// /app/api/riot-lookup/route.ts
import { NextResponse } from 'next/server';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rFetch(url: string, apiKey: string, retries = 3): Promise<Response> {
  await sleep(120);
  const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
  if (res.status === 429) {
    if (retries <= 0) throw new Error('Rate limit');
    const wait = Number(res.headers.get('Retry-After') || 12) * 1000;
    await sleep(wait);
    return rFetch(url, apiKey, retries - 1);
  }
  return res;
}

export async function POST(request: Request) {
  try {
    const { riotId } = await request.json();
    if (!riotId) return NextResponse.json({ error: 'riotId gerekli' }, { status: 400 });

    const API_KEY = process.env.RIOT_API_KEY;
    if (!API_KEY) return NextResponse.json({ error: 'API key eksik' }, { status: 500 });

    const [gameName, tagLine] = riotId.split('#');
    if (!gameName || !tagLine) return NextResponse.json({ error: 'Format: OyuncuAdı#TAG' }, { status: 400 });

    // PUUID al
    const accountRes = await rFetch(
      `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      API_KEY
    );
    if (!accountRes.ok) return NextResponse.json({ error: 'Oyuncu bulunamadı' }, { status: 404 });
    const { puuid } = await accountRes.json();

    // Rank
    const rankRes = await rFetch(`https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`, API_KEY);
    const rankData = await rankRes.json();
    const soloQ = Array.isArray(rankData) ? rankData.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') : null;

    // Son 100 maç — tüm sezon istatistikleri
    const matchIdsRes = await rFetch(
      `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=50&queue=420`,
      API_KEY
    );
    const matchIds = await matchIdsRes.json();

    const champMap: Record<string, { games: number; wins: number; kills: number; deaths: number; assists: number; }> = {};
    const recentList: any[] = [];

    for (const id of matchIds.slice(0, 50)) {
      const r = await rFetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${id}`, API_KEY);
      const match = await r.json();
      if (!match?.info) continue;
      const p = match.info.participants.find((p: any) => p.puuid === puuid);
      if (!p) continue;

      if (!champMap[p.championName]) champMap[p.championName] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
      champMap[p.championName].games++;
      champMap[p.championName].kills += p.kills;
      champMap[p.championName].deaths += p.deaths;
      champMap[p.championName].assists += p.assists;
      if (p.win) champMap[p.championName].wins++;

      // Sadece son 15 maçı listeye ekle
      if (recentList.length < 15) {
        recentList.push({
          champion: p.championName,
          win: p.win,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          kda: ((p.kills + p.assists) / Math.max(p.deaths, 1)).toFixed(2),
          date: new Date(match.info.gameCreation).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
        });
      }
    }

    const topChamps = Object.entries(champMap)
      .map(([name, s]) => ({
        name,
        games: s.games,
        winRate: Math.round((s.wins / s.games) * 100),
        kda: ((s.kills + s.assists) / Math.max(s.deaths, 1)).toFixed(2),
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);

    return NextResponse.json({
      riotId,
      tier: soloQ?.tier || 'UNRANKED',
      rank: soloQ?.rank || '',
      lp: soloQ?.leaguePoints || 0,
      wins: soloQ?.wins || 0,
      losses: soloQ?.losses || 0,
      winRate: soloQ ? Math.round((soloQ.wins / (soloQ.wins + soloQ.losses)) * 100) : 0,
      topChamps,
      recentMatches: recentList,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}