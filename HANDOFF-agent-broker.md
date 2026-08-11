# HANDOFF — the agent broker (the desk)

*Born 2026-08-12 from Nate's strategic question: "our system is novel, but
anyone can build it pretty easily. Do you see a bigger idea with our
transaction batching system? … say an agent just 'needs $15 of AAPL', hits
our agent and then talks back and forth to handle the transaction flow."*

## The thesis

The chat UI is replicable. What is NOT easily replicable is what sits under
it: ~20 fail-closed venue guards, deterministic builders the planner can't
touch, the cross-chain funding cascade, spend policy, receipts. Today all of
that is only reachable by a HUMAN typing into OUR chat.

The bigger idea: **make Pantessa the transaction desk for other people's
agents.** Every agent framework is bolting on wallets (CDP, x402); none of
them can safely execute multi-step on-chain flows, and none of them want to
carry the liability of writing calldata from a language model. We already
solved that — sell the solution to the agents themselves.

This also flips the distribution problem (see HANDOFF-gtm-bulletproof.md:
the machine works, nobody uses it). Selling to agent BUILDERS is a tighter
channel than acquiring retail wallet users one at a time, and every agent
that integrates brings its own humans.

## What shipped in this prototype (branch `feat/agent-broker`)

**`/api/broker/mcp`** — an MCP endpoint (Streamable HTTP, `mcp-handler`)
any agent can connect to:

| tool | what it does |
|---|---|
| `broker_capabilities` | START HERE: the lanes, the loop, the contract |
| `broker_open` | ask → parse (via `scripts/ask-ladder` — the real gate ladder), dapp set (`composeMcps`), REAL multi-chain funding scan when a wallet rides along, options |
| `broker_choose` | pick an option; options are resume-SENTENCES that re-enter the parse ladder — no other negotiation channel exists |
| `broker_handoff` | mints a durable `/i/<slug>` sign link (full guarded runtime, connect-to-act) bound to the intent |
| `broker_status` | the feedback loop the fire-and-forget hands MCP lacks: server-truth funnel (open→connect→built→signed→settled + signed USD from embed_turns) |
| `broker_close` | walk away; revokes the bound link |

**The safety contract, mechanical:** `assertNoTxMaterial` runs on every
outbound payload (no 64+ hex runs, no calldata/typedData/depositAddress
keys), and the harness re-checks the RAW WIRE BYTES of every call. The desk
talks in sentences and links; transaction bytes exist only on the sign side,
built by the deterministic guarded builders, signed only by the human.

**State:** `broker_intents` (Neon, additive, DDL run) — states move
rightward only: open → handed_off → signed → settled | closed.

**The demo:** `BASE=… npx tsx scripts/broker-drill.ts ["ask"] [wallet]` —
plays the external agent, prints the two-agent transcript, self-cleans
(KEEP=1 to leave the link alive for a real signing drill). Verified live:
generic ask, and a real wallet scan (movable $17.16 / stranded $3.46 named
per the #549 honesty rule) with an honest no-route-covers-it verdict.

**Harness:** 9 new checks in `scripts/test-api.ts` (§ agent broker desk),
including the wire-level hex scan and revoked-link refusal.

## Deliberately NOT in v0

- **Agent-side signing** (returning guarded artifacts to agents holding
  their own keys under spend policy). The API shape supports it later; the
  hands contract ("nothing you receive can execute by itself") holds until
  we consciously decide otherwise. That decision deserves its own security
  review (`/security-audit`).
- **x402 pricing on the desk.** The two-door pattern (free + paid) exists
  in mcp-kit; wiring payment is a config decision once the loop proves out.
- **Webhooks.** Polling `broker_status` is enough for v0; push
  notifications are a fast follow.
- **Per-destination shortfall math.** The funding quote is advisory
  (movable-vs-ask across Base/Eth/Arb); the sign-side cascade remains the
  truth. Tightening it means reusing `readFundingShortfall` per venue.

## Where this could go (the roadmap sketch)

1. **Prove the loop** — one external agent (Claude with the hands MCP +
   this desk, or agent-examples' lazy-trader) completing a real signed buy
   through a brokered link. The demo clip: two agents negotiate, a human
   taps sign.
2. **Price it** — x402 on `broker_open` (pennies) + the existing link-tier
   bps on signed volume. The desk inherits the whole fee stack.
3. **Publish it** — the hands MCP already ships in free-mcps; the desk is
   its stateful sibling. List both on the MCP registries; "give your agent
   a trading desk" is the launch story.
4. **Agent-side signing under policy** — the expense-account layer
   (grants, caps, kill switches) was BUILT for this; it's the phase where
   "desk" becomes "prime brokerage."

## Session log

- 2026-08-12: v0 built end-to-end (this file). Gates at commit time: tsc
  clean, build clean, harness green except the standing router-select red
  (NFT reds on the first run were the documented stale-worktree
  OPENSEA_API_KEY signature; key copied locally, not committed).
