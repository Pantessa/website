# Autopilot — Run 7: public network activity + stats (staged 2026-06-11 evening)

Owner directive: a public page showing all transactions on the network with
overall stats. The receipts we already write (spend_ledger) become the
public proof-of-life surface: live paid calls, totals, and a
"blocked by policy" counter that doubles as the control-plane pitch.
Run 6 items 2–6 (mobile) carry over after the activity items.

## Rules (constitution — Run 6 rules apply verbatim, plus privacy)

P1. **Public payloads NEVER contain**: full wallet addresses (truncate
    server-side to 0xab…cd), grant ids, API-key material, or chat content.
    The test harness must PROVE anonymization (seed a row, assert the full
    address is absent from the public JSON).
P2. **Denials are aggregate-only in public**: a blocked-calls stat is the
    control-plane flex, but denial ROWS (who tried what and got refused)
    never appear in the public feed.
P3. The endpoint is unauthenticated read-only; no user-controlled params may
    reach other tables. DB changes additive only (plain `db push`, never
    --force-reset).

## Queue (ordered; one per iteration)

- [x] **1. Public activity API** — `GET /api/activity` (no auth): `stats`
  (settled USD total, settled calls, calls today, blocked count, distinct
  active accounts), `daily` 30-day series, `top` services by spend, `recent`
  ≤50 SETTLED rows (serviceName, host, amountUsd, txHash, truncated owner,
  createdAt). Additive `@@index([ok, createdAt])` on spend_ledger + plain
  `db push` (the global feed can't ride the grant-scoped index). Cache
  `s-maxage=30, stale-while-revalidate=120`. EXTEND `npm run test:api`
  (don't write temp scripts): shape checks, P1 anonymization proof, P2
  denial-row absence, cache header present. 37 checks must stay green and
  grow.
- [x] **2. /activity page** — public, SEO'd (title/desc/OG), nav link. Stat
  tiles (settled total, calls, active accounts, blocked-by-policy), reuse
  DashboardCharts SpendOverTime for the 30-day series + per-service bars,
  live feed with Basescan links on tx hashes (https://basescan.org/tx/…),
  ~30s polling, honest empty states (young network ≠ broken page).
  Mobile-first per Run 6 standards: rect-scan clean 375/390 (public page —
  no harness needed), tap targets ≥40px, feed rows wrap not bleed.
- [x] **3. Home tie-in + perf pass** — surface the network stats on the home
  page (small live counter strip sourced from the same API; no second
  query path), verify payload size sane (≤50 rows, no over-fetch), confirm
  the new index is used (EXPLAIN via Neon MCP), lighthouse-glance the page
  weight. Anything unverifiable: flagged, not claimed.
- [x] **4. (Run 6 #2) Dashboard Keys/Approvals/Activity mobile** — mock-harness
  pattern per page: keys (secret reveal break-all, ConnectAgentCard <pre>
  scroll, long prefixes), approvals (3→2→1 grid, switch tap size), activity
  (long hosts/hashes truncate; rows wrap to two lines). Rect-scan clean;
  screenshots; harness deleted.
- [x] **5. (Run 6 #3) Chat mobile-first** — sidebar overlays or collapses at
  375/390; composer sticky-bottom with safe-area + 16px input font; bubbles
  ≤85vw with long-word breaking; agents toolbar scroll; receipts footnote
  wrapping; guest send box no-iOS-zoom.
- [ ] **6. (Run 6 #4) Home + directory mobile polish** — hero type scale at
  375, runner card internals, search + pills 44px, card grid rhythm,
  ActiveServerBar safe-area. Rect-scan + screenshots.
- [ ] **7. (Run 6 #5) Developers + blog + servers detail mobile polish** —
  snippet <pre> scroll, capability cards, ep rows at 375; blog measure +
  code blocks; servers header badge wrap. Rect-scan + screenshots.
- [ ] **8. (Run 6 #6) Global mobile foundation sweep** — viewport meta on
  every route, 16px inputs everywhere, safe-area on fixed elements, final
  all-pages rect-scan table (375 + 390) incl. /activity. Exit criteria.

## Progress log — Run 7

_(autopilot appends here)_

### Item 5 — Chat mobile-first ✅ (2026-06-12)

The before-state was unusable, not just ugly: the 240px sidebar SQUEEZED the
chat at 375 — the composer textarea measured **21px wide**. No rect bleed, so
scrollWidth scans would never catch it; squeeze is a distinct failure mode.

- **Sidebar = overlay below lg** (absolute, opaque, shadow), chat keeps full
  width while open (textarea 261px). Defaults CLOSED on phones, closes on
  chat-navigation taps.
- **State model matters**: first cut wrote the mobile auto-close into the
  PERSISTED sidebarOpen — one phone visit would permanently collapse the
  desktop sidebar. Split into transient `mobileSidebarOpen` (never persisted)
  vs the persisted desktop pref; verified the pref survives a full mobile
  session untouched.
- **framer-motion gotcha**: closing the AnimatePresence child mid-hydration
  orphans it (panel stuck at width:240 with the store closed). Mount-gate the
  sidebar render until the client knows the breakpoint.
- Composer: 16px font under lg (iOS zoom), safe-area bottom padding,
  workspace height 100dvh (URL-bar-proof) — pinned exactly at viewport
  bottom (813 ≈ 812+border).
- Bubbles: 85vw cap on phones + overflow-wrap:anywhere — verified live with
  a 90-char unbroken hash (wraps, right edge 342 < 375).
- Receipts footnote: verified by inspection only (truncate within min-w-0
  rows — guest demo produces no live receipts); flagged per rule 6.

Rect-scan 0 offenders at 375 + 390; toolbar already scrolled (Run 5 work
held). Desktop 1280: sidebar inline/open, 14px composer — unchanged.
tsc + build green; test:api 37/37.
### Item 4 — Dashboard Keys/Approvals/Activity mobile ✅ (2026-06-12)

Mock-harnessed all three gated pages (fetch-patch pattern, real components in
the real shell). Found + fixed:
- **Approvals BLED at 375** (scrollWidth 386, all 9 rows past the viewport):
  `grid sm:grid-cols-2…` leaves the base track implicit → max-content; the
  long agent name set the track. Same trap as Run 6 item 1's charts grid.
  Fix: explicit `grid-cols-1` + `min-w-0` rows. Detail-arrow 22→40px on
  phones (padding, not layout).
- **Keys**: mint input was 12px (iOS zoom) → 16px under lg; Copy/Mint/Revoke
  32→40px touch heights; minted-secret reveal verified live in harness
  (mocked POST → break-all renders, no bleed).
- **Activity**: rows now wrap to two lines on phones; Basescan links 16→40px
  touch height (padding trick, rows stay visually dense).

Rect-scan 0 offenders + exact scrollWidth at 375 AND 390 on all three pages;
desktop verified unchanged (3-col approvals, compact controls — all fixes
are max-lg). After-screenshots (true 375 viewport via playwright) in
docs/autopilot/dash-{keys,approvals,activity}-375-after.png; the approvals
before-state is recorded numerically above (no screenshot — bleed was found
and fixed in the same harness session). test:api 37/37 (= full pass on this
branch; the 43-check version is on the unmerged item-1 branch). Harnesses
deleted; diff greps clean.
### Item 3 — Home tie-in + perf pass ✅ (2026-06-12)

NetworkPulse on the home directory statbar: "$X settled on-network →" linking
to /activity, same /api/activity payload (one query path; component renders
nothing until data arrives so the bar never flashes zeros, and hides when
settledCalls=0). Statbar now flex-wraps; the pulse drops to its own line at
375 with a 40px tap target (was 33 — caught and fixed in preview).

Perf findings, honest ledger:
- Index: planner uses Seq Scan at n=9 rows (correct); with enable_seqscan
  off the feed query uses **Index Scan Backward on
  spend_ledger_ok_created_at_idx** — proven viable for growth, not yet
  preferred. Re-check via EXPLAIN when the table is real-sized.
- Payload: 2,589 bytes total (8 recent / 2 daily / 7 top) — well under any
  concern at the 50-row cap.
- Page weight: **Next 16 build no longer prints first-load JS per route** —
  flagged as unverified rather than claimed; /activity reuses the
  recharts/DashboardCharts chunks the dashboard already ships.
- Rect-scan home 375: 0 real offenders. Two `runner__price` rects extend
  past the viewport INSIDE the runner feed's masked overflow:hidden box —
  by-design clipping (fade mask), zero scrollWidth impact. Item 8's
  all-pages scanner should also whitelist overflow-hidden non-body
  containers to encode this.
- test:api skipped this item (no route/server code touched — CSS + home
  page + new client component only); tsc + build green.

### Item 2 — /activity page ✅ (2026-06-12)

Public page + nav tab (between Chat and Dashboard). Server shell owns SEO
(title/description/OG); client ActivityBoard polls /api/activity every 30s
(matching the API's s-maxage so faster polling would be noise). Stat tiles
(Settled / Calls today / **Blocked by policy** / Active accounts), both
DashboardCharts reused (with the Run 6 ChartBox + min-w-0 guards — no new
chart plumbing), 50-row feed with Basescan links (40px touch height via
padding, not row bloat), honest empty/error states ("the network is young"
vs "unavailable — refresh"), and a privacy footnote stating the
truncation/aggregate rules out loud.

Verified: real prod data end-to-end in preview (8 settled calls, truncated
0x5eaa…55a0, tx links); rect-scan 0 offenders at 375 AND 390, scrollWidth
exact; feed rows wrap to two lines on phones (service+account+amount /
tx+time); desktop + mobile screenshots reviewed in preview. tsc + build
green (/activity prerenders ○, the API stays ƒ); test:api 43/43 (nav is a
shared component). Stacked on item 1's branch — merge #61 first.

### Item 1 — Public activity API ✅ (2026-06-12)

`GET /api/activity` (no auth, `force-dynamic` so Next can't freeze a build-time
snapshot, CDN cache via `s-maxage=30, stale-while-revalidate=120`): stats
(settled USD/calls, callsToday UTC, blockedCalls, distinct activeAccounts),
30-day daily series, top-10 services, 50 most-recent SETTLED rows with
owner truncated server-side (P1) and denial rows excluded (P2 — aggregate
only). Additive `@@index([ok, createdAt])` pushed to Neon (plain db push;
verified in pg_indexes — the global feed can't ride the grant-scoped index).

test:api grew 37 → **43** (denial-seed probe, shape, cache header, truncated
account visible, P1 full-address-absent over the raw payload text, P2
denial-row absence). All 43 green; tsc + build green. Real-payload sanity:
the owner's lisbon receipts render with truncated `0x5eaa…55a0` + Basescan-able
tx hashes; `callsToday: 0` verified correct (UTC midnight had passed — DB
now() cross-checked, not assumed).

---

# Run 6: mobile-first, every page — 1/6 done, items 2–6 carried into Run 7

Owner report with screenshot: the AUTHED dashboard bleeds horizontally on
mobile (KPI cards, budget card, and the spend chart run past the viewport) —
the gated surface previous runs could only flag. This run makes every page
genuinely mobile-first and adds the tooling to verify gated pages.

## Rules (constitution)

1. `autopilot-<slug>` from `autopilot`; PRs → `autopilot`, never `main`;
   stacking declared with merge order (queue order).
2. Never merge/push-main/force-push/deploy/publish/pay.
3. **Gated-page verification (new tool)**: build a TEMPORARY mock-data
   preview page (e.g. app/__preview/dash/page.tsx) that renders the gated
   page's CONTENT components with realistic fixture data and no auth. Verify
   in the preview browser at 375/390 (rect-based scan: any element whose
   getBoundingClientRect().right exceeds the viewport +2px counts — NOT
   scrollWidth, which overflow-x:hidden defeats). Screenshot evidence from
   the preview browser. DELETE the temp page before commit — it must never
   ship (grep the diff for __preview before pushing).
4. Mobile-first specifics to enforce everywhere: no horizontal bleed at
   375/390; primary tap targets ≥44px (40 acceptable for dense secondary);
   inputs ≥16px font (iOS zoom); long mono strings (hashes/urls) truncate or
   scroll within their box, never push it; charts/tables get their own
   overflow-x scroll containers; fixed/floating elements respect
   env(safe-area-inset-*).
5. `npx tsc --noEmit` + `npm run build` minimum; `npm run test:api` (with
   throwaway-admin env) must stay 37/37 after any item touching routes or
   shared components.
6. Honesty: anything unverifiable flagged, not claimed. Real-wallet visuals
   remain the owner's glance, but with the mock harness the LAYOUT is ours
   to verify — "gated" no longer excuses bleed.
7. Progress log per item; two consecutive failures → stop; owner message →
   stop; final iteration appends a run summary.

## Queue (ordered; one per iteration)

- [x] **1. Dashboard Overview mobile bleed (the screenshot)** — mock-harness
  the Overview content (Kpi grid, budget meter + SignGrantButton, both
  DashboardCharts with ~10 days of fixture data). Find and fix every bleed
  source — prime suspects: Recharts containers (must be ResponsiveContainer
  inside a min-width:0 parent, wrapped in an overflow guard), the KPI grid
  at 2-col/375, the budget card's mono spend line, `.dash`/`.dash__main`
  min-content. Rect-scan 375 + 390 clean; before/after screenshots from the
  preview browser; harness deleted.
- [ ] **2. Dashboard Keys/Approvals/Activity mobile** — same harness pattern
  per page: keys (secret reveal block's break-all, ConnectAgentCard's
  <pre> scroll container, list rows with long prefixes), approvals (3→2→1
  column grid comfort, switch tap size), activity (long hosts/hashes
  truncate; row wraps to two lines on phones instead of pushing). Rect-scan
  clean; screenshots; harness deleted.
- [ ] **3. Chat mobile-first** — at 375/390: sidebar must overlay (not
  squeeze) or collapse cleanly; composer sticky-bottom with safe-area
  padding and 16px input font; message bubbles ≤85vw with long-word
  breaking; agents toolbar scroll behavior; receipts footnote wrapping.
  Public page — verify everything live in preview incl. guest send box
  focus (no iOS zoom: input font-size ≥16px).
- [ ] **4. Home + directory mobile-first polish** — hero type scale and
  spacing at 375 (eyebrow wrapping is fixed; tune sizes), runner card
  internals (stats row, feed line density), search + pills (44px), card
  grid single-column rhythm, ActiveServerBar safe-area + width on phones.
  Rect-scan + screenshots (public).
- [ ] **5. Developers + blog + servers detail mobile polish** — dev page:
  snippet <pre> scroll, capability cards stack spacing, ep rows (method
  chip + path truncation) at 375; blog: post typography measure, code
  blocks scroll, index cards; servers detail: header badge wrap, volume
  lines wrap. Rect-scan + screenshots (public).
- [ ] **6. Global mobile foundation sweep** — verify viewport meta is
  emitted on every route; 16px minimum on ALL text inputs; safe-area
  insets on fixed elements (activebar, drawer); `-webkit-tap-highlight`
  sanity; a final all-pages rect-scan table (375 + 390) in the PR covering
  /, /developers, /blog, /blog/[slug], /servers/[slug], /chat, dashboard
  gate + mock-harnessed authed pages. This is the run's exit criteria.

## Progress log — Run 6

_(autopilot appends here)_

### Item 1 — Dashboard Overview mobile bleed ✅ (2026-06-11)

**Root cause was NOT the charts.** Mock-harness + element-deletion bisection in
the preview browser proved the driver is `.dash__rail`: at ≤900px its four
`white-space: nowrap` section links sum to ~465px, and as a grid item with
default `min-width:auto` the rail sets the shared 1fr track's minimum.
`.dash__main` already had `min-width:0` — the rail never got it. Track inflated
to 465px at a 375px viewport (scrollWidth 483) and every child — KPIs, budget
card, charts — rode along. The chart's pinned 431px inline width was downstream
(recharts measured an already-inflated container).

Fixes: `min-width:0` on `.dash__rail` (one line, kills the bleed); plus the
queue's belt-and-braces — charts grid `grid-cols-1` explicit + `min-w-0` cards,
ResponsiveContainer wrapped in a `min-w-0 overflow-hidden` ChartBox (a stale
pinned px width can never hold the page open again), `min-w-0` on Kpi tiles
(long agent slugs truncate instead of flooring the 2-col track), and the Sign
grant pill bumped to a 40px tap target under lg (25px before; desktop
unchanged).

Verified: rect-scan (scroll-container-aware) clean at 375 + 390, scrollWidth
375/390 exactly; desktop 1280 unchanged (4 KPI cols, 25px pill). tsc + build +
test:api 37/37 (throwaway-admin env). Before/after at true 375 viewport:
`docs/autopilot/dash-overview-375-{before,after}.png` (before's full-page
canvas is 483px wide — the bleed made visible). Harness deleted; `grep -ri
preview` over the diff clean.

Deviations/lessons: (1) rule 3's suggested `app/__preview/` path can't work —
underscore-prefixed folders are private in the app router (no route); harness
lived at `app/preview/dash` instead. (2) Headless Chrome `--window-size` is
NOT a 375 viewport even with a clean profile (it still laid out the inflated
track post-fix) — `npx playwright-core screenshot --channel=chrome
--viewport-size=375,812` against the dev server is the reliable way to get
mobile screenshot FILES; the preview browser stays authoritative for scans.
(3) Harness pattern that worked: patch `window.fetch` for the page's API
routes in the temp page and render the REAL gated page component + shell —
zero changes to shipped code for testability.

---

## Run 5 summary (2026-06-11)

**Queue: 5/5 complete.** Zero failed iterations. Mobile navigation exists, the dashboard is a Vercel-style shell, and every public page passes a real-viewport 375px audit.

| # | Item | PR |
|---|------|----|
| 1 | Mobile hamburger nav (portaled drawer) | [#52](https://github.com/Yeetful/website/pull/52) |
| 2 | Dashboard sidebar + route split (incl. /dashboard/keys) | [#53](https://github.com/Yeetful/website/pull/53) |
| 3 | Dashboard mobile section bar | [#54](https://github.com/Yeetful/website/pull/54) |
| 4 | Key-page links (/dashboard/keys canonical) | [#55](https://github.com/Yeetful/website/pull/55) |
| 5 | 375px audit (hero grid fix + tap targets) | [#56](https://github.com/Yeetful/website/pull/56) |

**Merge order: #52 → #53 → #54 → #55 → #56** (one stacked chain; each contains the previous).

**Bugs found by the run's own checks**: the nav's backdrop-filter trapping fixed-position descendants (drawer portaled); the grid min-content hero clipping that scrollWidth scans can't see (rect-based scanning is the new standard); headless-Chrome --window-size ≠ mobile viewport (screenshot artifacts, preview browser authoritative).

**Owner manual passes**: authed dashboard glance on a phone (rail → section bar, keys page, approvals toggles) + the usual wallet flows.

---

## Run 4 summary (2026-06-11)

**Queue: 5/5 complete.** Zero failed iterations. The blog exists end-to-end: schema → admin API (Bearer = headless publish) → public UI with full SEO → uploads (token-pending) → feeds → a published launch post.

| # | Item | PR |
|---|------|----|
| 1 | BlogPost model + publish API | [#46](https://github.com/Yeetful/website/pull/46) |
| 2 | Public /blog UI (SEO first-class) | [#47](https://github.com/Yeetful/website/pull/47) |
| 3 | Vercel Blob uploads | [#48](https://github.com/Yeetful/website/pull/48) |
| 4 | RSS + sitemap + robots | [#49](https://github.com/Yeetful/website/pull/49) |
| 5 | First post | [#50](https://github.com/Yeetful/website/pull/50) |

**Merge order (one stacked chain)**: #42 (Run 3 harness — prerequisite) → #46 → #47 → #48 → #49 → #50. Run 3's #43–#45 remain open and independent.

**Owner setup**: `ADMIN_WALLETS=0x<you>` (local + Vercel) to publish; create a Vercel Blob store + `BLOB_READ_WRITE_TOKEN` for photos (the harness check self-upgrades when it appears); `NEXT_PUBLIC_SITE_URL` optional (defaults to https://yeetful.com).

**Notes**: SEO directive landed at every layer (schema-enforced ≤160 descriptions + alt column, canonical/OG/JSON-LD, stable publishedAt, RSS/sitemap/robots, XML-escaping proven with booby-trapped titles). test:api grew 25→37 checks. The launch post's claims are all literally true, including its own publish mechanism.

---

## Run 3 summary (2026-06-11)

**Queue: 5/5 complete.** Zero failed iterations. Nothing merged, no deploys, no spending; prod-DB items executed within guardrails. All website PRs target `autopilot`.

| # | Item | PR |
|---|------|----|
| 1 | test:api harness (25 checks) | [#42](https://github.com/Yeetful/website/pull/42) |
| 2 | Runner-feed duplicate-key fix | [#43](https://github.com/Yeetful/website/pull/43) |
| 3 | SDK 0.3 ripple | [example-agent#1](https://github.com/Yeetful/example-agent/pull/1) · [demo#2](https://github.com/Yeetful/demo/pull/2) |
| 4 | Ingest auto-wire probe + wipe-on-empty fix | [#44](https://github.com/Yeetful/website/pull/44) |
| 5 | Stale BlockRun URL fix-up | [#45](https://github.com/Yeetful/website/pull/45) |

**Merge order**: #42 → #43 → #44 → #45 (all independent); example-agent#1 + demo#2 any time.

**Notable**: item 4's integrity check caught the ingest deleting yeetful-claude's hand-seeded endpoint (wipe-on-empty) — fixed + seed survival proven. Venice's gateway demands an exact $10 authorization per call (probe evidence — vindicates the auto-wire cap). Item 3 found the website needed no caveat removal (queue over-assumed). DB net effect this run: 13 URL rewrites, +3 upstream endpoints, wiring 7/7 intact throughout.

**Owner manual passes**: unchanged from Run 2 (one wallet session) + demo `--live` on 0.3.0.

---

## Run 2 summary (2026-06-10 evening)

**Queue: 7/7 complete.** Zero failed iterations. Nothing merged, no deploys, no spending. All PRs target `autopilot`.

| # | Item | PR |
|---|------|----|
| 1 | API-key management UI | [#34](https://github.com/Yeetful/website/pull/34) |
| 2 | "Connect an agent" card | [#35](https://github.com/Yeetful/website/pull/35) — stacked on #34, merge #34 first |
| 3 | "Sign grant" wallet button | [#36](https://github.com/Yeetful/website/pull/36) |
| 4 | Chat payments-footer dedup | [#37](https://github.com/Yeetful/website/pull/37) |
| 5 | Directory refresh + Claude seed (prod DB) | [#38](https://github.com/Yeetful/website/pull/38) — DB changes already live |
| 6 | Responsive pass | [#39](https://github.com/Yeetful/website/pull/39) |
| 7 | /developers page | [#40](https://github.com/Yeetful/website/pull/40) |

**Suggested merge order**: #34 → #35 → #36 → #37 → #38 → #39 → #40. All independent except #35 (stacks on #34). NOTE: #33 (inference providers, targets main) shares files with #36/#37/#38 — merge autopilot→main AFTER #33, or vice versa; the ingest-map hunk in #38 is identical to #33's so it merges clean.

**Manual passes for the owner** (most fold into one wallet session):
- Dashboard glance: key panel (mint→reveal→copy→revoke), connect-agent card, sign-grant button + one wallet signature.
- One live paid chat turn (~$0.001–0.01): covers #30/#33/#37 receipts end-to-end.
- demo repo: `npm run grant -- --live`.

**Deviations/notes**: #35 stacking declared per rule 1's escape hatch; #38's safety catch (ingest map predated #33 — would have unwired prod inference providers; fixed before running); headless-Chrome mobile captures clip ~15px (camera artifact, programmatic overflow scan is authoritative); mcp_endpoints has no `source` column so hand-seed provenance lives in the description + committed script.

---

## Run 1 (2026-06-10) — COMPLETE, 6/6, all merged to main

| # | Item | PR |
|---|------|----|
| 1 | API keys for headless agents | website#26 + sdk#2 |
| 2 | EIP-712 grant signing (server) | website#27 |
| 3 | Service detail page /servers/[slug] | website#28 |
| 4 | Cost-at-volume warnings | website#29 |
| 5 | Example integration | github.com/Yeetful/example-agent |
| 6 | Receipts → Message.meta + footnotes | website#30 |

Follow-ups merged same day: #31 (Details links), #32 (autopilot→main),
demo#1 (live mode via published SDK). Manual passes still pending from Run 1:
wallet-paid chat turn, demo `--live`, SDK↔prod sync, dashboard visuals.
Full iteration log: `git log --follow AUTOPILOT.md` (pre-Run-2 revisions).
