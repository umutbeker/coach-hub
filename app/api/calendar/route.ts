// /app/api/calendar/route.ts
// Team calendar — scrims, review sessions and anything else the staff books.
// Official matches are not stored here; the page merges them in from the
// PandaScore fixture so there is one source for them.
import { NextResponse } from 'next/server';
import { KEYS, all, put, remove } from '../../../lib/store';
import { newId, type CalendarEvent, type EventType } from '../../../lib/hub';

const TYPES: EventType[] = ['scrim', 'official', 'review', 'other'];

export async function GET() {
  const events = await all<CalendarEvent>(KEYS.calendar);
  events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const date = String(b?.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'A date is required' }, { status: 400 });
  const type: EventType = TYPES.includes(b?.type) ? b.type : 'other';
  const opponent = b?.opponent ? String(b.opponent).trim() : undefined;
  const title = String(b?.title ?? '').trim() || (type === 'scrim' && opponent ? `Scrim vs ${opponent}` : 'Event');

  const id = b?.id || newId();
  const ev: CalendarEvent = {
    id, type, title, opponent, date,
    time: /^\d{2}:\d{2}$/.test(b?.time ?? '') ? b.time : '18:00',
    durationMin: Math.min(Math.max(Number(b?.durationMin) || 120, 15), 720),
    notes: String(b?.notes ?? '').slice(0, 1000),
    createdBy: String(b?.createdBy ?? 'unknown'),
  };
  await put(KEYS.calendar, id, ev);
  return NextResponse.json({ success: true, event: ev });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await remove(KEYS.calendar, id);
  return NextResponse.json({ success: true });
}
