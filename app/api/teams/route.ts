// /app/api/teams/route.ts
// Team name search for the Prep box: type "g2" and pick "G2 Esports" instead
// of having to know how Leaguepedia spells it (a wrong spelling returns zero
// rows rather than an error, so it looks like "no data").
//
// One query per two-letter prefix, cached for a week, and longer searches are
// filtered from that cached slice. Querying on every keystroke hits the rate
// limit even signed in — measured: "ge" and "gen" typed in sequence were both
// refused, while the same searches through the cache are free.
import { NextResponse } from 'next/server';
import { lpQuery, cargo } from '../../../lib/leaguepedia';
import { get, put } from '../../../lib/store';

const KEY = 'teams:v2';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const BUDGET_MS = 12_000;

export type TeamHit = { name: string; short: string; region: string; disbanded: boolean };
type Slice = { teams: TeamHit[]; at: number };

/** Everything whose name or tag starts with the same first two letters. */
async function slice(base: string): Promise<{ teams: TeamHit[]; rateLimited: boolean }> {
  const cached = await get<Slice>(KEY, base);
  if (cached && Date.now() - cached.at < FRESH_MS) return { teams: cached.teams, rateLimited: false };

  const rows = await lpQuery(cargo({
    tables: 'Teams',
    fields: 'Name,Short,Region,IsDisbanded',
    where: `Name LIKE "${base}%" OR Short LIKE "${base}%"`,
    order_by: 'Name',
    limit: '200',
  }), `teams/${base}`, Date.now() + BUDGET_MS);

  // Typing should never surface an error; fall back to a stale slice if there
  // is one, otherwise to nothing, and try again on the next keystroke.
  if (rows === null) return { teams: cached?.teams ?? [], rateLimited: true };

  const teams: TeamHit[] = rows.map(r => ({
    name: r.Name,
    short: r.Short ?? '',
    region: r.Region ?? '',
    disbanded: r.IsDisbanded === '1',
  }));
  await put(KEY, base, { teams, at: Date.now() } satisfies Slice);
  return { teams, rateLimited: false };
}

export async function GET(request: Request) {
  // Keep what team names can contain, drop what could break the query.
  const q = (new URL(request.url).searchParams.get('q') ?? '')
    .replace(/["\\%_]/g, '').trim().slice(0, 40).toLowerCase();
  if (!q) return NextResponse.json({ teams: [] });

  const { teams, rateLimited } = await slice(q.slice(0, 2));

  const hits = teams.filter(t => t.name.toLowerCase().startsWith(q) || t.short.toLowerCase().startsWith(q));
  // Teams whose *name* matches come first — typing "g" should surface G2, not
  // a team whose tag happens to be GOB — and disbanded teams last.
  const rank = (t: TeamHit) => (t.disbanded ? 10 : 0) + (t.name.toLowerCase().startsWith(q) ? 0 : 2);
  hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return NextResponse.json({ teams: hits.slice(0, 12), rateLimited });
}
