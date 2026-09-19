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

## Design

The UI follows the mockups in [design/mockups/](design/mockups/) (literal HTML/CSS, see [design/README.md](design/README.md)). When changing a redesigned page, match them rather than inventing new styling. The draft room (`app/draft/*`) was deliberately left out of the redesign and must look identical after any global change.

## What this is

"Pyramid4 HUB" — a player and coach dashboard for the Pyramid IV Esports League of Legends team. Next.js 16 App Router, React 19, TypeScript, Tailwind 4. Behind a login: coach panel, player panel, match history, the live draft room, and the coaching tools (scrims, VOD review, feedback, match prep, calendar). Plus one public page. The team cares about pro and scrim play far more than solo queue — new features should serve coaching and competitive analysis.

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
| `vods:v2:lec` / `vods:v2:lck` | `/api/pro-vods` (12h TTL) | `/api/pro-vods`, `/pro` |
| `sync:updatedAt` | `/api/sync` | `/api/data` |
| `scrims:v1` (hash) | `/api/scrims` | `/api/scrims` |
| `vods-lib:v1` (hash) | `/api/vods` | `/api/vods` |
| `vodnotes:v1:<vodId>` (hash) | `/api/notes` | `/api/notes` |
| `pool:v1` (hash, field = player) | `/api/pool` | `/api/pool` |
| `prep:v1` / `oppreport:v1` (hash, field = opponent slug) | `/api/prep` | `/api/prep` |
| `calendar:v1` (hash) | `/api/calendar` | `/api/calendar` |

The coaching-tool collections are Redis **hashes**, one field per record, accessed through [lib/store.ts](lib/store.ts); their types are in [lib/hub.ts](lib/hub.ts). A collection is one `hgetall`, a write touches one field. Don't fold a collection into a single JSON value — a season of scrims would outgrow Upstash's per-value limit. These keys hold hand-entered team data with no other copy, unlike the synced keys above, which can be rebuilt.

`/api/sync` reports `{"success":false,"error":"No matches found"}` whenever `cargoquery` is absent from the Leaguepedia response — which includes a rate-limited response, not just a genuinely empty result. Treat that message as "no usable reply", and retry before concluding the query is wrong.

`data/players.json` is a stale snapshot of `player:*` values, not a live source — nothing imports it.

### Write path is a cron, read path is instant

`/api/sync` is the only thing that talks to Riot and fetches heavily; it is slow (rate-limited, ~120ms between Riot calls) and never called from the UI. `vercel.json` runs `/api/sync-all` daily at 06:00 UTC, which loops the five players sequentially by calling `/api/sync?player=<Name>` over HTTP against `VERCEL_URL`. All UI reads go to `/api/data`, which only does Redis gets. When adding a stat, compute and store it in `/api/sync`; do not add Riot calls to a read path.

### Team identity and roster are single-source

[lib/team.ts](lib/team.ts) holds the team's names and [lib/users.ts](lib/users.ts) holds the roster; everything else derives from them. Nothing should hardcode a team name or a player list again — the two were previously duplicated across ~15 call sites, which is how a rename silently emptied every Leaguepedia query.

The three name constants are not interchangeable:

- `TEAM_NAME` — display only (`Pyramid4`).
- `TEAM_LP_NAME` — the exact `Team` value on Leaguepedia (`Pyramid IV Esports`), interpolated verbatim into cargoquery where-clauses. A mismatch returns zero rows rather than an error, so a wrong value looks like "no data" instead of a bug.
- `TEAM_PANDASCORE_NAME` / `TEAM_ACRONYM` — lowercase substring and exact-match acronym used to spot our own side in PandaScore fixtures.

Each roster entry carries three identities that genuinely differ and must not be collapsed back into one:

- `name` — display, and the Redis key (`player:<name>`, `lp:<name>`).
- `lpName` — the `Name` value on Leaguepedia. It diverges from `name` in practice (`Akashii` has a doubled i, `moe` is lowercase), and a wrong value returns zero rows rather than an error.
- `riotId` — drives the Riot sync. Entries without one (coaches) are skipped everywhere a player list is derived.

### Shared modules

Three things were duplicated across call sites and are now single-source; adding a sixth copy of any of them is the mistake to avoid.

- [lib/team.ts](lib/team.ts) and [lib/users.ts](lib/users.ts) — team identity and roster, described above.
- [lib/leaguepedia.ts](lib/leaguepedia.ts) — `lpQuery` (rate-limit-aware, deadline-bounded) and `seasonCandidates`. Its return type distinguishes `null` (could not fetch) from `[]` (genuinely empty); conflating those is what made several failures look like missing data.
- [lib/champions.ts](lib/champions.ts) — `champImg`/`champSplash` and `DDRAGON_VERSION`. Leaguepedia writes champion names for humans (`Kai'Sa`, `Nunu & Willump`) while Data Dragon wants filenames (`Kaisa`, `Nunu`); the map covers the names that do not reduce mechanically. Data Dragon is cumulative, so keeping the version current is safe and a stale one 403s on new champions.

### External data sources

- **Riot API** (`europe`/`euw1` regions) — soloq rank, last 20 ranked matches, timelines for the first 5 (used for gold/CS diff at 15 against the lane opponent). Wrapped in `rFetch`, which sleeps 120ms before every call and retries on 429 honoring `Retry-After`.
- **Leaguepedia** (`lol.fandom.com/api.php`, `action=cargoquery`) — all pro/competitive data: scoreboards, picks and bans. Queried with `origin=*`, so both API routes *and* client components call it directly. Team names differ between providers; `TEAM_NAME_MAP` in `/api/sync` patches known opponent mismatches. **Its rate limit is strict, per-IP, and slow to clear** — a handful of consecutive queries from one machine locks it out for many minutes, returning `{"error":{"code":"ratelimited"}}`. The architecture exists to avoid this: queries run from the browser (spreading load across users) and results are cached in Redis by the daily cron and in localStorage per client, so any given query runs about once a day. Do not loop over this API from a script or shell.
- **PandaScore** — upcoming fixtures and pro player stats.
- **Gemini** (`/api/draft-ai`) — the draft coach. Its Turkish system prompt encodes the team's actual drafting doctrine (pick count and presence outrank win rate); treat it as product logic, not boilerplate. Note `@anthropic-ai/sdk` is a dependency but is unused.

### Live draft room

[app/draft/page.tsx](app/draft/page.tsx) is a shared, multi-user board. Clients never mutate state locally as the source of truth: every change POSTs an action to `/api/draft` (`SET_PICK`, `SET_BAN`, `SET_NOTE`, `SET_TEAM_NAME`, `SET_AI_RESULT`, `SET_SOLOQ`, `SET_STRATEGY`, `RESET`), which applies it to `draft:current` in Redis and then broadcasts the whole new draft over Pusher on `draft-channel` / `draft-updated`. Every client, including the sender, re-renders from that broadcast. New draft state must go through a new action case, or it will not propagate.

### The public page

`/pro` lists recent LEC and LCK **series** — a BO3/BO5 is one collapsed row that expands into its games — each with its draft and a video of it, and is the one route with **no login check** — it deliberately omits the `currentUser` guard every other page runs. That makes its data path different in kind: anonymous traffic cannot be allowed to reach Leaguepedia, whose rate limit is per-IP, so the page only ever reads `vods:*` from Redis and the daily cron is what fills it.

The video and the draft are not separate sources. Three Leaguepedia tables join on `GameId`: `MatchScheduleGame` (the VOD fields), `PicksAndBansS7` (picks and bans) and `ScoreboardGames` (teams, winner, date). Of the VOD fields, `Vod` is empty for both leagues in practice while `VodPB` is consistently filled and carries a `?t=` offset pointing at the draft, so `VodPB` is the primary video and `Vod` only a fallback. `VodHighlights` exists for LEC and not LCK.

Series are not inferred from dates or team names: `MatchScheduleGame.MatchId` is already shared by every game of a series. Sides swap between games of a series, so the series score counts wins by team name — counting by blue/red would be wrong. `gamesPlayed` is how many games were played, not the format: a BO5 ending 3-1 has four.

The Redis keys carry a `v2` segment because the response shape changed from a flat game list to series; bump it again rather than letting a differently-shaped cached payload reach the page.

### Coaching tools

- **Scrims are never mixed with official games.** Official data is Leaguepedia-only; scrims live in `scrims:v1`. `/matches` shows official only. Anything that combines them must say so with a source label.
- **Scrims are entered by hand** at `/scrims/new`. Riot's public API does not return the custom games scrims are played in (checked: `queue=0` returns `[]`). Picks are entered by role, and the role decides which roster player gets credited — that is how the champion pool matrix attributes scrim games.
- **VODs are links, not uploads.** Unlisted YouTube or a direct video URL. Uploading would need a storage bucket (Vercel caps function request bodies). [app/components/VideoPlayer.tsx](app/components/VideoPlayer.tsx) drives YouTube through the IFrame API, because a plain embed can't be seeked from outside; that is what lets a note jump the video to its timestamp. Other hosts get a link-out.
- **Notes** carry a timestamp, a category and tagged players. `/feedback` reads them per player across every VOD.
- **Match prep** (`/prep`) builds the opponent report in the browser from Leaguepedia and saves it through `/api/prep`, so the team reads one saved copy instead of each viewer spending the per-IP limit. `/api/opponent-ai` turns the computed numbers (not raw rows) into a Gemini brief.
- **Calendar** stores scrims, reviews and other events; official matches are merged in from `/api/fixture` at read time, never stored twice.
- **The next opponent** is set in Prep ("Set as next opponent"), stored on the shared draft state via the `SET_OPPONENT` action, and read by the draft room's scout panel. There is no other place to set it.
- **The coach panel is the hub's front page:** an Overview of summary cards (`HubCard`), one per section, each linking to its page, all fed by one Redis-only read (`/api/overview`) plus the cached fixture. When adding a section, give it a card there. The old Schedule & scouting tab is gone — Calendar and Prep replaced it.
- **The player home leads with coaching, not solo queue:** feedback about them (each note opens the VOD at its timestamp), up next, their lane opponent from the saved Prep report, and the pool the coach rated for them plus their scrims. Solo queue collapses behind "Solo queue details"; Pro stage stays open. Coaches see the same page when they open a player.
- **Lane matchups** (Prep report and player home) join the opponent's Leaguepedia players to our roster by role. Leaguepedia's role is free text, so it goes through `toRole()` in [lib/hub.ts](lib/hub.ts) — never compare role strings directly.

### Navigation

Seven entries: Home, Calendar, Games, Review, Prep, Draft, Pro. Games covers `/scrims` + `/matches`, Review covers `/review` + `/feedback`, switched with `SectionTabs`; URLs were kept so links from notes and the calendar still resolve. Review and Games show a count of what is new since the viewer last opened them — the timestamps live in the viewer's localStorage and `/api/badges` only counts. Below 700px the links become a bottom tab bar.

### Auth

Client-side only and not a security boundary. [app/page.tsx](app/page.tsx) matches credentials against the plaintext `USERS` array in [lib/users.ts](lib/users.ts) and stores the matched user in `localStorage.currentUser`; each page re-reads it in an effect and `router.push`es away on mismatch. `lib/users.ts` is imported by a client component, so it ships to the browser — the credentials are public to anyone with the URL. API routes have no auth at all. Coaches viewing a player use `sessionStorage.viewingPlayer` to impersonate on `/player`.

### Client caching

Pages cache aggressively in `localStorage` under `<key>` plus a `<key>_time` timestamp, via the local `isFresh`/`saveCache`/`loadCache` helpers repeated in each page. The usual order is: localStorage → `/api/data` (Redis) → direct Leaguepedia query as a last resort. When data looks stale during development, clear localStorage before suspecting Redis.

### Styling

There are two styling systems and they must not mix.

- **Redesigned pages** (every page except `/draft`) put `className="hub"` on their root. Tokens (`--bg`, `--surface`, `--accent`, `--win`, `--loss`, …) are on `:root` in [app/globals.css](app/globals.css); every component class there (`.card`, `.btn`, `.tag`, `.tab`, `.champ`, …) is scoped as `.hub .x`. Shared pieces live in [app/components/](app/components/): `Nav` (+ `SectionTabs`), `HubCard`, `Icon` (inline stroke SVG — no emoji), `useUser` (the signed-in user via `useSyncExternalStore`: no hydration mismatch, no setState-in-effect), `ChampionPicker`/`Slot`, `VideoPlayer`, `PoolMatrix`. New pages should use `useUser` rather than reading localStorage in an effect. Fonts come from `next/font` in [app/layout.tsx](app/layout.tsx): Barlow Semi Condensed (`.h`), IBM Plex Sans (body, 15px base, nothing under 12px), IBM Plex Mono (`.mono`, stats). UI copy is English. Spacing is deliberately compact (page titles 24px, section headings 20px, page padding 20/28px) — the user asked for density over the mockups' roominess, so don't reintroduce the mockups' larger spacing.
- **The draft room** keeps its own inline `<style>` block, its own `@import` of `Barlow`/`Barlow Condensed` from Google Fonts, and short class names (`.btn`, `.logo`, `.main`, `.center`). That is why the redesign's classes are scoped under `.hub`: an unscoped `.btn` in globals would leak into it. It is also why `layout.tsx` must never load a family named `Barlow` or `Barlow Condensed`. Its own `body{}` rule comes after globals in the document and wins.

`/api/sync` stores match records locale-free (`result: 'W'|'L'`, `durationMin`, `playedAt` ISO); pages format them. Older records stored pre-rendered Turkish (`'Galibiyet'`, `'31dk'`), which is why `isWin()` in the pages still accepts `'Galibiyet'` — harmless once every client cache has turned over.
