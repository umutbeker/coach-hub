// /app/api/draft-saves/route.ts
//
// The draft room's shelf of saved boards.
//
// Kept out of `draft:current` on purpose: that key is the one live board every
// client re-renders from on every pick, and folding ten snapshots into it
// would rewrite all of them on every click. This is a Redis hash, one field
// per save, like the other coaching-tool collections.
//
// Writes broadcast on the draft room's existing Pusher channel under their own
// event, so a save made by one coach appears on every open board at once —
// the same guarantee the live draft has.

import { NextResponse } from 'next/server';
import Pusher from 'pusher';
import { KEYS, allMap, put, remove } from '../../../lib/store';
import { MAX_SAVED_DRAFTS, newId, type SavedDraft } from '../../../lib/hub';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

const five = (v: unknown): string[] =>
  Array.isArray(v) ? [0, 1, 2, 3, 4].map(i => String(v[i] ?? '')) : ['', '', '', '', ''];

/** Newest first — the shelf reads as a stack. */
async function list(): Promise<SavedDraft[]> {
  const all = await allMap<SavedDraft>(KEYS.draftSaves);
  return Object.values(all).sort((a, b) => b.savedAt - a.savedAt);
}

async function broadcast(saves: SavedDraft[]) {
  // A missed broadcast only costs the other tabs a manual refresh.
  await pusher.trigger('draft-channel', 'saves-updated', { saves }).catch(() => {});
}

export async function GET() {
  try {
    return NextResponse.json({ saves: await list() });
  } catch (e: any) {
    console.error('[draft-saves] read failed:', e.message);
    return NextResponse.json({ saves: [], error: e.message });
  }
}

export async function POST(request: Request) {
  try {
    const { op, id, name, note, draft, userName } = await request.json();

    if (op === 'save') {
      const saves = await list();
      // Refuse rather than evicting the oldest: silently dropping a board a
      // coach saved is worse than being told the shelf is full.
      if (saves.length >= MAX_SAVED_DRAFTS) {
        return NextResponse.json(
          { error: `En fazla ${MAX_SAVED_DRAFTS} draft saklanabilir — birini silin.`, saves },
          { status: 409 },
        );
      }
      const record: SavedDraft = {
        id: newId(),
        name: (name ?? '').trim(),
        note: (note ?? '').trim(),
        savedAt: Date.now(),
        savedBy: userName || 'Bilinmiyor',
        picks: { blue: five(draft?.picks?.blue), red: five(draft?.picks?.red) },
        bans: { blue: five(draft?.bans?.blue), red: five(draft?.bans?.red) },
        teamNames: {
          blue: draft?.teamNames?.blue ?? '',
          red: draft?.teamNames?.red ?? '',
        },
        opponent: draft?.opponent ?? null,
      };
      await put(KEYS.draftSaves, record.id, record);
      const next = await list();
      await broadcast(next);
      return NextResponse.json({ saves: next, saved: record });
    }

    if (op === 'note' || op === 'rename') {
      const all = await allMap<SavedDraft>(KEYS.draftSaves);
      const current = all[id];
      if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const next: SavedDraft = op === 'note'
        ? { ...current, note: String(note ?? '') }
        : { ...current, name: String(name ?? '').trim() };
      await put(KEYS.draftSaves, id, next);
      const saves = await list();
      await broadcast(saves);
      return NextResponse.json({ saves });
    }

    if (op === 'delete') {
      await remove(KEYS.draftSaves, id);
      const saves = await list();
      await broadcast(saves);
      return NextResponse.json({ saves });
    }

    return NextResponse.json({ error: 'unknown op' }, { status: 400 });
  } catch (e: any) {
    console.error('[draft-saves] write failed:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
