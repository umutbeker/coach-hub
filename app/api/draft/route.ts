// /app/api/draft/route.ts
import { NextResponse } from 'next/server';
import Pusher from 'pusher';
import { Redis } from '@upstash/redis';
import { TEAM_NAME } from '../../../lib/team';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

const redis = Redis.fromEnv();
const DRAFT_KEY = 'draft:current';

// Draft state'i al
export async function GET() {
  try {
    const draft = await redis.get(DRAFT_KEY);
    return NextResponse.json(draft ?? getEmptyDraft());
  } catch (e: any) {
    return NextResponse.json(getEmptyDraft());
  }
}

// Draft güncelle + Pusher ile yayınla
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, payload, userName } = body;

    // Mevcut draft'ı al
    let draft: any = await redis.get(DRAFT_KEY) ?? getEmptyDraft();
    if (typeof draft === 'string') draft = JSON.parse(draft);

    // Action'a göre güncelle
    switch (action) {
      case 'SET_PICK':
        draft.picks[payload.side][payload.index] = payload.champion;
        break;
      case 'SET_BAN':
        draft.bans[payload.side][payload.index] = payload.champion;
        break;
      case 'SET_NOTE':
        draft.notes[payload.side] = payload.text;
        break;
      case 'SET_AI_RESULT':
        draft.aiResult = payload;
        break;
      case 'SET_TEAM_NAME':
        draft.teamNames[payload.side] = payload.name;
        break;
      case 'RESET':
        draft = getEmptyDraft();
        break;
      case 'SET_SOLOQ':
        if (!draft.soloq) draft.soloq = {};
        draft.soloq[payload.playerName] = payload.data;
        break;
      case 'SET_STRATEGY':
        draft.strategy = payload;
        break;
    }

    draft.lastUpdatedBy = userName || 'Bilinmiyor';
    draft.lastUpdatedAt = Date.now();

    // Redis'e kaydet
    await redis.set(DRAFT_KEY, JSON.stringify(draft));

    // Pusher ile herkese yayınla
    await pusher.trigger('draft-channel', 'draft-updated', { draft, action, userName });

    return NextResponse.json({ success: true, draft });
  } catch (e: any) {
    console.error('[draft] hata:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function getEmptyDraft() {
  return {
    picks: { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] },
    bans:  { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] },
    notes: { blue: '', red: '' },
    teamNames: { blue: TEAM_NAME, red: 'Rakip' },
    soloq: {},
    strategy: null,
    aiResult: null,
    lastUpdatedBy: null,
    lastUpdatedAt: null,
  };
}
