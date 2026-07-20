# Yeetful Guardrails

**The transaction layer is the product, and the guardrails are the moat.** An
agent — ours or anyone's — never writes calldata. Every artifact a user is
asked to sign was built deterministically by Yeetful's own venue layer,
re-verified byte-by-byte against what the user asked for, and gated by their
spend policy. When any of that fails, Yeetful refuses. A refusal is a
first-class outcome: it names the reason, it's ledgered, and nothing signable
leaves the server.

This document is the living adversarial checklist: what we guarantee, where
each guarantee lives in code, and how it's pinned by the standing harness
(`scripts/test-api.ts`, 750+ checks, run against every build). Last full
adversarial audit: **2026-07-20** (every builder, every relay, every
model-output path).

---

## The guarantees

### 1. The model never writes calldata or addresses

The planner/LLM picks *which* tool runs and *what the user meant* — it never
authors a `to`, `data`, `value`, deposit address, or typed-data field.

- **Native builders** construct calldata from on-chain reads + pinned
  constants only: CoW (`lib/cow-build.ts`, `lib/cow-guardrails.ts`), Uniswap
  v3 (`lib/uniswap-venue.ts`), Uniswap v4 (`lib/uniswap-v4.ts`), LiFi
  settlement (`lib/lifi-venue.ts`), LiFi funding bridge (`lib/lifi-bridge.ts`),
  cross-chain (`lib/cross-chain-swap.ts`), Aave (`lib/aave-supply.ts`),
  Robinhood bridge (`lib/robinhood-bridge.ts`), Lido (`lib/lido-stake.ts`),
  NFT/Seaport (`lib/nft-layer.ts`, `lib/opensea.ts`), token sends
  (`lib/transfer-exec.ts`).
- **External API responses are never trusted**: LiFi's aggregator-opaque
  calldata is pinned to a per-chain router allowlist with exact-amount
  approvals decoded and verified (`lib/lifi-venue.ts`, `lib/lifi-bridge.ts`);
  NEAR Intents deposits are re-decoded and the transfer must move *exactly*
  the quote to the tool's own deposit address (`lib/cross-chain-swap.ts` —
  born from a live fabricated-address near-miss, PR #374); Seaport buy
  fulfillments are re-encoded **locally**, never forwarded opaque
  (`lib/nft-layer.ts`); AaveKit builds are verified against pinned 4-byte
  selectors, word-decoded amounts, and reserve-id **sets** cross-checked
  against the official reserves list (`lib/aave-supply.ts`).
- **The generic MCP passthrough is guarded** (closed 2026-07-20). A directory
  MCP that returns a signable payload passes
  `guardPlannerArtifact` (`lib/planner-artifact-guard.ts`) before anything
  reaches a sign button — on both synthesis paths (`lib/router.ts`,
  `app/api/chat/route.ts`). It refuses the drain shapes outright: ERC-20
  transfers to anyone but the signer, **unlimited** approvals,
  transferFrom-family calldata, `setApprovalForAll`, any Permit2 call, bare
  native sends to third parties, off-registry chains, and any generic EIP-712
  order that isn't a CoW order verifying against the pinned GPv2 settlement
  contract and paying the signer.

**Tested:** 18 planner-guard checks (drain-shape refusals + the legit-call
pass path), cross-chain deposit pinning, per-venue guard suites.

### 2. Fail closed, everywhere

A guard error refuses the build. It never falls through to an artifact.

- Pure guards return `{ok, reasons}` and **do not populate the tx/steps field
  on failure** (`lib/cross-chain-swap.ts`, `lib/lido-stake.ts`,
  `lib/uniswap-v4.ts`, …). Builder-level guards fold into
  `buildReport` (`lib/tx-guardrails.ts`): one failed block-level check ⇒
  `blocked: true` ⇒ every consumer withholds the artifact.
- **Fallback cascades never demote safety.** v3→v4 triggers only on
  `NoV3PoolError`; v4→LiFi only on `GatedV4PoolError` (`lib/swap-exec.ts`).
  A *guard* failure is a block, never a fallback trigger — any other error
  rethrows.
- **A broken gate refuses.** If the spend-policy check itself crashes
  (malformed row, bad date), `grantViolation` returns `POLICY_ERROR` — a
  refusal — instead of the pre-audit behavior of authorized-by-crash
  (`lib/spend-grant.ts`, fixed 2026-07-20).
- A refusal response carries the verdict, never the payload:
  `/api/cow/quote` withholds the raw order struct on a blocked build, not
  just the wrapped artifact (hardened 2026-07-20).

**Tested:** refusal paths for every venue guard; `POLICY_ERROR` fail-closed;
the blocked-quote withholding check runs against the live route.

### 3. Deadline-bearing calldata never goes stale in a wallet

Calldata with a baked-in deadline (Uniswap multicall/Universal Router, LiFi
backend-signed fills) always ships as a **txChain** — even one step — with a
`validUntil` and a server-side refresh recipe (`lib/transaction-layer.ts`,
`app/api/tx/refresh/route.ts`). The card re-quotes before the deadline passes;
expired calldata is never offered (the "$32M gas estimate" pattern, PRs
#427/#428). The refresh route accepts only intent params (token symbols,
human amounts, registry chain ids) — `to`/`data`/`value` are **never**
client-suppliable; every rebuild re-runs the full guard set plus an
`estimateGas` revert probe.

**Tested:** `validUntil` propagation, 1-step chains with refresh recipes,
refresh param validation, junk-`validUntil` rejection.

### 4. Spend policy is direction-aware — and the kill switch always wins

- **Outflows** run the full gate: allowlist, per-call cap, daily/lifetime
  budgets, expiry, kill switches (`policyCheck`, `lib/tx-guardrails.ts`).
- **Inflows are never spend-gated.** A $1,800 sale is not a $200 "spend" —
  only kill switches survive direction (`policyCheckInflow`, PR #469).
- **Your own signature is the consent.** Caps govern what agents may spend
  *without you*; a build you sign per-action is exempt from the caps
  (`selfSigned`, PR #474) — but **never** from the allowlist, expiry, or the
  kill switches. Frozen/revoked refuses everything, both directions, and is
  checked *before* the caps so the exemption can never mask it
  (`lib/spend-grant.ts` ordering).
- Autonomous paths (house-paid x402 calls, the HL Guardian's delegated key,
  planner tool spends) never set `selfSigned` — they get the raw gate
  (`app/api/chat/route.ts`, `lib/hl-guardian.ts`).
- Every builder loads the live grant server-side; as of 2026-07-20 that
  includes the LiFi funding bridge (`lib/lifi-bridge.ts`), which previously
  had no kill-switch check.

**Tested:** inflow gate (proceeds pass, frozen/revoked refuse), self-signed
exemption boundaries (caps yes; allowlist/frozen/revoked/`POLICY_ERROR` no),
frozen-over-caps precedence, wildcard-allowlist semantics.

### 5. Submit relays re-gate on the server — the client can't skip the checks

Signing happens client-side; **acceptance** doesn't.

- `/api/cow/submit`: recipient must be the signer, order not expired,
  re-priced and re-gated against the live policy at submit time.
- `/api/opensea/submit`: signature recovered over the exact order params must
  match the claimed offerer; payout allowlist re-derived from the
  collection's **live** fee schedule; target pinned to Seaport 1.6; inflow
  gate applied (a frozen account can't list, a sale is never spend-gated).
- `/api/hl/submit`: typed data re-derived server-side from the raw action +
  nonce, signer recovered, re-guarded against the live market before
  anything reaches the venue.
- `/api/tx/refresh`, `/api/panels/swap`: build-only endpoints that return
  unsigned, fully re-guarded calldata pinned to the requesting wallet.

**Tested:** relay refusal paths, signature-mismatch rejections, live
fee-schedule re-derivation, refresh param hygiene.

### 6. One fee source, one treasury

Every fee constant and the treasury address live in **`lib/fees.ts`** — the
address appears nowhere else in the codebase (grep-enforced in the audit).
Fees ride as their own visible transfer step, never buried in venue calldata.
Funding legs (moving your own money in) carry no fee.

### 7. Recipient and validity are venue-neutral invariants

Whatever the venue: proceeds return to the requesting wallet
(`recipientCheck`), and nothing stays signable longer than 31 days
(`validityCheck`, `MAX_VALID_SEC`) — an unbounded signed order is a standing
liability, so it's refused. Third-party recipients only exist in the
dedicated transfer layer, which re-decodes its own calldata with an
independent guard and takes the **full** (non-exempt) policy gate
(`lib/transfer-exec.ts`).

**Tested:** expired/forever/mismatch refusals; transfer-layer decode checks.

---

## Honest residuals (documented, not hidden)

- **LiFi price/simulation checks degrade to warnings on RPC transport
  failure.** Address pinning (the anti-theft layer) is never bypassed — funds
  cannot be redirected — but with both the independent quoter and
  `estimateGas` unreachable, a bad-price fill is theoretically possible until
  the sign-time re-quote. Block-level everywhere the data is available.
- **The generic planner path allows ordinary contract calls** (unknown
  selectors on app chains) after the drain shapes are excluded — that's the
  bring-your-own-MCP contract. Your wallet renders native value; Yeetful
  refuses the shapes wallets render worst.
- **Snapshot vote relay forwards signed votes without content re-derivation.**
  Votes carry no economic outflow; Snapshot validates signature and voting
  power.

## Running the audit

```bash
npx tsc --noEmit && npm run build
next start -p 3281 &
BASE=http://localhost:3281 npm run test:api
```

Every guarantee above maps to named checks in `scripts/test-api.ts` — the
sections `— guardrail audit (fail-closed invariants)`, per-venue guard
suites, and the relay/refresh checks. Extending a venue? Add the guard, add
the refusal check, and update this file in the same PR.
