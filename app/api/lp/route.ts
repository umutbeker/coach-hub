// /app/api/lp/route.ts
// Our own team's Leaguepedia data, on demand.
//
// The daily cron fills `matches:lp` and `lp:<player>`; this is what the pages
// call when Redis has nothing yet — it used to be a query straight from the
// browser, which is the one path that could still hit the anonymous rate
// limit. Same queries, run here, signed in, and written back to Redis so the
// next reader gets them from cache.
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { lpQuery, cargo } from '../../../lib/leaguepedia';
import { TEAM_LP_NAME } from '../../../lib/team';
import { USERS } from '../../../lib/users';

const redis = Redis.fromEnv();
const BUDGET_MS = 40_000;

const BAN_PICK = [1, 2, 3, 4, 5].flatMap(i => [
  `PB.Team1Ban${i}`, `PB.Team2Ban${i}`, `PB.Team1Pick${i}`, `PB.Team2Pick${i}`,
]);

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const type = sp.get('type');
  const deadline = Date.now() + BUDGET_MS;

  if (type === 'matches') {
    const rows = await lpQuery(cargo({
      tables: 'ScoreboardPlayers=SP,PicksAndBansS7=PB',
      fields: ['SP.PlayerWin', 'SP.DateTime_UTC', 'SP.Tournament', 'SP.Team', 'SP.TeamVs', 'SP.Side', 'SP.GameId', ...BAN_PICK].join(','),
      join_on: 'SP.GameId=PB.GameId',
      where: `SP.Team='${TEAM_LP_NAME}' OR SP.TeamVs='${TEAM_LP_NAME}'`,
      order_by: 'SP.DateTime_UTC DESC',
      limit: '500',
    }), 'lp/matches', deadline);
    if (rows === null) return NextResponse.json({ error: 'Leaguepedia is rate-limiting right now.' }, { status: 503 });

    // Stored in the same shape the cron writes, so readers don't care which
    // of the two filled it.
    const data = { cargoquery: rows.map(title => ({ title })) };
    if (rows.length) await redis.set('matches:lp', JSON.stringify(data));
    return NextResponse.json({ data });
  }

  if (type === 'player') {
    const name = (sp.get('name') ?? '').trim();
    const player = USERS.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (!player) return NextResponse.json({ error: 'unknown player' }, { status: 404 });

    const rows = await lpQuery(cargo({
      tables: 'ScoreboardPlayers',
      fields: 'Champion,Kills,Deaths,Assists,PlayerWin,DateTime_UTC,Tournament,Team,TeamVs,CS,Gold,Side',
      where: `Name='${player.lpName ?? player.name}' AND Team='${TEAM_LP_NAME}'`,
      order_by: 'DateTime_UTC DESC',
      limit: '50',
    }), `lp/player/${player.name}`, deadline);
    if (rows === null) return NextResponse.json({ error: 'Leaguepedia is rate-limiting right now.' }, { status: 503 });

    const data = { cargoquery: rows.map(title => ({ title })) };
    if (rows.length) await redis.set(`lp:${player.name}`, JSON.stringify(data));
    return NextResponse.json({ data });
  }

  return NextResponse.json({ error: 'type must be matches or player' }, { status: 400 });
}
