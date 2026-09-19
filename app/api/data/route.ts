// /app/api/data/route.ts
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Tek oyuncu verisi
export async function POST(request: Request) {
  try {
    const { playerName } = await request.json();
    if (!playerName) return NextResponse.json({ error: 'playerName gerekli' }, { status: 400 });

    const data = await redis.get(`player:${playerName}`);
    if (!data) {
      return NextResponse.json({ error: `${playerName} için veri yok — sync çalıştırın` }, { status: 404 });
    }

    const updatedAt = await redis.get('sync:updatedAt');
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    return NextResponse.json({ ...parsed, _updatedAt: updatedAt });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Tüm oyuncular (coach sayfası için)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    const updatedAt = await redis.get('sync:updatedAt');

    // LP maç verisi — matches sayfası için
    if (type === 'matches') {
      const data = await redis.get('matches:lp');
      if (!data) return NextResponse.json({ error: 'Matches data not found' }, { status: 404 });
      return NextResponse.json({ data: typeof data === 'string' ? JSON.parse(data) : data, updatedAt });
    }

    // Tek oyuncunun LP verisi — pro stage için
    if (type === 'lp') {
      const name = searchParams.get('player');
      if (!name) return NextResponse.json({ error: 'player param required' }, { status: 400 });
      const data = await redis.get(`lp:${name}`);
      if (!data) return NextResponse.json({ error: 'LP data not found' }, { status: 404 });
      return NextResponse.json({ data: typeof data === 'string' ? JSON.parse(data) : data, updatedAt });
    }

    // Scout verisi
    if (type === 'scout') {
      const data = await redis.get('scout:next');
      if (!data) return NextResponse.json({ error: 'Scout data not found' }, { status: 404 });
      return NextResponse.json({ data: typeof data === 'string' ? JSON.parse(data) : data, updatedAt });
    }

    // Tüm oyuncular (coach sayfası için)
    const playerNames = ['MonkaS', 'Grave', 'Fade', 'Cape', 'StarScreen'];
    const players: Record<string, any> = {};
    for (const name of playerNames) {
      const data = await redis.get(`player:${name}`);
      if (data) players[name] = typeof data === 'string' ? JSON.parse(data) : data;
    }

    if (Object.keys(players).length === 0) {
      return NextResponse.json({ error: 'No data yet' }, { status: 404 });
    }

    return NextResponse.json({ updatedAt, players });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
