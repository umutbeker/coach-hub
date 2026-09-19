// /app/api/notes/route.ts
// Timestamped notes on a VOD.
//   GET ?vod=ID        notes on one VOD
//   GET ?player=NAME   every note tagged with that player, across all VODs
//   GET ?all=1         every note (coach overview)
import { NextResponse } from 'next/server';
import { KEYS, all, allAcross, put, remove } from '../../../lib/store';
import { NOTE_CATEGORIES, newId, type Vod, type VodNote, type NoteCategory } from '../../../lib/hub';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const vodId = sp.get('vod');
  if (vodId) {
    const notes = await all<VodNote>(KEYS.notes(vodId));
    notes.sort((a, b) => a.t - b.t);
    return NextResponse.json({ notes });
  }

  const player = sp.get('player');
  if (player || sp.get('all')) {
    const vods = await all<Vod>(KEYS.vods);
    const notes = await allAcross<VodNote>(vods.map(v => KEYS.notes(v.id)));
    const byId = Object.fromEntries(vods.map(v => [v.id, v]));
    const picked = player
      ? notes.filter(n => n.players?.some(p => p.toLowerCase() === player.toLowerCase()))
      : notes;
    picked.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({
      notes: picked.map(n => ({ ...n, vod: byId[n.vodId] ? { id: byId[n.vodId].id, title: byId[n.vodId].title, date: byId[n.vodId].date, source: byId[n.vodId].source } : null })),
    });
  }

  return NextResponse.json({ error: 'vod, player or all required' }, { status: 400 });
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const vodId = String(b?.vodId ?? '');
  const t = Number(b?.t);
  const text = String(b?.text ?? '').trim();
  if (!vodId) return NextResponse.json({ error: 'vodId required' }, { status: 400 });
  if (!Number.isFinite(t) || t < 0) return NextResponse.json({ error: 'A timestamp is required' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'Note text is required' }, { status: 400 });

  const category: NoteCategory = NOTE_CATEGORIES.includes(b?.category) ? b.category : 'other';
  const id = b?.id || newId();
  const note: VodNote = {
    id, vodId, t: Math.floor(t), text: text.slice(0, 1000), category,
    players: (Array.isArray(b?.players) ? b.players : []).map(String).slice(0, 5),
    author: String(b?.author ?? 'unknown'),
    createdAt: Number(b?.createdAt) || Date.now(),
  };
  await put(KEYS.notes(vodId), id, note);
  return NextResponse.json({ success: true, note });
}

export async function DELETE(request: Request) {
  const sp = new URL(request.url).searchParams;
  const vodId = sp.get('vod'), id = sp.get('id');
  if (!vodId || !id) return NextResponse.json({ error: 'vod and id required' }, { status: 400 });
  await remove(KEYS.notes(vodId), id);
  return NextResponse.json({ success: true });
}
