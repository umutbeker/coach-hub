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
  /** Picks in DRAFT order (their 1st pick first), not by role. */
  theirPicks: string[]; theirBans: string[]; oppPicks: string[]; oppBans: string[];
  /** Role of each pick, same index as `theirPicks` — verified against Leaguepedia. */
  theirRoles: string[]; oppRoles: string[];
  patch: string;
  /** Shared by every game of a series; `gameNo` is its place in that series. */
  matchId: string; gameNo: number;
  /** VodPB — the broadcast seeked to the draft. */
  vod: string | null;
  /** VodGameStart — the same broadcast seeked to first blood-ish. */
  vodGame: string | null;
  minutes: number | null;
};

/**
 * A BO3/BO5 as one row. Games of a series already share `MatchId` on
 * Leaguepedia, so this is read rather than inferred from dates and names.
 * Sides swap between games, so the score counts wins by team — counting by
 * blue/red would be wrong.
 */
export type RecentSeries = {
  matchId: string;
  date: string;
  tournament: string;
  vs: string;
  /** Games won by them and by the opponent. Not the format: a BO5 can end 3-1. */
  us: number; them: number;
  won: boolean;
  patch: string;
  games: RecentGame[];
};

// ── Draft analysis ──────────────────────────────────────────────────────────
// What a coach actually asks before a draft: what do they take first, what do
// they never let through, what do they ban. All of it scoped to the current
// patch, because a pick priority from three patches ago is not their priority.

/**
 * A team's own 1st–5th pick, grouped the way the draft actually rotates.
 * Blue picks 1st, then red answers with two, blue takes two, and so on, so
 * "their 2nd pick" means something different on each side.
 */
export type SlotKey = 'B1' | 'B2-3' | 'B4-5' | 'R1-2' | 'R3' | 'R4-5';

export type SlotStat = {
  key: SlotKey;
  side: 'blue' | 'red';
  /** What this slot is for, in draft language. */
  label: string;
  /** How many picks were made in this slot across the window. */
  n: number;
  champs: Count[];
  /** Which roles they spend this slot on — "first pick is a jungler" etc. */
  roles: Count[];
};

/**
 * How often they take a champion when it is actually available to them.
 * A champion picked 4 times out of 4 games where nobody banned it is a very
 * different signal from one picked 4 times out of 20 — raw pick counts hide
 * that completely.
 */
export type PriorityChamp = {
  name: string;
  /** Games in the window where neither team banned it. */
  open: number;
  /** Of those, how many times they took it. */
  picked: number;
  /** Of those, how many times the OTHER team took it instead. */
  conceded: number;
  /** picked / open, as a percentage. */
  rate: number;
  wins: number;
};

/** One game's draft, kept whole so a winning composition can be read as one. */
export type DraftComp = {
  gameId: string;
  side: 'blue' | 'red';
  vs: string;
  /** In draft order, with the role of each pick at the same index. */
  picks: string[];
  roles: string[];
};

/**
 * Bump whenever `DraftAnalysis` gains or changes a field.
 *
 * Saved reports outlive the shape that produced them. Checking only that
 * `draft` exists let a report built before `comps` was added pass the
 * freshness test and reach a page that reads `d.comps.won` — a client-side
 * crash, not a missing section. The version makes an out-of-date shape
 * rebuild the same way `/pro` bumps its cache key.
 */
export const ANALYSIS_VERSION = 2;

export type DraftAnalysis = {
  /** `ANALYSIS_VERSION` at the time it was built. */
  v: number;
  /** Patches included, newest first. Usually one. */
  patches: string[];
  /** True when the newest patch alone had too few games and we widened. */
  widened: boolean;
  games: number;
  wins: number;
  side: { blue: { n: number; w: number }; red: { n: number; w: number } };
  slots: SlotStat[];
  /** Their own bans, split by rotation: 1–3 are blind, 4–5 answer the picks. */
  bans: { first: Count[]; second: Count[] };
  /** What gets banned AGAINST them — the pool other teams respect. */
  bannedAgainst: { first: Count[]; second: Count[] };
  priority: PriorityChamp[];
  bySide: { blue: Count[]; red: Count[] };
  byRole: { role: string; champs: Count[] }[];
  /** Champions they have put in more than one role. */
  flex: { name: string; roles: Count[] }[];
  /**
   * Every champion they picked at least twice, sorted by record.
   * Their *losses* are the half a scouting report usually omits: knowing what
   * they keep losing with is worth as much as knowing their comfort picks,
   * and it is the same column of data read from the other end.
   */
  record: Count[];
  /** Whole drafts, split by how the game went. */
  comps: { won: DraftComp[]; lost: DraftComp[] };
};

export type ReportPlayer = {
  name: string; role: string; games: number; wr: number;
  /** Most played. */
  champs: Count[];
  /** Their losing picks — a losing record on 2+ games, worst first. */
  weak: Count[];
};

export type Report = {
  opponent: string; builtAt: number; games: number; wins: number;
  side: { blue: { n: number; w: number }; red: { n: number; w: number } };
  avgMinutes: number | null;
  perGame: { dragons: number | null; barons: number | null; towers: number | null; grubs: number | null };
  firstPicks: Count[]; theirBans: Count[]; bannedAgainst: Count[]; picks: Count[];
  players: ReportPlayer[];
  /** Flat game list. The draft room's scout panel still renders this. */
  recent: RecentGame[];
  /** The same games collapsed into series — what Prep lists. */
  series?: RecentSeries[];
  /** Current-patch draft scouting — the part a coach reads before a draft. */
  draft?: DraftAnalysis;
  /** Every patch in the fetched window with its game count, newest first. */
  patchCounts?: { patch: string; n: number }[];
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

/**
 * Picks and their roles as one aligned pair list.
 * Filtering the two columns separately would silently misalign them whenever a
 * role is blank — pick 3 would be labelled with pick 4's role — so they are
 * zipped first and dropped together.
 */
function picksWithRoles(m: LpRow, side: 'Team1' | 'Team2') {
  const p = [1, 2, 3, 4, 5]
    .map(i => ({ champ: m[`${side}Pick${i}`] ?? '', role: m[`${side}Role${i}`] ?? '' }))
    .filter(x => x.champ);
  return { champs: p.map(x => x.champ), roles: p.map(x => x.role) };
}
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

/**
 * Games collapsed into the series they belong to, newest first.
 *
 * Leaguepedia already shares `MatchId` across a series, so nothing is guessed
 * from dates or team names. Within a series the games are ordered by
 * `N_GameInMatch`, which is the only reliable order — several games of one
 * series can carry the same timestamp.
 */
export function groupSeries(games: RecentGame[]): RecentSeries[] {
  const by = new Map<string, RecentGame[]>();
  for (const g of games) {
    if (!by.has(g.matchId)) by.set(g.matchId, []);
    by.get(g.matchId)!.push(g);
  }
  return [...by.values()]
    .map(gs => {
      const ordered = [...gs].sort((a, b) => a.gameNo - b.gameNo);
      const first = ordered[0];
      const us = ordered.filter(g => g.won).length;
      return {
        matchId: first.matchId,
        date: first.date,
        tournament: first.tournament,
        vs: first.vs,
        us, them: ordered.length - us,
        won: us > ordered.length - us,
        patch: first.patch,
        games: ordered,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── Draft analysis ──────────────────────────────────────────────────────────

/** "26.17" sorts after "26.9" — string compare would get that backwards. */
function patchRank(p: string): number {
  const [a, b] = p.split('.').map(Number);
  return (Number.isFinite(a) ? a : 0) * 1000 + (Number.isFinite(b) ? b : 0);
}

/**
 * Below this, one patch is not a read — it is a coincidence, so older patches
 * are folded in and the report says it widened.
 */
const MIN_DRAFT_GAMES = 8;

const SLOTS: { key: SlotKey; side: 'blue' | 'red'; label: string; idx: number[] }[] = [
  // Blue picks 1st, 4th-5th, 8th-9th overall; red picks 2nd-3rd, 6th, 10th.
  { key: 'B1', side: 'blue', label: 'First pick of the draft', idx: [0] },
  { key: 'B2-3', side: 'blue', label: 'Blue 2nd–3rd', idx: [1, 2] },
  { key: 'B4-5', side: 'blue', label: 'Blue last two', idx: [3, 4] },
  { key: 'R1-2', side: 'red', label: 'Red answer to first pick', idx: [0, 1] },
  { key: 'R3', side: 'red', label: 'Red 3rd', idx: [2] },
  { key: 'R4-5', side: 'red', label: 'Red last two (counter pick)', idx: [3, 4] },
];

/**
 * Everything the draft screen needs, computed over one patch.
 *
 * Scoped deliberately: a pick priority from three patches ago is not their
 * priority, and a coach reading 50 games of mixed patches reads the average of
 * two different metas.
 */
export function analyseDraft(all: RecentGame[]): DraftAnalysis | undefined {
  const dated = all.filter(g => g.patch);
  if (!dated.length) return undefined;

  const order = [...new Set(dated.map(g => g.patch))].sort((a, b) => patchRank(b) - patchRank(a));

  // Newest patch first, widening only until the sample is readable.
  const patches: string[] = [];
  let games: RecentGame[] = [];
  for (const p of order) {
    patches.push(p);
    games = dated.filter(g => patches.includes(g.patch));
    if (games.length >= MIN_DRAFT_GAMES) break;
  }

  const side = (s: 'blue' | 'red') => {
    const x = games.filter(g => g.side === s);
    return { n: x.length, w: x.filter(g => g.won).length };
  };

  const slots: SlotStat[] = SLOTS.map(s => {
    const g = games.filter(x => x.side === s.side);
    const champs: string[] = [], wins: boolean[] = [], roles: string[] = [];
    g.forEach(x => s.idx.forEach(i => {
      if (!x.theirPicks[i]) return;
      champs.push(x.theirPicks[i]); wins.push(x.won); roles.push(x.theirRoles[i] || '');
    }));
    return { key: s.key, side: s.side, label: s.label, n: champs.length, champs: tally(champs, wins).slice(0, 8), roles: tally(roles).slice(0, 5) };
  }).filter(s => s.n > 0);

  const rotation = (pick: (g: RecentGame) => string[], from: number, to: number) =>
    tally(games.flatMap(g => pick(g).slice(from, to))).slice(0, 8);

  // What they take when nobody takes it away from them. The denominator is
  // what makes this a read: 4-for-4 and 4-of-20 are opposite signals.
  const seen = new Map<string, { picked: number; wins: number; conceded: number; open: number }>();
  const touch = (c: string) => {
    if (!seen.has(c)) seen.set(c, { picked: 0, wins: 0, conceded: 0, open: 0 });
    return seen.get(c)!;
  };
  games.forEach(g => {
    g.theirPicks.forEach(c => { const e = touch(c); e.picked++; if (g.won) e.wins++; });
    g.oppPicks.forEach(c => { touch(c).conceded++; });
  });
  games.forEach(g => {
    const banned = new Set([...g.theirBans, ...g.oppBans]);
    seen.forEach((e, c) => { if (!banned.has(c)) e.open++; });
  });

  const priority: PriorityChamp[] = [...seen.entries()]
    .filter(([, e]) => e.picked >= 2 && e.open > 0)
    .map(([name, e]) => ({
      name, open: e.open, picked: e.picked, conceded: e.conceded,
      rate: Math.round((e.picked / e.open) * 100), wins: e.wins,
    }))
    .sort((a, b) => b.rate - a.rate || b.picked - a.picked)
    .slice(0, 12);

  const byRoleMap: Record<string, { champs: string[]; wins: boolean[] }> = {};
  const champRoles: Record<string, string[]> = {};
  games.forEach(g => g.theirPicks.forEach((c, i) => {
    const r = g.theirRoles[i] || 'Unknown';
    byRoleMap[r] ??= { champs: [], wins: [] };
    byRoleMap[r].champs.push(c); byRoleMap[r].wins.push(g.won);
    (champRoles[c] ??= []).push(r);
  }));

  const ROLE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
  const byRole = Object.entries(byRoleMap)
    .map(([role, v]) => ({ role, champs: tally(v.champs, v.wins).slice(0, 8) }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  const flex = Object.entries(champRoles)
    .map(([name, rs]) => ({ name, roles: tally(rs) }))
    .filter(f => f.roles.length > 1)
    .sort((a, b) => b.roles.length - a.roles.length);

  const picksOn = (s: 'blue' | 'red') => {
    const g = games.filter(x => x.side === s);
    return tally(g.flatMap(x => x.theirPicks), g.flatMap(x => x.theirPicks.map(() => x.won))).slice(0, 10);
  };

  // Their record on each champion, best first. `tally` already carries wins,
  // so this is the same data the pick lists use, sorted by outcome instead of
  // by volume. Two games is the floor at which a record means anything.
  const record = tally(
    games.flatMap(g => g.theirPicks),
    games.flatMap(g => g.theirPicks.map(() => g.won)),
  )
    .filter(c => c.n >= 2)
    .sort((a, b) => ((b.w ?? 0) / b.n) - ((a.w ?? 0) / a.n) || b.n - a.n);

  const comp = (g: RecentGame): DraftComp => ({
    gameId: g.gameId, side: g.side, vs: g.vs, picks: g.theirPicks, roles: g.theirRoles,
  });

  return {
    v: ANALYSIS_VERSION,
    patches, widened: patches.length > 1,
    games: games.length, wins: games.filter(g => g.won).length,
    side: { blue: side('blue'), red: side('red') },
    slots,
    bans: { first: rotation(g => g.theirBans, 0, 3), second: rotation(g => g.theirBans, 3, 5) },
    bannedAgainst: { first: rotation(g => g.oppBans, 0, 3), second: rotation(g => g.oppBans, 3, 5) },
    priority, bySide: { blue: picksOn('blue'), red: picksOn('red') }, byRole, flex,
    record,
    comps: {
      won: games.filter(g => g.won).map(comp),
      lost: games.filter(g => !g.won).map(comp),
    },
  };
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
      'SG.Team1VoidGrubs', 'SG.Team2VoidGrubs', 'SG.Patch', 'SG.MatchId', 'SG.N_GameInMatch',
      // RoleN describes PickN, and PickN is the team's Nth pick in DRAFT
      // order — both verified against Leaguepedia, not assumed.
      ...[1, 2, 3, 4, 5].flatMap(i => [
        `PB.Team1Ban${i}`, `PB.Team2Ban${i}`, `PB.Team1Pick${i}`, `PB.Team2Pick${i}`,
        `PB.Team1Role${i}`, `PB.Team2Role${i}`,
      ]),
      'MSG.VodPB', 'MSG.VodGameStart', 'MSG.Vod',
    ].join(','),
    where: `SG.Team1="${t}" OR SG.Team2="${t}"`,
    order_by: 'SG.DateTime_UTC DESC',
    // Wider than we analyse on purpose: the draft window is one patch, but the
    // window has to be *chosen* from something, and more fields on the same
    // query cost nothing against the rate limit.
    limit: '50',
  }), `report/games/${t}`, deadline);
  if (games === null) return { ok: false, reason: 'ratelimited' };
  if (!games.length) return { ok: false, reason: 'empty' };

  /*
   * The exact name Leaguepedia spells, which is not necessarily the one we
   * searched for.
   *
   * Cargo's WHERE is case-insensitive while JavaScript's === is not, so
   * querying "skillcamp" happily returned 20 rows of "Skillcamp" and then
   * matched none of them to us. Every game fell through to the red-side
   * branch: the opponent came out as the team itself, the result was read off
   * the wrong side, and `theirPicks` was the OTHER team's draft — a whole
   * report of confidently wrong data, with nothing that looked like an error.
   */
  const lc = t.toLowerCase();
  const canon = games.reduce<string | null>((found, g) =>
    found
    ?? ((g.Team1 ?? '').toLowerCase() === lc ? g.Team1
      : (g.Team2 ?? '').toLowerCase() === lc ? g.Team2 : null), null) ?? t;

  // A refused player query must not pass as "this team has no players": the
  // report is marked partial instead, so it is never saved over a full one.
  const rowsOrNull = await lpQuery(cargo({
    tables: 'ScoreboardPlayers',
    fields: 'Name,Role,Champion,PlayerWin,DateTime_UTC',
    where: `Team="${canon}"`,
    order_by: 'DateTime_UTC DESC',
    limit: '150',
  }), `report/players/${t}`, deadline);
  const rows = rowsOrNull ?? [];

  const recent: RecentGame[] = games.map(g => {
    const blue = g.Team1 === canon;
    const theirs = picksWithRoles(g, blue ? 'Team1' : 'Team2');
    const opp = picksWithRoles(g, blue ? 'Team2' : 'Team1');
    return {
      gameId: g.GameId,
      date: (g['DateTime UTC'] ?? g.DateTime_UTC ?? '').split(' ')[0],
      tournament: g.Tournament ?? '',
      vs: blue ? g.Team2 : g.Team1,
      won: (g.Winner === '1') === blue,
      side: blue ? 'blue' : 'red',
      theirPicks: theirs.champs,
      theirRoles: theirs.roles,
      oppPicks: opp.champs,
      oppRoles: opp.roles,
      theirBans: five(g, blue ? 'Team1Ban' : 'Team2Ban'),
      oppBans: five(g, blue ? 'Team2Ban' : 'Team1Ban'),
      patch: g.Patch ?? '',
      // A game with no MatchId is its own series rather than joining everyone
      // else's under the empty key.
      matchId: g.MatchId || g.GameId,
      gameNo: Number(g['N GameInMatch'] ?? g.N_GameInMatch) || 0,
      vod: parseVod(g.VodPB)?.embed ?? parseVod(g.Vod)?.embed ?? null,
      vodGame: parseVod(g.VodGameStart)?.embed ?? null,
      minutes: num(g['Gamelength Number'] ?? g.Gamelength_Number),
    };
  });

  const side = (s: 'blue' | 'red') => {
    const x = recent.filter(r => r.side === s);
    return { n: x.length, w: x.filter(r => r.won).length };
  };
  const mine = (g: LpRow, k: string) => num(g[`${g.Team1 === canon ? 'Team1' : 'Team2'}${k}`]);

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
    // The same tally read from the other end. A pool is not only what someone
    // plays a lot; it is also what they keep losing on, which a top-5 hides.
    weak: tally(v.champs, v.wins)
      .filter(c => c.n >= 2 && (c.w ?? 0) / c.n < 0.5)
      .sort((a, b) => ((a.w ?? 0) / a.n) - ((b.w ?? 0) / b.n) || b.n - a.n)
      .slice(0, 3),
  })).sort((a, b) => b.games - a.games).slice(0, 7);

  return {
    ok: true,
    partial: rowsOrNull === null,
    report: {
      partial: rowsOrNull === null,
      // Leaguepedia's spelling, not whatever was typed into the box.
      opponent: canon,
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
      // Built from the whole window, then trimmed: slicing games first would
      // cut a BO5 in half and show it as a 2-1.
      series: groupSeries(recent).slice(0, 6),
      draft: analyseDraft(recent),
      patchCounts: Object.entries(
        recent.reduce<Record<string, number>>((a, g) => (g.patch ? { ...a, [g.patch]: (a[g.patch] ?? 0) + 1 } : a), {}),
      ).map(([patch, n]) => ({ patch, n })).sort((a, b) => patchRank(b.patch) - patchRank(a.patch)),
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

  /*
   * A saved report is only reusable if it is also *correct*. Two ways it is
   * not, both of which outlive their three days otherwise:
   *  - an analysis built to an older shape. `draft` existing is not enough:
   *    one built before `comps` was added still passed that test and reached
   *    a page that reads `d.comps.won`, which is a client-side crash rather
   *    than a missing section.
   *  - a game whose opponent is the team itself: the signature of the
   *    case-sensitivity bug above, which wrote whole reports off the wrong
   *    side of every game. Those are wrong, not stale.
   */
  const current = saved?.draft?.v === ANALYSIS_VERSION;
  const selfPlayed = !!saved?.recent?.some(g => g.vs === saved.opponent);
  if (current && !selfPlayed && !refresh && Date.now() - age < FRESH_MS) {
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
