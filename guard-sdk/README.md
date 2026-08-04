# @yeetful/guard

**Fail-closed transaction guards for agent wallets.** Agents and models
*propose*; deterministic code *verifies*; only the user's wallet signs.

This package is the guard layer extracted from Pantessa's production
transaction engine — the code that stands between "an AI composed a
transaction" and "a human signed it." It holds no keys, opens no database,
and never trusts a string an LLM wrote. Every module was built against a
**live incident**, not a hypothetical; each file's header names the one it
came from.

## Why this exists

If you are building an agent wallet — an MCP-connected wallet, an AI
trading copilot, a session-key executor — your attack surface is not smart
contract bugs. It is the gap between *what the user asked for* and *what
the composed transaction actually does*. Four classes we have caught live:

1. **The fabricated address.** A planner composing a cross-chain deposit
   nearly offered a transfer to an address it invented. Fix:
   `guardCrossChainBuild` — the signable tx must move *exactly* the quoted
   amount to the venue's one-time deposit address, decoded from calldata,
   never read from prose.
2. **The consistent liar.** A market id that resolves honestly, calldata
   that matches the resolved tuple, and an asset that is *still* the wrong
   token — because the agent's `symbol → address` claim was never checked
   against the chain. Fix: `assertTokenIdentity` — the chain is the only
   authority on what a token *is*.
3. **The runaway delegate.** A delegated key that can trade "on your
   behalf" can also grow your position, switch assets, or fire twice.
   Fix: `guardGuardianClose` — a delegated close must be reduce-only IOC,
   asset-pinned, size-bounded to the live position, price-bounded to mark,
   single-fire, and kill-switchable. Ten checks, all block-level.
4. **The authorized-by-crash policy.** A spend-policy row that fails to
   deserialize used to authorize the spend. Fix: a broken gate **refuses**
   (`POLICY_ERROR`); it never waves through.

## What's in the box

| module | guards | provenance |
|---|---|---|
| `spend-grant` | scoped spend authorizations: allowlist, per-call / daily / lifetime caps, expiry, kill switches, fail-closed evaluation | the "agent expense account" layer |
| `tx-guardrails` | venue-neutral artifact checks: recipient-must-be-signer, validity windows, the policy gate (incl. the self-signed exemption and the inflow rule: sales are never spend-gated) | live wallet-drain review, 2026-07 |
| `hl-guardian` | delegated-execution guard for autonomous stop-loss/take-profit: derived-not-chosen closes + the ten-check gate + EIP-712 delegation artifacts | a real autonomous fire, $11.93, 10/10 checks green |
| `cross-chain-guard` | deposit verification for intent-based bridges + fee-recipient pinning (the venue never validates fee recipients — we do) | the fabricated-address near-miss |
| `token-identity` | on-chain symbol/decimals binding with an injected reader (works with viem, ethers, or a test fake) | the hostile-MCP market-substitution find |

## Design rules

- **Fail closed, always.** Unpriceable value under an enabled policy:
  refused. Unreadable token: refused. Broken policy row: refused. The
  guard's own failure is never an authorization.
- **Decode, don't believe.** Every check runs against decoded calldata or
  venue-signed payloads — never against a model's summary of them.
- **I/O is injected.** No RPC clients, no databases. You pass the reader,
  the policy row, and today's spend; the package answers. That's why the
  whole suite runs offline in milliseconds: `npm run guard:test`.
- **The copies can't drift.** In the Pantessa repo, `guard:sync` enforces
  byte-parity between this package and the modules guarding production.

## Status

`0.1.0` — extraction of the venue-neutral core. Not yet published to npm.
The venue-specific builders (Uniswap v3/v4 calldata verification, CoW
appData family pinning, Seaport fee-schedule re-derivation) remain in the
app; they extract next if there's interest. Talk to us if you're building
an agent wallet and want this under yours.
