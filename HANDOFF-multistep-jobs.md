# HANDOFF — Multi-step jobs (the orchestration primitive)

The product gap named on 2026-07-13: a user should be able to type

> "take $30 of my Base USDC, put $25 on Hyperliquid, long ETH, and protect it
> with a 5% stop"

and watch one card execute the whole chain. Today the chat can build each leg
(NEAR Intents swap; the HL deposit + orders + guardian arming shipped on
`hl-execution-layer`), but nothing chains them: every leg needs the user to
come back, and nothing survives the minutes-long settlement waits between
legs. This doc specs the missing primitive. It was written immediately after
running the chain BY HAND (agent-driving-agents for the guardian drill), so
the pain points are fresh, not hypothetical.

## What a job is

A **job** is a persisted, resumable sequence of steps across venues, where
each step is one of exactly three kinds:

1. **sign** — a guarded artifact the USER's wallet signs (SendTx, HL L1
   action, EIP-712 order). The job pauses until signed; the existing cards
   render inside the job card.
2. **wait** — a settlement watch with a deterministic completion predicate
   (1Click status = SUCCESS; Arbitrum USDC balance ≥ X; HL clearinghouse
   credited; order oid terminal). Waits are polled by the runner, never by
   the browser.
3. **auto** — a server-side action under an existing delegation/policy
   (guardian arm, agent-key order, x402 paid call). Only allowed when a
   consent artifact already covers it (approveAgent, spend grant, embed key
   credit) — a job NEVER widens authority; it only sequences it.

The plan of steps is FIXED at job creation (deterministically parsed/built,
planner may only fill the same params a single-turn ask could) — the runner
executes and re-guards; it never re-plans. A failed step fails the job
(with refunds surfaced), it doesn't improvise an alternative route.

## Why this is the moat compounding

Each leg already has the Yeetful discipline (deterministic build, fail-closed
guard, receipt + valueUsd). The job primitive multiplies it: N guarded legs
with ONE intent, per-step receipts rolling into one job receipt, and the kill
switch pausing the whole pipeline. Nobody else has safe multi-venue jobs
because nobody else has the per-leg trust layer to compose.

## Data model (additive)

```
jobs:       id, wallet, title, source ('chat'|'api'), status
            (draft|running|waiting_signature|waiting_settlement|done|failed|paused),
            current_step, created_at, updated_at
job_steps:  id, job_id, seq, kind ('sign'|'wait'|'auto'), status
            (pending|offered|signed|running|done|failed|skipped),
            builder (build_path-style attribution, e.g. 'native-cross-chain'),
            params jsonb (the FIXED build inputs), artifact jsonb (built at
            offer-time, rebuilt fresh if stale), guard_report jsonb,
            result jsonb (tx hash / fill / settlement proof), value_usd,
            wait_predicate jsonb (kind + args + timeout + poll_interval),
            expires_at
```

Receipts stay per-step (the artifact/guard/result triple mirrors
hl_guardian_runs); the job row is the rollup.

## Runner

Reuse the guardian pattern exactly (it is the proto-runner):
- `app/api/cron/jobs` every minute + an SSE/poll endpoint the job card uses
  for live progress. Per-tick: for each running job, advance ONLY the
  current step. `wait` steps: evaluate the predicate; timeout → fail with
  refund guidance. `auto` steps: re-check the covering consent + kill switch,
  build → guard → execute → receipt. `sign` steps: (re)build the artifact
  fresh when offered (the tx/refresh pattern), mark `waiting_signature`; the
  chat/dashboard card holds the sign button; the signed submit posts back to
  the step, which re-guards at submit exactly like /api/hl/submit.
- Atomic step-claim (`UPDATE … WHERE status='pending' RETURNING`) — the
  guardian's single-fire lesson.
- Kill switch: spend_grants.paused pauses every job for the wallet mid-flight.
- Tracing: one turnId per job, negative-seq lines per step — /activity shows
  jobs breathing.

## Chat surface

- Parse: compound asks split on connectors ("then", "and then", "→", ";").
  v1 recognizes chains of the EXISTING native parses only — cross-chain swap,
  HL deposit, HL order, guardian arm — with $-amount flow-through ("put $25
  of THAT on hyperliquid" binds to the prior step's output minus fees,
  resolved at wait-completion time, floored by the step's `minimum`).
- One **JobCard**: step list with live states, the current sign button
  embedded, per-step receipts, value_usd rollup, pause/cancel. The
  self-advancing SendTxChain is the visual precedent; jobs generalize it
  across venues + waits + server-side steps.
- Telemetry: embed_turns outcome 'job-built' / per-step 'signed' beacons with
  the step's builder as build_path (funnel: where do jobs die?).

## Signer model per step

| step | signer | consent |
|---|---|---|
| 1Click deposit (EVM transfer) | user wallet | the signature |
| HL bridge deposit | user wallet | the signature |
| HL order | user wallet (L1 action) | the signature |
| guardian arm | none (DB) | active approveAgent delegation |
| guardian close (later fires) | delegated agent key | approveAgent + policy |
| x402 paid call | burner / spend permission | spend grant |

The three-signature version of the canonical job is v1. The ZERO-mid-job-
signature version (session keys / spend permissions covering the EVM legs +
an HL agent key covering orders) is v2 — that's the "expense account"
keystone finally meeting the job runner: sign once at job creation,
everything else executes under bounded delegations.

## Canonical job (acceptance test)

`bridge $25 USDC Base→Arbitrum → wait SUCCESS → deposit to HL Bridge2 →
wait clearinghouse credit → long $12 ETH IOC → arm 5% guardian stop`.
Done when: one chat ask produces one card; three signatures total; job
completes hands-off between signatures; every step shows its guard report;
money-moved sums the legs; killing the switch mid-job freezes it.

## Prerequisite fixes (found running the chain by hand, 2026-07-13)

1. **Guardian sweep env fence** (bug, ship before any wider guardian use):
   local + prod share one Neon DB, so the prod cron sweeps rows created by a
   testnet/local env. The sweep must (a) filter policies to delegations whose
   `hl_chain` matches ITS env, and (b) treat `decryptAgentKey` failure as
   "not my row — skip silently", never `status='error'` (cross-env
   GUARDIAN_KEY_SECRETs differ by design).
2. **1Click amount minimums/fee curve surfaced in build_swap** — sub-$5 legs
   quote badly; the job planner needs the venue's floor to refuse at parse
   time (learned pricing the $3 gas leg).
3. **Faucet/testnet reality**: HL testnet faucet requires mainnet existence —
   testnet drills need a mainnet-touched wallet. Document in the drill
   runbook; don't burn time rediscovering.

## Not in scope (deliberately)

Re-planning failed jobs, cross-user jobs, parallel step DAGs (v1 is a strict
sequence), Telegram surface (rides on the same job API later), x402-priced
job execution (natural fit — each auto step can be a paid call — but only
after v1 proves the runner).
