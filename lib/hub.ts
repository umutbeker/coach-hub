// lib/hub.ts
// Types for the coaching tools (scrims, VOD review, champion pool, prep,
// calendar). Shared by the API routes and the pages.

export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support',
};

export type Side = 'blue' | 'red';
export type Result = 'W' | 'L';

/**
 * One scrim game. Scrims live only here (Redis `scrims:v1`), never in the
 * Leaguepedia-backed official data, so the two can't bleed into each other.
 */
export type ScrimGame = {
  id: string;
  /** Games entered together (a scrim block vs one opponent) share a blockId. */
  blockId: string;
  gameNo: number;
  date: string;           // YYYY-MM-DD
  opponent: string;
  patch: string;          // e.g. "16.18"
  side: Side;             // our side
  result: Result;         // our result
  /** Our picks by role — the role decides which roster player is credited. */
  ourPicks: Record<Role, string>;
  theirPicks: string[];
  ourBans: string[];
  theirBans: string[];
  notes: string;
  vodId?: string;
  createdBy: string;
  createdAt: number;
};

export type VodSource = 'scrim' | 'official' | 'other';

export type Vod = {
  id: string;
  title: string;
  url: string;
  source: VodSource;
  /** Scrim game id when source is 'scrim'. */
  refId?: string;
  opponent?: string;
  date: string;
  createdBy: string;
  createdAt: number;
};

export const NOTE_CATEGORIES = ['laning', 'vision', 'teamfight', 'macro', 'draft', 'mechanics', 'comms', 'other'] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export type VodNote = {
  id: string;
  vodId: string;
  /** Seconds from the start of the video. */
  t: number;
  text: string;
  category: NoteCategory;
  /** Roster display names the note is about. */
  players: string[];
  author: string;
  createdAt: number;
};

export type PoolTier = 'ready' | 'practice' | 'no';
/** player name → champion → tier */
export type PoolMatrix = Record<string, Record<string, PoolTier>>;

export type DraftPlanSide = {
  bans: string[];
  priorityPicks: string[];
  notes: string;
};
export type DraftPlan = {
  opponent: string;
  blue: DraftPlanSide;
  red: DraftPlanSide;
  branches: { id: string; when: string; then: string }[];
  updatedBy: string;
  updatedAt: number;
};

/**
 * A snapshot of the draft room's board, kept so a coach can put a board aside
 * and come back to it. Distinct from `DraftPlan`, which is what we *intend* to
 * do against an opponent; this is a board that actually existed.
 *
 * Capped at MAX_SAVED_DRAFTS: the point is a small shelf you can scan, not an
 * archive, and a capped hash never grows past what one read can return.
 */
export type SavedDraft = {
  id: string;
  /** Free text; defaults to the matchup and time when left blank. */
  name: string;
  note: string;
  savedAt: number;
  savedBy: string;
  picks: { blue: string[]; red: string[] };
  bans: { blue: string[]; red: string[] };
  teamNames: { blue: string; red: string };
  opponent: string | null;
};

export const MAX_SAVED_DRAFTS = 10;

export type EventType = 'scrim' | 'official' | 'review' | 'other';
export type CalendarEvent = {
  id: string;
  type: EventType;
  title: string;
  opponent?: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM, team-local
  durationMin: number;
  notes: string;
  createdBy: string;
};

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "mm:ss" or "h:mm:ss" for a second offset. */
export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Parses "5:30", "1:05:30" or "330" into seconds; null if unreadable. */
export function parseTime(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some(n => isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Leaguepedia's ScoreboardPlayers.Role is free text ("Bot", "Mid", …) with
 * varying spellings, so roles are normalised rather than matched exactly —
 * an unmatched spelling would silently leave a lane empty.
 */
export function toRole(raw: string): Role | null {
  const r = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (r.startsWith('top')) return 'top';
  if (r.startsWith('jung')) return 'jungle';
  if (r === 'mid' || r.startsWith('middle')) return 'mid';
  if (r === 'bot' || r.startsWith('bottom') || r === 'adc' || r.startsWith('adcarry') || r === 'carry') return 'adc';
  if (r.startsWith('sup')) return 'support';
  return null;
}
