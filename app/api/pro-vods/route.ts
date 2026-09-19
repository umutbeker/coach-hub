// /app/api/pro-vods/route.ts
// LEC + LCK son maçları: video (VOD) + draft, tek sorguda.
//
// Video ve draft ayrı kaynaklardan gelmiyor — üç Leaguepedia tablosu aynı
// GameId ile birleşiyor: MatchScheduleGame (Vod/VodPB), PicksAndBansS7
// (pick/ban) ve ScoreboardGames (takımlar, kazanan, tarih).
//
// Sayfa herkese açık olduğu için ziyaretçi başına Leaguepedia sorgusu ATILMAZ:
// veriyi günlük cron doldurur, istekler Redis'ten okur. Aksi halde anonim
// trafik Leaguepedia'nın IP bazlı limitini anında patlatır.
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { lpQuery, cargo, seasonCandidates, type LpRow } from '../../../lib/leaguepedia';
import { parseVod } from '../../../lib/vod';

const redis = Redis.fromEnv();
const CACHE_TTL = 60 * 60 * 12; // 12 saat
const BUDGET_MS = 45_000;
const GAMES_PER_LEAGUE = 20;

export const LEAGUES = ['LEC', 'LCK'] as const;
type League = (typeof LEAGUES)[number];

const cacheKey = (l: string) => `vods:${l.toLowerCase()}`;

const pick = (r: LpRow, prefix: string, kind: 'Ban' | 'Pick') =>
  [1, 2, 3, 4, 5].map(i => r[`${prefix}${kind}${i}`]).filter(Boolean);

async function fetchLeague(league: League, deadline: number) {
  for (const year of seasonCandidates()) {
    const tournament = `${league} ${year}`;
    const params = cargo({
      tables: 'MatchScheduleGame=MSG,ScoreboardGames=SG,PicksAndBansS7=PB',
      join_on: 'MSG.GameId=SG.GameId,SG.GameId=PB.GameId',
      fields: [
        'MSG.GameId', 'MSG.Vod', 'MSG.VodPB', 'MSG.VodHighlights', 'MSG.N_GameInMatch',
        'SG.Team1', 'SG.Team2', 'SG.Winner', 'SG.DateTime_UTC', 'SG.Tournament',
        'PB.Team1Ban1', 'PB.Team1Ban2', 'PB.Team1Ban3', 'PB.Team1Ban4', 'PB.Team1Ban5',
        'PB.Team2Ban1', 'PB.Team2Ban2', 'PB.Team2Ban3', 'PB.Team2Ban4', 'PB.Team2Ban5',
        'PB.Team1Pick1', 'PB.Team1Pick2', 'PB.Team1Pick3', 'PB.Team1Pick4', 'PB.Team1Pick5',
        'PB.Team2Pick1', 'PB.Team2Pick2', 'PB.Team2Pick3', 'PB.Team2Pick4', 'PB.Team2Pick5',
      ].join(','),
      where: `SG.Tournament LIKE "%${tournament}%"`,
      order_by: 'SG.DateTime_UTC DESC',
      limit: String(GAMES_PER_LEAGUE),
    });

    const rows = await lpQuery(params, `vods/${tournament}`, deadline);
    if (rows === null) return { rows: null, tournament };  // limit/hata
    if (rows.length === 0) continue;                       // bu sezon boş, öncekine düş

    const games = rows.map(r => {
      const date = r['DateTime UTC'] ?? r['DateTime_UTC'] ?? '';
      // Winner '1' | '2' — Team1/Team2'ye karşılık geliyor.
      const winner = r.Winner === '1' ? r.Team1 : r.Winner === '2' ? r.Team2 : null;
      return {
        gameId: r.GameId,
        date,
        tournament: r.Tournament || tournament,
        gameInMatch: Number(r['N GameInMatch'] ?? r.N_GameInMatch ?? 0) || null,
        blueTeam: r.Team1,
        redTeam: r.Team2,
        winner,
        blueWon: r.Winner === '1',
        vod: parseVod(r.Vod),
        vodDraft: parseVod(r.VodPB),
        vodHighlights: parseVod(r.VodHighlights),
        draft: {
          blueBans: pick(r, 'Team1', 'Ban'),
          redBans: pick(r, 'Team2', 'Ban'),
          bluePicks: pick(r, 'Team1', 'Pick'),
          redPicks: pick(r, 'Team2', 'Pick'),
        },
      };
    });

    return { rows: games, tournament };
  }
  return { rows: [], tournament: `${league} ${seasonCandidates()[0]}` };
}

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get('refresh') === 'true';

  // Cache lig bazında tutuluyor: biri düşerse sadece o yeniden çekiliyor.
  // Hepsini birden çekmek boşuna Leaguepedia sorgusu demek.
  const cached = refresh ? [] : await Promise.all(LEAGUES.map(l => redis.get(cacheKey(l))));
  const leagues = cached
    .map(c => (typeof c === 'string' ? JSON.parse(c) : c))
    .filter(Boolean);

  const missing = refresh
    ? [...LEAGUES]
    : LEAGUES.filter((_, i) => !cached[i]);

  if (missing.length === 0) {
    return NextResponse.json({ success: true, fromCache: true, leagues });
  }

  const deadline = Date.now() + BUDGET_MS;
  let rateLimited = false;

  // Sıralı — paralel sorgu limiti tetikliyor.
  for (const league of missing) {
    const { rows, tournament } = await fetchLeague(league, deadline);
    if (rows === null) { rateLimited = true; continue; }

    const payload = { league, tournament, updatedAt: new Date().toISOString(), games: rows };
    const at = leagues.findIndex((l: { league: string }) => l.league === league);
    if (at >= 0) leagues[at] = payload; else leagues.push(payload);
    await redis.set(cacheKey(league), JSON.stringify(payload), { ex: CACHE_TTL });
  }

  if (leagues.length === 0) {
    return NextResponse.json({
      success: false,
      rateLimited,
      error: rateLimited
        ? 'Leaguepedia rate limit — veri çekilemedi, birazdan tekrar deneyin'
        : 'Veri bulunamadı',
    });
  }

  // Sıra bozulmasın: LEC, LCK sırası sabit kalsın.
  leagues.sort((a: { league: string }, b: { league: string }) =>
    LEAGUES.indexOf(a.league as League) - LEAGUES.indexOf(b.league as League));

  return NextResponse.json({ success: true, fromCache: false, rateLimited, leagues });
}
