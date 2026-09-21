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

Optional env: `LEAGUEPEDIA_USER` / `LEAGUEPEDIA_BOT_PASSWORD` — a Leaguepedia account and bot password, which lifts the per-IP rate limit on Leaguepedia queries.

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
| `fixture:cache` | `/api/fixture` (30m TTL) | `/api/fixture` |
| `vods:v2:lec` / `vods:v2:lck` | `/api/pro-vods` (12h TTL) | `/api/pro-vods`, `/pro` |
| `sync:updatedAt` | `/api/sync` | `/api/data` |
| `scrims:v1` (hash) | `/api/scrims` | `/api/scrims` |
| `vods-lib:v1` (hash) | `/api/vods` | `/api/vods` |
| `vodnotes:v1:<vodId>` (hash) | `/api/notes` | `/api/notes` |
| `pool:v1` (hash, field = player) | `/api/pool` | `/api/pool` |
| `prep:v1` / `oppreport:v1` (hash, field = opponent slug) | `/api/prep` | `/api/prep` |
| `calendar:v1` (hash) | `/api/calendar` | `/api/calendar` |
| `drafts:saved:v1` (hash, max 10) | `/api/draft-saves` | `/api/draft-saves`, draft page |
| `tour:v1:<league>` | `/api/tournaments` (no TTL, carries `updatedAt`) | `/api/tournaments`, `/tournaments`, `/coach` |

The coaching-tool collections are Redis **hashes**, one field per record, accessed through [lib/store.ts](lib/store.ts); their types are in [lib/hub.ts](lib/hub.ts). A collection is one `hgetall`, a write touches one field. Don't fold a collection into a single JSON value — a season of scrims would outgrow Upstash's per-value limit. These keys hold hand-entered team data with no other copy, unlike the synced keys above, which can be rebuilt.

`/api/sync` reports `{"success":false,"error":"No matches found"}` whenever `cargoquery` is absent from the Leaguepedia response — which includes a rate-limited response, not just a genuinely empty result. Treat that message as "no usable reply", and retry before concluding the query is wrong.

`data/players.json` is a stale snapshot of `player:*` values, not a live source — nothing imports it.

### Write path is a cron, read path is instant

Two exceptions to the rule below, both deliberate: `/api/tournaments` and `/api/fixture` refresh themselves from a read, because a schedule changes when an organiser says so, not on a daily boundary. See **Tournaments**.

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
- **Leaguepedia** (`lol.fandom.com/api.php`, `action=cargoquery`) — all pro/competitive data: scoreboards, picks and bans. **Every Leaguepedia query now runs on the server** ([lib/leaguepedia.ts](lib/leaguepedia.ts)), signed in, and results are shared through Redis; no page queries it from the browser. Keep it that way — a browser query spends the viewer's own IP limit, and the draft room, the heaviest user, was the worst place for that. Team names differ between providers; `TEAM_NAME_MAP` in `/api/sync` patches known opponent mismatches. **Its rate limit is strict, per-IP, and slow to clear** — measured, not guessed: a handful of anonymous queries locks an IP out for minutes, and it applies to a Vercel region the same as a home connection. Setting `LEAGUEPEDIA_USER` and `LEAGUEPEDIA_BOT_PASSWORD` (Special:BotPasswords) makes [lib/leaguepedia.ts](lib/leaguepedia.ts) log in and count against the wider logged-in bucket instead of the IP one; without them it stays anonymous. Ticking the bot password's "High API limits" grant does **nothing** on its own — a grant only permits rights the account already holds, and `meta=userinfo` confirms this account has groups `*, user, emailconfirmed` and neither `noratelimit` nor `apihighlimits` (those belong to the `bot` group, which a Leaguepedia admin would have to add). So signing in widens the limit; it does not remove it, and caching is still what keeps us under it. The User-Agent makes no difference (tested), and `origin=*` is worse than useless once signed in: it makes MediaWiki treat the request as an anonymous CORS call and ignore the session, which is why the login looked like it had no effect at first. Even signed in the limit is real — typing-rate queries still get refused — so results are cached in Redis and any given query runs about once a day. Do not loop over this API from a script or shell.

  `/api/teams` is the one search driven by typing (the opponent box on `/prep`). It never queries per keystroke: it fetches every team whose name or tag starts with the **first two letters**, caches that slice in `teams:v2` for a week, and filters longer searches from it in memory — so "gen.g" costs the same one query as "ge". Keep that shape if you add another as-you-type search.
- **PandaScore** — upcoming fixtures, pro player stats, and the whole Tournaments section. Two quirks worth knowing: the standings endpoint is `/tournaments/<id>/standings` with **no `lol/` prefix** (the prefixed path 404s), and a successful call answers with an array while an error answers with an object — `/api/tournaments` checks `Array.isArray` rather than the status alone. Bracket stages return standings with every row 0–0; those are dropped rather than drawn as an empty table.
- **Gemini** (`/api/opponent-ai`) — writes the Prep brief from the computed opponent numbers. The draft room's Gemini assistant was removed in favour of saved drafts with notes, so `/api/draft-ai` and `/api/draft-meta` are gone. Note `@anthropic-ai/sdk` is a dependency but is unused.

### Live draft room

[app/draft/page.tsx](app/draft/page.tsx) is a shared, multi-user board. Clients never mutate state locally as the source of truth: every change POSTs an action to `/api/draft` (`SET_PICK`, `SET_BAN`, `SET_NOTE`, `SET_TEAM_NAME`, `SET_SOLOQ`, `SET_STRATEGY`, `SET_OPPONENT`, `LOAD_SAVED`, `RESET`), which applies it to `draft:current` in Redis and then broadcasts the whole new draft over Pusher on `draft-channel` / `draft-updated`. Every client, including the sender, re-renders from that broadcast. New draft state must go through a new action case, or it will not propagate.

The centre panel has three tabs: opponent scout, strategy map, and **saved drafts**.

**Saved boards are a capped shelf, not an archive.** Up to `MAX_SAVED_DRAFTS` (10) snapshots live in the Redis hash `drafts:saved:v1`, one field per save, written through `/api/draft-saves`. They are deliberately *not* folded into `draft:current`: that key is re-read and rewritten on every single pick, and carrying ten snapshots in it would rewrite all of them on every click. Each save carries its own **note** — the tab replaced the Gemini draft assistant, which is gone along with `/api/draft-ai`, `/api/draft-meta` and the `draft:meta` cache the daily cron used to warm.

Writes to the shelf broadcast on the same `draft-channel` under their own `saves-updated` event, so a save by one coach appears on every open board — the same guarantee the live board has. Loading a save goes through the `LOAD_SAVED` action rather than setting local state, so the whole room switches to it, not just the tab that clicked. A full shelf answers **409 with the current list** rather than evicting the oldest: silently dropping a board someone saved is worse than being told to delete one. The per-save note textarea is uncontrolled (`defaultValue` + `onBlur`) so an incoming Pusher update cannot overwrite what someone is mid-sentence on.

### Tournaments

`/tournaments` is the schedule of the competitions we play in: the whole league's fixtures, not only ours, with the broadcast links and the standings beside them.

Which competitions is single-source in [lib/tournaments.ts](lib/tournaments.ts) — a PandaScore **league id** each, because ids are stable while names and splits are not. The *serie* (Summer 2026, Winter 2027 …) is deliberately not listed: `/api/tournaments` picks the current one from the matches themselves, so a new split needs no code change. Today that is Arabian League (4962, ours) and EMEA Masters (4996).

**Unannounced matches are drawn, not hidden.** PandaScore publishes a playoff bracket as dated `TBD vs TBD` rows with the stream already attached, weeks before the names are known. That is the shape of the week and the page renders it as dashed TBA slots that fill in by themselves; a league with nothing published at all still gets a placeholder skeleton so the page reads the same either way.

**It is near-live without a per-minute cron.** `/api/tournaments` serves Redis and refreshes itself only when the copy it is about to return has aged out. The window is set by `ttlMs()` in [lib/tournaments.ts](lib/tournaments.ts) and tightens as a match approaches — 45s while one is being played, 60s inside the half hour before kickoff, 5 min for later today, 30 min otherwise — so scores move in near real time while a quiet week costs two PandaScore calls an hour no matter how many tabs are open. Three things make that work and should stay:

- The cached value carries `updatedAt` instead of using a Redis TTL, because an expired key cannot be served. When PandaScore fails, the older copy goes out with `stale: true` — the same choice the opponent report makes.
- A short `tour:lock:<league>` key means one refresh at a time; tabs that miss the lock serve the old copy for a moment rather than all calling PandaScore in the same second.
- The refresh broadcasts on Pusher `tournaments-channel` / `tournaments-updated`, so a score one viewer's poll pulled in lands on every other open page at once instead of up to a poll interval later. The page also polls, but only while its tab is visible.

Our own team is spotted with `isOurTeam()`, the same name-substring / acronym test `/api/fixture` uses.

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
- **One report, many readers.** `getOrBuildReport()` in [lib/report.ts](lib/report.ts) is the single path to opponent data: it returns the saved report, rebuilding from Leaguepedia only when it is missing, older than three days, refreshed, or **missing the `draft` field** (a report saved before the draft analysis existed can never grow one by waiting — the same reason `/pro` bumps its cache key). `/api/opponent-report` (Prep), `/api/scout` (the draft room's panel, mapped to the shape it renders) and the daily cron all go through it, so an opponent is fetched once. Team-name aliases (`BIG` → `Berlin International Gaming`) live in `buildReport`.
- **The opponent report is draft-first, and scoped to one patch.** `analyseDraft()` is the part a coach reads with the draft screen open, and it runs on the newest patch alone — a pick priority from three patches ago is not their priority. Below `MIN_DRAFT_GAMES` it folds in the previous patch and sets `widened`, so a thin sample is labelled rather than silently averaged. It answers the four questions actually asked before a draft: what they take in each **pick slot** (`B1`, `B2-3`, `B4-5`, `R1-2`, `R3`, `R4-5` — "their 2nd pick" means different things on each side, and each slot carries its **role** split), what they **ban** in the blind first rotation versus the reactive second, what gets **banned against them**, and what they **never let through** — `picked / open`, where `open` counts the games nobody banned it. That denominator is the whole point: 4-of-4 and 4-of-20 are opposite reads, and a raw pick count cannot tell them apart.

  **A report that lists only comfort picks is half a report.** What a team keeps *losing* on is as actionable as what they are good at, and it is the same tally read from the other end — so the board carries both: `record` (their W–L on every champion picked twice or more) splits into "they win with" / "they lose with", `comps` keeps whole winning and losing drafts side by side rather than five separate picks, and each player card lists what they **struggle on** under their most-played. Those can be the same champion — a jungler whose most-played is also his worst record is exactly the read a top-5-by-games list hides.

  It is laid out **the way a draft is**: their blue-side behaviour in the left column, red on the right, the bans between them, so the eye lands where it already looks during a draft. Rows, not cards — a card per pick slot is what made the first version unreadable at a glance. Below 1180px the three columns stack. A side with fewer than five games this patch says so in the column rather than letting four games read as a tendency.

  Two Leaguepedia facts this rests on, both **verified against live rows, not assumed**: `PicksAndBansS7.Team1PickN` is that team's Nth pick in *draft* order (not by role), and `Team1RoleN` describes `Team1PickN`. Picks and roles are zipped by `picksWithRoles()` before either is filtered — dropping blanks from the two columns separately would label pick 3 with pick 4's role.

- **Match Leaguepedia team names case-insensitively, then use their spelling.** Cargo's `WHERE` is case-insensitive and JavaScript's `===` is not, so a search for `skillcamp` returned 20 rows of `Skillcamp` and then matched our side in none of them. Every game fell through to the red-side branch: the opponent came out as the team itself, the result was read off the wrong side, and `theirPicks` held the *other* team's draft — a whole report of confidently wrong numbers with nothing that looked like an error. `buildReport` now resolves a `canon` name from the returned rows and compares against that; `Report.opponent` carries Leaguepedia's spelling rather than whatever was typed. `slug()` lowercases, so the Redis key is unaffected. A saved report where any game's `vs` equals its own `opponent` is the signature of this bug and is rebuilt rather than served — it is wrong, not stale.

- **A game row shows both drafts and both VOD cuts.** The opponent's own picks and bans are half the story; what the other side took is what their draft was answering, so each game lists both teams. `MatchScheduleGame` carries several VOD fields and which are filled varies by league — measured on Rift Legends: `VodPB` and `VodGameStart` are 20/20, while `Vod`, `VodPostgame`, `VodHighlights` and `MatchHistory` are 0/20. Both filled fields point at the *same* broadcast with different `?t=` offsets, so one is the draft and the other the game; both are offered.

  `parseVod()` read the video id from `?v=` only, which is null for the `/live/<id>?t=…` form Leaguepedia actually uses, so it returned no embed and **the draft VOD button silently never appeared**. It now shares `youtubeId()`, which already handled `/live/`, `/embed/` and `/shorts/`. `/pro` parses the same fields, so it gained the fix too.

- **Prep lists series, not games.** `groupSeries()` collapses the opponent's games by `ScoreboardGames.MatchId`, which every game of a series already shares — the same join `/pro` uses, and the reason neither infers a series from dates or team names. Within a series, games are ordered by `N_GameInMatch`: several games of one series can carry the same timestamp, so sorting by time is not reliable. The score counts wins **by team**, because sides swap between games. Series are built from the whole fetched window and only then trimmed — slicing games first would cut a BO5 in half and show it as a 2-1. The draft room's scout panel still reads the flat `recent` list, so both shapes ship.

  Widening the fields on an existing cargoquery costs **nothing** against the rate limit; only extra *queries* do. The report still runs the same two queries it always did, and takes ~120 columns instead of ~40. Reach for more fields before reaching for another query.
- **Our own team's Leaguepedia data** is written by the cron; `/api/lp?type=matches|player` is the on-demand path the pages use when Redis is empty. It refreshes Redis too.
- **Match prep** (`/prep`) reads the opponent report from `/api/opponent-report`, which builds it **on the server** ([lib/report.ts](lib/report.ts)) and saves it in Redis. It used to be built in the browser, which spent the viewer's own per-IP Leaguepedia limit and locked them out of the feature. A saved report under three days old is served as is; a rate-limited rebuild returns the stale one with a flag rather than an error. The daily cron pre-builds it for whoever is set as next opponent. `/api/opponent-ai` turns the computed numbers (not raw rows) into a Gemini brief.
- **Calendar** stores scrims, reviews and other events; official matches are merged in from `/api/fixture` at read time, never stored twice.
- **The next opponent** is set in Prep ("Set as next opponent"), stored on the shared draft state via the `SET_OPPONENT` action, and read by the draft room's scout panel. There is no other place to set it.
- **The coach panel is the hub's front page:** an Overview of summary cards (`HubCard`), one per section, each linking to its page, all fed by one Redis-only read (`/api/overview`) plus the cached fixture. When adding a section, give it a card there. The old Schedule & scouting tab is gone — Calendar and Prep replaced it.
- **The player home leads with coaching, not solo queue:** feedback about them (each note opens the VOD at its timestamp), up next, their lane opponent from the saved Prep report, and the pool the coach rated for them plus their scrims. Solo queue collapses behind "Solo queue details"; Pro stage stays open. Coaches see the same page when they open a player.
- **Lane matchups** (player home) join the opponent's Leaguepedia players to our roster by role. Prep used to show the same table and no longer does — it read as filler next to the draft board, which answers the pre-draft question directly. Leaguepedia's role is free text, so it goes through `toRole()` in [lib/hub.ts](lib/hub.ts) — never compare role strings directly.

### Navigation

Eight entries: Home, Calendar, Games, Review, Prep, Draft, Tournaments, Pro. Games covers `/scrims` + `/matches`, Review covers `/review` + `/feedback`, switched with `SectionTabs`; URLs were kept so links from notes and the calendar still resolve. Review and Games show a count of what is new since the viewer last opened them — the timestamps live in the viewer's localStorage and `/api/badges` only counts. Below 700px the links become a bottom tab bar.

### Auth

Client-side only and not a security boundary. [app/page.tsx](app/page.tsx) matches credentials against the plaintext `USERS` array in [lib/users.ts](lib/users.ts) and stores the matched user in `localStorage.currentUser`; each page re-reads it in an effect and `router.push`es away on mismatch. `lib/users.ts` is imported by a client component, so it ships to the browser — the credentials are public to anyone with the URL. API routes have no auth at all. Coaches viewing a player use `sessionStorage.viewingPlayer` to impersonate on `/player`.

### Client caching

Pages cache aggressively in `localStorage` under `<key>` plus a `<key>_time` timestamp, via the local `isFresh`/`saveCache`/`loadCache` helpers repeated in each page. The usual order is: localStorage → `/api/data` (Redis) → direct Leaguepedia query as a last resort. When data looks stale during development, clear localStorage before suspecting Redis.

### Styling

There are two styling systems and they must not mix.

- **Redesigned pages** (every page except `/draft`) put `className="hub"` on their root. Tokens (`--bg`, `--surface`, `--accent`, `--win`, `--loss`, …) are on `:root` in [app/globals.css](app/globals.css); every component class there (`.card`, `.btn`, `.tag`, `.tab`, `.champ`, …) is scoped as `.hub .x`. Shared pieces live in [app/components/](app/components/): `Nav` (+ `SectionTabs`), `HubCard`, `Icon` (inline stroke SVG — no emoji), `useUser` (the signed-in user via `useSyncExternalStore`: no hydration mismatch, no setState-in-effect), `ChampionPicker`/`Slot`, `VideoPlayer`, `PoolMatrix`. New pages should use `useUser` rather than reading localStorage in an effect. Fonts come from `next/font` in [app/layout.tsx](app/layout.tsx): Barlow Semi Condensed (`.h`), IBM Plex Sans (body, 15px base, nothing under 12px), IBM Plex Mono (`.mono`, stats). UI copy is English. Spacing is deliberately compact (page titles 24px, section headings 20px, page padding 20/28px) — the user asked for density over the mockups' roominess, so don't reintroduce the mockups' larger spacing.
  **Grep `globals.css` before naming a new class.** Everything is one flat `.hub .x` namespace with no modules, so a name that already exists does not error — it silently merges, and only the properties the later rule sets are overridden. This has bitten once: a new `.hub .slot` inherited `width: 44px; flex: none` from the champion picker's slot and crushed a whole column, while a new `.hub .chip` inherited `padding: 0 14px` from the filter button and, under `box-sizing: border-box`, left a 30px portrait 2px wide — which looked like broken image URLs, not like CSS. Reuse the existing class where one fits: `.champ` (+ `.sm`, `.ban`) is the champion portrait and `.row` is a wrapping flex row; neither needed re-inventing.

- **The draft room** keeps its own inline `<style>` block, its own `@import` of `Barlow`/`Barlow Condensed` from Google Fonts, and short class names (`.btn`, `.logo`, `.main`, `.center`). That is why the redesign's classes are scoped under `.hub`: an unscoped `.btn` in globals would leak into it. It is also why `layout.tsx` must never load a family named `Barlow` or `Barlow Condensed`. Its own `body{}` rule comes after globals in the document and wins.

`/api/sync` stores match records locale-free (`result: 'W'|'L'`, `durationMin`, `playedAt` ISO); pages format them. Older records stored pre-rendered Turkish (`'Galibiyet'`, `'31dk'`), which is why `isWin()` in the pages still accepts `'Galibiyet'` — harmless once every client cache has turned over.
