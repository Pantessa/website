# Autopilot — Run 3 (staged 2026-06-11, owner-approved queue; start via /loop)

Unattended build run, ~1 hour. One item per iteration; PRs into `autopilot`,
never `main`. Runs 1–2 are summarized at the bottom; full logs in git history.

## Rules (constitution — apply to every iteration)

1. **Branching**: `autopilot-<slug>` cut from `autopilot`. PRs target
   `autopilot`, never `main`. Items independent; unavoidable stacking must be
   declared in the PR with merge order.
2. **Never**: merge any PR, push to `main`, force-push, deploy, publish to
   npm, or make live paid x402 calls. No spending of any kind.
3. **DB**: additive only (plain `db push`, never `--force-reset`); never
   destroy user data. Test rows under throwaway wallets, ALWAYS cleaned,
   verified zero left. Items 4–5 carry extra guardrails — see the items.
4. **Public repos** (`demo`, `sdk`, `example-agent` are PUBLIC): secrets grep
   before EVERY push — `sk-`, `0x[64 hex]`, `key/token = <value>`, env files;
   `git ls-files` check for tracked env files; review every hit; never pipe
   the grep through anything that masks its exit code.
5. **Verify before PR**: `npx tsc --noEmit` + `npm run build` minimum.
   Server-logic: temp script vs dev + real Neon (or the new test:api harness
   once item 1 lands — prefer extending it over new temp scripts). UI:
   preview at 1440px, headless-Chrome screenshots under `docs/autopilot/` on
   the PR branch (stripped before main).
6. **Wallet/SIWE-gated UI**: verify logic via scripts + tsc/build; flag gated
   visuals "needs manual pass" — never claimed.
7. **Honesty**: anything unverifiable is flagged, not claimed.
8. **Logging**: update the Progress log on `autopilot` after each item. One
   item failing twice → log, close branch, move on. Two consecutive failures
   → stop the run.
9. **Isolation**: this session's worktree only; don't touch PRs you didn't
   open this run.
10. **Stop conditions**: queue exhausted, two consecutive failures, or owner
    message. Final iteration appends a run summary.

## Queue (ordered; one per iteration)

- [x] **1. Committed API test harness** — consolidate the Run-1/2 throwaway
  verification patterns into `scripts/test-api.ts` + `npm run test:api`
  (runs vs a dev server + Neon, throwaway SIWE wallets, full cleanup):
  auth nonce/verify, keys mint/list/revoke + Bearer auth, grants CRUD +
  caps validation, EIP-712 GET/PUT/void/re-sign, ledger sync + cross-wallet
  404, receipts→Message.meta round-trip + share-page render. Mirrors
  test-auth.ts style (check/pass/fail counters, exit code). Run it green
  twice; it becomes the standing verification tool for later items.
- [x] **2. Fix the duplicate React key warning** — the home page console
  spams "two children with the same key, `235`" from the runner demo feed
  (numeric keys repeat as the feed cycles). Find the keyed list in
  components/RunnerDemo.tsx (or Hero), key by a monotonic id, verify the
  warning is gone in preview console after letting the feed cycle. Tiny,
  preview-verifiable.
- [x] **3. SDK 0.3 ripple (published!)** — `yeetful@0.3.0` is live on npm:
  bump `example-agent` and `demo` to `^0.3.0` (their repos, own branches +
  PRs, secrets grep before push), re-run their offline checks (`npm start`
  demo mode / `npm run grant` dry-run — NO --live), and delete the
  "activates with yeetful ≥ 0.3 / ignored by 0.2.x" caveats from
  example-agent README, website `/developers` page, `ConnectAgentCard`,
  and the sdk README if present. Also drop example-agent's runtime
  `typeof pay.flushLedger === 'function'` guard — 0.3 always has it.
- [ ] **4. Ingest auto-wire probe for inference providers (PROD DB)** —
  extend `scripts/ingest-agentic.ts`: after building services, for each
  kind=inference service NOT already in the CALLABLE map that exposes an
  OpenAI-compatible `chat/completions` endpoint, probe it (free request →
  402): wire it (callable, protocol http, endpoint, default model from a
  curated per-brand map or the gateway's cheapest, priceUsd from the
  challenge) ONLY if the challenge parses, scheme is `exact`, and price ≤
  $0.05; metered/keyed/dead → listed-only with the reason logged. Probes
  are free GETs/POSTs that never pay. Guardrails: `--dry` prints decisions
  without writing; run --dry first and put the decision table in the PR;
  then a live run with before/after counts; existing CALLABLE entries are
  never overridden; the 4 BlockRun providers + yeetful-claude/tripadvisor/
  wolfram wiring verified intact after.
- [ ] **5. Stale endpoint URL fix-up (PROD DB)** — directory mcp_endpoints
  rows for BlockRun gateways point at `blockrun.ai/v1/*`, which 404s (the
  live path is `blockrun.ai/api/v1/*` — probed in Run 2). Committed
  idempotent script: for each distinct stale URL, probe both forms (free
  request; 402/200 = alive, HTML 404 = dead) and rewrite rows to the
  verified-alive form; rows where neither form responds stay untouched and
  are listed in the PR. Before/after counts + per-URL probe evidence table
  in the PR. Detail pages re-screenshotted for one affected service.

## Progress log — Run 3

_(autopilot appends here — branch, PR, verification evidence, caveats)_

### Iteration 1 — Item 1: Committed API test harness ✅
- **Branch/PR**: `autopilot-test-harness` → [Yeetful/website#42](https://github.com/Yeetful/website/pull/42).
- **What**: `scripts/test-api.ts` + `npm run test:api` — 25 checks across auth, keys (show-once/Bearer/revocation), grants (validation/scoping), EIP-712 (sign/void/re-sign), ledger sync, chat-receipt meta + share render, verified cleanup.
- **Verification**: green twice back-to-back vs dev + Neon; tsc + build ✓. Later items extend this harness per rule 5.

### Iteration 2 — Item 2: Duplicate React key fix ✅
- **Branch/PR**: `autopilot-feed-keys` → [Yeetful/website#43](https://github.com/Yeetful/website/pull/43).
- **What**: RunnerDemo's auto-fund path ran `seq.current += 1` + nested `setLog` inside the `setBalance` updater (double-invoked in dev → corrupted keys). Refill decision moved into `tick()` with a `balanceRef` mirror; all updaters pure; one monotonic key source.
- **Verification**: armed console hook over ~105 feed ticks (24-entry window cycled 4×) — zero same-key errors; tsc + build ✓. Caveat in PR: original trigger was timing-dependent, but the removed pattern was the only numeric-keyed list and a known hazard.

### Iteration 3 — Item 3: SDK 0.3 ripple ✅
- **PRs**: [example-agent#1](https://github.com/Yeetful/example-agent/pull/1) (^0.3.0, unguarded flushLedger, all ≥0.3 caveats deleted; free demo re-run on the published package, zero spend) · [demo#2](https://github.com/Yeetful/demo/pull/2) (^0.3.0; dry-run re-verified, tsc clean). Both public repos: secrets grep + tracked-env checks clean.
- **Website**: grep found NO ≥0.3 caveats on /developers or ConnectAgentCard (the queue item over-assumed) — no website change needed; sdk README also clean.
- **Flagged**: demo `--live` still the owner's manual pass (spends).

---

## Run 2 summary (2026-06-10 evening)

**Queue: 7/7 complete.** Zero failed iterations. Nothing merged, no deploys, no spending. All PRs target `autopilot`.

| # | Item | PR |
|---|------|----|
| 1 | API-key management UI | [#34](https://github.com/Yeetful/website/pull/34) |
| 2 | "Connect an agent" card | [#35](https://github.com/Yeetful/website/pull/35) — stacked on #34, merge #34 first |
| 3 | "Sign grant" wallet button | [#36](https://github.com/Yeetful/website/pull/36) |
| 4 | Chat payments-footer dedup | [#37](https://github.com/Yeetful/website/pull/37) |
| 5 | Directory refresh + Claude seed (prod DB) | [#38](https://github.com/Yeetful/website/pull/38) — DB changes already live |
| 6 | Responsive pass | [#39](https://github.com/Yeetful/website/pull/39) |
| 7 | /developers page | [#40](https://github.com/Yeetful/website/pull/40) |

**Suggested merge order**: #34 → #35 → #36 → #37 → #38 → #39 → #40. All independent except #35 (stacks on #34). NOTE: #33 (inference providers, targets main) shares files with #36/#37/#38 — merge autopilot→main AFTER #33, or vice versa; the ingest-map hunk in #38 is identical to #33's so it merges clean.

**Manual passes for the owner** (most fold into one wallet session):
- Dashboard glance: key panel (mint→reveal→copy→revoke), connect-agent card, sign-grant button + one wallet signature.
- One live paid chat turn (~$0.001–0.01): covers #30/#33/#37 receipts end-to-end.
- demo repo: `npm run grant -- --live`.

**Deviations/notes**: #35 stacking declared per rule 1's escape hatch; #38's safety catch (ingest map predated #33 — would have unwired prod inference providers; fixed before running); headless-Chrome mobile captures clip ~15px (camera artifact, programmatic overflow scan is authoritative); mcp_endpoints has no `source` column so hand-seed provenance lives in the description + committed script.

---

## Run 1 (2026-06-10) — COMPLETE, 6/6, all merged to main

| # | Item | PR |
|---|------|----|
| 1 | API keys for headless agents | website#26 + sdk#2 |
| 2 | EIP-712 grant signing (server) | website#27 |
| 3 | Service detail page /servers/[slug] | website#28 |
| 4 | Cost-at-volume warnings | website#29 |
| 5 | Example integration | github.com/Yeetful/example-agent |
| 6 | Receipts → Message.meta + footnotes | website#30 |

Follow-ups merged same day: #31 (Details links), #32 (autopilot→main),
demo#1 (live mode via published SDK). Manual passes still pending from Run 1:
wallet-paid chat turn, demo `--live`, SDK↔prod sync, dashboard visuals.
Full iteration log: `git log --follow AUTOPILOT.md` (pre-Run-2 revisions).
