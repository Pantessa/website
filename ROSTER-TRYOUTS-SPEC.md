# ROSTER-TRYOUTS-SPEC.md — M6 forward-paper tryouts + Season 0 at n≈0

*Ideation lane, wave 2 (2026-08-26, off main 1030be9). Buildable specs — a
code lane should need zero judgment calls. Both live inside the judge
kills of ROSTER-STRATEGY.md §1: no backtests, no "would have made $X"
(labeled or not), no returns ranks, no /league surface. Grounded in the
merged code: `parseMandate`/canonical recompose (lib/roster.ts),
`decideProposalGate` fail-closed pricing (lib/roster-propose.ts),
`SEASON_LABEL`/`qualifiesForBoard` (lib/league.ts), the DCA periodKey
uniqueness pattern, and the roster-policy rate fences.*

---

## §1 M6 — forward-paper tryouts, buildable spec

### 1.1 Principles (each enforced by construction, not by copy)

1. **Forward-only.** A tryout starts NOW and looks only forward. Nothing
   reads a price older than the tryout's own rows (no historical rail
   exists; none is introduced).
2. **PAPER is structural, not a flag on a real thing.** Tryout proposals
   are rows in their own table ONLY. They are never `intent_links`, never
   `broker_intents`, never inbox items, never `embed_turns`. There is no
   artifact to sign because no artifact is ever built — a mark stores
   quote NUMBERS, never calldata. `notifyEligible` has nothing to fire
   because no addressed intent exists. Record/standings queries never
   join these tables.
3. **Two quotes, zero arithmetic.** A mark = the venue quote at proposal
   time; review adds the venue quote at review time. The product may
   display both numbers side by side. It may NEVER compute across them —
   no delta, no percent, no dollar gain, no extrapolation. (The
   regulatory line, ROSTER-STRATEGY.md §5: descriptive facts survive;
   counterfactual dollars do not, labeled or not.)
4. **Same pipes as real.** Quotes come from the SAME read-only venue
   quote path the mandate's executor would use at real build time
   (QuoterV2 staticcall / CoW quote / HL mark — the build-path quote
   fns, NOT `chartPairFor`, which nulls stocks/stables). A pair the real
   executor would refuse (unknown ticker, gated pool — the #429
   discipline) refuses a mark by name.
5. **Fail-closed pricing.** An unpriceable proposal never produces a
   mark (the `decideProposalGate` discipline, reused).

### 1.2 Schema (additive DDL)

```
roster_tryouts
  id             text pk
  wallet         text      -- the owner; connect-to-act reads (rule 6)
  agent_key_hash text      -- M4 identity; bonded, never the raw key
  mandate_text   text      -- CANONICAL recompose from parseMandate (T2)
  mandate_kind   text      -- 'shape'|'dca'|'protect'|'yield'
  mandate_hash   text      -- sha256(canonical)[:16]
  cap_usd        numeric   -- mirrored from the would-be slot; caps marks too
  status         text      -- 'running'|'reviewed'|'retired'  (append-only; no delete)
  started_at     timestamptz
  review_at      timestamptz  -- FIXED AT CREATION = started_at + 7 days, immutable
  reviewed_at    timestamptz null  -- actual capture moment (shown on the card)
  is_internal    boolean default false
  created_at     timestamptz

roster_tryout_marks
  id               text pk
  tryout_id        text fk
  seq              int
  proposed_at      timestamptz
  ask_text         text   -- canonical proposal sentence (grammar round-trip required)
  venue            text   -- the executor's build_path venue label
  route_ref        text   -- pool/route id the quote came from (auditability)
  quote_at_propose jsonb  -- {pair, side, amountIn, quoteOut, unit} — server-computed
  quote_at_review  jsonb null  -- same shape, same fn, WRITE-ONCE at review
  period_key       text null   -- cadence dedupe (dca), unique(tryout_id, period_key)
  is_internal      boolean default false
```

`@@unique(tryout_id, period_key)` where period_key is non-null (the DCA
no-double-buys pattern).

### 1.3 Flow

- **Start:** owner (or an agent via the desk, addressed to an owner who
  accepts) creates a tryout: mandate_text must round-trip `parseMandate`
  or refuse by name; review_at stamped; quota checked (§1.5-3/4).
- **Marks:** the agent files paper proposals against the tryout. Server
  round-trips the ask, resolves the executor's venue, computes
  quote_at_propose server-side. Cap: a mark whose priced size exceeds
  cap_usd refuses by name (same copy as the real gate). Cadence quota
  (§1.5-4) enforced per mandate kind.
- **Review:** lazy due-detection (the DCA pattern — no new cron): the
  first authenticated read at ≥ review_at triggers the one-time
  quote_at_review capture for every mark (same venue fn), stamps
  reviewed_at, flips status to 'reviewed', and mints the report card as
  an inbox item for the owner wallet. Early review API calls refuse.
- **Promote:** the card's one CTA runs the NORMAL hire flow (fresh
  consent, server-minted nonce — CONTRACTS v1.2). Nothing transfers from
  the tryout; the tryout flips to 'retired' (row kept).

### 1.4 Report card — exact copy contract (pin this)

Header label, every surface (card, inbox item, OG), verbatim:

> **Paper tryout — simulated proposals; no transactions occurred.
> Hypothetical activity, not a prediction, not advice.**

Body, facts only:

> Tryout: "<mandate_text>" · <started_at>–<review_at>
> <N> paper proposals. This agent has run <K> tryouts of this mandate
> kind in the last 90 days (all shown on your tryouts page).
> #<seq> — proposed "<ask_text>" on <date> · venue: <venue>
>   quote then: <quote_at_propose rendered> · quote at review: <quote_at_review rendered>
>   (review captured <reviewed_at>)

**Banned in render, enforced by a test-api pin on the copy function:**
any arithmetic across the two quotes; the strings "would have", "made",
"kept", "earned", "gained", "+$", "return", "profit", "%" applied to the
pair of quotes; any annualization. Drawdown/gain words never appear. The
OG template is separate from the record OG (never blend paper and signed
surfaces — security contract §5; data separation is §1.1-2).

### 1.5 The five gaming vectors, each closed by a rule

| # | Vector | Closing rule |
|---|---|---|
| 1 | **Self-quoting** — agent supplies its own numbers | Quotes are computed server-side at write time by our venue quote fns; the agent payload contributes ONLY ask_text; quote-shaped fields in the payload are ignored (schema never accepts them) |
| 2 | **Cherry-picked review time** — review when it looks good | review_at fixed at creation (+7d exactly), immutable; quote_at_review is WRITE-ONCE at first read ≥ review_at; early-review refuses; a late capture is visible ("review captured <ts>" on the card) |
| 3 | **Survivorship** — run 20, show the 1 winner | Append-only (no delete API; 'retired' keeps the row); the card always states K = total tryouts of that kind in 90d; the owner page lists ALL; concurrent cap: ≤3 running tryouts per agent per mandate kind (roster-policy quota pattern) |
| 4 | **Lottery-ticket mark spam** — many marks, variance wins | Marks capped by the mandate's OWN cadence: dca ≤1 per UTC period (period_key unique); shape/protect/yield ≤1/day per tryout (rate-fence constant in roster-policy); over-quota refuses by name |
| 5 | **Quote-source gaming** — thin/gated pools the agent can nudge | Marks only price what the REAL executor would trade: grammar round-trip first, venue resolved by the executor's own cascade, gated/unknown refuses (#429); route_ref stored so any reviewer can audit the pool; is_internal stamps our drills out of every read |

Tryouts never touch records: `qualifiesForBoard` and every M4 record
query read signed turns only — a thousand perfect tryouts move nothing
public. (That asymmetry is the point: paper buys an inbox moment, only
signatures buy reputation.)

---

## §2 Season 0 — standings mechanics at n≈0

Merged reality: `SEASON_LABEL = 'Season 0 — preseason'`,
`qualifiesForBoard = signedTurns > 0`, drawdown column null until real
marks. This section specifies behavior at 0, 1–3, and ≥5 qualified
agents so the board is honest and never pathetic.

### 2.1 Minimum bar (unchanged, restated as the rule)

An agent appears on `/agents` standings only with **≥1 real human-signed
turn** (`REAL_TRAFFIC`, is_internal excluded). Below the bar the agent's
own `/agents/<handle>` page still exists by direct link, wearing the
honest empty record state. Tryouts never qualify anyone (§1.5).

### 2.2 The board at 0 qualified agents — the empty state is the pitch

No placeholder rows, no grayed samples, no harness residue. Render the
narrative:

> **The standings are signatures.**
> No agent has earned a row yet. A row costs exactly one thing: a real
> person signing a real proposal. Records here are on-chain signatures —
> we can't fake them, and neither can anyone else.
> *Building an agent? Listing is open → /docs/roster*

(Emptiness framed as proof of the honesty rule, plus the supply CTA.
Never "be the first to invest", never returns bait.)

### 2.3 The board at 1–4 qualified agents — a roster, not a race

**Rank ordinals (#1/#2…) are suppressed below 5 qualified agents.** With
two agents a volume rank is a coin-flip advertisement and maximizes
wash-volume incentive at exactly the moment sybil pressure is highest.
Below threshold the board is headed **"The opening roster"** and rows
order by **tenure (first real signature, ascending)** — stable, and
un-gameable by spending money. Each row shows the fact tiles only:
distinct real employers · signed proposals · tenure · cap breaches
(0 is the badge). No points, no drawdown (null until real marks), no
"leader".

### 2.4 Ordinals and tie-breaks (≥5 qualified agents)

Order by, in sequence: (1) distinct real fee-paying employer wallets
desc; (2) signed proposals desc; (3) zero cap breaches before any
breach; (4) tenure asc (earlier first signature wins — longer proven);
(5) handle-hash lexicographic as the final total order (deterministic,
no render flicker). Never by volume USD alone (whale-wash resistant),
never by returns (killed).

### 2.5 When Season 1 starts

Season 0 (preseason) has no scheduled end — "preseason lasts as long as
it lasts" is the honest line. **Season 1 begins on the first UTC Monday
after BOTH:** (a) ≥5 qualified agents, and (b) ≥1 external agent with a
real non-house hire (the memo's supply tripwire). Seasons thereafter are
90-day windows. **Season boundaries delete nothing** — the lifetime
record is permanent; a season is a windowed read of the same fact
columns. Season 0's board reads lifetime numbers by definition.

### 2.6 Copy fences (pin alongside the board)

Banned on any standings surface: "top performer", "best", "beat",
"returns", "APY", any dollar-gain figure, any projection. Required:
the standings header carries "real signed history — never projections"
and (post-Season-0) "past activity, not a promise" (GTM's stricter
phrasing governs). `SEASON_LABEL` stays the single source.
