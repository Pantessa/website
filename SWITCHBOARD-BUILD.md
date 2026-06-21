# SWITCHBOARD — build queue (the bulletproof routing offer)

> **Switchboard** = Yeetful's MCP routing engine, made a product. "Ask in plain
> English → it weighs every MCP that can answer, picks the best-priced route
> under your cap, patches the call, and pays per call in USDC." This is the
> wedge from `brand/PROBLEM.md` (routing puts us back in the settlement path).
> The engine itself = `lib/endpoint-planner.ts` + the planner inference in
> `app/api/chat/route.ts`, executing through `lib/x402.ts`.
>
> This file is the autonomous build queue. **Each tick: pick the next unchecked
> item, implement on a branch off `main`, verify (`npx tsc --noEmit` + `npm run
> build` + extend `npm run test:api` where it applies), then check the box with
> a one-line note + branch/PR ref. Log every tick under "Run log" at the bottom.**

## Operating rules (read before each tick)
- Branch per item off `main`; never commit to the user's `earn-side` branch or
  touch its uncommitted files. Do NOT merge — the owner reviews/merges.
- `app/api/chat/route.ts` is a HOT shared file (a parallel process coordinates
  on it). Prefer additive, isolated changes. If an item needs deep surgery
  there, do the smallest safe slice and flag the rest for the owner.
- Honesty bar (P0, already shipped in #151): never display a number we can't
  back. Routed/saved/settled figures on public surfaces must come from real
  `spend_ledger` / `/api/activity`, or be labeled simulation.
- Verify against `next start` (web-prod), not just dev, for anything visual.
- Keep the brand voice (yeetful-brand skill): plainspoken, one cheeky moment
  max, mono for receipts/version stamps.

---

## D — Surface (the user-facing offer)
- [x] **D0. /switchboard hero + explainer** — live routing animation
  (`components/SwitchboardWeb.tsx`), request→weigh→patch→settle with a live HUD
  decision log; `/switchboard` page + "How the operator works" 3-beat. tsc clean,
  verified in preview. _(this session, branch `switchboard`)_
- [x] **D1. Nav link** — `Switchboard` tab added to the top nav (desktop +
  mobile drawer), placed after Servers. tsc clean + `npm run build` clean
  (`/switchboard` prerenders static). _(branch `switchboard`)_ Remaining
  inline cross-links from home/`/developers`/`/docs` body copy = optional
  polish (deferred; nav tab is sitewide and covers discovery).
- [x] **D2. Live "engine at work" strip** — `components/SwitchboardLive.tsx`
  fetches `/api/activity` and renders the 8 most-recent SETTLED routes (service ·
  account · amount · time · Basescan `tx ↗`) under a "$X settled · N routed
  calls" header. Renders nothing if the feed is empty (honesty bar — no zeros).
  Verified live: 8 real rows, $0.32 / 56 calls. tsc + build clean.
  _(branch `switchboard`)_
- [x] **D3. "Try a route" inline demo (safe slice)** — `/api/route/preview`
  (DB-only) groups every plannable catalog route by category, picks the
  **cheapest PROVEN route** (settled-count > 0; falls back to cheapest only if
  none proven — so the demo never "picks" a probe-dead route like jeetscreener),
  and reports the saving vs the priciest. `components/SwitchboardTry.tsx` =
  category chips → ranked candidate list with proven badges + the PICK. Verified
  live (7 categories, Data→Yeetful·Snapshot ✓18 over untested $0.001 routes;
  chip switching works). tsc + build clean. _(branch `switchboard`)_
  → **OWNER FOLLOW-UP (flagged, not built):** the live English→endpoint match
  needs the planner's house-paid inference; exposing that on a public unpaid
  endpoint needs a rate-limit + cost model decision.
- [x] **D4. Switchboard docs page** — `/docs/switchboard` registered in
  `lib/docs.ts` (flagship slot #2) + `app/docs/switchboard/page.tsx`: 7 sections
  (front door · how it weighs routes · the pick · over-cap drop · receipts ·
  preview-the-lever · what the engine is). SEO complete (canonical/OG/JSON-LD
  via the registry helpers), entity-space swept clean. Sidebar/landing/sitemap
  auto-picked it up. tsc + build clean (static prerender). _(branch `switchboard`)_

## B — Trust (believe the pick + the receipt)
- ⛔ **B1. Probe-gated callable surface** — **BLOCKED on this branch (flagged
  14:45).** HANDOFF-P1 #5's probe infra is NOT here: no `npm run probe:callable`
  script, no `probeOk`/`probedAt` field, no dead-route list (it lives in a
  parallel worktree — `website-autopilot-c`/`website-snapshot-redesign`). Won't
  hardcode "jeetscreener/dtelecom are dead" without probe data on THIS branch,
  and won't build a network probe autonomously. **Owner: merge the probe branch,
  or say which routes to denylist.** Mitigation already in place: the Switchboard
  preview proven-gate means a dead route can never be *picked* (only listed as
  "untested"). _(deferred)_
- [x] **B0. Regression coverage for the engine** _(done 14:45, unplanned but
  on-convention — the literal "bulletproof")_ — extended the standing
  `npm run test:api` harness with a `switchboard route preview` section: contract
  shape, the $0.05 ceiling, every candidate price in (0,cap], pick∈candidates,
  and the **proven-gate invariant** (pick = cheapest proven route). 6 new checks,
  116/0 green. _(branch `switchboard`, `scripts/test-api.ts`)_
- [ ] **B2. "Proven" badge** — surface each route's settled count (from
  `spend_ledger.ok=true`) in the directory + Switchboard demo, so users see
  which routes are battle-tested. (Engine already reads this for ranking, #160.)
- [x] **B3. Receipt → Basescan — VERIFIED (no change needed)** —
  `components/MessageReceipts.tsx:62-72` already links every `txHash` →
  `basescan.org/tx/…`, shared by live `/chat` and read-only `/p/[slug]`; denials
  render an "approve →" link instead. The `test:api` harness already covers the
  Message.meta receipt round-trip + share-page render (in the 116/0). Witnessed
  end-to-end. _(verified 14:53)_
- [x] **B-mobile. Switchboard surface at 375px — VERIFIED** — rect-scan shows
  zero horizontal overflow; chips wrap, `.swtry`/`.swlive` rows collapse per
  their `@media(max-width:720px)` rules. Looks right. _(verified 14:53)_
- [x] **S1. Switchboard page SEO** — extracted the interactive hero into client
  `components/SwitchboardHero.tsx`; rewrote `app/switchboard/page.tsx` as a
  SERVER component exporting `metadata` (title/description/canonical/OG/Twitter)
  + WebPage & Service JSON-LD. Verified in-page: title, description, canonical
  `yeetful.com/switchboard`, og:title, twitter:card, JSON-LD all present; hero
  animation unchanged. tsc + build clean (still static prerender). _(branch
  `switchboard`)_
- [x] **S2. OG image for /switchboard** — `app/switchboard/opengraph-image.tsx`
  (next/og, 1200×630, dark hero palette + emerald glow, "Ask in plain English /
  We patch the call" + yeetful.com/switchboard). Next auto-wired `og:image` +
  `twitter:image` + `og:image:alt` into the page head. Rendered + eyeballed
  (fixed a Satori whitespace-collapse on the headline). tsc + build clean
  (static prerender). _(branch `switchboard`)_
- [x] **S3. SEO finish** — `/switchboard` was MISSING from `sitemap.ts` → added
  (priority 0.9, weekly). Added a `test:api` "switchboard SEO" section: canonical
  → /switchboard, og:image present, descriptive `<title>`, sitemap lists it.
  4 new checks, **120/0** green. tsc + build clean. _(branch `switchboard`)_
- [x] **S4. Discovery cross-links** — added a `/switchboard` biglink (prominent
  first slot) to the `/developers` "see also" row ("watch the router pick the
  best-priced MCP, live"). `/docs` landing already cross-links the Switchboard
  docs page via the registry card (→ which links the product page), so the
  `/docs → /docs/switchboard → /switchboard` path exists. Left the owner's home
  hero (#93) + docs lead prose untouched (deliberate). tsc + build clean.
  _(branch `switchboard`)_
- ⚠️ **B2. "Proven" badge in the MAIN directory** — touches the owner-designed
  `McpServerCard`/`ServerDirectory` (visual regression risk on a core surface).
  The proven badge already ships on the Switchboard "try a route" panel; the
  remaining value is the main catalog. FLAGGED for owner sign-off on the card
  design before I edit it; the safe data plumbing (a proven-counts source) I can
  prep on request.
- [ ] **B4. "Why this route" in the receipt** — extend the chat receipt to show
  price vs the runner-up + `saved` (the Switchboard value prop, per call).

## A — Engine quality (it picks the RIGHT route) — from HANDOFF-P1-engine.md
- [ ] **A1. Latency capture** → additive `spend_ledger.latencyMs`; record
  wall-time around `paidCall`. The missing raw signal + needed for demotion (A3).
  (HANDOFF-P1 #3 — small, additive; touches the hot file, smallest slice.)
- [ ] **A2. Failure/denial split** — distinguish a real call FAILURE from a
  POLICY DENIAL on the ledger (today `ok=false` conflates them). Add a `kind`
  enum/column. Unblocks honest demotion. (HANDOFF-P1 #4 blocker.)
- [ ] **A3. Demote flaky routes** — planner ranking down-weights endpoints with a
  bad failure rate (needs A1 + A2); keep the cold-start guard. (HANDOFF-P1 #4.)
- [ ] **A4. Retry / fallback** — on build-error or failed `paidCall`, fall back
  to the next-best endpoint of the SAME service (lift the 1/service cap on
  failure only). (HANDOFF-P1 #6.)
- [ ] **A5. Live-402 price re-check** — enforce the ≤$0.05 ceiling (and the
  wallet plan-time amount) against the LIVE 402 challenge, not the stale catalog
  price. Prevents overpaying a route that raised its price. (HANDOFF-P1 #7.)
- [ ] **A6. Plan caching** — memoize plans on (normalized intent, endpoint-id
  set) with a short TTL to amortize the house planner tax. (HANDOFF-P1 #8.)

## C — Reach (more questions actually route) — the breadth bottleneck
- [ ] **C1. Grow param-schema coverage** — 85% of endpoints have
  `parameters=NULL` → display-only. Infer schemas from descriptions/OpenAPI at
  ingest so more services become plannable. The true reach lever. (HANDOFF-P1 #9.)
- [ ] **C2. Wire more callable services** — 26 of 73 are visible-callable; raise
  it by confirming + flagging planner-ready services (coordinate with B1 probe).

---

## ⏹ LOOP STOPPED 2026-06-20 15:21 (early, by design)
Shipped the whole **Surface (D0–D4)** + **SEO (S1–S4)** tracks, regression
**tests (B0)**, and verified **B3 + mobile**. The safe, cleanly-isolated queue
is done. Everything left needs OWNER REVIEW (don't auto-build):
- **B1** — BLOCKED: probe infra not on this branch (merge it or give a denylist).
- **B2 / B4** — owner-core: the directory card design (B2) + the hot
  `chat/route.ts` receipt path (B4). Flagged.
- **A1–A6** — engine internals, all touch `chat/route.ts` (a parallel process
  coordinates there) and/or the ledger schema. A1 (latency, additive) is the
  smallest; do it WITH the owner so it doesn't collide with the parallel branch.
- **C1 / C2** — catalog breadth (param-schema coverage at ingest); the true
  reach lever, but it's an ingest/data project, not a website tick.
Branch `switchboard` off `main`; NOT merged (owner reviews). `earn-side` and its
uncommitted files untouched throughout.

## Run log
> Autonomous loop started 2026-06-20 ~14:13. **Owner EXTENDED 14:32 → new target
> stop ~16:32 (2 more hours).** Each wakeup: pick next unchecked, branch,
> implement, verify, check box, log. Work the SAFE items (D/B + additive A1)
> autonomously; FLAG (don't charge into) hot-file/schema-heavy A3–A6 + C1 for
> owner review. Stop early + report if the safe queue runs dry before 16:32.
- **2026-06-20 15:21** — S4 done: `/switchboard` biglink on `/developers`. tsc +
  build clean. **Loop STOPPED early** — safe queue exhausted, rest is owner-review.
- **2026-06-20 15:15** — S3 done: added `/switchboard` to the sitemap (was
  missing) + 4 SEO regression checks in `test:api` (120/0). tsc + build clean.
  Next: S4 (discovery cross-links) — the LAST planned safe tick, then STOP early
  + consolidated report (remaining queue is all owner-review).
- **2026-06-20 15:08** — S2 done: branded OG image (`opengraph-image.tsx`),
  auto-wired into the page head. tsc + build clean. Next: S3 (sitemap + SEO
  regression test). NOTE: cleanly-isolated queue is winding down to small SEO/
  polish items; the big remaining items (A-group engine, C breadth, owner-core
  B2/B4) all need owner review. Plan: finish S3 + maybe cross-links, then STOP
  EARLY with a consolidated report rather than padding to 16:32.
- **2026-06-20 15:01** — S1 done: `/switchboard` now a server component with
  metadata + JSON-LD (client hero extracted to `SwitchboardHero.tsx`). All meta
  verified in-page; tsc + build clean. Next: S2 (OG image). B2 reclassified as
  owner-core (flagged).
- **2026-06-20 14:53** — B3 VERIFIED (receipts already link Basescan in
  `/chat`+`/p`, no change) + mobile 375px VERIFIED (no overflow). Found a real
  SEO gap → queued S1 (flagship `/switchboard` page is `'use client'` → no
  metadata). Next: S1 (server-component metadata + JSON-LD; extract client hero).
- **2026-06-20 14:45** — B1 BLOCKED (probe infra not on this branch — flagged
  for owner). Pivoted to B0: extended `test:api` with a switchboard route-preview
  section (6 checks incl. the proven-gate invariant), 116/0 green. tsc clean.
  Next: B3 (verify Basescan receipts end-to-end) + a mobile (375px) glance at
  the new Switchboard surface.
- **2026-06-20 14:40** — D4 done: `/docs/switchboard` registered + written (7
  sections, SEO complete, sidebar auto-wired). tsc + build clean. **All Surface
  (D) items done.** Next: Trust track — B1 (probe-gate dead routes off the
  callable surface). NOTE: the Switchboard preview already never *picks* a dead
  route (proven-gate), so B1's value is mainly the main directory surface.
- **2026-06-20 14:31** — D3 done (safe slice): `/api/route/preview` +
  `SwitchboardTry.tsx` interactive route preview (cheapest-proven pick, proven
  badges, no LLM spend). tsc + build clean. Live-LLM pick flagged for owner.
  Next: D4 (Switchboard docs page off `lib/docs.ts`).
- **2026-06-20 14:20** — D2 done: `SwitchboardLive.tsx` live strip wired to real
  `/api/activity` (8 settled routes + Basescan links, honest empty-state).
  tsc + build clean. Next: D3 SAFE SLICE — DB-only price/proven candidate
  preview (no LLM spend; live-LLM pick flagged for owner cost decision).
- **2026-06-20 14:13** — D1 done: `Switchboard` nav tab (`Navigation.tsx`).
  tsc + full `npm run build` clean. Next: D2 (live engine-at-work strip).
- **2026-06-20** — D0 shipped: Switchboard named + hero built
  (`SwitchboardWeb.tsx`, `app/switchboard/page.tsx`, `sw-*` CSS). tsc clean,
  verified in preview at 800px + 1440px (HUD decision log reads
  request→weigh→pick→saved). Branch `switchboard`. Queue seeded for the loop.
