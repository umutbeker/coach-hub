// lib/tournaments.ts
// Which competitions the Tournaments page follows, and the shape their schedule
// is normalised into. Shared by the API route and the page — the page never
// sees a raw PandaScore object.
//
// Every league we track is identified by its PandaScore league id, which is
// stable; the *serie* (Summer 2026, Winter 2027 …) is not listed here on
// purpose — a new split would otherwise need a code change. The route picks
// the current serie from the matches themselves.

import { TEAM_PANDASCORE_NAME, TEAM_ACRONYM } from './team';

export type TrackedLeague = {
  /** URL and Redis segment. */
  slug: string;
  /** Display name. */
  name: string;
  /** PandaScore `league.id` — verified against the API, not guessed. */
  pandascoreId: number;
  /** One line under the title. */
  blurb: string;
  /** True for the league we actually play in; its matches get the "us" marker. */
  ours: boolean;
};

// Arabian League is our ERL; EMEA Masters is the tier it feeds into.
// Both ids confirmed live against api.pandascore.co on 2026-09-20.
export const TRACKED: TrackedLeague[] = [
  {
    slug: 'arabian-league',
    name: 'Arabian League',
    pandascoreId: 4962,
    blurb: 'Our league — EMEA regional',
    ours: true,
  },
  {
    slug: 'emea-masters',
    name: 'EMEA Masters',
    pandascoreId: 4996,
    blurb: 'Where the EMEA regional leagues meet',
    ours: false,
  },
];

export const DEFAULT_LEAGUE = TRACKED[0].slug;

export const findLeague = (slug: string | null | undefined) =>
  TRACKED.find(l => l.slug === slug) ?? TRACKED[0];

// ── Normalised shapes ───────────────────────────────────────────────────────

export type TTeam = {
  id: number;
  name: string;
  acronym: string | null;
  image: string | null;
  /** Our own team, matched the same way the fixture route does it. */
  ours: boolean;
};

export type TStream = {
  url: string;
  embed: string | null;
  platform: 'twitch' | 'youtube' | 'other';
  language: string;
  main: boolean;
  official: boolean;
};

/**
 * `tba` means the slot exists on the calendar but has no kickoff time yet.
 * A match can be `scheduled` with both teams still null — that is the normal
 * state of a playoff bracket before the group stage ends, and the page draws
 * those as empty TBA slots rather than hiding them.
 */
export type TStatus = 'live' | 'finished' | 'scheduled' | 'tba';

export type TMatch = {
  id: number;
  /** "Round of 16 Match 4", "Grand final" — the part before the team names. */
  round: string | null;
  scheduledAt: string | null;
  bestOf: number;
  status: TStatus;
  teamA: TTeam | null;
  teamB: TTeam | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: number | null;
  /** One of the two teams is us. */
  ours: boolean;
  streams: TStream[];
};

export type TStanding = {
  rank: number;
  team: TTeam;
  wins: number;
  losses: number;
  gameWins: number;
  gameLosses: number;
};

export type TStage = {
  id: number;
  name: string;
  matches: TMatch[];
  /** Empty for bracket stages — PandaScore only ranks round-robin ones. */
  standings: TStanding[];
};

export type LeagueSchedule = {
  slug: string;
  league: string;
  leagueImage: string | null;
  /** "Summer 2026" — whichever split is current. */
  serie: string;
  stages: TStage[];
  /** ISO. When PandaScore was last read successfully. */
  updatedAt: string;
  /** True when this is an older copy served because the refresh failed. */
  stale?: boolean;
};

// ── Team matching ───────────────────────────────────────────────────────────

/** Same test the fixture route uses: name substring or exact acronym. */
export function isOurTeam(name?: string | null, acronym?: string | null) {
  return (
    (name ?? '').toLowerCase().includes(TEAM_PANDASCORE_NAME) ||
    (acronym ?? '').toLowerCase() === TEAM_ACRONYM
  );
}

// ── Freshness ───────────────────────────────────────────────────────────────

/**
 * How long a cached schedule may be served before the next read refreshes it.
 *
 * This is what makes the page feel live without a per-minute cron: the window
 * tightens as a match approaches and is at its shortest while one is being
 * played, so scores move in near real time, while a quiet week costs
 * PandaScore two calls an hour no matter how many people have the tab open.
 */
export function ttlMs(s: LeagueSchedule): number {
  const matches = s.stages.flatMap(st => st.matches);
  if (matches.some(m => m.status === 'live')) return 45_000;

  const now = Date.now();
  let soonest = Infinity;
  for (const m of matches) {
    if (!m.scheduledAt || m.status === 'finished') continue;
    const delta = new Date(m.scheduledAt).getTime() - now;
    if (delta > 0) soonest = Math.min(soonest, delta);
  }

  if (soonest <= 30 * 60_000) return 60_000;        // kickoff within the half hour
  if (soonest <= 12 * 60 * 60_000) return 5 * 60_000; // something later today
  return 30 * 60_000;                                // nothing imminent
}

export const isFresh = (s: LeagueSchedule) =>
  Date.now() - new Date(s.updatedAt).getTime() < ttlMs(s);
