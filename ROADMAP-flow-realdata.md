# Roadmap — Conversation flow + real-data loops (2026-06-26)

Triggered by a live bug: after a DAO-vote turn, asking "what is the price of ETH?"
routed correctly (CoinMarketCap + ChatGPT, 2 x402 calls) but the **synthesized
reply re-emitted the previous turn's "Voting is ready… please confirm" message**.
Routing is fine; **answer synthesis used stale conversation context**.

This roadmap covers: (WS1) conversation-flow correctness, (WS2) real-data loops
now that logging is live, (WS3) Vercel/prod hardening, (WS4) catalog supply
(where MCP-proxy fits). Everything below is code-grounded with file refs.

> **MCP-proxy verdict:** `sparfenyuk/mcp-proxy` is a transport bridge
> (stdio↔SSE↔HTTP). It does NO selection/pricing/aggregation/routing. It does
> NOT help routing quality. Only possible future use: wrapping stdio-only 3rd-party
> MCP servers to expose HTTP so we can paywall them into the catalog (WS4, supply).

---

## WS1 — Conversation flow correctness  ⚠️ TOP PRIORITY

### W1.1 — Stale-context synthesis (the screenshot bug)
- **Root cause:** `buildPrompt()` (`app/api/chat/route.ts:1492-1508`) joins raw
  history via `answerHistoryBlock()` (`route.ts:115`) into the synthesis prompt.
  Used by BOTH synthesis paths — burner (`route.ts:1265`) and wallet
  (`route.ts:632`). `sanitizeHistory()` (`route.ts:100-112`) strips footers but
  not stale assistant message bodies, so the governance "🗳️ Voting is ready…"
  reply (`lib/governance.ts:278`) bleeds into the next turn and gets parroted.
- **Fix (both paths — see [[auto-router-two-synthesis-paths]]):**
  1. In the synthesis prompt, separate **"history for disambiguation only"** from
     **"data to answer from"**. The freshly-fetched `decision.context` /
     `contextBlocks` are AUTHORITATIVE; history is only for resolving pronouns and
     follow-ups. Add an explicit instruction: *"Answer ONLY the current question
     using the fetched data below. Do not repeat or continue any earlier message,
     pending action, or confirmation prompt from the conversation."*
  2. Strip governance/action "reply" bodies (the 🗳️ confirmation prompts) out of
     history before synthesis — they are UI control messages, not answer content.
     Tag them at creation (e.g. `meta.kind = 'action-prompt'`) and drop in
     `sanitizeHistory`.
- **Test:** extend `npm run test:api` / a router test with the exact sequence
  (vote turn → unrelated price query) and assert the reply contains the ETH price,
  not the proposal title.

### W1.2 — Pending action not cleared on topic switch
- A "ready to vote / please confirm" is a **pending confirmation**. When the next
  user message is unrelated (price of ETH), the pending vote should be treated as
  **abandoned/superseded**, not resurfaced. Today there's no pending-action state
  machine — the only "memory" is the stale text in history.
- **Fix:** track a single `pendingAction` (vote/sign) on the turn/chat; on a new
  message, the planner decides "is this a confirmation of the pending action?" —
  if not, drop it. Keeps governance multi-step flows intact without leakage.

### W1.3 — Vote direction correctness ("vote yes" → "Voted Against")  🔴 correctness
- Screenshot: user typed "vote **yes** on New yeet tester buy", UI pre-highlighted
  **For**, recorded result shows **Voted Against**. Money/governance correctness.
- **Investigate:** the `suggested` index + `choices[]` mapping in
  `lib/governance.ts` (~`:276`) and where the actual Snapshot choice is signed via
  EIP-712 ([[eip712-governance-tool]]). Verify "yes/For" maps to the correct
  1-based Snapshot choice, and that the signed choice == the displayed choice ==
  the recorded result. Add an assertion + a DAO test-rig pass (the Nate DAO rig).

### W1.4 — Footer dedup (known open follow-up)
- Receipts still embed both `paymentsFooter` in reply text AND `MessageReceipts`.
  Fold into the flow cleanup while touching synthesis.

---

## WS2 — Real-data loops (logging is live → close the loops)

**Already REAL + persisted to shared Neon** (no work needed to "turn on"):
`route_trace_lines` (live `/activity` feed, `lib/route-trace.ts`), `route_events`
(per-turn telemetry, `lib/route-telemetry.ts`), `spend_ledger` (per x402 call),
`route_incidents` (self-heal dedup, `lib/incidents.ts`), reputation computed live
from `spend_ledger` + `mcp_ratings` (`lib/reputation.ts`). The loops to CLOSE:

### W2.1 — Real-data-driven evals
- `scripts/eval-routing.ts` uses a **fixed 29-case fixture**. Mine real
  `route_events.intent` + picks (and incident-flagged misses) to GROW the eval
  set so it tracks what users actually ask. Keep the curated fixture as a stable
  core; add a `--from-db` sampled set. Guard against PII (intent is already
  paraphrased, not raw question).

### W2.2 — Incident → reputation feedback
- Today incidents are tracked but **don't auto-affect reputation**. Add: when an
  open `route_incidents.signature` crosses a threshold (e.g. ≥N in 24h), surface a
  "reliability under review" flag on `/leaderboard` + downweight liveness until it
  resolves. Real-time on incident create, or a nightly job.

### W2.3 — Persist reputation snapshots (trend, not just point-in-time)
- Reputation is recomputed on every load (pure function, fine) but there's no
  HISTORY. Add a daily snapshot table to chart a service's tier over time and to
  detect regressions (feeds W2.2 + the self-heal Phase 2).

### W2.4 — "Engine at work" proof on real numbers
- Wire any remaining simulated UI stats (e.g. landing proof-row) to real
  `/api/activity` aggregates so the public surfaces reflect ground truth.

---

## WS3 — Vercel / prod hardening

- **Confirm prod writes traces:** all `record*` writers are gated on
  `USE_DB === 'true' && DATABASE_URL`. Verify BOTH are set on Vercel so prod chats
  populate `/activity`, `route_events`, `spend_ledger`, incidents (local already
  does — local↔prod share ONE Neon, so prod may already be live; verify).
- **Daily catalog sync:** `.github/workflows/agentic-sync.yml` runs ingest→tag→
  embed→audit at 08:17 UTC; needs repo secrets `DATABASE_URL` (req),
  `ANTHROPIC_API_KEY` (tag), `OPENAI_API_KEY` (embed). Confirm all set.
- **Observability:** add a lightweight admin metrics view (settle rate, p50/p95
  latency, denials, top incidents) off `route_events` + `spend_ledger` so prod
  health is glanceable. (`/incidents` exists; add an aggregate dashboard.)
- **Planner model guard:** ensure prod plans on direct Claude
  (`ANTHROPIC_API_KEY`), never the paid answer engine — see
  [[reason-router-planner-decoupled]]. Add a startup assertion / health check.

---

## WS4 — Catalog supply (where MCP-proxy *might* fit)

- **Not a routing improvement.** Only if we want to onboard **stdio-only** MCP
  servers (no HTTP) into the callable catalog: run them behind `mcp-proxy`
  (stdio→SSE/HTTP), then put the x402 paywall + ingest in front. Low priority;
  most supply already arrives as HTTP via agentic.market.
- Higher-leverage supply work: keep growing exact-priced callable endpoints +
  pgvector embeddings (recall is the real lever — [[sharp-router-roadmap]]).

---

## Suggested sequence
1. **W1.1 + W1.3** (synthesis fix + vote-direction correctness) — smallest, highest
   impact; ship first on a branch with a regression test.
2. **W1.2** (pending-action state machine) — prevents the whole class of leaks.
3. **W2.2 + W2.1** (incident→reputation, real-data evals) — turn live logs into a
   self-improving loop.
4. **WS3** prod hardening pass; **WS4** only if supply demands it.
