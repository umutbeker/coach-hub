// /app/api/scout/route.ts
// The draft room's scout panel, served from the shared opponent report.
//
// The draft room used to run its own two Leaguepedia queries from the
// browser, on every open — the heaviest use of the API in the whole app, from
// the machine least able to afford being rate-limited (a coach mid-draft).
// It now reads the same saved report as Prep, in the shape it already
// renders, so nothing about the panel changes except where the data comes
// from.
import { NextResponse } from 'next/server';
import { getOrBuildReport, type Report } from '../../../lib/report';

const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0);

/** The shape the draft room has always rendered. */
function toScout(r: Report) {
  return {
    opponent: r.opponent,
    players: r.players.map(p => ({
      name: p.name,
      games: p.games,
      winRate: p.wr,
      topChamps: p.champs.map(c => ({ name: c.name, games: c.n, winRate: pct(c.w ?? 0, c.n) })),
    })),
    recentMatches: r.recent.map(g => {
      const blue = g.side === 'blue';
      return {
        id: g.gameId,
        date: g.date,
        tournament: g.tournament,
        opponent: g.vs,
        result: g.won ? 'W' : 'L',
        teamIsBlue: blue,
        // The report stores picks and bans as "theirs" and "the other side's";
        // the panel wants them by side.
        blueBans: blue ? g.theirBans : g.oppBans,
        redBans: blue ? g.oppBans : g.theirBans,
        bluePicks: blue ? g.theirPicks : g.oppPicks,
        redPicks: blue ? g.oppPicks : g.theirPicks,
      };
    }),
    fetchedAt: r.savedAt ?? r.builtAt,
    partial: r.partial ?? false,
  };
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const opponent = (sp.get('opponent') ?? '').trim();
  if (!opponent) return NextResponse.json({ error: 'opponent required' }, { status: 400 });

  const { report, reason } = await getOrBuildReport(opponent, sp.get('refresh') === 'true');
  if (!report) {
    return NextResponse.json({
      error: reason === 'ratelimited'
        ? 'Leaguepedia is rate-limiting right now. Try again in a minute.'
        : `No Leaguepedia data found for “${opponent}”.`,
      reason,
    }, { status: reason === 'ratelimited' ? 503 : 404 });
  }
  return NextResponse.json({ scout: toScout(report) });
}
