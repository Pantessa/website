# Day-2 lane — 2026-07-14 09:40 WEST (Nate-directed; full creative authority)

Mission: make the TRANSACTION LAYER the visible product. External agents and
users hit the same intent → guarded artifact → receipt rails from API, chat,
or embed; docs lead with that; embed is the icing. Telegram parked.

Lane `day2-lane`; sub-branches PR + merge INTO the lane, ONE lane→main PR at
the end. Burner spend cap $2 TOTAL (x402 demo calls only — no bridges, no
positions; the drill already proved the money path). Cheap testing is a
FEATURE this lane ships, not a constraint it suffers.

## W1 — Jobs API + dry-run mode (the cheap-testing unlock)  [first]
- [x] POST /api/jobs {ask, dryRun?} — Bearer yf_ OR SIWE. dryRun=true:
      compile + build&guard STEP 1 artifact, return full plan preview,
      create NOTHING, cost $0. dryRun=false: create + advance (today's chat
      path, now key-authenticated for external agents).
- [x] GET /api/jobs list for Bearer keys (already SIWE) — verify parity.
- [x] test:api: dryRun compiles canonical ask w/ live artifact, creates no
      rows; Bearer auth parity; bad-ask problem passthrough. (9 new checks;
      gotcha: the harness revokes its first yf_ key mid-run — jobs section
      mints its own + revokes it so the cleanup sweep stays green.)
- [x] scripts/jobs-api-demo.ts: the walkthrough that becomes the docs
      quickstart — wrapped in main() (top-level await breaks under tsx/cjs),
      non-JSON responses reported honestly. Run vs local: 3-seg ask →
      honest live refusal (burner's USDC is in the HL position); 4-seg
      bridge-first ask → REAL guarded near-intents artifact, $5 valueUsd,
      guard ok. Prod run BLOCKED until day2-lane→main deploys (POST route
      isn't live there yet) — rerun for the docs paste then.

## W2 — Embed verification, $0  [needs W1 dryRun for the cheap path]
- [ ] Local embed page test: /embed with burner address → send the compound
      ask → JobCard renders with offered step-1 artifact → DO NOT SIGN.
- [ ] Fix whatever breaks (postMessage/meta plumbing in embed mode).
- [ ] Screenshot for the lane PR.

## W3 — Docs overhaul: the transaction layer IS the product
- [ ] Restructure /docs nav: 1) What Yeetful is (intents → guarded builds →
      receipts), 2) Jobs (compound intents, the API quickstart from W1),
      3) Guardian (autonomy without custody), 4) Native venues + guards
      table, 5) Embed ("icing": 5 lines, host wallet), 6) x402 payer/payee.
- [ ] Every docs code sample must be RUNNABLE against prod (dryRun) — no
      aspirational snippets (the action-chips rule, applied to docs).
- [ ] yeetful-brand voice pass on new pages.

## W4 — Lido guided flow (the canonical "agent proposes the job" demo)
- [ ] Native lido step: parse "stake N eth on lido" → lido MCP build_stake →
      guarded SendTx artifact (recipient self, contract pinned from MCP
      response verified against known Lido mainnet stETH addr).
- [ ] Jobs compiler: lido stake as a step ("swap …, then stake … on lido").
- [ ] The guided moment: "help me stake on lido" (chip on the Lido splash
      card) → deterministic context check (ETH balance) → if broke-but-
      stablecoined, reply proposes the EXACT compound job as a chip:
      "Swap 5 USDC → ETH, then stake it on Lido — one job. Run it?"
- [ ] Chip round-trip harness checks for every new string.

## W5 — x402 payer demo  [≤$2 total]
- [ ] scripts/x402-payer-demo.ts: an external agent that (1) pays a ≤$0.05
      x402 endpoint through the router for data, (2) then submits a dryRun
      job via the W1 API with a yf_ key — the full "agent walks in with
      money, leaves with a guarded plan" loop. Runnable, receipted, cheap.
- [ ] Docs page for it (W3 section 6).

## W6 — Hardening (as time allows; else backlog notes in the lane PR)
- [ ] Explicit leverage on HL opens (updateLeverage behind the guard)
- [ ] v2 delegations: SPEC ONLY unless CDP secrets appear (blocked:
      CDP_WALLET_SECRET — note in PR)
- [ ] Same-chain swap as a job step (uniswap/cow builders in the compiler)

## Log
- 09:40 lane opened @ 1c45b0f (main w/ #409). Burner: $5.86 USDC Base,
  $25 on HL (ETH long armed w/ 0.1% guardian stop — leave it alone).
- 10:15 W1 DONE: tsc + build green, test:api 459 passed / 2 known reds vs
  next start :3299, demo script run local (dryRun, $0, nothing created).
  PR w1-jobs-api → day2-lane. Prod demo paste deferred to lane-end deploy.
