// /app/api/overview/route.ts
// One read for the coach panel's summary cards: a line or two from every
// section of the hub. Redis only — nothing here calls Riot, Leaguepedia or
// PandaScore (the fixture has its own cached route).
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { KEYS, all, allAcross, allMap } from '../../../lib/store';
import { slug, type CalendarEvent, type DraftPlan, type ScrimGame, type Vod, type VodNote } from '../../../lib/hub';
import { TEAM_LP_NAME } from '../../../lib/team';

const redis = Redis.fromEnv();
const parse = <T,>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : (v as T));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type ProSeries = { date: string; teamA: string; teamB: string; scoreA: number; scoreB: number };

export async function GET() {
  const [scrims, vods, events, plans, reports, draftRaw, matchesRaw, lecRaw, lckRaw] = await Promise.all([
    all<ScrimGame>(KEYS.scrims),
    all<Vod>(KEYS.vods),
    all<CalendarEvent>(KEYS.calendar),
    allMap<DraftPlan>(KEYS.prep),
    allMap<{ builtAt?: number; savedAt?: number; brief?: unknown }>(KEYS.reports),
    redis.get('draft:current'),
    redis.get('matches:lp'),
    redis.get('vods:v2:lec'),
    redis.get('vods:v2:lck'),
  ]);
  const notes = await allAcross<VodNote>(vods.map(v => KEYS.notes(v.id)));
  const today = new Date().toISOString().slice(0, 10);

  // Scrims ────────────────────────────────────────────────────────────────
  const week = scrims.filter(g => g.date >= daysAgo(7));
  const blocks = new Map<string, { date: string; opponent: string; w: number; l: number }>();
  scrims.forEach(g => {
    const b = blocks.get(g.blockId) ?? { date: g.date, opponent: g.opponent, w: 0, l: 0 };
    if (g.result === 'W') b.w++; else b.l++;
    blocks.set(g.blockId, b);
  });
  const lastBlock = [...blocks.values()].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  // Review & feedback ─────────────────────────────────────────────────────
  const since14 = Date.now() - 14 * 86400000;
  const recentNotes = notes.filter(n => n.createdAt >= since14);
  const byPlayer: Record<string, number> = {};
  recentNotes.forEach(n => n.players.forEach(p => { byPlayer[p] = (byPlayer[p] ?? 0) + 1; }));
  const latestVod = [...vods].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  // Draft room / next opponent ────────────────────────────────────────────
  const draft = parse<{ opponent?: string | null; picks?: { blue: string[]; red: string[] }; lastUpdatedBy?: string; lastUpdatedAt?: number }>(draftRaw);
  const opp = draft?.opponent ?? null;
  const oppKey = opp ? slug(opp) : null;

  // Last official series, from the synced Leaguepedia rows (one row per
  // player per game, so games are de-duplicated by GameId first).
  let lastOfficial: { date: string; opponent: string; w: number; l: number } | null = null;
  const m = parse<{ cargoquery?: { title: Record<string, string> }[] }>(matchesRaw);
  if (m?.cargoquery?.length) {
    const games = new Map<string, { date: string; opponent: string; won: boolean }>();
    m.cargoquery.forEach(({ title: r }) => {
      if (games.has(r.GameId)) return;
      const us = r.Team === TEAM_LP_NAME;
      games.set(r.GameId, {
        date: (r['DateTime UTC'] ?? r.DateTime_UTC ?? '').slice(0, 10),
        opponent: us ? r.TeamVs : r.Team,
        won: us ? r.PlayerWin === 'Yes' : r.PlayerWin !== 'Yes',
      });
    });
    const sorted = [...games.values()].sort((a, b) => b.date.localeCompare(a.date));
    const head = sorted[0];
    if (head) {
      const cutoff = new Date(new Date(head.date).getTime() - 3 * 86400000).toISOString().slice(0, 10);
      const series = sorted.filter(g => g.opponent === head.opponent && g.date >= cutoff);
      lastOfficial = { date: head.date, opponent: head.opponent, w: series.filter(g => g.won).length, l: series.filter(g => !g.won).length };
    }
  }

  const proLatest = (raw: unknown) => {
    const d = parse<{ series?: ProSeries[] }>(raw);
    const s = d?.series?.[0];
    return s ? { date: s.date, teamA: s.teamA, teamB: s.teamB, scoreA: s.scoreA, scoreB: s.scoreB, count: d!.series!.length } : null;
  };

  return NextResponse.json({
    scrims: {
      total: scrims.length,
      w: scrims.filter(g => g.result === 'W').length,
      week: { n: week.length, w: week.filter(g => g.result === 'W').length },
      lastBlock,
    },
    review: {
      vods: vods.length,
      notesWeek: notes.filter(n => n.createdAt >= Date.now() - 7 * 86400000).length,
      latestVod: latestVod && { id: latestVod.id, title: latestVod.title, date: latestVod.date },
    },
    feedback: { byPlayer, total14: recentNotes.length },
    calendar: {
      next: events.filter(e => e.date >= today)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .slice(0, 3)
        .map(e => ({ id: e.id, type: e.type, title: e.title, date: e.date, time: e.time, opponent: e.opponent })),
    },
    prep: {
      opponent: opp,
      hasPlan: !!(oppKey && plans[oppKey]),
      report: oppKey && reports[oppKey] ? { builtAt: reports[oppKey].savedAt ?? reports[oppKey].builtAt ?? null, hasBrief: !!reports[oppKey].brief } : null,
      plans: Object.keys(plans).length,
    },
    official: lastOfficial,
    pro: { lec: proLatest(lecRaw), lck: proLatest(lckRaw) },
    draft: draft ? {
      opponent: opp,
      picks: [...(draft.picks?.blue ?? []), ...(draft.picks?.red ?? [])].filter(Boolean).length,
      updatedBy: draft.lastUpdatedBy ?? null,
      updatedAt: draft.lastUpdatedAt ?? null,
    } : null,
  });
}
