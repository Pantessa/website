# Autopilot — Run 8: docs + Claude Code onboarding + signed-in app shell (staged 2026-06-12, started via /loop)

Owner directive: (a) a real `/docs` section explaining SDK integration —
SEO first-class, sub-pages, FULL-WIDTH layout; (b) a Claude Code page: a
copy-paste prompt that lets someone building a Coinbase Developer Portal
agent add Yeetful in one shot — the prompt instructs Claude to wire the SDK
and walk the human to the exact yeetful.com pages for API keys + grant id;
(c) GitHub-style signed-in experience: once authed, skip the marketing
landing page (/ → dashboard) and use the full viewport width in the portal.

## Rules (Run 6/7 constitution applies; additions)

D1. **Docs accuracy**: every code sample must match the SHIPPED yeetful
    0.3.1 surface — copy from sdk/README.md, sdk/src, example-agent; never
    invent APIs. Prices/links match prod (keys live at /dashboard/keys).
D2. **SEO checklist per docs page**: title ≤60 chars, description ≤160,
    canonical, OG, JSON-LD (TechArticle + BreadcrumbList), in sitemap.xml,
    crawlable server-rendered content (no client-only copy).
D3. **Full-width**: docs + authed portal surfaces use the full viewport
    (fluid with sane gutters); marketing pages keep --maxw for guests.
D4. The / → dashboard redirect applies ONLY with a verified SIWE session
    (not mere wallet connection), client-side (auth is client-known), with
    an escape hatch (?home=1 or a "view site" link) so the marketing page
    stays reachable.

## Queue (ordered; one per iteration)

- [x] **1. Docs foundation** — /docs route group with its own FULL-WIDTH
  layout (left sidebar nav, content region, right "on this page" rail at
  xl), shared DocsPage scaffolding (breadcrumbs + JSON-LD helpers), and the
  /docs landing page (what Yeetful is for builders + cards to sub-pages).
  Server-rendered content, D2 SEO on the landing. Mobile: sidebar collapses
  to a top scroll-row (Run 6/7 standards apply — rect-scan).
- [x] **2. Core SDK sub-pages** — /docs/quickstart (install → grant →
  first paid call, from sdk README), /docs/expense-account (allowlist,
  caps, receipts, GrantError — the concepts page), /docs/ledger-sync
  (API keys, YEETFUL_GRANT_ID, ledgerUrl + the canonical-origin/auth-header
  gotcha we hit live), /docs/x402 (v1/v2 differences the SDK absorbs).
  D1+D2 on every page.
- [x] **3. Claude Code page** — /docs/claude-code: "add Yeetful to your
  Coinbase agent in one prompt". A prominent copy button on a prebuilt
  prompt that tells Claude Code to: npm i yeetful, wrap the agent's paid
  calls in yeetful(), add env handling, and INTERACTIVELY walk the human
  through minting a key at https://yeetful.com/dashboard/keys (copy yf_
  secret + YEETFUL_GRANT_ID from the connect card) with direct links/
  buttons. Mention CDP wallets work as the signer (viem account). D2 SEO;
  this page is the funnel target.
- [x] **4. Wire-up + SEO plumbing** — nav "Docs" tab + footer + /developers
  cross-links into docs; sitemap.xml gains all docs URLs; robots fine;
  RSS untouched. Verify every docs page's head tags server-side (curl).
- [ ] **5. Signed-in shell** — / redirects to /dashboard when a SIWE
  session exists (D4, mount-gated, no flash for guests); portal surfaces
  (dashboard shell, /activity when authed? NO — dashboard only) go fluid
  full-width with gutters; nav reflects portal mode (Dashboard first).
  Careful with hydration + the existing mount-gates.
- [ ] **6. Exit verification** — all-pages sweep table updated incl. the
  new /docs pages (375/390 via the iframe method), desktop 1280+1680
  full-width screenshots of docs + dashboard, head-tag table for docs
  pages, tsc/build/test:api. Run summary.

## Progress log — Run 8

_(autopilot appends here)_

### Item 4 — Wire-up + SEO plumbing ✅ (2026-06-12)

Docs is now reachable from everywhere: nav tab (Developers · Docs · Blog,
startsWith-active so sub-pages highlight; desktop tabs + mobile drawer share
the block), footer link first among product links, and /developers' "rest
of the stack" grid leads with a docs biglink. sitemap.xml maps the registry
— all six /docs URLs emitted (plus /activity, which item 3 of Run 7 forgot
to add; fixed here). Head-tag table verified server-side on all six pages:
titles 47–59ch, descriptions 139–154ch, canonical + TechArticle +
BreadcrumbList everywhere.

Tooling find: Next 16 dev refuses a SECOND dev server for the same project
(lock under .next/dev — "Run kill <pid> to stop it"), so the throwaway-
admin harness server can't be a dev server while the owner's runs. `next
start` (prod build) has no such lock — harness now runs against the prod
server: test:api 43/43. tsc + build green.

### Item 3 — Claude Code page ✅ (2026-06-12)

/docs/claude-code is live: a 3,026-char self-contained prompt (server-
rendered as a prop into a dumb CopyBlock client shell, so it's crawlable)
that instructs Claude Code to install yeetful, create one shared pay() —
using an existing CDP wallet as the signer when present — replace paid
fetches, set up env + .env.example + gitignore, then INTERACTIVELY walk
the human through the two dashboard clicks (mint at /dashboard/keys with
the show-once warning; copy YEETFUL_GRANT_ID + flip approvals) one step at
a time, and finish with a NO-SPEND verification (free allowlisted call →
$0 receipt + sync check; paid calls only on explicit say-so). The prompt
bakes in this week's lessons: ledgerUrl pinned to the www origin (redirect
auth-header gotcha), small default caps, never print secrets.

Page sections: what-it-sets-up, the two dashboard clicks as link cards,
and "why route a Coinbase agent through Yeetful" (CDP signs / Yeetful
decides; Spend Permissions as the direction of travel). D2 proven via
curl; scans clean 375 + 1680; copy button 40px on phones; tsc + build
green. claude-code flipped ready — all six pages now in the sidebar.

### Item 2 — Core SDK sub-pages ✅ (2026-06-12)

Four pages live, all flipped `ready` in the registry (sidebar/cards/sitemap
pick them up automatically): /docs/quickstart (install → wallet → grant →
paid call, code verbatim from sdk README 0.3.1 incl. the CDP-wallets-work
note), /docs/expense-account (grant fields, ordered checks, the 5 GrantError
codes as a table, receipts incl. denials, the local-vs-hard-enforcement
honesty paragraph), /docs/ledger-sync (mint → env → flushLedger, plus a
"gotchas we hit" section encoding THIS WEEK's live findings: the
redirect/auth-header 401, prefix-vs-secret, owner-scoping 404, enforcement-
stays-local), /docs/x402 (flow, the v1/v2 wire table, network resolution,
the sell-side primitives).

The sweep caught a constitution violation in my own work: the v1/v2
comparison TABLE pushed /docs/x402 to scrollWidth 390 at 375 (offender scan
missed it — tables overflow the BODY, not a flagged element; noted for the
exit sweep). Fixed globally: .docs__prose tables are display:block +
overflow-x:auto. Re-scanned both table pages clean.

D2 proven via curl on all four (title/canonical/TechArticle); scans clean
at 375 + 1680; tsc + build green (all four prerender ○). All five live
docs pages show in the sidebar.

### Item 1 — Docs foundation ✅ (2026-06-12)

`/docs` shell is FULL-WIDTH per D3 (verified docsW == viewport at 375/390/
1280/1680 — no --maxw cap): sticky 240px rail + fluid content, prose measure
capped at 80ch for readability while code runs to 96ch. Mobile rail = the
proven top scroll-row pattern. `lib/docs.ts` is the single registry driving
sidebar, landing cards, breadcrumbs, JSON-LD, and (item 4) the sitemap —
pages hidden until `ready` so mid-run links never 404. Landing page live
with the five-line SDK pitch (copy matches sdk/README 0.3.1 per D1).

D2 verified server-side via curl: title 52ch, description 154ch, canonical,
OG, TechArticle + BreadcrumbList JSON-LD, prose crawlable in the HTML.
Rect-scan 0 offenders at all four widths.

Tooling note: the owner's dev server held :3000 and the preview MCP refuses
to start while the configured port is occupied (autoPort didn't help) —
verified against the owner's server instead via curl + a temporary
playwright-core script (devDep added, used, reverted). launch.json base
port moved to 3010 for the rest of the run.

---

# Run 9 DRAFT: Coinbase Spend Permission example (awaiting owner review — do NOT start until approved)

The strategic wedge from CLAUDE.md: back the (signable) SpendGrant with a
real on-chain Coinbase Spend Permission so the agent never holds funds.
CDP research (2026-06-11): Agentic Wallets = Server Wallet v2 accounts (MPC
in AWS Nitro Enclave); Spend Permissions API maps ~1:1 onto SpendGrant
(grantor smart account / spender / token "usdc" / allowance / periodInDays);
contract 0xf85210B21cC50302F477BA56686d2019dC9b67Ad on Base; spender may be
any onchain account; gas via Coinbase paymaster. CAVEAT to verify first:
permission creation is documented as CDP-Smart-Account-only.

## Rules (Run 6/7 constitution applies; additions)

R1. TESTNET FIRST (Base Sepolia) — no mainnet funds until the owner's
    explicit go. Never store CDP API secrets in any repo; .env only.
R2. The example repo is PUBLIC from birth (Yeetful/coinbase-example) —
    secrets grep before every push.
R3. Spending real money (even $0.01 mainnet) = owner manual step, never
    autopilot.

## Queue (draft — owner may reorder/trim)

- [ ] **1. Spike: verify the CDP API surface** — create a CDP project
  (owner provides API key id/secret in .env), Server Wallet v2 + Smart
  Account on Base Sepolia, createSpendPermission with SpendGrant-shaped
  caps, spender.useSpendPermission() pulls testnet USDC. Probe-style
  evidence; document the Smart-Account-only caveat's real shape.
- [ ] **2. Yeetful/coinbase-example repo** — owner-setup.ts (one-time:
  create + sign the permission mirroring a yeetful.com grant) + agent.ts
  (yeetful() pay loop; spender auto-pulls via the permission when its
  balance runs low) + README. Testnet by default per R1.
- [ ] **3. Website: grant ↔ permission linkage** — store the permission
  hash on SpendGrant (additive column), surface a "backed on-chain" badge
  on the dashboard + signature payload alignment so the EIP-712 grant and
  the Spend Permission share terms.
- [ ] **4. SDK: spender adapter** — optional `spendPermission` option on
  yeetful(): auto-pull before payment when balance < price; receipts note
  the pull tx. Tests with a mocked CDP client.
- [ ] **5. Blog post draft** — "Your agent has an expense account, not a
  wallet" (publish = owner step per constitution).

_(Run 8 starts only when the owner says go — likely needs: CDP account +
API key, testnet faucet funds.)_

---

# Run 7 (COMPLETE 8/8): public network activity + stats (staged 2026-06-11 evening)

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
- [x] **6. (Run 6 #4) Home + directory mobile polish** — hero type scale at
  375, runner card internals, search + pills 44px, card grid rhythm,
  ActiveServerBar safe-area. Rect-scan + screenshots.
- [x] **7. (Run 6 #5) Developers + blog + servers detail mobile polish** —
  snippet <pre> scroll, capability cards, ep rows at 375; blog measure +
  code blocks; servers header badge wrap. Rect-scan + screenshots.
- [x] **8. (Run 6 #6) Global mobile foundation sweep** — viewport meta on
  every route, 16px inputs everywhere, safe-area on fixed elements, final
  all-pages rect-scan table (375 + 390) incl. /activity. Exit criteria.

## Progress log — Run 7

_(autopilot appends here)_

### Item 8 — Global mobile foundation sweep ✅ (2026-06-12) — EXIT CRITERIA MET

Foundation: viewport meta verified emitted on all 8 route classes (curl);
`-webkit-tap-highlight-color: transparent` added to the html base; nav
drawer bottom padding now includes env(safe-area-inset-bottom).

**The sweep caught one more real bug**: /servers (the add-custom-server
page — never previously audited) bled to scrollWidth 412 at 375. The color
hex input (`flex-1`, min-width:auto) forced its grid-cols-2 column wide.
Fix: `min-w-0` + the category/color row stacks at phone widths; that input,
its 3 siblings, and the category <select> all get 16px under lg (selects
zoom on iOS focus too).

**Final all-pages table** (iframe-viewport scan, both widths; offenders =
rect right > vw+2, excluding scroll containers and overflow-hidden non-body
boxes; smallInputs = visible input/textarea/select under 16px):

| Page | 375 off/inputs | 390 off/inputs |
|---|---|---|
| / | 0 / 0 | 0 / 0 |
| /activity | 0 / 0 | 0 / 0 |
| /developers | 0 / 0 | 0 / 0 |
| /blog | 0 / 0 | 0 / 0 |
| /blog/[slug] | 0 / 0 | 0 / 0 |
| /servers | 0 / 0 | 0 / 0 |
| /servers/[slug] (tripadvisor) | 0 / 0 | 0 / 0 |
| /chat | 0 / 0 | 0 / 0 |
| /dashboard (gate) | 0 / 0 | 0 / 0 |
| dash Overview (harness) | 0 / 0 | 0 / 0 |
| dash Keys (harness) | 0 / 0 | 0 / 0 |
| dash Approvals (harness) | 0 / 0 | 0 / 0 |
| dash Activity (harness) | 0 / 0 | 0 / 0 |

**26/26 clean.** Method note: pages loaded in a sized same-origin iframe
(its own viewport — media queries + dvh respond correctly), which made the
26-combo sweep tractable in two scans. Safe-area insets remain
preview-unverifiable (env() = 0) — flagged; owner's phone glance covers it.
tsc + build + test:api 43/43; harnesses deleted.

---

## Run 7 summary (2026-06-12)

**Queue: 8/8 complete.** Zero failed iterations. The spend ledger is now a
public surface (API + page + home pulse) and every page of the site passes
a 26-combo mobile exit sweep.

| # | Item | PR |
|---|------|----|
| 1 | Public activity API (privacy-proofed) | [#61](https://github.com/Yeetful/website/pull/61) |
| 2 | /activity page + nav tab | [#62](https://github.com/Yeetful/website/pull/62) |
| 3 | Home network pulse + perf pass | [#63](https://github.com/Yeetful/website/pull/63) |
| 4 | Dashboard sub-pages mobile | [#64](https://github.com/Yeetful/website/pull/64) |
| 5 | Chat mobile-first (overlay sidebar) | [#65](https://github.com/Yeetful/website/pull/65) |
| 6 | Home + directory polish | [#66](https://github.com/Yeetful/website/pull/66) |
| 7 | Dev/blog/servers audit (no code needed) | [#67](https://github.com/Yeetful/website/pull/67) |
| 8 | Foundation sweep + exit table | [#68](https://github.com/Yeetful/website/pull/68) |

**Merge order**: #61→#62→#63 (stacked chain, merged mid-run), #64, #65
(merged mid-run), then #66→#67→#68 (stacked).

**Bugs the run's own checks caught**: the implicit-grid-track bleed pattern
(twice: Approvals grid, /servers color row — base `grid` with only
sm:/lg: cols sizes the phone track to max-content); chat's 21px composer
(squeeze ≠ bleed — rect scans can't see it); the persisted-preference trap
(mobile auto-close almost permanently collapsed the desktop sidebar);
framer-motion orphaning AnimatePresence children closed mid-hydration;
fetch dropping auth headers on cross-origin redirects (found via the
example-agent's 401s — fixed in sdk 0.3.1/0.3.2 work, same session).

**test:api 37 → 43** (activity shape, cache header, P1 anonymization proof,
P2 denial-row absence). New standing tools: the fetch-patch harness pattern
for gated pages, the iframe-viewport sweep for all-pages tables.

**Owner manual passes**: phone glance for safe-area insets (env() invisible
in preview); the usual wallet flows.

### Item 7 — Developers + blog + servers detail mobile ✅ (2026-06-12, no code)

The queue over-assumed (like Run 3 item 3): a full live audit found NOTHING
to fix. All four surfaces rect-scan 0 offenders with exact scrollWidth at
BOTH 375 and 390:
- /developers — snippet <pre> scrolls (666px content in a 339px box,
  overflow-x auto), no sub-16px inputs, capability cards stack clean
- /servers/yeetful-claude AND /servers/tripadvisor (61 endpoint elements,
  the long-path stress case) — header badges wrap to two rows, method
  chips + paths fit, volume lines wrap
- /blog — single-column grid at phone widths
- /blog/an-agent-shipped-this-blog — 16px body measure, code block
  scrolls (overflow auto), zero inline-code overflows

These pages were all built/refreshed AFTER the mobile standards landed
(Runs 4–5), which is why they hold. Zero diff per rule 6 — no fixes
invented to look busy. Item 8's all-pages table will re-verify them as
part of the exit sweep.
### Item 6 — Home + directory mobile polish ✅ (2026-06-12)

Live audit at 375 found the page already in good shape (Run 5's audit held:
hero type/wrapping clean at 54px, runner card stats + feed density right,
CTAs side-by-side). Three real gaps, fixed in one mobile-only CSS block:
- `.search__input` 15→16px under lg (iOS zoom)
- `.pill` 40→46px (queue asks 44 for the primary directory filter)
- `.activebar`: bottom floats above `env(safe-area-inset-bottom)`, gutter
  tightened to 24px total, Start-chat CTA 40→46px (Clear too)

Verified live: pills 46px, search 16px, activebar 229px wide / 14px above
the viewport bottom with an agent in the runner (env() inset is 0 in the
preview — real devices add it; flagged, not claimable in preview).
Rect-scan 0 offenders at 375 + 390 (scanner now also whitelists
overflow-hidden non-body boxes per item 3's note — the runner feed's mask).
Desktop 1280 unchanged (40px pills, 15px search). CSS-only diff: test:api
not run (no routes/shared components); tsc + build green.

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
