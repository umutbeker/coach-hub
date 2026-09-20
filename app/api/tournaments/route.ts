// /app/api/tournaments/route.ts
//
// The schedule of a tracked competition, normalised and cached in Redis.
//
// Read path, not a cron. `/api/sync` is daily because Riot is slow and its
// data changes once a day; a tournament schedule changes the moment an
// organiser announces a time or a game ends, so this route refreshes itself
// whenever the copy it is about to serve has gone stale (see `ttlMs`), and
// tells every open page over Pusher when it does. A viewer's poll is what
// triggers the refresh, so nothing runs while nobody is watching, and one
// refresh serves everybody rather than each tab calling PandaScore.
//
// The cached value carries `updatedAt` instead of using a Redis TTL, because
// an expired key cannot be served: when PandaScore fails we return the older
// copy with `stale: true` rather than an error, the same way the opponent
// report does.

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import Pusher from 'pusher';
import {
  findLeague, isFresh, isOurTeam,
  type LeagueSchedule, type TMatch, type TStage, type TStanding, type TStream, type TTeam,
} from '../../../lib/tournaments';

const redis = Redis.fromEnv();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

// v1: bump when the payload shape changes, so a differently-shaped cached
// value can never reach the page.
const key = (slug: string) => `tour:v1:${slug}`;
const lockKey = (slug: string) => `tour:lock:${slug}`;

const PS = 'https://api.pandascore.co';

async function ps(path: string) {
  const res = await fetch(`${PS}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.PANDASCORE_API_KEY}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PandaScore ${res.status} on ${path}`);
  const body = await res.json();
  // PandaScore answers errors with an object, successes with an array.
  if (!Array.isArray(body)) throw new Error(body?.error ?? 'unexpected PandaScore response');
  return body as any[];
}

// ── Normalisation ───────────────────────────────────────────────────────────

function team(raw: any): TTeam | null {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    name: raw.name ?? 'TBD',
    acronym: raw.acronym ?? null,
    image: raw.image_url ?? null,
    ours: isOurTeam(raw.name, raw.acronym),
  };
}

function streams(raw: any[]): TStream[] {
  return (raw ?? [])
    .filter(s => s?.raw_url)
    .map(s => ({
      url: s.raw_url as string,
      embed: s.embed_url ?? null,
      platform: /twitch/i.test(s.raw_url) ? 'twitch' as const
        : /youtu/i.test(s.raw_url) ? 'youtube' as const
        : 'other' as const,
      language: (s.language ?? '').toLowerCase(),
      main: !!s.main,
      official: !!s.official,
    }))
    // The broadcast the organiser calls main first, then the other official
    // ones; co-streams last.
    .sort((a, b) => Number(b.main) - Number(a.main) || Number(b.official) - Number(a.official));
}

/**
 * PandaScore names a match "Round of 16 Match 4: TBD vs TBD" or
 * "Grand final: ANB vs JSK". The half before the colon is the round label; the
 * half after duplicates the teams we already render.
 */
function round(name?: string | null): string | null {
  if (!name) return null;
  const head = (name.includes(':') ? name.slice(0, name.indexOf(':')) : name).trim();
  // "TBD vs TBD" with no round in front of it is not a label.
  if (!head || /\bvs\.?\b/i.test(head)) return null;
  return head;
}

function match(m: any): TMatch {
  const [a, b] = (m.opponents ?? []).map((o: any) => team(o?.opponent));
  const teamA = a ?? null;
  const teamB = b ?? null;

  const results: Record<number, number> = {};
  (m.results ?? []).forEach((r: any) => { if (r?.team_id) results[r.team_id] = r.score ?? 0; });

  const status: TMatch['status'] =
    m.status === 'running' ? 'live'
      : m.status === 'finished' ? 'finished'
      : m.scheduled_at ? 'scheduled'
      : 'tba';

  return {
    id: m.id,
    round: round(m.name),
    scheduledAt: m.scheduled_at ?? null,
    bestOf: m.number_of_games ?? 1,
    status,
    teamA,
    teamB,
    scoreA: teamA ? results[teamA.id] ?? null : null,
    scoreB: teamB ? results[teamB.id] ?? null : null,
    winnerId: m.winner_id ?? null,
    ours: !!(teamA?.ours || teamB?.ours),
    streams: streams(m.streams_list),
  };
}

function standings(rows: any[]): TStanding[] {
  const table = rows
    .map(r => {
      const t = team(r?.team);
      if (!t) return null;
      return {
        rank: r.rank ?? 0,
        team: t,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        gameWins: r.game_wins ?? 0,
        gameLosses: r.game_losses ?? 0,
      };
    })
    .filter((r): r is TStanding => !!r)
    .sort((a, b) => a.rank - b.rank);

  // A bracket answers with a seeding order and no record — every row 0–0.
  // A table of zeroes reads as "nobody has played", which is the opposite of
  // what it means, so it is better shown as no table at all.
  return table.some(r => r.wins || r.losses || r.gameWins || r.gameLosses) ? table : [];
}

// ── Build ───────────────────────────────────────────────────────────────────

async function build(slug: string): Promise<LeagueSchedule> {
  const league = findLeague(slug);
  const id = league.pandascoreId;
  const q = `filter%5Bleague_id%5D=${id}`;

  const [running, upcoming, past] = await Promise.all([
    ps(`/lol/matches/running?${q}&per_page=20`),
    ps(`/lol/matches/upcoming?${q}&per_page=100&sort=scheduled_at`),
    ps(`/lol/matches/past?${q}&per_page=100&sort=-scheduled_at`),
  ]);

  const all = [...running, ...upcoming, ...past];

  // The current split: whatever the next match belongs to, or the last one
  // played if the league is between splits. Showing every serie at once would
  // put three seasons of the same group stage on one page.
  const serieOf = (m: any) => m?.serie?.id as number | undefined;
  const currentSerie =
    serieOf(running[0]) ?? serieOf(upcoming[0]) ?? serieOf(past[0]) ?? null;

  const serieName =
    (running[0] ?? upcoming[0] ?? past[0])?.serie?.full_name ??
    (running[0] ?? upcoming[0] ?? past[0])?.serie?.name ?? '';

  const seen = new Set<number>();
  const stages = new Map<number, TStage>();

  for (const m of all) {
    if (currentSerie && serieOf(m) !== currentSerie) continue;
    if (seen.has(m.id)) continue;   // a live match also shows up in upcoming
    seen.add(m.id);

    const stageId = m.tournament?.id ?? 0;
    if (!stages.has(stageId)) {
      stages.set(stageId, { id: stageId, name: m.tournament?.name ?? 'Schedule', matches: [], standings: [] });
    }
    stages.get(stageId)!.matches.push(match(m));
  }

  // Standings exist for round-robin stages only; a bracket answers 404 and
  // that is not a failure worth losing the whole schedule over.
  await Promise.all(
    [...stages.values()].map(async st => {
      if (!st.id) return;
      try {
        st.standings = standings(await ps(`/tournaments/${st.id}/standings`));
      } catch { /* bracket stage, or standings not published yet */ }
    })
  );

  const ordered = [...stages.values()]
    .map(st => ({
      ...st,
      matches: st.matches.sort((a, b) =>
        (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999') || a.id - b.id),
    }))
    // Earliest stage first, so Play-Ins → Group Stage → Playoffs reads in order.
    .sort((a, b) =>
      (a.matches[0]?.scheduledAt ?? '9999').localeCompare(b.matches[0]?.scheduledAt ?? '9999'));

  const first = running[0] ?? upcoming[0] ?? past[0];

  return {
    slug: league.slug,
    league: first?.league?.name ?? league.name,
    leagueImage: first?.league?.image_url ?? null,
    serie: serieName,
    stages: ordered,
    updatedAt: new Date().toISOString(),
  };
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = findLeague(url.searchParams.get('league')).slug;
  const force = url.searchParams.get('refresh') === '1';

  let cached: LeagueSchedule | null = null;
  try {
    const raw = await redis.get(key(slug));
    cached = typeof raw === 'string' ? JSON.parse(raw) : (raw as LeagueSchedule | null);
  } catch { /* Redis unreachable — fall through to a live build */ }

  if (cached?.stages && !force && isFresh(cached)) {
    return NextResponse.json({ ...cached, stale: false });
  }

  // One refresh at a time. Without this, every tab that polls past the TTL in
  // the same second would call PandaScore; the others serve the old copy for
  // another moment and pick up the new one from the Pusher broadcast.
  const gotLock = await redis.set(lockKey(slug), '1', { nx: true, ex: 60 });
  if (!gotLock && cached?.stages) {
    return NextResponse.json({ ...cached, stale: true });
  }

  try {
    const fresh = await build(slug);
    await redis.set(key(slug), JSON.stringify(fresh));
    // Everyone with the page open updates now, rather than at their own next poll.
    await pusher.trigger('tournaments-channel', 'tournaments-updated', {
      slug, updatedAt: fresh.updatedAt,
    }).catch(() => { /* a missed broadcast only costs one poll interval */ });
    return NextResponse.json({ ...fresh, stale: false });
  } catch (e: any) {
    console.error('[tournaments] build failed:', e.message);
    // A schedule an hour old beats an error page.
    if (cached?.stages) return NextResponse.json({ ...cached, stale: true });
    return NextResponse.json({ error: e.message }, { status: 502 });
  } finally {
    await redis.del(lockKey(slug)).catch(() => {});
  }
}
