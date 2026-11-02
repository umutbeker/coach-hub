// /app/api/owner/route.ts
//
// The handful of figures the owner dashboard needs that /api/overview does not
// already carry: the season record, where each player sits in solo queue, and
// how much of the champion pool is actually rated.
//
// Deliberately small. The owner page reads this alongside /api/overview,
// /api/fixture and /api/tournaments rather than this route re-deriving what
// those already serve — a second copy of the overview aggregation is exactly
// the kind of duplication this codebase keeps paying for.
//
// Redis only. Nothing here calls Riot, Leaguepedia or PandaScore.

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { KEYS, allMap } from '../../../lib/store';
import { USERS } from '../../../lib/users';
import { TEAM_LP_NAME } from '../../../lib/team';

const redis = Redis.fromEnv();
const parse = <T,>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : (v as T));

const ROSTER = USERS.filter(u => u.role === 'player' && u.riotId).map(u => u.name);

type PlayerBlob = {
  rank?: string; tier?: string; lp?: number; wins?: number; losses?: number;
  overallWinRate?: number; recentWinRate?: number; streak?: number; _updatedAt?: string;
};

export async function GET() {
  const [matchesRaw, poolRaw, syncedAt, ...playerBlobs] = await Promise.all([
    redis.get('matches:lp'),
    allMap<Record<string, string>>(KEYS.pool),
    redis.get('sync:updatedAt'),
    ...ROSTER.map(n => redis.get(`player:${n}`)),
  ]);

  /*
   * Official record for the season.
   *
   * matches:lp is one row per player per game, so games are de-duplicated by
   * GameId first — counting rows would multiply every result by five.
   */
  const games = new Map<string, { date: string; opponent: string; won: boolean; tournament: string }>();
  const m = parse<{ cargoquery?: { title: Record<string, string> }[] }>(matchesRaw);
  for (const { title: r } of m?.cargoquery ?? []) {
    if (games.has(r.GameId)) continue;
    const us = r.Team === TEAM_LP_NAME;
    games.set(r.GameId, {
      date: (r['DateTime UTC'] ?? r.DateTime_UTC ?? '').slice(0, 10),
      opponent: us ? r.TeamVs : r.Team,
      won: us ? r.PlayerWin === 'Yes' : r.PlayerWin !== 'Yes',
      tournament: r.Tournament ?? '',
    });
  }
  const all = [...games.values()].sort((a, b) => b.date.localeCompare(a.date));
  const wins = all.filter(g => g.won).length;

  // Last ten games, newest first — the shape of current form, not a total.
  const form = all.slice(0, 10).map(g => (g.won ? 'W' : 'L'));

  const players = ROSTER.map((name, i) => {
    const p = parse<PlayerBlob>(playerBlobs[i]);
    const rated = poolRaw[name] ?? {};
    const tiers = Object.values(rated);
    return {
      name,
      rank: p?.rank ?? null,
      lp: p?.lp ?? null,
      wins: p?.wins ?? null,
      losses: p?.losses ?? null,
      winRate: p?.overallWinRate ?? null,
      recentWinRate: p?.recentWinRate ?? null,
      // null means the sync never wrote this player — a dead Riot key looks
      // exactly like a player who stopped playing, so say which it is.
      synced: !!p,
      pool: {
        ready: tiers.filter(t => t === 'ready').length,
        practice: tiers.filter(t => t === 'practice').length,
        total: tiers.length,
      },
    };
  });

  return NextResponse.json({
    official: {
      games: all.length,
      wins,
      losses: all.length - wins,
      winRate: all.length ? Math.round((wins / all.length) * 100) : null,
      form,
      tournaments: [...new Set(all.map(g => g.tournament).filter(Boolean))].slice(0, 4),
      last: all[0] ?? null,
    },
    players,
    syncedAt: typeof syncedAt === 'string' ? syncedAt : null,
    rosterSize: ROSTER.length,
  });
}
