// /app/api/draft-meta/route.ts
// Pro draft meta: LEC + EMEA, son 30 maç, şampiyon rolleri + pick order + matchup
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const META_KEY = 'draft:meta';
const META_TTL = 60 * 60 * 12; // 12 saat

const TOURNAMENTS = [
  { name: 'LEC', query: 'LEC 2025' },
  { name: 'EMEA Masters', query: 'EMEA Masters 2025' },
];

// 1) Pick/Ban + pick order verisi
async function fetchDraftData(tournamentQuery: string) {
  try {
    const params = new URLSearchParams({
      action: 'cargoquery',
      tables: 'PicksAndBansS7=PB,ScoreboardGames=SG',
      fields: [
        'PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5',
        'PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5',
        'PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5',
        'PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5',
        'SG.Winner','SG.DateTime_UTC','SG.Tournament','SG.Team1','SG.Team2',
      ].join(','),
      join_on: 'PB.GameId=SG.GameId',
      where: `SG.Tournament LIKE "%${tournamentQuery}%"`,
      order_by: 'SG.DateTime_UTC DESC',
      limit: '30',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`https://lol.fandom.com/api.php?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.cargoquery?.map((item: any) => item.title) || [];
  } catch (e) {
    console.error(`[draft-meta] draft fetch hatası:`, e);
    return [];
  }
}

// 2) Şampiyon + Rol verisi (ScoreboardPlayers'dan)
async function fetchChampionRoles(tournamentQuery: string) {
  try {
    const params = new URLSearchParams({
      action: 'cargoquery',
      tables: 'ScoreboardPlayers=SP,ScoreboardGames=SG',
      fields: 'SP.Champion,SP.Role,SP.PlayerWin,SG.DateTime_UTC',
      join_on: 'SP.GameId=SG.GameId',
      where: `SG.Tournament LIKE "%${tournamentQuery}%"`,
      order_by: 'SG.DateTime_UTC DESC',
      limit: '300',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`https://lol.fandom.com/api.php?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.cargoquery?.map((item: any) => item.title) || [];
  } catch (e) {
    console.error(`[draft-meta] roles fetch hatası:`, e);
    return [];
  }
}

function processMetaData(draftMatches: any[], roleData: any[]) {
  // ── Şampiyon Rol Dağılımı ──
  const champRoles: Record<string, Record<string, { games: number; wins: number }>> = {};

  roleData.forEach((row) => {
    const champ = row.Champion;
    const role = row.Role; // "Top", "Jungle", "Mid", "Bot", "Support"
    if (!champ || !role) return;

    if (!champRoles[champ]) champRoles[champ] = {};
    if (!champRoles[champ][role]) champRoles[champ][role] = { games: 0, wins: 0 };
    champRoles[champ][role].games++;
    if (row.PlayerWin === 'Yes') champRoles[champ][role].wins++;
  });

  // ── Draft Pick/Ban İstatistikleri ──
  const champStats: Record<string, {
    picks: number; wins: number; bans: number;
    firstPick: number; midPick: number; lastPick: number;
  }> = {};

  // ── Synergy tracking (aynı takımda alınan ikililer) ──
  const synergy: Record<string, { games: number; wins: number }> = {};

  let totalGames = 0;

  draftMatches.forEach((match) => {
    totalGames++;
    const winner = match.Winner;

    // Her iki takım için pick'leri işle
    for (let team = 1; team <= 2; team++) {
      const isWinner = winner === String(team);
      const picks: string[] = [];

      for (let i = 1; i <= 5; i++) {
        const champ = match[`Team${team}Pick${i}`];
        if (champ) {
          picks.push(champ);
          if (!champStats[champ]) champStats[champ] = { picks: 0, wins: 0, bans: 0, firstPick: 0, midPick: 0, lastPick: 0 };
          champStats[champ].picks++;
          if (isWinner) champStats[champ].wins++;

          // Pick order: Blue(team1) → Pick1=R1, Pick2-3=R2, Pick4-5=R3
          //             Red(team2) → Pick1-2=R1, Pick3=R2, Pick4-5=R3
          if (team === 1) {
            if (i === 1) champStats[champ].firstPick++;
            else if (i <= 3) champStats[champ].midPick++;
            else champStats[champ].lastPick++;
          } else {
            if (i <= 2) champStats[champ].firstPick++;
            else if (i === 3) champStats[champ].midPick++;
            else champStats[champ].lastPick++;
          }
        }
      }

      // Synergy: aynı takımdaki ikilileri kaydet
      for (let a = 0; a < picks.length; a++) {
        for (let b = a + 1; b < picks.length; b++) {
          const key = [picks[a], picks[b]].sort().join('+');
          if (!synergy[key]) synergy[key] = { games: 0, wins: 0 };
          synergy[key].games++;
          if (isWinner) synergy[key].wins++;
        }
      }
    }

    // Banlar
    for (let team = 1; team <= 2; team++) {
      for (let i = 1; i <= 5; i++) {
        const champ = match[`Team${team}Ban${i}`];
        if (champ) {
          if (!champStats[champ]) champStats[champ] = { picks: 0, wins: 0, bans: 0, firstPick: 0, midPick: 0, lastPick: 0 };
          champStats[champ].bans++;
        }
      }
    }
  });

  // ── Final hesaplama ──
  const meta = Object.entries(champStats)
    .map(([name, s]) => {
      // Rol bilgisini ekle
      const roles = champRoles[name] || {};
      const roleList = Object.entries(roles)
        .sort((a, b) => b[1].games - a[1].games)
        .map(([role, data]) => ({
          role,
          games: data.games,
          winRate: data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0,
        }));

      return {
        name,
        picks: s.picks,
        bans: s.bans,
        wins: s.wins,
        winRate: s.picks > 0 ? Math.round((s.wins / s.picks) * 100) : 0,
        pickRate: totalGames > 0 ? Math.round((s.picks / totalGames) * 100) : 0,
        banRate: totalGames > 0 ? Math.round((s.bans / totalGames) * 100) : 0,
        presence: totalGames > 0 ? Math.round(((s.picks + s.bans) / totalGames) * 100) : 0,
        firstPick: s.firstPick,
        midPick: s.midPick,
        lastPick: s.lastPick,
        roles: roleList, // ör: [{role:"Mid", games:8, winRate:62}, {role:"Bot", games:3, winRate:33}]
        primaryRole: roleList.length > 0 ? roleList[0].role : 'Unknown',
        isFlex: roleList.length > 1 && roleList[1].games >= 2, // 2+ farklı rolde oynanmış
      };
    })
    .filter(c => c.picks >= 2 || c.bans >= 3)
    .sort((a, b) => b.presence - a.presence);

  // Top synergy pairs (min 2 game)
  const topSynergy = Object.entries(synergy)
    .filter(([, s]) => s.games >= 2)
    .map(([pair, s]) => ({
      pair,
      games: s.games,
      winRate: Math.round((s.wins / s.games) * 100),
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 15);

  return {
    totalGames,
    champions: meta,
    topPicked: [...meta].sort((a, b) => b.picks - a.picks).slice(0, 15),
    topBanned: [...meta].sort((a, b) => b.bans - a.bans).slice(0, 15),
    firstPickPriority: [...meta].filter(c => c.firstPick >= 2).sort((a, b) => b.firstPick - a.firstPick).slice(0, 10),
    latePickPriority: [...meta].filter(c => c.lastPick >= 2).sort((a, b) => b.lastPick - a.lastPick).slice(0, 10),
    flexPicks: meta.filter(c => c.isFlex),
    topSynergy,
    fetchedAt: Date.now(),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    if (!forceRefresh) {
      const cached = await redis.get(META_KEY);
      if (cached) {
        return NextResponse.json({ success: true, data: cached, fromCache: true });
      }
    }

    console.log('[draft-meta] Veri çekiliyor...');

    // Paralel olarak hem draft hem role verisini çek
    const [draftResults, roleResults] = await Promise.all([
      Promise.all(TOURNAMENTS.map(t => fetchDraftData(t.query))),
      Promise.all(TOURNAMENTS.map(t => fetchChampionRoles(t.query))),
    ]);

    const allDrafts = draftResults.flat();
    const allRoles = roleResults.flat();

    console.log(`[draft-meta] ${allDrafts.length} maç, ${allRoles.length} oyuncu kaydı`);

    if (allDrafts.length === 0) {
      return NextResponse.json({ success: false, error: 'Veri bulunamadı' });
    }

    const metaData = processMetaData(allDrafts, allRoles);
    const metaWithTournaments = { ...metaData, tournaments: TOURNAMENTS.map(t => t.name) };

    await redis.set(META_KEY, JSON.stringify(metaWithTournaments), { ex: META_TTL });

    return NextResponse.json({ success: true, data: metaWithTournaments, fromCache: false });
  } catch (e: any) {
    console.error('[draft-meta] hata:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
