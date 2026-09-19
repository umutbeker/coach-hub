# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server (Turbopack) on :3000
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint (flat config, eslint-config-next)
```

There is no test suite — no test runner is configured and no test files exist.

Env vars live in `.env.local`, pulled from Vercel rather than hand-written:

```bash
npx vercel login              # interactive, browser-based
npx vercel env pull .env.local
```

The project is already linked to the Vercel project `s2g-hub` via `.vercel/project.json`, so `vercel link` is not needed. If Redis-backed endpoints return `{"error":"fetch failed"}`, the Upstash credentials in `.env.local` are stale — re-pull before debugging the code.

Required env: `KV_REST_API_URL` / `KV_REST_API_TOKEN` (read by `Redis.fromEnv()`), `RIOT_API_KEY`, `PANDASCORE_API_KEY`, `GEMINI_API_KEY`, `PUSHER_APP_ID`/`PUSHER_KEY`/`PUSHER_SECRET`/`PUSHER_CLUSTER` plus their `NEXT_PUBLIC_PUSHER_*` counterparts, and `CRON_SECRET`.

## What this is

"Pyramid4 HUB" — a player and coach dashboard for the Pyramid IV Esports League of Legends team. Next.js 16 App Router, React 19, TypeScript, Tailwind 4. Four screens behind a login: coach panel, player panel, match history, and a live draft room.

## Architecture

### Redis is the only datastore

There is no database and no ORM. Every API route opens `Redis.fromEnv()` (Upstash REST) and reads/writes JSON strings under a flat key namespace:

| Key | Written by | Read by |
| --- | --- | --- |
| `player:<Name>` | `/api/sync` | `/api/data` (POST) |
| `lp:<Name>` | `/api/sync` | `/api/data?type=lp` |
| `matches:lp` | `/api/sync?player=matches` | `/api/data?type=matches` |
| `scout:next` | `/api/sync?player=matches` | `/api/data?type=scout` |
| `draft:current` | `/api/draft` | `/api/draft`, draft page |
| `draft:meta` | `/api/draft-meta` (12h TTL) | `/api/draft-ai` |
| `fixture:cache` | `/api/fixture` (30m TTL) | `/api/fixture` |
| `sync:updatedAt` | `/api/sync` | `/api/data` |

`data/players.json` is a stale snapshot of `player:*` values, not a live source — nothing imports it.

### Write path is a cron, read path is instant

`/api/sync` is the only thing that talks to Riot and fetches heavily; it is slow (rate-limited, ~120ms between Riot calls) and never called from the UI. `vercel.json` runs `/api/sync-all` daily at 06:00 UTC, which loops the five players sequentially by calling `/api/sync?player=<Name>` over HTTP against `VERCEL_URL`. All UI reads go to `/api/data`, which only does Redis gets. When adding a stat, compute and store it in `/api/sync`; do not add Riot calls to a read path.

### Team identity and roster are single-source

[lib/team.ts](lib/team.ts) holds the team's names and [lib/users.ts](lib/users.ts) holds the roster; everything else derives from them. Nothing should hardcode a team name or a player list again — the two were previously duplicated across ~15 call sites, which is how a rename silently emptied every Leaguepedia query.

The three name constants are not interchangeable:

- `TEAM_NAME` — display only (`Pyramid4`).
- `TEAM_LP_NAME` — the exact `Team` value on Leaguepedia (`Pyramid IV Esports`), interpolated verbatim into cargoquery where-clauses. A mismatch returns zero rows rather than an error, so a wrong value looks like "no data" instead of a bug.
- `TEAM_PANDASCORE_NAME` / `TEAM_ACRONYM` — lowercase substring and exact-match acronym used to spot our own side in PandaScore fixtures.

`USERS[].name` is likewise load-bearing in two directions: it is the Redis key (`player:<name>`) *and* the `Name` value in Leaguepedia queries, so it must match the wiki's spelling exactly. `USERS[].riotId` drives the Riot sync; entries without one (coaches) are skipped.

### External data sources

- **Riot API** (`europe`/`euw1` regions) — soloq rank, last 20 ranked matches, timelines for the first 5 (used for gold/CS diff at 15 against the lane opponent). Wrapped in `rFetch`, which sleeps 120ms before every call and retries on 429 honoring `Retry-After`.
- **Leaguepedia** (`lol.fandom.com/api.php`, `action=cargoquery`) — all pro/competitive data: scoreboards, picks and bans. Queried with `origin=*`, so both API routes *and* client components call it directly. Team names differ between providers; `TEAM_NAME_MAP` in `/api/sync` patches known opponent mismatches. **Its rate limit is strict, per-IP, and slow to clear** — a handful of consecutive queries from one machine locks it out for many minutes, returning `{"error":{"code":"ratelimited"}}`. The architecture exists to avoid this: queries run from the browser (spreading load across users) and results are cached in Redis by the daily cron and in localStorage per client, so any given query runs about once a day. Do not loop over this API from a script or shell.
- **PandaScore** — upcoming fixtures and pro player stats.
- **Gemini** (`/api/draft-ai`) — the draft coach. Its Turkish system prompt encodes the team's actual drafting doctrine (pick count and presence outrank win rate); treat it as product logic, not boilerplate. Note `@anthropic-ai/sdk` is a dependency but is unused.

### Live draft room

[app/draft/page.tsx](app/draft/page.tsx) is a shared, multi-user board. Clients never mutate state locally as the source of truth: every change POSTs an action to `/api/draft` (`SET_PICK`, `SET_BAN`, `SET_NOTE`, `SET_TEAM_NAME`, `SET_AI_RESULT`, `SET_SOLOQ`, `SET_STRATEGY`, `RESET`), which applies it to `draft:current` in Redis and then broadcasts the whole new draft over Pusher on `draft-channel` / `draft-updated`. Every client, including the sender, re-renders from that broadcast. New draft state must go through a new action case, or it will not propagate.

### Auth

Client-side only and not a security boundary. [app/page.tsx](app/page.tsx) matches credentials against the plaintext `USERS` array in [lib/users.ts](lib/users.ts) and stores the matched user in `localStorage.currentUser`; each page re-reads it in an effect and `router.push`es away on mismatch. `lib/users.ts` is imported by a client component, so it ships to the browser — the credentials are public to anyone with the URL. API routes have no auth at all. Coaches viewing a player use `sessionStorage.viewingPlayer` to impersonate on `/player`.

### Client caching

Pages cache aggressively in `localStorage` under `<key>` plus a `<key>_time` timestamp, via the local `isFresh`/`saveCache`/`loadCache` helpers repeated in each page. The usual order is: localStorage → `/api/data` (Redis) → direct Leaguepedia query as a last resort. When data looks stale during development, clear localStorage before suspecting Redis.

### Styling

Tailwind 4 utilities for layout, but the four main pages also define terse two-or-three-letter class names (`HB`, `BT`, `MDB`, `FDB`) in an inline `<style>` block inside their JSX. `app/globals.css` is nearly empty and holds only the Tailwind import and the font/theme variables. UI copy is Turkish.
