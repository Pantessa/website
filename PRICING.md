# Pricing decision note — price the autonomy layer

*2026-07-20, written under the full-tilt mandate ("business model may be
adjusted… document the change in a PRICING.md decision note"). Status:
DECIDED (copy re-anchor shipped in this PR) + QUEUED (enforcement follow-up).*

## Addendum 2026-07-21 — COGS lock-in (Nate-directed)

The only real inference COGS is a chat turn (~$0.01–0.06). Watchers don't
burn inference: the guardian is a per-minute deterministic cron, DCA/jobs
compile without the model. So the exposure was the credit allowances, and
they're now sized so a maxed plan can never exceed its price in COGS:

| Plan | Was | Now | Grandfathered |
|---|---|---|---|
| Builder $0 | 2,500 | **250/mo** (+40/day cap) | n/a (no Stripe object) |
| Growth $99 | 25,000 | **8,000/mo** | pre-2026-07-21 subs keep 25k forever |
| Scale $499 | 150,000 | **40,000/mo** | pre-2026-07-21 subs keep 150k forever |

Enforced in lib/plans.ts `planCreditsFor` (keyed on subscription
createdAt). Stripe untouched — allowances aren't Stripe objects.

**Circuit breakers (lib/billing.ts — the "leave it open" guarantee):**
- `FREE_DAILY_TURN_CAP` (default 40/day/wallet, free tier only)
- `HOUSE_DAILY_TURN_CAP` (default 2,000/day across EVERYONE ≈ $60/day
  worst-case Anthropic bill; env-overridable, clamped)
Both refuse with honest per-gate copy; standing jobs/DCA/guardian are
never gated (they don't touch the model). Fail-open on store errors
(chat availability beats metering, unchanged).

**Queued for Nate on Stripe (owner step):** credit packs — $10 per 1,000
credits as a one-time price, so heavy chatters buy margin-priced
inference instead of hitting walls. Code hook lands when the product id
exists.

**B2C stays subscription-free:** DCA/jobs/guardian price via the 0.20%
flow fee (now on LiFi + Uniswap v3 + CoW, website#485) — a $100/week DCA
pays $0.20/week, no seat fee. Subscriptions are for embed hosts and
power autonomy (standing-intent capacity 3/25/unlimited).

**If a faster watcher ever ships** (1s–10s cadence): it's a compute SKU
($5–10/mo per protection or Scale-only), never inference-priced — the
tick loop must stay model-free.

## The decision

Keep the three plans and their prices — **Builder $0 / Growth $99 / Scale
$499**, the 0.20% flow fee, and credits as the meter for attended chat. Do
NOT touch the live Stripe products. What changes is **what the tiers are
FOR**: the differentiator moves from embed-site count + credit volume to
**standing-intent capacity** — how much of your money moves without you
watching.

| Plan | Standing intents (active jobs + DCA schedules + guardian protections) |
|---|---|
| Builder $0 | 3 |
| Growth $99 | 25 |
| Scale $499 | Unlimited |

Everything else (sites, credits, theming, orgs, SLA) stays as-is per tier.

## Why

- The strategic frame: the company is a take-rate on money that moves
  unattended. Standing intents are the retention engine; one-shot attended
  swaps are a commodity. Seats and credits price the commodity; capacity
  for standing intents prices the thing that recurs.
- Three free standing intents is deliberately generous enough for the aha
  (a DCA + a guardian stop + one job) and small enough that a working
  portfolio of automations is a paid behavior.
- The falsifiable link: the attended/standing scoreboard (website#478)
  shows whether standing money concentrates in accounts that would hit
  these caps. If the standing line grows and never touches a cap, the caps
  are wrong — revisit with data, not vibes.

## What ships when

1. **Now (this PR):** /pricing copy re-anchors on the autonomy layer
   (lib/plans.ts highlights). Advertising a limit before enforcing it harms
   nobody — free users get MORE than advertised until enforcement lands.
2. **Follow-up card (not today):** soft enforcement at creation time — the
   4th active standing intent on Builder gets a friendly upgrade chip, not
   a wall; nothing running ever pauses for plan reasons. Kill switches and
   safety gates are NEVER plan-gated.
3. **Never:** retro-limiting. Grandfathering rule: anything active at
   enforcement time stays active forever; caps gate NEW creations only;
   existing subscribers keep whichever terms are better.

## Explicitly not changed

- Stripe products/prices (no new objects, nobody re-checkouts, nobody
  strands — the handoff's hard rule).
- The 0.20% flow fee and its single source (lib/fees.ts).
- x402 paid doors: per-call packaging for agent customers, separate lane.
- Credits: still the attended-chat meter on every plan.

---

## Addendum 2026-07-21 — Intent links: the creator rail (Nate-approved)

Intent links (website#500/#503) get the third capacity axis and the first
revenue-share program. Decided in-session with Nate; shipped ledgered
(phase 1) in website#505's lane.

### The fee map (unchanged rule, now on the record)

**Charge on conversions, never on movements or inflows.** The fee is
earned when Yeetful's routing chose a price for you — one asset became
another through our venue cascade:

| Action | Fee |
|---|---|
| Swaps, tokenized-stock buys/sells, DCA runs | 0.20% (lib/fees.ts, unchanged) |
| NFT sales / listings / transfers | $0 forever (a sale is an inflow) |
| Sends, bridges, funding legs | $0 (taxing the fix kills the wedge) |
| Reads, asks, votes, staking | $0 |

### Creator fee-split

- **50% of the fee** (10bps of notional) accrues to the link's creator on
  fee-bearing conversions attributed to their link. Single source:
  lib/fees.ts `CREATOR_FEE_SPLIT` + `FEE_BEARING_BUILD_PATHS` (exactly the
  four native-swap-* paths — NFTs/transfers/bridges move $ through links
  but never earn).
- Sybil-proof by construction: creators earn a fraction of fees actually
  paid; self-referral is a self-discount, not a drain.
- **Phase 1 (live): ledgered.** Fees land in the treasury unchanged;
  earnings compute read-time from embed_turns (guardrail-priced, server
  side); claims open at $10, paid manually as USDC on Base.
- **Phase 2 (when payouts get frequent):** venue fee recipient becomes a
  per-creator deterministic split contract (0xSplits on Base/Eth/Arb;
  CREATE2-derived so the guard re-pins it; 4663 stays ledgered). No user
  ever signs an extra transaction in either phase.
- Disclosed on every creator-minted /i page: "The creator of this link
  earns half of Yeetful's 0.20% conversion fee."

### Active-link capacity (mirrors standing intents)

| | Builder $0 | Growth $99 | Scale $499 |
|---|---|---|---|
| Active intent links | 3 | 25 | Unlimited |

Soft at mint time (402 + upgrade pointer; revoke frees capacity); revoked
links keep their funnel + earnings history forever; nothing retro-limits.
Link visitors' auto-run turns bill the creator's credit allowance — the
embed-key contract in link form; the existing breakers bound the worst
case.

### Explicitly not changed (again)

- Stripe products/prices; credit allowances + breakers (#486 lock).
- The global money-moved metric stays guardrail-priced embed_turns —
  per-link client-reported funnel numbers never feed it.
