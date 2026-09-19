// /app/api/prep/route.ts
// Pre-match material per opponent:
//   - draft plan (bans, priority picks, if/then branches), written by the coach
//   - cached opponent report, built in the browser from Leaguepedia and saved
//     here so the next person to open it doesn't spend Leaguepedia's per-IP
//     rate limit rebuilding the same thing
import { NextResponse } from 'next/server';
import { KEYS, all, get, put } from '../../../lib/store';
import { slug, type DraftPlan } from '../../../lib/hub';

export async function GET(request: Request) {
  const opp = new URL(request.url).searchParams.get('opponent');
  if (!opp) {
    const plans = await all<DraftPlan>(KEYS.prep);
    plans.sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ plans });
  }
  const key = slug(opp);
  const [plan, report] = await Promise.all([get<DraftPlan>(KEYS.prep, key), get<unknown>(KEYS.reports, key)]);
  return NextResponse.json({ plan, report });
}

/** POST { kind: 'plan', plan } or { kind: 'report', opponent, report } */
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  if (b?.kind === 'report') {
    const opp = String(b?.opponent ?? '').trim();
    if (!opp || !b?.report) return NextResponse.json({ error: 'opponent and report required' }, { status: 400 });
    await put(KEYS.reports, slug(opp), { ...b.report, savedAt: Date.now() });
    return NextResponse.json({ success: true });
  }

  const p = b?.plan;
  const opp = String(p?.opponent ?? '').trim();
  if (!opp) return NextResponse.json({ error: 'plan.opponent required' }, { status: 400 });
  const side = (s: any) => ({
    bans: (Array.isArray(s?.bans) ? s.bans : []).map(String).slice(0, 5),
    priorityPicks: (Array.isArray(s?.priorityPicks) ? s.priorityPicks : []).map(String).slice(0, 10),
    notes: String(s?.notes ?? '').slice(0, 2000),
  });
  const plan: DraftPlan = {
    opponent: opp,
    blue: side(p.blue),
    red: side(p.red),
    branches: (Array.isArray(p?.branches) ? p.branches : [])
      .map((x: any) => ({ id: String(x?.id ?? Math.random().toString(36).slice(2)), when: String(x?.when ?? '').slice(0, 300), then: String(x?.then ?? '').slice(0, 300) }))
      .filter((x: { when: string; then: string }) => x.when || x.then)
      .slice(0, 20),
    updatedBy: String(b?.updatedBy ?? 'unknown'),
    updatedAt: Date.now(),
  };
  await put(KEYS.prep, slug(opp), plan);
  return NextResponse.json({ success: true, plan });
}
