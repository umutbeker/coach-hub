// /app/api/sync/route.ts
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const PLAYERS = [
  { name: 'MonkaS',     riotId: 'kd6dash3dot7#1111' },
  { name: 'Grave',      riotId: 'GRAVE#x1905' },
  { name: 'Fade',       riotId: 'SU ZYZZ#0311' },
  { name: 'Cape',       riotId: 'eL KaDDaF1#DEAD' },
  { name: 'StarScreen', riotId: 'ESREF TEK#1702' },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rFetch(url: string, apiKey: string, retries = 3): Promise<Response> {
  await sleep(120);
  const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
  if (res.status === 429) {
    if (retries <= 0) throw new Error('Rate limit aşıldı');
    const retryAfter = Number(res.headers.get('Retry-After') || 12) * 1000;
    console.log(`[sync] Rate limit, ${retryAfter}ms bekleniyor...`);
    await sleep(retryAfter);
    return rFetch(url, apiKey, retries - 1);
  }
  return res;
}

async function fetchPlayerData(riotId: string, apiKey: string) {
  const [gameName, tagLine] = riotId.split('#');

  const accountRes = await rFetch(
    `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey
  );
  if (!accountRes.ok) throw new Error(`Oyuncu bulunamadı: ${riotId}`);
  const { puuid } = await accountRes.json();

  const rankRes = await rFetch(`https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`, apiKey);
  const rankData = await rankRes.json();
  const soloQ = Array.isArray(rankData) ? rankData.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') : null;

  const matchIdsRes = await rFetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=20&queue=420`,
    apiKey
  );
  const matchIds = await matchIdsRes.json();

  const oneWeekAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const weeklyRes = await rFetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=100&queue=420&startTime=${oneWeekAgo}`,
    apiKey
  );
  const weeklyMatchIds = await weeklyRes.json();
  const weeklyMatchSet = new Set(weeklyMatchIds);

  const matchDetails: any[] = [];
  for (const id of matchIds.slice(0, 20)) {
    const r = await rFetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${id}`, apiKey);
    matchDetails.push(await r.json());
  }

  const timelineDetails: any[] = [];
  for (const id of matchIds.slice(0, 5)) {
    try {
      const r = await rFetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${id}/timeline`, apiKey);
      timelineDetails.push(await r.json());
    } catch { timelineDetails.push(null); }
  }

  const champMap: Record<string, any> = {};
  const recentMatches: any[] = [];
  let totalWins = 0, weeklyWins = 0, weeklyGames = 0;
  let totalGoldDiff15 = 0, totalCsDiff15 = 0, earlyGameCount = 0;
  let totalDoubles = 0, totalTriples = 0, totalQuadras = 0, totalPentas = 0;
  let totalDragons = 0, totalBarons = 0, totalHeraldKills = 0, objectiveGameCount = 0;
  let totalWardsPlaced = 0, totalWardsKilled = 0, totalControlWards = 0;

  matchDetails.forEach((match: any, idx: number) => {
    if (!match?.info) return;
    const participant = match.info.participants.find((p: any) => p.puuid === puuid);
    if (!participant) return;

    const won = participant.win;
    const champName = participant.championName;
    const k = participant.kills, d = participant.deaths, a = participant.assists;
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
      id: matchId, champion: champName,
      result: won ? 'Galibiyet' : 'Bozgun',
      kills: k, deaths: d, assists: a,
      kda: ((k + a) / (d || 1)).toFixed(2),
      cs, csPerMin: (cs / gameDurationMin).toFixed(1),
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

  return {
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
  };
}

export async function GET(request: Request) {
  const API_KEY = process.env.RIOT_API_KEY;
  if (!API_KEY) return NextResponse.json({ error: 'API key missing' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const playerParam = searchParams.get('player');

  // Tek oyuncu sync
  if (playerParam && playerParam !== 'matches') {
    const player = PLAYERS.find(p => p.name === playerParam);
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    const errors: string[] = [];
    const synced: string[] = [];

    // Riot
    try {
      console.log(`[sync] ${player.name} Riot...`);
      const data = await fetchPlayerData(player.riotId, API_KEY);
      await redis.set(`player:${player.name}`, JSON.stringify(data));
      synced.push(player.name);
    } catch (e: any) {
      errors.push(`Riot: ${e.message}`);
    }

    // LP
    try {
      console.log(`[sync] ${player.name} LP...`);
      const lpParams = new URLSearchParams({
        action: 'cargoquery', tables: 'ScoreboardPlayers',
        fields: 'Champion,Kills,Deaths,Assists,PlayerWin,DateTime_UTC,Tournament,Team,TeamVs,CS,Gold,Side,Name',
        where: `Name='${player.name}' AND Team='Ozarox Esports'`,
        order_by: 'DateTime_UTC DESC', limit: '50', format: 'json', origin: '*',
      });
      const lpRes = await fetch(`https://lol.fandom.com/api.php?${lpParams.toString()}`);
      const lpData = await lpRes.json();
      if (lpData.cargoquery?.length > 0) {
        await redis.set(`lp:${player.name}`, JSON.stringify(lpData));
      }
    } catch (e: any) {
      errors.push(`LP: ${e.message}`);
    }

    await redis.set('sync:updatedAt', new Date().toISOString());
    return NextResponse.json({ success: true, player: player.name, synced, errors });
  }

  // Matches sync
  if (playerParam === 'matches') {
    try {
      console.log('[sync] matches LP...');
      const matchesParams = new URLSearchParams({
        action: 'cargoquery',
        tables: 'ScoreboardPlayers=SP,PicksAndBansS7=PB',
        fields: [
          'SP.Name','SP.Champion','SP.Kills','SP.Deaths','SP.Assists','SP.PlayerWin',
          'SP.DateTime_UTC','SP.Tournament','SP.Team','SP.TeamVs','SP.Side','SP.GameId','SP.CS',
          'PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5',
          'PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5',
          'PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5',
          'PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5',
        ].join(','),
        join_on: 'SP.GameId=PB.GameId',
        where: `SP.Team='Ozarox Esports' OR SP.TeamVs='Ozarox Esports'`,
        order_by: 'SP.DateTime_UTC DESC', limit: '200', format: 'json', origin: '*',
      });
      const matchesRes = await fetch(`https://lol.fandom.com/api.php?${matchesParams.toString()}`);
      const matchesData = await matchesRes.json();
      if (matchesData.cargoquery?.length > 0) {
        await redis.set('matches:lp', JSON.stringify(matchesData));
        await redis.set('sync:updatedAt', new Date().toISOString());

      // Scout: sonraki rakibi bul ve LP'den çek
      try {
        const pandaKey = process.env.PANDASCORE_API_KEY;
        if (pandaKey) {
          const fixtureRes = await fetch(
            'https://api.pandascore.co/lol/matches/upcoming?page[size]=10&sort=begin_at',
            { headers: { Authorization: `Bearer ${pandaKey}` } }
          );
          const fixtureData = await fixtureRes.json();
          const s2gMatch = Array.isArray(fixtureData) ? fixtureData.find((m: any) =>
            m.opponents?.some((o: any) => 
              o.opponent?.name?.toLowerCase().includes('ozarox') ||
              o.opponent?.acronym?.toLowerCase() === 'ozarox'
            )
          ) : null;

          if (s2gMatch) {
            const oppTeam = s2gMatch.opponents?.find((o: any) =>
              !o.opponent?.name?.toLowerCase().includes('ozarox') &&
              o.opponent?.acronym?.toLowerCase() !== 'ozarox'
            )?.opponent?.name;

            if (oppTeam) {
              const TEAM_NAME_MAP: Record<string,string> = {
                'BIG': 'Berlin International Gaming',
                'The Otter Side': 'Otter Side',
              };
              const lpName = TEAM_NAME_MAP[oppTeam] ?? oppTeam;

              const p1 = new URLSearchParams({
                action:'cargoquery', tables:'ScoreboardPlayers',
                fields:'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name',
                where:`Team="${lpName}"`,
                order_by:'DateTime_UTC DESC', limit:'75', format:'json', origin:'*',
              });
              const p2 = new URLSearchParams({
                action:'cargoquery', tables:'ScoreboardPlayers=SP,PicksAndBansS7=PB',
                fields:['SP.PlayerWin','SP.DateTime_UTC','SP.Tournament','SP.Team','SP.TeamVs','SP.Side','SP.GameId',
                  'PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5',
                  'PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5',
                  'PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5',
                  'PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5',
                ].join(','),
                join_on:'SP.GameId=PB.GameId',
                where:`SP.Team="${lpName}"`,
                order_by:'SP.DateTime_UTC DESC', limit:'50', format:'json', origin:'*',
              });

              const [r1, r2] = await Promise.all([
                fetch(`https://lol.fandom.com/api.php?${p1}`).then(r=>r.json()),
                fetch(`https://lol.fandom.com/api.php?${p2}`).then(r=>r.json()),
              ]);

              const playerMap: Record<string,any> = {};
              (r1.cargoquery||[]).forEach((item: any) => {
                const m=item.title, name=m.Name||'Unknown';
                if (!playerMap[name]) playerMap[name]={name,champs:{},games:0,wins:0};
                playerMap[name].games++;
                if (m.PlayerWin==='Yes') playerMap[name].wins++;
                if (m.Champion) {
                  if (!playerMap[name].champs[m.Champion]) playerMap[name].champs[m.Champion]={games:0,wins:0};
                  playerMap[name].champs[m.Champion].games++;
                  if (m.PlayerWin==='Yes') playerMap[name].champs[m.Champion].wins++;
                }
              });
              const players = Object.values(playerMap).map((p:any)=>({
                name:p.name, games:p.games, winRate:Math.round((p.wins/p.games)*100),
                topChamps:Object.entries(p.champs).map(([c,s]:any)=>({name:c,games:s.games,winRate:Math.round((s.wins/s.games)*100)})).sort((a,b)=>b.games-a.games).slice(0,5),
              })).sort((a,b)=>b.games-a.games);

              const gameMap: Record<string,any> = {};
              (r2.cargoquery||[]).forEach((item: any) => {
                const m=item.title;
                const rawDate=(m['DateTime UTC']??m['DateTime_UTC']??'').split(' ')[0];
                const gid=m.GameId||`${m.TeamVs}_${rawDate}`;
                if (!gameMap[gid]) {
                  gameMap[gid]={id:gid,date:rawDate,tournament:m.Tournament||'',opponent:m.TeamVs||'?',
                    result:m.PlayerWin==='Yes'?'W':'L',teamIsBlue:m.Side==='1'||m.Side?.toLowerCase()==='blue',
                    blueBans:[m.Team1Ban1,m.Team1Ban2,m.Team1Ban3,m.Team1Ban4,m.Team1Ban5].filter(Boolean),
                    redBans:[m.Team2Ban1,m.Team2Ban2,m.Team2Ban3,m.Team2Ban4,m.Team2Ban5].filter(Boolean),
                    bluePicks:[m.Team1Pick1,m.Team1Pick2,m.Team1Pick3,m.Team1Pick4,m.Team1Pick5].filter(Boolean),
                    redPicks:[m.Team2Pick1,m.Team2Pick2,m.Team2Pick3,m.Team2Pick4,m.Team2Pick5].filter(Boolean),
                  };
                }
              });
              const recentMatches = Object.values(gameMap).sort((a:any,b:any)=>b.date.localeCompare(a.date)).slice(0,5);

              await redis.set('scout:next', JSON.stringify({ opponent:oppTeam, players, recentMatches, fetchedAt:Date.now() }));
              console.log(`[sync] Scout prefetch: ${oppTeam}`);
            }
          }
        }
      } catch(e:any) { console.error('[sync] Scout hata:', e.message); }

      return NextResponse.json({ success: true, matches: matchesData.cargoquery.length });
      }
      return NextResponse.json({ success: false, error: 'No matches found' });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // ?player yoksa — hepsini listele
  return NextResponse.json({
    message: 'Use ?player=NAME to sync a player, or ?player=matches for match history',
    players: PLAYERS.map(p => p.name),
    endpoints: PLAYERS.map(p => `/api/sync?player=${p.name}`).concat(['/api/sync?player=matches']),
  });
}
