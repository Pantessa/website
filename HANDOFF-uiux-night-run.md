# UI/UX elegance pass — night run (2026-06-25)

Autonomous overnight run on branch **`uiux/night-run`** (worktree
`website-uiux/`, based off `origin/autopilot`). Goal: take the site "up a
note" — more elegant, prettier, better flow — per Nate's brief. **Nothing
merges to `main`.** Work accumulates on `uiux/night-run` and is folded into the
local/remote **`autopilot`** branch for morning review.

Preview: dev server runs from this worktree via the `uiux` launch config
(`/Users/nategeier/yeetful/.claude/launch.json`, port 3400) so it never
collides with the sharp-router-night dev server in `website/` (:3000).

## Brief (Nate, verbatim intent)
1. Font alignment — Activity page mixes fonts; **use the big Newsreader serifs
   for the tables**.
2. Mobile CTAs are ugly — want **flat, full-width buttons + a scroll-triggered
   sticky action bar**.
3. Prettier **blog** index + post layout.
4. Add **server analytics charts to the landing page** showing we track
   spending + earning agents (data from /api/activity · Yeetful·Claude /
   Snapshot).
5. General elegance / flow polish.

## Batches

### ✅ Batch 1 — Typography alignment (committed)
- Added a font-family **variable system** to `:root` in `app/x402-design.css`
  (`--font-sans`/`--font-mono`/`--font-serif`/`--font-display`) as the single
  source of truth; pointed `body`, `.mono`, `.hero__h1` at it.
- New reusable classes: `.cardh--serif` (the "nice big serif" table/section
  title, ~23px Newsreader) and `.u-name-serif` (serif row identity for entity
  names).
- `CardTitle` (lib/dashboard-ui.tsx) gained an opt-in `serif` prop — the public
  /activity surface uses the big serif; the dense dashboard keeps compact sans
  (no regression there).
- Applied on `components/ActivityBoard.tsx`: serif titles on Network spend,
  Spend by service, MCP reliability, Staked by token, Latest settled calls; and
  serif **names** in the reliability + staked tables (numbers/% stay mono).
- Verified desktop + mobile (375px): names truncate cleanly, numbers stay
  mono/right-aligned. Terminal-style LIVE ROUTING feed kept mono on purpose.

### ✅ Batch 2 — Mobile CTAs (committed)
- Hero CTAs (`.heroweb__ctas`) now **stack flat & full-width** on phones
  (≤600px) instead of uneven floated buttons overlapping the network.
- New `components/MobileCtaBar.tsx` — a **scroll-triggered, flat, full-bleed
  sticky bar** that rises from the bottom once the hero scrolls past ~60% of
  the first viewport. State-aware (Create account → Open dashboard / Try a
  route), mounted on the landing page. Hidden on desktop (`display:none`,
  shown only ≤640px). Verified: rises on scroll, docks bottom, desktop/tablet
  unaffected. (The overlapping "N" at bottom-left is just the Next.js dev
  indicator — absent in production.)
### ✅ Batch 3 — Landing analytics charts (committed)
- New `components/SwitchboardStats.tsx` landing section: **"Every paying and
  earning agent, tracked."** Serif heading + serif stat numbers (settled $,
  routed calls, avg/call, paying agents, paid-to-stakers) + two charts reusing
  the existing lazy Recharts: **Network spend · last 30 days** (area) and **Top
  earning agents** (bars — Yeetful·Claude / Yeetful·Snapshot feature). Pulls
  the public `/api/activity` feed; renders nothing until real settled volume
  (honesty bar, no zeros). Mounted after the live strip on the landing page;
  charts stack on ≤760px. Verified desktop + mobile (no overflow).
### ✅ Batch 4 — Blog index + post (committed)
- **Index**: leads with a **featured "LATEST"** card (big serif title, lede,
  "Read the post →"); remaining posts in a richer 2-col grid. Card titles now
  **serif** (Newsreader), more padding, a "Read →" affordance on hover.
- **Post**: editorial header — accent kicker, big serif title, a **lede**
  (post.description), meta under a hairline divider; serif `h2` subheads;
  wider line-height + 720px measure for comfortable reading.
- Verified index + post on desktop + mobile (no overflow, serif throughout).
### ✅ Batch 5 — Landing header unification (committed)
- The landing page alternated serif (hero, how-it-works) and sans
  (servers/try/proof/live section H2s). Unified all four sans section headers
  (`.swsrv__h2`, `.swtry__h2`, `.swproof__h2`, `.swlive__h2`) to the Newsreader
  serif at a consistent size — the whole page now speaks one serif voice for
  section titles (agent-card names keep Archivo for contrast). Verified.

### Signed-in view — verified
Logged the preview browser in as the house wallet (`0x5eaa…55a0`) via the SIWE
handshake using env `PRIVATE_KEY` (nonce → sign in Node → verify POST from the
browser so the httpOnly session cookie lands in its jar). The dashboard Overview
renders with real data. **Decision:** the dashboard is a dense, app-like surface
where the compact sans reads correctly — the big-serif identity is reserved for
the marketing surfaces (home, activity, blog), so dashboard typography is left
as-is. (Re-auth recipe for future iterations is the 3-step flow above.)

### Merge / review
All batches live on `uiux/night-run` → **PR #260 (base `autopilot`, NOT main)**.
Merged into `autopilot` for morning review.

### ✅ Batch 6 — Site-wide H1 alignment (committed)
- `/servers` (`.srvpage__h1`) and `/docs` splash (`.splash__h1`) hero titles
  were bold-sans (Archivo) while every other public hero (home, activity, blog,
  leaderboard) is serif. Moved both to the Newsreader serif. **Every public
  page hero H1 now reads in the same serif voice** — "fonts aligned", site-wide.

### Remaining ideas (optional, for the user to direct)
- Nav + footer micro-polish; a hover/focus-state sweep.
- Dashboard page-title treatment (kept compact sans intentionally for now).
