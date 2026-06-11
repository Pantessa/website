# Autopilot — Run 5: mobile nav + dashboard shell (staged 2026-06-11; start via /loop)

Owner directives: (1) mobile navigation is broken — the nav tabs are
`display:none` under 900px with NO replacement; build a slick hamburger/drawer.
(2) The signed-in dashboard should feel like Vercel's: a full persistent left
sidebar with sections, not one long scroll. (3) API-key creation gets its own
directly-linkable page (no more scrolling/#anchor). ~2 hours; one item per
iteration; PRs into `autopilot`, never `main`.

## Rules (constitution)

1. **Branching**: `autopilot-<slug>` from `autopilot`; PRs target `autopilot`,
   never `main`. Stacking allowed where items share the dashboard shell —
   declare it + merge order (queue order).
2. **Never**: merge PRs, push main, force-push, deploy, publish, pay anything.
3. **DB**: no schema changes expected this run; if one becomes necessary,
   additive only, harness-verified.
4. **Verify before PR**: `npx tsc --noEmit` + `npm run build` minimum. Public
   UI: preview + headless-Chrome screenshots (375/768/1440 where relevant)
   under `docs/autopilot/` on the PR branch. Run `npm run test:api` (with the
   throwaway-admin env) after any item touching routes/layouts — it must stay
   37/37. Programmatic overflow scan (scrollWidth vs innerWidth) on touched
   pages at 375px.
5. **Wallet/SIWE-gated UI** (dashboard shell): verify structure via tsc/build
   + static renders of presentational components where possible; gated visuals
   flagged "needs manual pass". The hamburger + public pages are fully
   verifiable — verify them completely (tap targets actually navigate).
6. **Honesty**: unverifiable → flagged, not claimed.
7. **Logging**: progress log per item on `autopilot`; two consecutive failures
   → stop. Owner message → stop.
8. Final iteration appends a run summary.

## Queue (ordered; one per iteration)

- [x] **1. Mobile hamburger nav** — replace the `display:none` cliff: a
  hamburger button in the nav under 900px opening a slide-in drawer (right
  side, full-height, backdrop): Servers / Chat (badge) / Dashboard (when
  connected) / Developers / Blog + the Connect Wallet button. Closes on
  navigation, backdrop tap, and Escape; body scroll locked while open;
  aria-expanded/label on the trigger. House style (surf/line tokens, mono
  labels). Verify at 375px in preview: drawer opens, each link NAVIGATES
  (click-through asserted), scroll lock works; screenshots open+closed;
  overflow scan clean; desktop ≥900px unchanged (screenshot).
- [ ] **2. Dashboard shell: Vercel-style left sidebar + route split** — turn
  /dashboard into a layout with a persistent left sidebar (sections:
  Overview, API Keys, Approvals, Activity) and nested routes:
  `/dashboard` = Overview (KPI tiles, budget meter + SignGrantButton, charts)
  · `/dashboard/keys` = ApiKeysPanel + ConnectAgentCard (the directly-linkable
  key page the owner asked for) · `/dashboard/approvals` = the agent toggles
  grid · `/dashboard/activity` = the ledger feed. Shared client layout keeps
  the connect/sign-in gate (gate once, in the layout); sidebar shows active
  section; data fetching split per page (stats where needed). No server/API
  changes. tsc/build + static-render the sidebar component (links/active
  logic); gated visuals flagged manual.
- [ ] **3. Dashboard mobile** — under 900px the sidebar becomes a horizontal
  scrollable section bar (sticky, under the main nav) — same component,
  responsive CSS; tap targets ≥44px. The connect-wallet gate screen must be
  clean at 375px (it's public — screenshot it). Overflow scan on all four
  dashboard routes at 375px via the gate screen + static renders; gated
  content flagged manual.
- [ ] **4. Key-page links** — point everything at `/dashboard/keys`: the
  /developers "Mint a key" CTA (drop the #api-keys anchor hack + the
  scroll-mt), the ConnectAgentCard "mint above" copy, and add a "Keys" quick
  link on the dashboard Overview empty/onboarding states. Verify the
  /developers CTA href + navigation in preview (public page).
- [ ] **5. Site-wide 375px audit** — programmatic overflow scan + screenshots
  of /, /developers, /blog, /blog/[slug] (seed+clean a sample), /servers/
  [slug], /chat (guest view): fix anything that scrolls horizontally or has
  sub-44px primary tap targets (known suspects: chat agents bar, runner feed,
  hero CTAs). Screenshots before/after for anything fixed.

## Progress log — Run 5

_(autopilot appends here)_

### Iteration 1 — Item 1: Mobile hamburger nav ✅
- **Branch/PR**: `autopilot-mobile-nav` → [Yeetful/website#52](https://github.com/Yeetful/website/pull/52).
- **What**: 44px burger → portaled full-height drawer (all tabs 48px+, wallet/auth in footer); closes on nav/backdrop/Escape; scroll lock; aria. Desktop unchanged. **CSS trap found**: the nav's backdrop-filter made the sticky header the containing block for fixed descendants — drawer portaled to body.
- **Verification**: programmatic at 375px (open, click-through navigation + auto-close, backdrop, Escape, scroll lock, zero overflow) + desktop computed-styles; test:api 37/37; tsc + build ✓.

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
