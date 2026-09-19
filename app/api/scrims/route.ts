// /app/api/scrims/route.ts
// Scrim games. Entered by hand — Riot's public API does not return the custom
// games scrims are played in. Stored apart from official (Leaguepedia) data.
import { NextResponse } from 'next/server';
import { KEYS, all, putMany, remove } from '../../../lib/store';
import { ROLES, newId, type ScrimGame } from '../../../lib/hub';

export async function GET() {
  const games = await all<ScrimGame>(KEYS.scrims);
  games.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.gameNo - b.gameNo);
  return NextResponse.json({ games });
}

const clean = (a: unknown, n: number) =>
  (Array.isArray(a) ? a : []).map(x => String(x ?? '').trim()).slice(0, n);

/** POST { games: Partial<ScrimGame>[], createdBy } — a whole block at once. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input: Partial<ScrimGame>[] = Array.isArray(body?.games) ? body.games : [];
  if (!input.length) return NextResponse.json({ error: 'No games to save' }, { status: 400 });

  const blockId = input[0].blockId || newId();
  const out: Record<string, ScrimGame> = {};

  for (const [i, g] of input.entries()) {
    const opponent = String(g.opponent ?? '').trim();
    if (!opponent) return NextResponse.json({ error: `Game ${i + 1}: opponent is required` }, { status: 400 });
    if (g.result !== 'W' && g.result !== 'L') return NextResponse.json({ error: `Game ${i + 1}: result is required` }, { status: 400 });

    const ourPicks = Object.fromEntries(
      ROLES.map(r => [r, String((g.ourPicks as Record<string, string> | undefined)?.[r] ?? '').trim()]),
    ) as ScrimGame['ourPicks'];

    const id = g.id || newId();
    out[id] = {
      id,
      blockId,
      gameNo: Number(g.gameNo) || i + 1,
      date: String(g.date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      opponent,
      patch: String(g.patch ?? '').trim(),
      side: g.side === 'red' ? 'red' : 'blue',
      result: g.result,
      ourPicks,
      theirPicks: clean(g.theirPicks, 5),
      ourBans: clean(g.ourBans, 5),
      theirBans: clean(g.theirBans, 5),
      notes: String(g.notes ?? '').slice(0, 2000),
      vodId: g.vodId || undefined,
      createdBy: String(body?.createdBy ?? g.createdBy ?? 'unknown'),
      createdAt: Number(g.createdAt) || Date.now(),
    };
  }

  await putMany(KEYS.scrims, out);
  return NextResponse.json({ success: true, blockId, games: Object.values(out) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await remove(KEYS.scrims, id);
  return NextResponse.json({ success: true });
}
