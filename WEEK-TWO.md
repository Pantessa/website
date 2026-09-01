# WEEK-TWO.md — after the ten strangers

*Ideation lane, overnight 2026-09-01. What happens after the ten-strangers
drill (H1 + the first watched hires). The ROSTER-MEMO discipline: named
metrics, committed branches, no hedging. Assumes flip-day ran per
FLIP-DAY.md and FIRST-HIRE-PREMORTEM.md's top modes were closed
(cron/runbook, /roster door, decline verb — the decline verb and the
storefront are merged; the cron is runbook-covered).*

## §1 The metric that decides the homepage

The memo's tripwires decide the FLIP (either fires):
- **T-demand:** one stranger signs twice (any two signed proposals or
  turns, non-internal, real origin — the first "returned" row ever).
- **T-supply:** one external agent gets one real non-house hire.

Week two decides whether the flip STICKS. One number:

> **R2 = returned signers / first-time signers, measured 14 days from
> flip-day** — a "returned signer" is a non-internal wallet with signed
> events on two distinct days.

**Commitments:** R2 ≥ 0.3 with ≥10 first-time signers → the Roster
homepage stays and week three is scale (more managers, more mandate
kinds). R2 < 0.3 → the homepage REVERTS to the current front (one env
var — that is why Visuals built it as a variant) and we go to the
branches in §3. No third outcome, no "let's give it another week": the
14-day read is the read. Instrument: the strangers arc (lib/gtm-arc) +
`digest:gtm`, which already computes returned — quote only stamped-clean
numbers.

## §2 What the squad builds in week two vs what waits

**Build (all serve the metric):**
1. `/api/cron/roster` — the manager heartbeat (premortem #1's real fix;
   the runbook's hand-run does not survive week two).
2. Mail (THE WEEK item 5, owner) + the period-due nudge — the ONLY
   product change that directly moves R2 (a proposal nobody sees cannot
   be signed twice). Until mail: the operator DM stays the push.
3. Payday v0 (the batch view + due chip — ROSTER-STRATEGY M7) — the
   return RITUAL the nudge points at.
4. Grammar-gap drain from the week-one ask_failures 'roster' rows (the
   #540 workflow on the new kind — UI/UX's observability landed; now
   use it).
5. Founding-manager integrations 4–10 off the template + contract (QA's
   template makes each one ~an hour).

**Waits (explicitly, regardless of excitement):** tryouts unlock for
protect/yield (needs the marks copy contract), Season 1 (dual tripwire
in ROSTER-TRYOUTS-SPEC §2.5), x402 desk pricing (M6 rake — price
nothing until something is worth paying for), Circles (dead), any new
mandate kind, any new venue/MCP, the Allowance.

## §3 The three failure branches — committed pivots

**F1 — Nobody signs** (ten drills, zero or one signature; R2 moot).
The constraint was never product and is not the Roster: ten watched
humans with a founder on the call could not be gotten through a $20
swap. That falsifies the hand-recruit pool or the trust story, not the
mechanics. **Committed pivot:** stop ALL consumer surface work; the
company goes to gtm-bulletproof §5 Path B — the guard/record rail as
infrastructure for agent builders (publish @pantessa/guard, the desk +
records as the product, B1/B2 outreach off the 08-18 target list); the
Roster remains the reference app and the demo, not the company. The
homepage reverts and stays reverted until a BUILDER brings the first
real users.

**F2 — They sign once and never return** (first signatures land; R2 <
0.3). The door works; the ritual doesn't exist. This is the EXPECTED
failure (no push, no mail, no habit anchor — premortem #8). **Committed
pivot:** week three is retention-only — mail + nudge + Payday shipped
and re-drilled on the SAME ten people (they signed once; they are the
warmest pool on earth). No new acquisition until R2 is re-read on them.
If R2 still < 0.3 with push in place, the mandate cadence is wrong for
the audience — fall to F1's branch.

**F3 — An agent integrates but gets no hires** (template cloned, real
external manager courting listings; zero non-house hires). Supply
showed up before demand — the marketplace claim works but consumers
don't. **Committed pivot:** invert the sell: the integrated agent's
BUILDER becomes the distribution (their audience hires their manager —
the staffed-receipt loop's builder edge); Pantessa's job becomes
builder enablement (records, webhook, quickstart, kickbacks at the
founding 70%), and consumer marketing stops. The homepage flips to the
builder story ("Give your agent a desk"), not back to the generic
front. T-supply firing without T-demand is a WIN for the desk company
— say so and steer into it.

**If two branches fire at once:** F1 beats F3 beats F2 (deeper
falsification wins the pivot).

## §4 One-line summary

Week two exists to turn one signature into a second one; everything we
build serves R2, everything else waits, and each way it fails already
has its pivot written down.
