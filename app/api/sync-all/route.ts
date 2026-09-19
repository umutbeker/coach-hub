// /app/api/sync-all/route.ts
// Bu endpoint cron job tarafından çağrılır
// Her oyuncuyu paralel değil sırayla ama hızlıca sync eder

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const players = ['MonkaS', 'Grave', 'Fade', 'Cape', 'StarScreen'];
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

  return NextResponse.json({
    success: true,
    updatedAt: new Date().toISOString(),
    results,
  });
}