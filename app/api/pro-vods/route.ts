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
// Maç (oyun) sayısı, seri değil — 50 maç kabaca 15 seriye denk geliyor.
const GAMES_PER_LEAGUE = 50;

/*
 * Order is the order the page shows them in — the biggest event first.
 *
 * `fetchLeague` filters on `Tournament LIKE "%<league> <year>%"`, and
 * Leaguepedia calls the event "Worlds 2026 Main Event", so "Worlds" matches
 * with no special case. Checked on live rows: 20/20 of its games carry
 * VodPB, VodGameStart and full pick/ban data.
 */
export const LEAGUES = ['Worlds', 'LEC', 'LCK'] as const;
type League = (typeof LEAGUES)[number];

// Sürümlü anahtar: yanıt şekli değiştiğinde eski cache servis edilmesin.
const cacheKey = (l: string) => `vods:v3:${l.toLowerCase()}`;

const pick = (r: LpRow, prefix: string, kind: 'Ban' | 'Pick') =>
  [1, 2, 3, 4, 5].map(i => r[`${prefix}${kind}${i}`]).filter(Boolean);

type Game = {
  gameId: string; matchId: string; date: string; tournament: string;
  gameInMatch: number | null; blueTeam: string; redTeam: string;
  winner: string | null; blueWon: boolean; patch: string;
};

/**
 * Maçları serilere topluyor. Tek bir BO3/BO5, listede üç ayrı satır olarak
 * değil tek seri olarak görünmeli; taraflar seri içinde değiştiği için
 * skor mavi/kırmızıya göre değil takım adına göre sayılıyor.
 */
function groupIntoSeries<T extends Game>(games: T[], fallbackTournament: string) {
  const map = new Map<string, T[]>();
  for (const g of games) {
    const list = map.get(g.matchId);
    if (list) list.push(g); else map.set(g.matchId, [g]);
  }

  return [...map.entries()].map(([matchId, list]) => {
    const ordered = [...list].sort(
      (a, b) => (a.gameInMatch ?? 0) - (b.gameInMatch ?? 0) || a.date.localeCompare(b.date),
    );
    const first = ordered[0];

    // Seri boyunca sabit kalan iki takım — ilk maçın taraflarından alınıyor.
    const teamA = first.blueTeam;
    const teamB = first.redTeam;
    const score = { [teamA]: 0, [teamB]: 0 } as Record<string, number>;
    for (const g of ordered) if (g.winner && g.winner in score) score[g.winner]++;

    const winner = score[teamA] === score[teamB] ? null
      : score[teamA] > score[teamB] ? teamA : teamB;

    return {
      matchId,
      date: first.date,
      tournament: first.tournament || fallbackTournament,
      teamA, teamB,
      scoreA: score[teamA], scoreB: score[teamB],
      winner,
      // Oynanan maç sayısı; serinin formatı (BO3/BO5) değil —
      // 3-1 biten bir BO5'te bu 4 olur.
      gamesPlayed: ordered.length,
      games: ordered,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

// ── Patch meta ──────────────────────────────────────────────────────────────
// The headline numbers for a league on the patch being played now. Computed
// here, from games already fetched for the VODs, so the page costs no extra
// Leaguepedia query — it reads one Redis key like everything else on /pro.

/** "26.20" sorts after "26.9"; a string compare gets that backwards. */
function patchRank(p: string): number {
  const [a, b] = p.split('.').map(Number);
  return (Number.isFinite(a) ? a : 0) * 1000 + (Number.isFinite(b) ? b : 0);
}

/** Below this, one patch is a coincidence rather than a read. */
const MIN_META_GAMES = 6;

type MetaGame = { patch: string; draft: { blueBans: string[]; redBans: string[]; bluePicks: string[]; redPicks: string[] } };

export type PatchMeta = {
  patches: string[];
  /** True when the newest patch alone was too thin and older ones were folded in. */
  widened: boolean;
  games: number;
  picked: { name: string; n: number }[];
  banned: { name: string; n: number }[];
  /** Blue's 1st pick — the first pick of the draft. */
  firstPick: { name: string; n: number }[];
  /** Red's 5th pick — the last pick of the draft, taken knowing everything. */
  lastPick: { name: string; n: number }[];
  /** Picked or banned, as a share of games. The number the team drafts by. */
  presence: { name: string; n: number; pct: number }[];
};

function count(names: (string | undefined)[], top = 10) {
  const t = new Map<string, number>();
  for (const n of names) if (n) t.set(n, (t.get(n) ?? 0) + 1);
  return [...t.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, top);
}

function buildMeta(games: MetaGame[]): PatchMeta | null {
  const dated = games.filter(g => g.patch);
  if (!dated.length) return null;

  // Newest patch first, widening only until the sample is readable.
  const order = [...new Set(dated.map(g => g.patch))].sort((a, b) => patchRank(b) - patchRank(a));
  const patches: string[] = [];
  let scoped: MetaGame[] = [];
  for (const p of order) {
    patches.push(p);
    scoped = dated.filter(g => patches.includes(g.patch));
    if (scoped.length >= MIN_META_GAMES) break;
  }

  const picks = scoped.flatMap(g => [...g.draft.bluePicks, ...g.draft.redPicks]);
  const bans = scoped.flatMap(g => [...g.draft.blueBans, ...g.draft.redBans]);

  const presence = new Map<string, number>();
  for (const n of [...picks, ...bans]) if (n) presence.set(n, (presence.get(n) ?? 0) + 1);

  return {
    patches,
    widened: patches.length > 1,
    games: scoped.length,
    picked: count(picks),
    banned: count(bans),
    // Draft order, not role order: bluePicks[0] is the very first pick of the
    // game and redPicks[4] is the very last.
    firstPick: count(scoped.map(g => g.draft.bluePicks[0])),
    lastPick: count(scoped.map(g => g.draft.redPicks[4])),
    presence: [...presence.entries()]
      .map(([name, n]) => ({ name, n, pct: Math.round((n / scoped.length) * 100) }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}

async function fetchLeague(league: League, deadline: number) {
  for (const year of seasonCandidates()) {
    const tournament = `${league} ${year}`;
    const params = cargo({
      tables: 'MatchScheduleGame=MSG,ScoreboardGames=SG,PicksAndBansS7=PB',
      join_on: 'MSG.GameId=SG.GameId,SG.GameId=PB.GameId',
      fields: [
        'MSG.GameId', 'MSG.MatchId', 'MSG.Vod', 'MSG.VodPB', 'MSG.VodHighlights', 'MSG.N_GameInMatch',
        'SG.Team1', 'SG.Team2', 'SG.Winner', 'SG.DateTime_UTC', 'SG.Tournament', 'SG.Patch',
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
        // Seriyi tahmin etmiyoruz: MatchId zaten bir BO serisinin tüm
        // maçlarında aynı. Yoksa GameId'nin son '_N' ekini atarak türetiyoruz.
        matchId: r.MatchId || r.GameId?.replace(/_\d+$/, '') || r.GameId,
        date,
        tournament: r.Tournament || tournament,
        patch: r.Patch ?? '',
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

    // Meta is built from the flat game list, before it is grouped into
    // series — a champion count is per game, not per series.
    return { rows: groupIntoSeries(games, tournament), tournament, meta: buildMeta(games) };
  }
  return { rows: [], tournament: `${league} ${seasonCandidates()[0]}`, meta: null };
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
    const { rows, tournament, meta } = await fetchLeague(league, deadline);
    if (rows === null) { rateLimited = true; continue; }

    const payload = { league, tournament, updatedAt: new Date().toISOString(), meta, series: rows };
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
