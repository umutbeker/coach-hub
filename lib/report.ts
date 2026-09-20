// lib/report.ts
// Builds the scouting report for an opponent from Leaguepedia.
//
// This runs on the SERVER, not in the browser. Leaguepedia's rate limit is
// per-IP: built in the browser it spends the limit of whoever opens the page,
// and one person testing can lock their whole network out. Built here it
// spends Vercel's, once, and the result is shared through Redis.

import { lpQuery, cargo, type LpRow } from './leaguepedia';
import { parseVod } from './vod';
import { KEYS, get, put } from './store';
import { slug } from './hub';

export type Count = { name: string; n: number; w?: number };

export type RecentGame = {
  gameId: string; date: string; tournament: string; vs: string; won: boolean; side: 'blue' | 'red';
  theirPicks: string[]; theirBans: string[]; oppPicks: string[]; oppBans: string[];
  vod: string | null; minutes: number | null;
};

export type ReportPlayer = { name: string; role: string; games: number; wr: number; champs: Count[] };

export type Report = {
  opponent: string; builtAt: number; games: number; wins: number;
  side: { blue: { n: number; w: number }; red: { n: number; w: number } };
  avgMinutes: number | null;
  perGame: { dragons: number | null; barons: number | null; towers: number | null; grubs: number | null };
  firstPicks: Count[]; theirBans: Count[]; bannedAgainst: Count[]; picks: Count[];
  players: ReportPlayer[];
  recent: RecentGame[];
  brief?: { headline: string; points: { kind: string; text: string }[]; sampleWarning?: string };
  savedAt?: number;
  /** The player query was refused (rate limit), so `players` is empty. */
  partial?: boolean;
};

const LP_TEAM_ALIAS: Record<string, string> = {
  BIG: 'Berlin International Gaming',
  'The Otter Side': 'Otter Side',
};

const five = (m: LpRow, p: string) => [1, 2, 3, 4, 5].map(i => m[`${p}${i}`]).filter(Boolean);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function tally(names: string[], wins?: boolean[]): Count[] {
  const t: Record<string, { n: number; w: number }> = {};
  names.forEach((c, i) => { if (!c) return; t[c] ??= { n: 0, w: 0 }; t[c].n++; if (wins?.[i]) t[c].w++; });
  return Object.entries(t).map(([name, v]) => ({ name, n: v.n, w: v.w })).sort((a, b) => b.n - a.n);
}

export type BuildResult =
  | { ok: true; report: Report; partial: boolean }
  | { ok: false; reason: 'ratelimited' | 'empty' };

/**
 * Two queries, run one after the other — two at once is enough to trip the
 * rate limit. `deadline` bounds the retries so the function answers before a
 * serverless timeout.
 */
export async function buildReport(team: string, deadline: number): Promise<BuildResult> {
  // Providers spell some teams differently from Leaguepedia; the draft room
  // used to patch these names before querying, so the map lives here now.
  const t = (LP_TEAM_ALIAS[team] ?? team).replace(/"/g, '');

  const games = await lpQuery(cargo({
    tables: 'ScoreboardGames=SG,PicksAndBansS7=PB,MatchScheduleGame=MSG',
    join_on: 'SG.GameId=PB.GameId,SG.GameId=MSG.GameId',
    fields: [
      'SG.Team1', 'SG.Team2', 'SG.Winner', 'SG.Gamelength_Number', 'SG.DateTime_UTC', 'SG.Tournament', 'SG.GameId',
      'SG.Team1Dragons', 'SG.Team2Dragons', 'SG.Team1Barons', 'SG.Team2Barons', 'SG.Team1Towers', 'SG.Team2Towers',
      'SG.Team1VoidGrubs', 'SG.Team2VoidGrubs',
      ...[1, 2, 3, 4, 5].flatMap(i => [`PB.Team1Ban${i}`, `PB.Team2Ban${i}`, `PB.Team1Pick${i}`, `PB.Team2Pick${i}`]),
      'MSG.VodPB', 'MSG.Vod',
    ].join(','),
    where: `SG.Team1="${t}" OR SG.Team2="${t}"`,
    order_by: 'SG.DateTime_UTC DESC',
    limit: '30',
  }), `report/games/${t}`, deadline);
  if (games === null) return { ok: false, reason: 'ratelimited' };
  if (!games.length) return { ok: false, reason: 'empty' };

  // A refused player query must not pass as "this team has no players": the
  // report is marked partial instead, so it is never saved over a full one.
  const rowsOrNull = await lpQuery(cargo({
    tables: 'ScoreboardPlayers',
    fields: 'Name,Role,Champion,PlayerWin,DateTime_UTC',
    where: `Team="${t}"`,
    order_by: 'DateTime_UTC DESC',
    limit: '150',
  }), `report/players/${t}`, deadline);
  const rows = rowsOrNull ?? [];

  const recent: RecentGame[] = games.map(g => {
    const blue = g.Team1 === t;
    return {
      gameId: g.GameId,
      date: (g['DateTime UTC'] ?? g.DateTime_UTC ?? '').split(' ')[0],
      tournament: g.Tournament ?? '',
      vs: blue ? g.Team2 : g.Team1,
      won: (g.Winner === '1') === blue,
      side: blue ? 'blue' : 'red',
      theirPicks: five(g, blue ? 'Team1Pick' : 'Team2Pick'),
      theirBans: five(g, blue ? 'Team1Ban' : 'Team2Ban'),
      oppPicks: five(g, blue ? 'Team2Pick' : 'Team1Pick'),
      oppBans: five(g, blue ? 'Team2Ban' : 'Team1Ban'),
      vod: parseVod(g.VodPB)?.embed ?? parseVod(g.Vod)?.embed ?? null,
      minutes: num(g['Gamelength Number'] ?? g.Gamelength_Number),
    };
  });

  const side = (s: 'blue' | 'red') => {
    const x = recent.filter(r => r.side === s);
    return { n: x.length, w: x.filter(r => r.won).length };
  };
  const mine = (g: LpRow, k: string) => num(g[`${g.Team1 === t ? 'Team1' : 'Team2'}${k}`]);

  // Players: most games first; role is whatever they played most.
  const byPlayer: Record<string, { roles: string[]; champs: string[]; wins: boolean[] }> = {};
  rows.forEach(r => {
    const p = r.Name || '?';
    byPlayer[p] ??= { roles: [], champs: [], wins: [] };
    byPlayer[p].roles.push(r.Role || '');
    byPlayer[p].champs.push(r.Champion || '');
    byPlayer[p].wins.push(r.PlayerWin === 'Yes');
  });
  const players: ReportPlayer[] = Object.entries(byPlayer).map(([name, v]) => ({
    name,
    role: tally(v.roles)[0]?.name ?? '',
    games: v.champs.length,
    wr: Math.round((v.wins.filter(Boolean).length / v.champs.length) * 100),
    champs: tally(v.champs, v.wins).slice(0, 5),
  })).sort((a, b) => b.games - a.games).slice(0, 7);

  return {
    ok: true,
    partial: rowsOrNull === null,
    report: {
      partial: rowsOrNull === null,
      opponent: team,
      builtAt: Date.now(),
      games: recent.length,
      wins: recent.filter(r => r.won).length,
      side: { blue: side('blue'), red: side('red') },
      avgMinutes: avg(recent.map(r => r.minutes)),
      perGame: {
        dragons: avg(games.map(g => mine(g, 'Dragons'))),
        barons: avg(games.map(g => mine(g, 'Barons'))),
        towers: avg(games.map(g => mine(g, 'Towers'))),
        grubs: avg(games.map(g => mine(g, 'VoidGrubs'))),
      },
      // B1 — the first pick of the draft — only exists when they're on blue.
      firstPicks: tally(recent.filter(r => r.side === 'blue').map(r => r.theirPicks[0])).slice(0, 6),
      theirBans: tally(recent.flatMap(r => r.theirBans)).slice(0, 8),
      bannedAgainst: tally(recent.flatMap(r => r.oppBans)).slice(0, 8),
      picks: tally(recent.flatMap(r => r.theirPicks), recent.flatMap(r => r.theirPicks.map(() => r.won))).slice(0, 10),
      players,
      recent: recent.slice(0, 8),
    },
  };
}

const FRESH_MS = 3 * 24 * 60 * 60 * 1000;
const BUDGET_MS = 45_000;

export type ReportLookup = {
  report: Report | null;
  fromCache: boolean;
  stale?: boolean;
  reason?: 'ratelimited' | 'empty' | 'partial';
};

/**
 * The saved report, rebuilt from Leaguepedia only when it is missing, older
 * than three days, or explicitly refreshed. Every caller goes through this —
 * the Prep page, the draft room's scout panel and the daily cron — so an
 * opponent is fetched once and everyone reads the same copy.
 */
export async function getOrBuildReport(opponent: string, refresh = false): Promise<ReportLookup> {
  const key = slug(opponent);
  const saved = await get<Report>(KEYS.reports, key);
  const age = saved?.savedAt ?? saved?.builtAt ?? 0;

  if (saved && !refresh && Date.now() - age < FRESH_MS) {
    return { report: saved, fromCache: true };
  }

  const res = await buildReport(opponent, Date.now() + BUDGET_MS);

  if (!res.ok) {
    // A stale report beats no report; the caller says how old it is.
    if (saved) return { report: saved, fromCache: true, stale: true, reason: res.reason };
    return { report: null, fromCache: false, reason: res.reason };
  }

  // A partial build (the player query was refused) must not replace a full
  // saved report — the coach would lose the pools they already had.
  if (res.partial && saved?.players?.length) {
    return { report: saved, fromCache: true, stale: true, reason: 'partial' };
  }

  // Keep a brief written for an earlier build of the same opponent.
  const report: Report = { ...res.report, brief: saved?.brief, savedAt: Date.now() };
  await put(KEYS.reports, key, report);
  return { report, fromCache: false };
}
