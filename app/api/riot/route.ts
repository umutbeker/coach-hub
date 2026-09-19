import { NextResponse } from 'next/server';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Rate-limited fetch — her istekten sonra 60ms bekle (dev key: 20 req/s)
async function rFetch(url: string, apiKey: string, retries = 3): Promise<Response> {
  await sleep(120); // dev key: 20 req/s, 120ms = güvenli aralık
  const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
  if (res.status === 429) {
    if (retries <= 0) throw new Error('Rate limit aşıldı, lütfen bekleyin');
    const retryAfter = Number(res.headers.get('Retry-After') || 12) * 1000;
    console.log();
    await sleep(retryAfter);
    return rFetch(url, apiKey, retries - 1);
  }
  return res;
}

export async function POST(request: Request) {
  try {
    const { riotId } = await request.json();
    const API_KEY = process.env.RIOT_API_KEY;
    if (!API_KEY) return NextResponse.json({ error: 'API Anahtarı eksik!' }, { status: 500 });

    const [gameName, tagLine] = riotId.split('#');

    // 1. PUUID
    const accountRes = await rFetch(
      `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      API_KEY
    );
    if (!accountRes.ok) throw new Error('Oyuncu bulunamadı.');
    const { puuid } = await accountRes.json();

    // 2. Rank
    const rankRes = await rFetch(
      `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
      API_KEY
    );
    const rankData = await rankRes.json();
    const soloQ = Array.isArray(rankData)
      ? rankData.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
      : null;

    // 3. Son 20 maç ID
    const matchIdsRes = await rFetch(
      `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=20&queue=420`,
      API_KEY
    );
    const matchIds = await matchIdsRes.json();

    // 4. Son 1 hafta
    const oneWeekAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const weeklyRes = await rFetch(
      `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=100&queue=420&startTime=${oneWeekAgo}`,
      API_KEY
    );
    const weeklyMatchIds = await weeklyRes.json();
    const weeklyMatchSet = new Set(weeklyMatchIds);

    // 5. Maç detayları — Promise.all yerine sırayla, rate limit koruması
    const matchDetails: any[] = [];
    for (const id of matchIds.slice(0, 20)) {
      const r = await rFetch(
        `https://europe.api.riotgames.com/lol/match/v5/matches/${id}`,
        API_KEY
      );
      matchDetails.push(await r.json());
    }

    // 6. Timeline — sadece ilk 5 maç (rate limit tasarrufu)
    const timelineDetails: any[] = [];
    for (const id of matchIds.slice(0, 5)) {
      try {
        const r = await rFetch(
          `https://europe.api.riotgames.com/lol/match/v5/matches/${id}/timeline`,
          API_KEY
        );
        timelineDetails.push(await r.json());
      } catch {
        timelineDetails.push(null);
      }
    }

    // 7. Analiz
    const champMap: Record<string, any> = {};
    const recentMatches: any[] = [];
    let totalWins = 0;
    let weeklyWins = 0;
    let weeklyGames = 0;
    let totalGoldDiff15 = 0;
    let totalCsDiff15 = 0;
    let earlyGameCount = 0;
    let totalDoubles = 0, totalTriples = 0, totalQuadras = 0, totalPentas = 0;
    let totalDragons = 0, totalBarons = 0, totalHeraldKills = 0, objectiveGameCount = 0;
    let totalWardsPlaced = 0, totalWardsKilled = 0, totalControlWards = 0;

    matchDetails.forEach((match: any, idx: number) => {
      if (!match?.info) return;
      const participant = match.info.participants.find((p: any) => p.puuid === puuid);
      if (!participant) return;

      const won = participant.win;
      const champName = participant.championName;
      const k = participant.kills;
      const d = participant.deaths;
      const a = participant.assists;
      const cs = participant.totalMinionsKilled + participant.neutralMinionsKilled;
      const gameDurationMin = match.info.gameDuration / 60;
      const matchId = match.metadata.matchId;

      if (won) totalWins++;
      if (weeklyMatchSet.has(matchId)) { weeklyGames++; if (won) weeklyWins++; }

      totalDoubles += participant.doubleKills || 0;
      totalTriples += participant.tripleKills || 0;
      totalQuadras += participant.quadraKills || 0;
      totalPentas += participant.pentaKills || 0;
      totalWardsPlaced += participant.wardsPlaced || 0;
      totalWardsKilled += participant.wardsKilled || 0;
      totalControlWards += participant.visionWardsBoughtInGame || 0;

      const team = match.info.teams?.find((t: any) => t.teamId === participant.teamId);
      if (team) {
        totalDragons += team.objectives?.dragon?.kills || 0;
        totalBarons += team.objectives?.baron?.kills || 0;
        totalHeraldKills += team.objectives?.riftHerald?.kills || 0;
        objectiveGameCount++;
      }

      if (!champMap[champName]) champMap[champName] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, history: [] };
      champMap[champName].games++;
      champMap[champName].kills += k;
      champMap[champName].deaths += d;
      champMap[champName].assists += a;
      champMap[champName].history.push(won ? 'W' : 'L');
      if (won) champMap[champName].wins++;

      const timeline = timelineDetails[idx];
      if (timeline?.info?.frames) {
        const frame15 = timeline.info.frames.find((f: any) => f.timestamp >= 900000) ||
          timeline.info.frames[timeline.info.frames.length - 1];
        if (frame15?.participantFrames) {
          const participantId = match.info.participants.findIndex((p: any) => p.puuid === puuid) + 1;
          const myFrame = frame15.participantFrames[String(participantId)];
          if (myFrame) {
            const myRole = participant.teamPosition || participant.individualPosition;
            const opponent = match.info.participants.find((p: any) =>
              p.teamId !== participant.teamId &&
              (p.teamPosition === myRole || p.individualPosition === myRole)
            );
            if (opponent) {
              const oppId = match.info.participants.findIndex((p: any) => p.puuid === opponent.puuid) + 1;
              const oppFrame = frame15.participantFrames[String(oppId)];
              if (oppFrame) {
                totalGoldDiff15 += myFrame.totalGold - oppFrame.totalGold;
                totalCsDiff15 += myFrame.minionsKilled - oppFrame.minionsKilled;
                earlyGameCount++;
              }
            }
          }
        }
      }

      recentMatches.push({
        id: matchId,
        champion: champName,
        result: won ? 'Galibiyet' : 'Bozgun',
        kills: k, deaths: d, assists: a,
        kda: ((k + a) / (d || 1)).toFixed(2),
        cs,
        csPerMin: (cs / gameDurationMin).toFixed(1),
        duration: `${Math.floor(gameDurationMin)}dk`,
        time: new Date(match.info.gameCreation).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
        isWeekly: weeklyMatchSet.has(matchId),
      });
    });

    const totalGamesCount = matchDetails.filter((m: any) => m?.info).length;
    const championStats = Object.keys(champMap).map(champ => {
      const s = champMap[champ];
      return {
        name: champ, games: s.games, wins: s.wins,
        winRate: `${Math.round((s.wins / s.games) * 100)}%`,
        kda: ((s.kills + s.assists) / (s.deaths || 1)).toFixed(2),
        avgKills: (s.kills / s.games).toFixed(1),
        avgDeaths: (s.deaths / s.games).toFixed(1),
        avgAssists: (s.assists / s.games).toFixed(1),
        history: s.history.slice(-5),
      };
    }).sort((a, b) => b.games - a.games);

    let currentStreak = 0, streakType = '';
    for (const m of recentMatches) {
      if (currentStreak === 0) { streakType = m.result === 'Galibiyet' ? 'W' : 'L'; currentStreak = 1; }
      else if ((m.result === 'Galibiyet') === (streakType === 'W')) currentStreak++;
      else break;
    }

    return NextResponse.json({
      rank: soloQ ? `${soloQ.tier} ${soloQ.rank}` : 'Unranked',
      lp: soloQ?.leaguePoints || 0,
      tier: soloQ?.tier || 'UNRANKED',
      wins: soloQ?.wins || 0,
      losses: soloQ?.losses || 0,
      overallWinRate: soloQ ? `${Math.round((soloQ.wins / (soloQ.wins + soloQ.losses)) * 100)}%` : 'N/A',
      weeklyGames, weeklyWins,
      weeklyWinRate: weeklyGames > 0 ? `${Math.round((weeklyWins / weeklyGames) * 100)}%` : 'N/A',
      recentGames: totalGamesCount,
      recentWinRate: totalGamesCount > 0 ? `${Math.round((totalWins / totalGamesCount) * 100)}%` : 'N/A',
      streak: { count: currentStreak, type: streakType },
      avgGoldDiff15: earlyGameCount > 0 ? Math.round(totalGoldDiff15 / earlyGameCount) : 0,
      avgCsDiff15: earlyGameCount > 0 ? (totalCsDiff15 / earlyGameCount).toFixed(1) : '0',
      multiKills: { doubles: totalDoubles, triples: totalTriples, quadras: totalQuadras, pentas: totalPentas },
      avgDragons: objectiveGameCount > 0 ? (totalDragons / objectiveGameCount).toFixed(1) : '0',
      avgBarons: objectiveGameCount > 0 ? (totalBarons / objectiveGameCount).toFixed(1) : '0',
      avgHerald: objectiveGameCount > 0 ? (totalHeraldKills / objectiveGameCount).toFixed(1) : '0',
      avgWardsPlaced: totalGamesCount > 0 ? (totalWardsPlaced / totalGamesCount).toFixed(1) : '0',
      avgWardsKilled: totalGamesCount > 0 ? (totalWardsKilled / totalGamesCount).toFixed(1) : '0',
      avgControlWards: totalGamesCount > 0 ? (totalControlWards / totalGamesCount).toFixed(1) : '0',
      championStats: championStats.slice(0, 7),
      recentMatches: recentMatches.slice(0, 15),
    });

  } catch (error: any) {
    console.error('Riot API Hatası:', error);
    return NextResponse.json({ error: error.message || 'Sunucu hatası' }, { status: 500 });
  }
}