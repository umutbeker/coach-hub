// /app/api/opponent-report/route.ts
// The scouting report for an opponent, built on the server.
//
// Leaguepedia's rate limit is per-IP. Built in the browser it spent the limit
// of whoever opened the page and could lock their whole network out of the
// feature; built here it is fetched once, signed in, and shared from Redis.
import { NextResponse } from 'next/server';
import { getOrBuildReport } from '../../../lib/report';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const opponent = (sp.get('opponent') ?? '').trim();
  if (!opponent) return NextResponse.json({ error: 'opponent required' }, { status: 400 });

  const { report, fromCache, stale, reason } = await getOrBuildReport(opponent, sp.get('refresh') === 'true');

  if (!report) {
    return NextResponse.json({
      error: reason === 'ratelimited'
        ? 'Leaguepedia is rate-limiting right now. Try again in a few minutes.'
        : `Leaguepedia has no games for “${opponent}”. Check the team’s exact name there.`,
      reason,
    }, { status: reason === 'ratelimited' ? 503 : 404 });
  }

  return NextResponse.json({ report, fromCache, stale, reason });
}
