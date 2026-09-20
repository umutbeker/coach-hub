// /app/api/opponent-report/route.ts
// Builds (or returns) the scouting report for an opponent.
//
// The build happens here rather than in the page because Leaguepedia's rate
// limit is per-IP: in the browser it spent the viewer's limit, and one person
// testing could lock their network out of the feature entirely.
import { NextResponse } from 'next/server';
import { KEYS, get, put } from '../../../lib/store';
import { buildReport, type Report } from '../../../lib/report';
import { slug } from '../../../lib/hub';

const BUDGET_MS = 45_000;
const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const opponent = (sp.get('opponent') ?? '').trim();
  if (!opponent) return NextResponse.json({ error: 'opponent required' }, { status: 400 });

  const key = slug(opponent);
  const saved = await get<Report>(KEYS.reports, key);
  const age = saved?.savedAt ?? saved?.builtAt ?? 0;
  const refresh = sp.get('refresh') === 'true';

  if (saved && !refresh && Date.now() - age < FRESH_MS) {
    return NextResponse.json({ report: saved, fromCache: true });
  }

  const res = await buildReport(opponent, Date.now() + BUDGET_MS);

  if (!res.ok) {
    // A stale saved report beats no report; say how old it is.
    if (saved) return NextResponse.json({ report: saved, fromCache: true, stale: true, reason: res.reason });
    return NextResponse.json({
      error: res.reason === 'ratelimited'
        ? 'Leaguepedia is rate-limiting right now. Try again in a few minutes.'
        : `Leaguepedia has no games for “${opponent}”. Check the team’s exact name there.`,
      reason: res.reason,
    }, { status: res.reason === 'ratelimited' ? 503 : 404 });
  }

  // A partial build (the player query was refused) must not replace a full
  // saved report — the coach would lose the pools they already had.
  if (res.partial && saved?.players?.length) {
    return NextResponse.json({ report: saved, fromCache: true, stale: true, reason: 'partial' });
  }

  // Keep a brief written for the previous build of the same opponent.
  const report: Report = { ...res.report, brief: saved?.brief, savedAt: Date.now() };
  await put(KEYS.reports, key, report);
  return NextResponse.json({ report, fromCache: false });
}
