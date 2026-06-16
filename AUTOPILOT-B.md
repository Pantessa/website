# AUTOPILOT-B — Lane B queue (CEO adoption dashboard + website optimization)

Second autonomous lane, isolated in its own git worktree so it never collides
with Lane A (the in-chat transaction UI on `snapshot-vote-ui` / `autopilot`).

- **Branch:** `autopilot-b` (off `main` @ 7601ee7)
- **Worktree:** `/Users/nategeier/yeetful/website-autopilot-b`
  (`node_modules` + `.env.local` symlinked from the main checkout — builds/runs standalone)
- **Verify like the other lanes:** `npx tsc --noEmit`, `npm run build`,
  `npm run test:api` against `next start` (own port, e.g. 3211 — NOT :3000, that's
  the owner's dev server / Lane A). One PR per item, base `main`.

---

## Theme 1 — Admin/CEO adoption dashboard (PRIMARY)

A private, server-gated view that answers one question: **is Yeetful being
adopted, and by whom?** Visible only to the two owner/admin wallets:

- `0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0`
- `0x66268791B55e1F5fA585D990326519F101407257`  (also the x402 PAYMENT_ADDRESS)

### Data reality (Neon `yeetful`, measured 2026-06-16)
No `users` table — **a "user" = a distinct `owner_address`** appearing across
`chats`, `spend_grants` (excl. `org:%`), `api_keys`, `agent_approvals`,
`org_members`. **First-seen = MIN(created_at)** for that address across those
tables. Current totals: 4 distinct wallets · 21 chats · 44 messages · 24 ledger
rows (22 ok) · $0.152 settled · 3 api_keys · 1 org. Mostly owner testing today —
this dashboard is the **instrument we grow into**, so it must read cleanly at
n=4 and at n=10,000.

### Queue
- **B1 — Admin gate.** `lib/admin.ts`: `isAdminAddress(addr)` = lowercased union
  of `ADMIN_WALLETS` env ∪ the two hardcoded owner wallets (so it works even if
  the env is unset on Vercel). Server-checked in every admin route via
  `getAuthAddress()` (SIWE session or Bearer) → 403 if not admin. Sidebar
  "Admin" tab + `/dashboard/admin` render-gate mirror it client-side (UX only;
  the API is the real gate).
- **B2 — `GET /api/admin/overview`.** One server-only aggregation endpoint
  (admin-gated). Returns the funnel, tiles, time series, roster, revenue, orgs.
  All math in SQL; no PII beyond on-chain addresses (already public).
- **B3 — `/dashboard/admin` page.** The CEO view (Recharts, mobile-first per the
  Run-6/7 grid rules: base `grid-cols-1` + `min-w-0`). Sections below.
- **B4 — Sidebar wiring.** Add an "Admin" item to `DashboardSidebar`, shown only
  when the connected address is admin (client check + server-enforced).
- **B5 — test:api coverage.** Extend `scripts/test-api.ts`: `/api/admin/overview`
  returns 403 without an admin session, 200 with one; funnel numbers are
  internally consistent (connected ≥ signed-in ≥ activated ≥ paid ≥ repeat).

### What the CEO sees (sections)
1. **North-star tiles:** distinct connected wallets (all-time) · new wallets
   (7d, with WoW delta) · activated users (≥1 paid call) · settled USDC (real
   revenue proxy) · paid calls · decline rate (the "declines don't spend" thesis).
2. **Onboarding funnel** (the centerpiece): Connected → Signed-in (owns a chat)
   → Activated (minted an api_key OR approved an agent) → Paid (≥1 `ok` ledger
   row) → Repeat (≥2 paid calls), with absolute counts + step conversion %.
3. **New wallets over time:** daily/weekly first-seen, cumulative line.
4. **Engagement:** active wallets per day (DAU/WAU), chats/day, messages/day.
5. **Revenue:** settled USDC over time + by service (`service_name`/`host`),
   declines broken out (count + would-be $ blocked).
6. **Wallet roster table:** address · first seen · #chats · #keys · settled $ ·
   last active · org — sortable, the CEO scanning who's real vs. tire-kicker.
7. **Orgs & supply:** org count + members + org spend; callable-services count
   (catalog health) for context.

### Design notes / gotchas
- Reuse `lib/dashboard-ui.ts` (`short()`, tokens) + the existing dash CSS so it
  matches the rest of the dashboard; don't fork the design system.
- Read-only: NO mutations from this view. It's a mirror, not a control panel.
- Exclude `org:%` synthetic addresses from "wallet" counts (they're org scope
  keys, not people) — but DO surface them in the orgs section.
- Self/admin wallets should be countable but **flaggable** (a toggle to exclude
  the 2 owner wallets) so early owner-testing noise can be filtered from the
  real adoption picture.

## Theme 2 — Website optimization (SECONDARY, fill between B-items)
- O1 — Lighthouse/perf pass on `/` and `/dashboard` (LCP, CLS, unused JS).
- O2 — Image/font audit (Newsreader + Geist already; check no layout shift).
- O3 — `/api/activity` + dashboard query efficiency (indexes on `created_at`,
  `owner_address`; the admin aggregations should stay sub-100ms at scale).
- O4 — Metadata/SEO sweep parity with the `/docs` + `/blog` standard.
(Optimization items are opportunistic — only ship with before/after proof.)

## Coordination with Lane A
- Lane A owns: `app/api/chat/route.ts`, `components/ChatInterface.tsx`,
  `components/SignVoteButton.tsx`, `lib/snapshot-vote.ts`, `app/api/snapshot/*`.
- Lane B owns: `app/dashboard/admin/*`, `app/api/admin/*`, `lib/admin.ts`,
  `components/DashboardSidebar.tsx` (additive line only), `scripts/test-api.ts`
  (additive checks). Minimal overlap surface → clean merges.
