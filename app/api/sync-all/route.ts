// /app/api/sync-all/route.ts
// The daily cron, split across two runs.
//
// Riot's development key allows 100 requests per 2 minutes, and one player
// costs roughly 28 of them (account, rank, 20 match details, 5 timelines). All
// five players in a single pass is ~140 calls, so the later ones were answered
// 429, retried past the 55s per-player timeout, and quietly skipped — a
// partial sync that reported success. Measured: with ~70s between players they
// all complete; back to back they do not.
//
// On the Hobby plan a function may run 60s and a project may have two cron
// jobs, each once a day. So the work is split into two runs an hour apart,
// each sized to fit inside one Riot window rather than paced with sleeps a
// 60s function cannot afford. `?part=` selects which; no part does everything,
// which is still the right behaviour for a manual run on a roomier key.

import { NextResponse } from 'next/server';
import { USERS } from '../../../lib/users';

const PLAYERS = USERS.filter(u => u.role === 'player' && u.riotId).map(u => u.name);

/** Riot-heavy work first, then the Leaguepedia/PandaScore work that is not. */
const PART_1 = PLAYERS.slice(0, 3);
const PART_2 = PLAYERS.slice(3);

export async function GET(request: Request) {
  /*
   * The stable production domain, not VERCEL_URL.
   *
   * VERCEL_URL is the deployment-specific host, which sits behind Deployment
   * Protection: every sub-request to it came back as Vercel's HTML login page,
   * so each step failed with "Unexpected token '<'" and the cron did nothing
   * at all. VERCEL_PROJECT_PRODUCTION_URL is the public alias.
   */
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const baseUrl = host ? `https://${host}` : 'http://localhost:3000';

  const part = new URL(request.url).searchParams.get('part');
  const players = part === '1' ? PART_1 : part === '2' ? PART_2 : PLAYERS;
  // The non-Riot work rides along with part 2, so part 1 spends its whole
  // Riot window on players.
  const doTheRest = part !== '1';

  const results: { player: string; success: boolean; error?: string; errors?: string[] }[] = [];

  const step = async (label: string, url: string, timeout = 55000) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      const data = await res.json();
      // /api/sync answers success:true even when a Riot call inside it failed,
      // reporting the failure in `errors`. A step that logged an error is not
      // a step that worked.
      const ok = (data.success ?? res.ok) && !(data.errors?.length);
      results.push({ player: label, success: ok, error: data.error, errors: data.errors });
    } catch (e) {
      results.push({ player: label, success: false, error: e instanceof Error ? e.message : 'failed' });
    }
  };

  for (const player of players) {
    await step(player, `${baseUrl}/api/sync?player=${encodeURIComponent(player)}`);
  }

  if (doTheRest) {
    await step('matches', `${baseUrl}/api/sync?player=matches`);
    // Public /pro reads vods:* from Redis; this is what fills it.
    await step('pro-vods', `${baseUrl}/api/pro-vods?refresh=true`);

    // Pre-build the scouting report for whoever is set as the next opponent,
    // so the coach opens a ready report instead of waiting for Leaguepedia.
    try {
      const draft = await fetch(`${baseUrl}/api/draft`, { signal: AbortSignal.timeout(20000) }).then(r => r.json());
      if (draft?.opponent) {
        await step('opponent-report', `${baseUrl}/api/opponent-report?opponent=${encodeURIComponent(draft.opponent)}&refresh=true`);
      }
    } catch (e) {
      results.push({ player: 'opponent-report', success: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  const failed = results.filter(r => !r.success);
  return NextResponse.json({
    baseUrl,
    // Don't claim success when half the steps failed — that is what made a
    // partial sync invisible.
    success: failed.length === 0,
    part: part ?? 'all',
    updatedAt: new Date().toISOString(),
    failed: failed.map(f => f.player),
    results,
  });
}
