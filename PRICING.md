# Pricing decision note — price the autonomy layer

*2026-07-20, written under the full-tilt mandate ("business model may be
adjusted… document the change in a PRICING.md decision note"). Status:
DECIDED (copy re-anchor shipped in this PR) + QUEUED (enforcement follow-up).*

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
