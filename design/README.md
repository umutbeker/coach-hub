# Redesign mockups

Source of truth for the 2026-09 UI redesign. Reviewed on the design canvas:
https://claude.ai/code/artifact/4113da96-50c2-4428-a751-313687d90182

Each `mockups/*.dc.html` is one screen as literal HTML/CSS — every color,
font size and spacing value in it is the intended value, not an approximation.
`canvas.json` is only the canvas layout.

| File | Screen | Replaces |
| --- | --- | --- |
| `System.dc.html` | design tokens, type scale, controls, patterns | `app/globals.css` |
| `Login.dc.html` | sign in | `app/page.tsx` |
| `Main.dc.html` | coach panel · roster tab | `app/coach/page.tsx` |
| `CoachSchedule.dc.html` | coach panel · schedule & scouting tab | `app/coach/page.tsx` |
| `Player.dc.html` | player | `app/player/page.tsx` |
| `Matches.dc.html` | match history | `app/matches/page.tsx` |
| `ProDrafts.dc.html` | public pro drafts | `app/pro/page.tsx` |

**Out of scope, do not restyle:** `app/draft/page.tsx`, `AIDraftAssistant.tsx`,
`StrategyMap.tsx`. Any global change (body font, reset, `globals.css`) must be
checked against `/draft` afterwards — its inline `<style>` block must still win.

Decisions already made (do not re-ask): all UI copy in English; dark theme,
one accent (`#8B7CF6` default; win `#34D399`, loss/red side `#F87171`,
blue side `#60A5FA`, warning `#FBBF24` are fixed); colors are team-neutral;
logo is a placeholder mark until the Pyramid IV logo is supplied.

Tokens: bg `#0F1115`, surface `#161920`, surface-2 `#1C2028`, border `#262B36`,
border-strong `#333A48`, text `#E6E8EC`, secondary `#9AA3B2`, muted `#5C6577`.
Type: Barlow Semi Condensed 600 (display), IBM Plex Sans 400/500/600 (body,
15px base, nothing below 12px), IBM Plex Mono 500/600 (stats, tabular).
Radii 8px cards / 6px controls. Nav 64px. Controls ≥40px, primary 44–46px.
Icons are inline stroke SVG (no emoji).

Suggested build order: fonts via `next/font/google` in `layout.tsx` →
tokens + type scale in `globals.css` → shared `app/components/Nav.tsx` →
`/pro` (smallest, newest) → login → matches → player → coach.
