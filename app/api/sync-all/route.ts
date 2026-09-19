// /app/api/sync-all/route.ts
// Bu endpoint cron job tarafından çağrılır
// Her oyuncuyu paralel değil sırayla ama hızlıca sync eder

import { NextResponse } from 'next/server';
import { USERS } from '../../../lib/users';

export async function GET(request: Request) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const players = USERS.filter(u => u.role === 'player' && u.riotId).map(u => u.name);
  const results: any[] = [];

  // Her oyuncuyu sırayla sync et
  for (const player of players) {
    try {
      const res = await fetch(`${baseUrl}/api/sync?player=${player}`, {
        signal: AbortSignal.timeout(55000), // 55 saniye timeout
      });
      const data = await res.json();
      results.push({ player, success: data.success, errors: data.errors });
    } catch (e: any) {
      results.push({ player, success: false, error: e.message });
    }
  }

  // Matches sync
  try {
    const res = await fetch(`${baseUrl}/api/sync?player=matches`, {
      signal: AbortSignal.timeout(55000),
    });
    const data = await res.json();
    results.push({ player: 'matches', success: data.success });
  } catch (e: any) {
    results.push({ player: 'matches', success: false, error: e.message });
  }

  // Draft meta'yı önceden doldur — 12 saatlik cache'i cron ısıtıyor ki
  // draft sırasında AI asistanı Leaguepedia'yı beklemesin.
  try {
    const res = await fetch(`${baseUrl}/api/draft-meta?refresh=true`, {
      signal: AbortSignal.timeout(55000),
    });
    const data = await res.json();
    results.push({ player: 'draft-meta', success: data.success, error: data.error });
  } catch (e: any) {
    results.push({ player: 'draft-meta', success: false, error: e.message });
  }

  // Pro VOD'lar (LEC/LCK) — herkese açık /pro sayfası Redis'ten okuyor.
  try {
    const res = await fetch(`${baseUrl}/api/pro-vods?refresh=true`, {
      signal: AbortSignal.timeout(55000),
    });
    const data = await res.json();
    results.push({ player: 'pro-vods', success: data.success, error: data.error });
  } catch (e: any) {
    results.push({ player: 'pro-vods', success: false, error: e.message });
  }

  // Pre-build the scouting report for whoever is set as the next opponent, so
  // the coach opens a ready report instead of waiting for Leaguepedia.
  try {
    const draft = await fetch(`${baseUrl}/api/draft`, { signal: AbortSignal.timeout(20000) }).then(r => r.json());
    if (draft?.opponent) {
      const res = await fetch(`${baseUrl}/api/opponent-report?opponent=${encodeURIComponent(draft.opponent)}&refresh=true`, {
        signal: AbortSignal.timeout(55000),
      });
      const data = await res.json();
      results.push({ player: 'opponent-report', success: res.ok, error: data.error });
    }
  } catch (e) {
    results.push({ player: 'opponent-report', success: false, error: e instanceof Error ? e.message : 'failed' });
  }

  return NextResponse.json({
    success: true,
    updatedAt: new Date().toISOString(),
    results,
  });
}