// /app/api/fixture/route.ts
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { USERS } from '../../../lib/users';
import { TEAM_NAME, TEAM_PANDASCORE_NAME, TEAM_ACRONYM } from '../../../lib/team';

const redis = Redis.fromEnv();
const CACHE_KEY = 'fixture:cache';
const CACHE_TTL = 30 * 60; // 30 dakika (Redis EX saniye cinsinden)

export async function GET() {
  // Redis cache kontrolü
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    return NextResponse.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
  }

  try {
    const API_KEY = process.env.PANDASCORE_API_KEY;
    const headers = {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    };

    // Find team ID — try players in order until one resolves a team
    const LOOKUP_PLAYERS = USERS.filter(u => u.role === 'player' && u.riotId).map(u => u.name);
    let teamId: number | undefined;
    let teamName = TEAM_NAME;

    for (const playerName of LOOKUP_PLAYERS) {
      const playerRes = await fetch(
        `https://api.pandascore.co/lol/players?search[name]=${encodeURIComponent(playerName)}&per_page=1`,
        { headers }
      );
      const players = await playerRes.json();
      const team = players?.[0]?.current_team;
      if (team?.id && (team?.name?.toLowerCase().includes(TEAM_PANDASCORE_NAME) ||
                       team?.acronym?.toLowerCase() === TEAM_ACRONYM)) {
        teamId = team.id;
        teamName = team.name;
        break;
      }
    }
    if (!teamId) return NextResponse.json({ teamName: TEAM_NAME, teamId: null, tournaments: [] });

    // Fetch upcoming matches
    const upcomingRes = await fetch(
      `https://api.pandascore.co/lol/matches/upcoming?filter[opponent_id]=${teamId}&per_page=20&sort=scheduled_at`,
      { headers }
    );
    const upcoming = await upcomingRes.json();

    // Fetch running matches (live)
    const runningRes = await fetch(
      `https://api.pandascore.co/lol/matches/running?filter[opponent_id]=${teamId}&per_page=5`,
      { headers }
    );
    const running = await runningRes.json();

    // Fetch recent past matches (so there's always something to show)
    const pastRes = await fetch(
      `https://api.pandascore.co/lol/matches/past?filter[opponent_id]=${teamId}&per_page=5&sort=-scheduled_at`,
      { headers }
    );
    const past = await pastRes.json();

    // Combine all matches — running first, then upcoming, then past
    const allMatches: any[] = [
      ...(Array.isArray(running) ? running : []),
      ...(Array.isArray(upcoming) ? upcoming : []),
      ...(Array.isArray(past) ? past : []),
    ];

    if (allMatches.length === 0) throw new Error('No matches found');

    // Group by tournament
    const tournamentMap: Record<string, any> = {};

    allMatches.forEach((match: any) => {
      const tourneyName = match.tournament?.name || match.league?.name || match.serie?.name || 'Other';
      const tourneyId = match.tournament?.id || match.league?.id || 'other';
      const key = String(tourneyId);

      if (!tournamentMap[key]) {
        tournamentMap[key] = {
          id: key,
          name: tourneyName,
          league: match.league?.name || '',
          serie: match.serie?.full_name || match.serie?.name || '',
          matches: [],
        };
      }

      // Avoid duplicates (same match ID)
      if (tournamentMap[key].matches.some((m: any) => m.id === match.id)) return;

      const opponent = match.opponents
        ?.find((o: any) => o.opponent?.id !== teamId)
        ?.opponent?.name || 'TBD';

      const scheduledAt = match.scheduled_at;
      const date = scheduledAt ? new Date(scheduledAt) : null;
      const daysLeft = date ? Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

      // Determine match status for display
      const isPast = match.status === 'finished' || (daysLeft !== null && daysLeft < 0);
      const isLive = match.status === 'running';

      tournamentMap[key].matches.push({
        id: match.id,
        opponent,
        scheduledAt,
        date: date ? date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD',
        time: date ? date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—',
        daysLeft,
        matchType: match.number_of_games > 1 ? `BO${match.number_of_games}` : 'BO1',
        status: match.status,
        isPast,
        isLive,
        league: match.league?.name || '',
        serie: match.serie?.full_name || '',
      });
    });

    // Sort matches within each tournament: live first, then upcoming (nearest), then past (most recent)
    Object.values(tournamentMap).forEach((t: any) => {
      t.matches.sort((a: any, b: any) => {
        if (a.isLive && !b.isLive) return -1;
        if (!a.isLive && b.isLive) return 1;
        if (!a.isPast && !b.isPast) return (a.daysLeft ?? 99) - (b.daysLeft ?? 99);
        if (a.isPast && b.isPast) return (b.scheduledAt || '').localeCompare(a.scheduledAt || '');
        if (!a.isPast && b.isPast) return -1;
        if (a.isPast && !b.isPast) return 1;
        return 0;
      });
    });

    const result = {
      teamName,
      teamId,
      tournaments: Object.values(tournamentMap).sort((a: any, b: any) => {
        const aDate = a.matches[0]?.scheduledAt || '';
        const bDate = b.matches[0]?.scheduledAt || '';
        return aDate.localeCompare(bDate);
      }),
    };

    await redis.set(CACHE_KEY, JSON.stringify(result), { ex: CACHE_TTL });
    return NextResponse.json(result);

  } catch (e: any) {
    console.error('[fixture] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
