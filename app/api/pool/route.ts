// /app/api/pool/route.ts
// The coach's champion pool matrix: player → champion → tier.
// One hash field per player, so editing one player never rewrites another.
import { NextResponse } from 'next/server';
import { KEYS, allMap, get, put } from '../../../lib/store';
import type { PoolTier } from '../../../lib/hub';

const TIERS: PoolTier[] = ['ready', 'practice', 'no'];

export async function GET() {
  const matrix = await allMap<Record<string, PoolTier>>(KEYS.pool);
  return NextResponse.json({ matrix });
}

/** POST { player, champion, tier | null } — null removes the champion. */
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const player = String(b?.player ?? '').trim();
  const champion = String(b?.champion ?? '').trim();
  if (!player || !champion) return NextResponse.json({ error: 'player and champion required' }, { status: 400 });

  const current = (await get<Record<string, PoolTier>>(KEYS.pool, player)) ?? {};
  if (b?.tier === null) delete current[champion];
  else if (TIERS.includes(b?.tier)) current[champion] = b.tier;
  else return NextResponse.json({ error: 'tier must be ready, practice, no or null' }, { status: 400 });

  await put(KEYS.pool, player, current);
  return NextResponse.json({ success: true, player, pool: current });
}
