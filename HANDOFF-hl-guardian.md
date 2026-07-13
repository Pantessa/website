# HANDOFF — Hyperliquid Guardian Agent (autonomy without custody)

Mission brief for the first **autonomous loop** on Yeetful rails. Status: in
build on branch `hl-guardian-agent` (worktree `website-hl-agent`). This doc is
the design source; trim to match reality before PR.

## Why this exists (the aha)

Chat where you approve every signature is a nicer swap UI. The aha is watching
money move safely **while you're not there**. Hyperliquid is the fastest path
because delegation is native to the venue:

- The user signs **one** EIP-712 `approveAgent` action with their master
  wallet, authorizing a Yeetful-held **agent key**.
- The agent key can **trade** on the account but can **never withdraw** —
  withdrawals require the master key. Custody problem: solved by the venue.
- Delegation expires (≤180 days, we default much shorter) and is revocable
  on-venue at any time, independent of us.

On top of that we run the Yeetful trust stack: policy → deterministic build →
fail-closed guard → receipt (+valueUsd) → kill switch. The pitch line:
**"Give your agent a job, not your keys."**

## Product shape (v1)

One policy type done excellently: **position guardian** — stop-loss /
take-profit on an existing perp position.

User flow:
1. Connect wallet (SIWE session as today). We read their HL account via the
   public info API (positions, entryPx, liquidationPx, uPnL).
2. Pick a position (e.g. SYRUP long 3x) → set policy: "close if drawdown ≥
   10% from entry" and/or "take profit at +25%", optional hard price floor.
3. Sign `approveAgent` (EIP-712, HyperliquidSignTransaction domain) approving
   a per-user agent address we generate and hold. The signature IS the
   consent artifact — no extra confirm dialogs.
4. Guardian loop (cron) evaluates every policy on an interval. When a
   trigger fires, it places a **reduce-only IOC/trigger order** built
   deterministically from the pinned policy params, guarded, and settles.
5. Receipt lands in the user's guardian activity feed (+ money-moved
   valueUsd); user can pause/kill any time; delegation expiry is displayed.

Non-goals v1: opening positions, sizing up, spot, multi-venue, strategy
"alpha", DCA (that's the Base spend-permissions sequel).

## Custody & key handling

- One fresh agent keypair **per user delegation**, generated server-side.
  Private key encrypted at rest (AES-256-GCM with `GUARDIAN_KEY_SECRET` env
  key) in Neon; never logged, never sent to the client, never in traces.
- Agent key powers: sign `/exchange` L1 actions on the user's account. It
  cannot withdraw, cannot transfer, cannot approve other agents.
- Defense in depth: even though the venue lets an agent place ANY order, our
  builder only ever emits **reduce-only** orders on the **pinned asset** —
  and the guard fails closed on anything else. The model/planner is nowhere
  in this loop at execution time (policy params were fixed at creation).

## HL signing facts (verified 2026-07-13 vs docs; confirm vs SDK at build)

Two distinct schemes — mixing them is the classic integration bug:

1. **User-signed actions** (`approveAgent`): EIP-712 domain
   `{name: "HyperliquidSignTransaction", version: "1", chainId: <signature
   chain, e.g. 42161>}`, primary type
   `HyperliquidTransaction:ApproveAgent {hyperliquidChain, agentAddress,
   agentName, nonce}`. Signed by the USER's wallet in the browser.
   `hyperliquidChain`: "Mainnet" | "Testnet". Nonce = timestamp ms.
2. **L1 actions** (order placement, signed by OUR agent key): msgpack-pack
   the action (field order matters), append nonce (8-byte BE) + vault flag,
   keccak → `connectionId`; phantom agent `{source: "a" (mainnet) | "b"
   (testnet), connectionId}`; EIP-712 domain `{name: "Exchange", version:
   "1", chainId: 1337, verifyingContract: 0x000…0}`, type
   `Agent(string source, bytes32 connectionId)`.
   Pitfalls: lowercase addresses before signing; price/size strings must be
   normalized (no trailing zeros; ≤5 sig figs, ≤ 6−szDecimals decimals).
   Prefer `@nktkas/hyperliquid` for wire+signing; guard stays ours.

Order wire shape (what the guard inspects):
`{type:"order", orders:[{a, b, p, s, r:true, t:{trigger|limit}, c?}],
grouping:"na"}` — reduce-only close = side opposite the position, size ≤
|szi|, `r: true` ALWAYS in v1.

Endpoints: mainnet `https://api.hyperliquid.xyz` (`/info`, `/exchange`),
testnet `https://api.hyperliquid-testnet.xyz`. Testnet is the headless test
path.

## Data model (additive Neon DDL — raw SQL, never prisma db push)

```sql
-- one row per user delegation (agent keypair)
create table hl_agent_delegations (
  id            uuid primary key default gen_random_uuid(),
  wallet        text not null,            -- master account (lowercase)
  agent_address text not null,            -- our agent key's address
  agent_key_enc text not null,            -- AES-256-GCM ciphertext
  hl_chain      text not null default 'Mainnet',  -- 'Mainnet' | 'Testnet'
  status        text not null default 'pending',  -- pending|active|revoked|expired
  approved_at   timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on hl_agent_delegations (wallet);

-- policies attached to a delegation
create table hl_agent_policies (
  id            uuid primary key default gen_random_uuid(),
  delegation_id uuid not null references hl_agent_delegations(id),
  wallet        text not null,
  coin          text not null,            -- e.g. 'SYRUP'
  side          text not null,            -- 'long' | 'short' (position being guarded)
  kind          text not null,            -- 'stop_loss' | 'take_profit'
  trigger_mode  text not null,            -- 'drawdown_pct' | 'price'
  trigger_value numeric not null,         -- 10 (=10%) or absolute px
  status        text not null default 'active',  -- active|paused|triggered|done|error
  last_checked  timestamptz,
  created_at    timestamptz not null default now()
);
create index on hl_agent_policies (status);

-- every evaluation that resulted in action (and errors); the receipt trail
create table hl_agent_runs (
  id            uuid primary key default gen_random_uuid(),
  policy_id     uuid not null references hl_agent_policies(id),
  wallet        text not null,
  action        text not null,            -- 'close' | 'error' | 'skipped_kill' | ...
  reason        text not null,            -- human-readable trigger explanation
  order_json    jsonb,                    -- exact guarded action sent
  guard_report  jsonb,                    -- guard check results
  hl_response   jsonb,                    -- exchange response / fill
  value_usd     numeric,                  -- closed notional for money-moved
  created_at    timestamptz not null default now()
);
create index on hl_agent_runs (policy_id, created_at desc);
```

(Column names final after checking house conventions in existing tables.)

## Evaluation loop

- `app/api/cron/hl-guardian` (+ `vercel.json` cron, every minute; secured by
  `CRON_SECRET` header per Vercel convention) and a local runner script for
  dev.
- Per active policy: kill-switch check → fetch `clearinghouseState` →
  compute drawdown from `entryPx`/mark (or check price trigger) → if fired,
  deterministic build (pinned coin/side/size from LIVE position, reduce-only,
  IOC market-ish trigger px with bounded slippage) → guard → sign with agent
  key → POST /exchange → await settlement (reuse the MCP's WS matcher
  pattern, or poll orderStatus) → write hl_agent_runs + valueUsd.
- Trace to route_trace_lines (negative seq) with build_path
  `native:hyperliquid-guardian` so /activity shows guardian heartbeats.
- Idempotency: policy flips to `triggered` BEFORE placing the order (single
  UPDATE … WHERE status='active' RETURNING guards double-fire across
  overlapping cron ticks).

## Guard (fail closed — the whole point)

`guardHlGuardianBuild(policy, position, action)` rejects unless ALL hold:
- exactly one order; `r === true` (reduce-only), `grouping === 'na'`
- `a` maps to policy.coin's asset index (fresh meta lookup)
- side opposes the guarded position side; size ≤ |position.szi|
- trigger/limit px within sane bounds of mark (configurable bps)
- delegation active + unexpired; kill switch clear; policy status flipped
- (also enforced live) drawdown/price condition ACTUALLY true at build time
Guard report is persisted in the run row verbatim.

## Surfaces

- `/dashboard/guardian` (or agents): delegation state, policies, runs feed,
  pause/kill, expiry countdown. ApproveAgent signing happens here (wagmi
  signTypedData — user's wallet, HyperliquidSignTransaction domain).
- Chat: guardian suggestion chip on the Hyperliquid splash card when an open
  position exists ("Protect this position"), deep-linking to setup. (Cheap
  v1: link out; card-native setup can follow.)
- Money-moved: closed notional recorded as value_usd; roll into the admin
  metric the same way embed_turns does.

## Integration points (as built)

- Guard reports use the house `GuardrailCheck`/`buildReport` shapes from
  lib/tx-guardrails; the guard itself is `guardGuardianClose` in
  lib/hl-guardian.ts (pure, unit-tested in scripts/test-api.ts).
- Kill switch = the existing `spend_grants.paused` freeze (getActiveGrant);
  a frozen account stands the guardian down even mid-trigger.
- Signing via `@nktkas/hyperliquid` ExchangeClient (agent key) — vetted SDK
  for the msgpack/phantom-agent wire layer; the guard inspects the exact
  order object handed to it. approveAgent is user-signed in the browser
  (wagmi) and submitted raw to /exchange.
- Tracing: sweep executions write route_trace_lines (negative seq, payer
  'agent'); `native-hl-guardian` added to BUILD_PATHS.
- Cron: vercel.json `crons` (every minute) → /api/cron/hl-guardian, gated by
  CRON_SECRET (fail-closed when unset). Local: curl with the bearer.
- Tables: hl_guardian_delegations / _policies / _runs (raw-SQL additive DDL,
  applied to Neon `yeetful` 2026-07-13; Prisma models mirror them).
- UI: /dashboard/guardian (+ sidebar entry) — approve/revoke delegation, arm
  policies against live positions, receipts feed.
- Env (set on Vercel before enabling): GUARDIAN_KEY_SECRET, CRON_SECRET,
  optional HL_GUARDIAN_TESTNET=true.

## Follow-ups (not in this PR)

- Money-moved rollup: hl_guardian_runs.value_usd into the /dashboard/embeds
  admin block (runs table is the source of truth already).
- Chat surface: "Protect this position" chip on the Hyperliquid splash card
  → /dashboard/guardian.
- Venue-side resting trigger orders as latency hardening (survives our loop
  being down; needs cancel/replace management).
- Owner pass: real approveAgent + a live testnet fire drill.
