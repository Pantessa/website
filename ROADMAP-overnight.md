# Overnight lane — 2026-07-13 20:24 → ~00:30 WEST (Nate-authorized, review AM)

Mission: make the product DEMONSTRATE "any intent → guarded money movement →
receipt" with zero fakery. Lane branch `overnight-lane`; sub-branches PR into
the lane (merge freely), ONE lane→main PR at the end for Nate. Burner may
spend ≤ $5 USDC total, only where it proves a card end-to-end. Cards are the
deliverable: informed, honest, pretty, testable.

Standing constraints: never touch main; verify every slice (tsc + build +
test:api + screenshot); no suggested prompts we can't answer — chips must be
backed by a deterministic builder + live context; additive DDL only.

## W1 — Jobs v1 (the orchestrator, from HANDOFF-multistep-jobs.md)  [~2h]
- [x] Tables `jobs` + `job_steps` (additive DDL + Prisma models)
- [x] lib/jobs.ts: plan compiler — compound-ask parse ("…, then …") chaining
      EXISTING native parses (cross-chain swap → hl deposit → hl order →
      guardian arm), $-flow-through ("put $X of that…")
- [x] Runner: app/api/cron/jobs (CRON_SECRET; guardian pattern: atomic step
      claim, env fence N/A, per-step guard re-run, receipts on job_steps)
      + wait predicates (1Click status, HL credit, balance ≥)
- [x] JobCard in chat: step list w/ live states, embedded sign buttons
      (reuse SendTxButton / SignHlActionButton per step), value rollup,
      pause/cancel; SSE-or-poll progress
- [x] vercel.json cron entry + test:api coverage (plan compiler matrix,
      runner auth, step-claim atomicity)

## W2 — Action chips replace suggested prompts  [~1h]
- [x] lib/action-chips.ts: chips = f(wallet context, native builders, MCP
      set). Each chip: {label, message-to-send, requires: balances/positions
      checked LIVE}. Sources: HL positions → "Protect …" / "Close …";
      Base/Arb USDC → "Bridge $N to …" / "Deposit $N to Hyperliquid";
      Aave positions → withdraw/repay; CoW/Uniswap balances → swap chips.
- [x] Replace static suggested prompts on splash cards + portfolio card
      bottom rows with verified chips (keep uniform-grid contract, one
      bottom chip row per card — splash memory #393)
- [x] Chip → sends the exact message the native layer parses (already-proven
      round trip), never a freeform prompt
- [x] Remove/retire prompt suggestions that lack a backing builder

## W3 — Cards polish + receipts  [~45m]
- [ ] Guardian: armed-policy reply becomes a live card (status, trigger
      distance, receipts feed link); HL fill card after SignHlActionButton
- [ ] Money-moved: hl_guardian_runs.value_usd + hl submits into the admin
      rollup on /dashboard/embeds
- [ ] Screenshot pass (light + dark; typing-never-clears; embed exempt)

## W4 — if time: MCP touches
- [ ] hyperliquid MCP: surface guardian-able positions hint in portfolio
      tool output (helps planner + splash)
- [ ] near-intents MCP: expose venue minimums in quote errors (jobs spec
      prerequisite #2)

## Log (append per iteration)
- 20:24 lane opened @ af057bb (main w/ #401 #404 merged)
- 21:15 W1 DONE — jobs-v1 merged to lane (PR #405): compiler/runner/JobCard,
  tables live, cron wired, 450-check harness green, LIVE job verified on
  :3277 (real 1Click artifact offered; fund-less deposit failed closed).
  Screenshot: JobCard w/ $4 bridge quote + embedded sign button. Next: W2.
- 21:50 W2 DONE — action-chips merged to lane (PR #406): every splash chip
  is a native action with live amounts; round-trip harness check added
  (451 green). Burner $33.86 → "Swap 33 USDC → ETH" verified live. Note:
  W2 chips landed inside sources.ts derivations (no separate
  lib/action-chips.ts needed — the registry already had the right shape).
  Next: W3 cards polish.
