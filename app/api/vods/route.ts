// /app/api/vods/route.ts
// The VOD library. A VOD is a link (unlisted YouTube or a direct video URL);
// uploading files would need a storage bucket the project doesn't have yet.
import { NextResponse } from 'next/server';
import { KEYS, all, get, put, remove, drop } from '../../../lib/store';
import { newId, type Vod } from '../../../lib/hub';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const vod = await get<Vod>(KEYS.vods, id);
    return vod ? NextResponse.json({ vod }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const vods = await all<Vod>(KEYS.vods);
  vods.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return NextResponse.json({ vods });
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const url = String(b?.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'A video link starting with http(s) is required' }, { status: 400 });

  const id = b?.id || newId();
  const vod: Vod = {
    id,
    title: String(b?.title ?? '').trim() || 'Untitled VOD',
    url,
    source: b?.source === 'scrim' || b?.source === 'official' ? b.source : 'other',
    refId: b?.refId || undefined,
    opponent: b?.opponent ? String(b.opponent).trim() : undefined,
    date: String(b?.date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    createdBy: String(b?.createdBy ?? 'unknown'),
    createdAt: Number(b?.createdAt) || Date.now(),
  };
  await put(KEYS.vods, id, vod);
  return NextResponse.json({ success: true, vod });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await remove(KEYS.vods, id);
  await drop(KEYS.notes(id));   // a VOD's notes go with it
  return NextResponse.json({ success: true });
}
