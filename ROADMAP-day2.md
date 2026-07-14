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
- [x] Local embed page test: /embed with burner address → send the compound
      ask → JobCard renders with offered step-1 artifact → DID NOT SIGN.
      (Bridge-first 6-step ask: step 1 offered at $4.00 w/ Sign & send;
      deposit-first ask fails HONESTLY on real balances — also correct.)
- [x] Fix whatever breaks: IT BROKE exactly as predicted — JobCard polls
      GET /api/jobs/[id] which was SIWE/Bearer-only, so embed visitors got
      401s forever (and the card kept polling). Fix = per-job capability
      token (lib/job-token.ts, HMAC(jobId, SESSION_SECRET)): chat's job
      reply carries jobToken, JobCard appends ?t= to poll/complete/cancel,
      the three /api/jobs/[id]* routes accept owner OR token, and the card
      stops polling on 401/404. Token DELETE proven through the real card's
      cancel (200, status→canceled). 2 new harness checks (401→404 flip on
      a token for a nonexistent id = the gate proven with ZERO rows).
- [x] Screenshot for the lane PR (in-session: embed + compiled 6-step job
      card, step-1 bridge artifact offered, unsigned). All 4 dev test jobs
      terminal (canceled/failed), origin_env=dev — prod cron blind to them.

## W3 — Docs overhaul: the transaction layer IS the product
- [x] Restructure /docs nav (lib/docs.ts is the one ordering): Overview
      (rewritten hero: "One intent in. A guarded transaction out." + steps
      = INTENT → GUARDED BUILD → SIGN & RECEIPT + $0 curl block) → NEW
      /docs/jobs (quickstart w/ REAL dryRun output) → NEW /docs/guardian
      (the cannot-do list is the product) → NEW /docs/transactions
      (doctrine + 8-venue guard table) → embed ("THE ICING · 5 LINES",
      demo kept) → router → the x402/SDK pages unchanged below.
- [x] Every snippet runnable: curl + Bearer dryRun, npx tsx
      scripts/jobs-api-demo.ts; sample response is the real W1 run
      (artifact + guard report + honest-refusal example).
- [x] yeetful-brand voice pass (skill loaded; docs tone: dry, precise,
      one aside max). Gotcha twice-earned: the JSX entity-space bug ALSO
      eats the space before em dashes — detector must grep
      `</(em|strong|a|code)>[a-zA-Z]` AND `</(em|strong|a|code)>—`; both
      run clean on all four pages.

## W4 — Lido guided flow (the canonical "agent proposes the job" demo)
- [x] Native lido step (lib/lido-stake.ts): parse "stake N eth on lido"
      (+ wstETH, + max forms "all my / the swapped eth") → build_stake →
      guard pins the CANONICAL mainnet stETH/wstETH addresses (hardcoded,
      never trusted from the response), decodes submit(), matches value,
      chainId 1, single step. Chat gate + buildLidoStakeTurn (route.ts),
      valueUsd priced off the MCP's own position read (fail-soft).
- [x] Jobs compiler: native-lido sign step; 'max' resolves from the LIVE
      mainnet balance at build time minus a 0.002 gas buffer (the
      amount-only-exists-after-the-bridge form).
- [x] The guided moment: isLidoGuidedAsk → deterministic position read →
      chips. VERIFIED LIVE on the burner: "Help me stake on Lido" → "no
      stakeable ETH … but 5.86 USDC on Base" → chip → 3-step job compiled
      (bridge → wait → stake), step 1 offered at $5.00, NOT signed,
      canceled via the card. Gotcha: clarifyOf drops 1-option payloads —
      the compound proposal needs a second honest option (bridge-only).
      + lidoSource splash card (position/APR/withdrawals, live-amount
      stake chip) + lido preview entry for hand-picked empties.
- [x] Chip round-trip harness checks: 8 new checks (parse forms, guided
      detection, compiler round-trip of the exact chip string, suggested-
      stake sizing, guard pass + 5 tampers + wstETH shape). 469/2 known.

## W5 — x402 payer demo  [≤$2 total]
- [x] scripts/x402-payer-demo.ts: ① POST /api/route (Bearer; SIWE-mints a
      key if none) → engine pays a ≤$0.05 endpoint, streams select/pay/
      receipt; ② POST /api/jobs dryRun → guarded plan, $0. RUN LIVE twice
      vs local: Otto AI $0.001 + ChatGPT $0.001 settled with tx hashes,
      real headlines, 6-step plan, "paid $0.0020, committed $0". Total
      lane x402 spend ≈ $0.003 of the $2 budget. Gotchas: receipt.priceUsd
      arrives as a string; failed receipts don't settle (don't sum them);
      the weather ask routed badly (FlightAware fail → answer engine) —
      crypto-news routes clean; 2 demo yf_ keys now on /dashboard/keys.
- [x] Docs page: /docs/payer-demo ("The payer loop"), real output pasted,
      placed after x402 in the nav. Entity-space detectors clean.

## W6 — Hardening → BACKLOG (time went to W1–W5 depth; notes for the PR)
- [ ] Explicit leverage on HL opens: parse "at 5x" in parseHlIntent →
      updateLeverage L1 action BEFORE the order, both behind the existing
      guard (guard must pin the asset + cap leverage; the drill ran at
      account-default 20x, which is the argument for shipping this next).
- [ ] v2 delegations: SPEC ONLY, still blocked on CDP_WALLET_SECRET (see
      spend-permissions memory) — no code written this lane.
- [ ] Same-chain swap as a job step: the uniswap/cow builders already
      exist; the compiler needs a swap segment (parseSwapIntent) + a
      'swap-settled' wait predicate (tx receipt poll). Straightforward
      but touches the venue-picker logic — a clean next sub-branch.
- [ ] From this lane's findings: harness-check the /api/route SSE shape
      (the payer demo depends on it); Otto weather routing (FlightAware
      claims weather asks and fails — a shortlist-quality case).

## Log
- 09:40 lane opened @ 1c45b0f (main w/ #409). Burner: $5.86 USDC Base,
  $25 on HL (ETH long armed w/ 0.1% guardian stop — leave it alone).
- 10:15 W1 DONE: tsc + build green, test:api 459 passed / 2 known reds vs
  next start :3299, demo script run local (dryRun, $0, nothing created).
  PR w1-jobs-api → day2-lane (#411, merged). Prod demo paste deferred to
  lane-end deploy.
- 10:35 W2 DONE: embed JobCard 401 plumbing found + fixed via job
  capability tokens (lib/job-token.ts); full sign-step card verified in
  /embed unsigned; token cancel exercised through the UI; test:api 461/2
  known reds. Headless gotcha: React controlled textarea ignores CDP
  type + form_input — native value setter + dispatched input/keydown works.
- 11:00 W3 DONE: docs lead with the layer — 3 new pages (jobs/guardian/
  transactions), overview + nav reordered, all snippets runnable, real
  output pasted. tsc + build green, entity-space detectors (letters AND
  dashes) clean, test:api 461/2 known reds. PR w3-docs → day2-lane.
- 11:45 W4 DONE: the Nate demo shape works end-to-end on the burner —
  guided ask noticed $5.86 USDC on Base + 0 mainnet ETH, proposed the
  exact bridge→stake job as a chip, chip compiled to a 3-step JobCard
  with the $5 bridge artifact offered. Unsigned, canceled, dev-fenced.
  tsc + build green, test:api 469/2 known reds. PR w4-lido → day2-lane.
- 12:10 W5 DONE: payer loop proven live — 2 settled x402 receipts
  ($0.002, tx hashes) through /api/route + a $0 guarded dryRun plan, one
  script. /docs/payer-demo added. test:api 469/2 known reds. PR
  w5-x402-demo → day2-lane. Remaining: W6 (backlog notes) + lane→main PR.
- 12:20 LANE COMPLETE: W6 written up as backlog (above), ONE PR
  day2-lane → main opened for Nate. Post-merge follow-ups: rerun
  jobs-api-demo + x402-payer-demo against prod and paste outputs into
  /docs/jobs + /docs/payer-demo if they differ; 2 demo yf_ keys on the
  burner's /dashboard/keys (revoke at will); all dev test jobs
  canceled/failed + origin-fenced; the prod HL drill position untouched.
