# Autopilot — Run 2 (staged 2026-06-10, owner-approved queue; start via /loop)

Unattended build run. Claude works the queue below, one item per iteration.
**Nothing merges to `main`** — every item becomes a PR into `autopilot` for
human review. Run 1 (6/6 complete, all merged to main same day) is summarized
at the bottom; its full log lives in git history of this file.

## Rules (constitution — apply to every iteration)

1. **Branching**: each item gets its own branch `autopilot-<slug>` cut from
   `autopilot` (git refuses `autopilot/*` refs while the `autopilot` branch
   exists). PRs target `autopilot`, never `main`. Items are independent —
   never stack one item's branch on another's; if stacking is truly
   unavoidable (an item amends another's surface), say so in the PR body and
   instruct which merges first.
2. **Never**: merge any PR, push to `main`, force-push, deploy, publish to
   npm, or make live paid x402 calls. No spending of any kind.
3. **DB**: additive changes OK (plain `db push`, never `--force-reset`).
   Never destroy user data (grants, ledger, chats, approvals, api_keys).
   Test rows under throwaway wallets, ALWAYS cleaned, verified zero left.
   Item 5 has extra guardrails — see the item.
4. **Public repos** (`website` is private; `demo`, `sdk`, `example-agent` are
   PUBLIC): secrets grep before EVERY push — `sk-`, `0x[64 hex]`,
   `api_key/token = <value>`, env files; check `git ls-files` for tracked env
   files, only `.env.example` ships. Review every hit; don't pipe the grep
   through anything that masks its exit code.
5. **Verify before PR**: `npx tsc --noEmit` + `npm run build` minimum.
   Server-logic items: temp verification script vs dev server + real Neon
   (throwaway SIWE wallets, cleanup verified, script deleted before commit).
   UI items: preview at 1440px; screenshots via **headless Chrome** (the
   preview tool renders black when scrolled), committed under
   `docs/autopilot/` on the PR branch and referenced by raw link in the PR
   body (folder is stripped before anything lands on main).
6. **Wallet/SIWE-gated UI** (dashboard etc.) can't be exercised headlessly:
   verify the logic via API scripts + tsc/build, verify any presentational
   component through a publicly rendered surface if one exists, and flag the
   gated visuals "needs manual pass" — never claimed as done.
7. **Honesty**: anything unverifiable is flagged in the PR, not claimed.
8. **Logging**: after each item, update the Progress log below on `autopilot`
   and push. An item failing verification twice → log it, close its branch,
   move on. Two consecutive failed items → stop the run.
9. **Isolation**: this session's worktree only; don't touch other branches or
   open PRs you didn't create this run.
10. **Stop conditions**: queue exhausted, two consecutive failures, or the
    owner sends any message. Final iteration appends a run summary.

## Queue (ordered; one per iteration)

- [x] **1. API-key management UI** — dashboard panel over the existing
  `/api/keys*` routes: list keys (prefix, label, lastUsedAt, createdAt),
  mint with a label → modal showing the plaintext `yf_…` ONCE with a copy
  button + "you won't see this again", revoke with confirm. Empty state
  explains what keys are for. Logic verified by API script; gated visuals
  flagged manual per rule 6.
- [x] **2. "Connect an agent" onboarding card** — after a key exists, the
  dashboard shows a copy-paste `yeetful/agent` snippet preloaded with the
  user's active grant id, ledger URL, and a `YEETFUL_API_KEY` placeholder
  (never the real secret — it's unrecoverable post-mint), linking to
  github.com/Yeetful/example-agent and the npm package. Pure presentational
  component → unit-verifiable; placement on dashboard flagged manual.
- [x] **3. "Sign grant" wallet button** — on the dashboard budget/grant card:
  fetch `GET /api/grants/[id]/signature`, sign via wagmi
  `signTypedDataAsync`, `PUT` the result; show a signed/unsigned badge from
  `signed`, and a "re-sign" nudge when a terms change voided it. BigInt
  conversion from the JSON payload (micros/expiry) — see the
  verify-eip712 pattern in Run 1. Wallet popup = manual pass; everything up
  to the signature request script-verified.
- [x] **4. Dedup the chat payments footer** — `/api/chat` replies still embed
  the text `paymentsFooter` AND receipts now render as structured footnotes
  from `Message.meta` (both burner and wallet paths, guests included via the
  ephemeral store). Strip the text footer from the reply, keep the meta.
  Verify via API script: reply text clean, receipts array intact; guest
  (no-SIWE) path covered since meta lives in the in-memory store.
- [x] **5. Directory endpoint data refresh (PROD DB — owner-approved)** —
  `yeetful-claude` and other callable services have no `mcp_endpoints` rows,
  so their detail pages show the empty state. Run `npm run db:ingest`
  **additive only — never `--prune`**; if agentic.market doesn't carry
  Yeetful·Claude's surface, hand-seed its known endpoints (Venice/Bankr/
  BlockRun.AI providers; correct $0.005 pricing) with `source` marking them
  hand-seeded. Guardrails: record row counts before/after in the PR; verify
  after ingest that the 3 callable services' wired `CALLABLE` fields are
  untouched and `/api/servers` + chat planner inputs still resolve; any
  anomaly → stop, document, don't retry destructively. This item commits a
  script if hand-seeding (idempotent, committed, NOT deleted — it's a
  fixture, not a test).
- [ ] **6. Responsive pass on the new surfaces** — `/servers/[slug]` and the
  directory cards at 375px and 768px (header wrap, endpoint rows, volume
  lines, Details chips), plus the dashboard grid where tsc-checkable. Fix
  overflow/wrap issues in `x402-design.css`. Headless-Chrome screenshots at
  both widths in the PR.
- [ ] **7. `/developers` page** — public, server-rendered: the expense-account
  pitch (3-liner from example-agent), a quickstart (install `yeetful`, mint a
  key on the dashboard, snippet with grant + apiKey), reference tables for
  Bearer auth on `/api/grants*` and the ledger-sync endpoint, links to npm /
  example-agent / demo repos. Footer/nav link where the design allows.
  Preview-verified with screenshots (public page — fully verifiable).

## Progress log — Run 2

_(autopilot appends here — branch, PR, verification evidence, caveats)_

### Iteration 1 — Item 1: API-key management UI ✅
- **Branch/PR**: `autopilot-key-ui` → [Yeetful/website#34](https://github.com/Yeetful/website/pull/34) (base `autopilot`).
- **What**: `ApiKeysPanel` on `/dashboard` (between approvals and activity feed) — mint with label → show-once `yf_…` secret in an emerald reveal block (copy + explicit dismiss), key list (prefix/label/used/created), two-step revoke with optimistic removal, explanatory empty state. No server changes — sits on Run-1 routes.
- **Verification**: temp script (deleted) replayed the panel's exact call sequence vs dev + Neon — mint w/ and w/o label, list shows prefixes never secrets, revoke, zero rows left — **5/5 green**; tsc + build ✓.
- **Flagged**: rendered panel needs one manual glance (wallet+SIWE gate, rule 6).

### Iteration 2 — Item 2: "Connect an agent" onboarding card ✅
- **Branch/PR**: `autopilot-connect-card` → [Yeetful/website#35](https://github.com/Yeetful/website/pull/35) (base `autopilot`; **stacked on #34** per rule 1's escape hatch — same dashboard region + key-state composition; merge #34 first).
- **What**: `ConnectAgentCard` shows once a key + grant exist — preloaded `yeetful/agent` snippet (owner's grant id, deployment ledger URL, ALWAYS the `process.env.YEETFUL_API_KEY` placeholder), copy button, links to example-agent + npm. `ApiKeysPanel` gains `onKeysChange`.
- **Verification**: static-render unit script (deleted) — 9/9 incl. "no secret-shaped string possible" and hidden-state checks; tsc + build ✓.
- **Flagged**: live placement glance (rule 6).

### Iteration 3 — Item 3: "Sign grant" wallet button ✅
- **Branch/PR**: `autopilot-sign-grant` → [Yeetful/website#36](https://github.com/Yeetful/website/pull/36) (base `autopilot`; independent — budget-meter card region).
- **What**: self-contained `SignGrantButton` — GET typed data + signed flag, pure exported `toSignable()` (uint256s from the served types), wagmi sign, PUT; emerald Signed badge / outline Sign button / amber "terms changed — re-sign" nudge (refreshKey wired to approval toggles).
- **Verification**: temp script (deleted) replayed the exact component data path with a throwaway key — GET → convert (BigInts asserted) → sign → PUT 200 signed:true → cap-change void → re-sign — **7/7 green**; tsc + build ✓.
- **Flagged**: wallet popup + visuals manual (rule 6); EOA path script-proven.

### Iteration 4 — Item 4: Chat payments-footer dedup ✅
- **Branch/PR**: `autopilot-footer-dedup` → [Yeetful/website#37](https://github.com/Yeetful/website/pull/37) (base `autopilot`; independent).
- **What**: `paymentsFooter` → `infoFooter` (reply keeps only listed-only + diagnostics + the burner grant-status line); 💸 paid-total moved into the structured footnote — `/api/chat` returns `payer`, client persists it in meta, `MessageReceipts` renders the total/payer summary above receipt rows. Orphaned `short()` removed.
- **Verification**: temp scripts (deleted) — meta.payer round-trip; shared page renders total + payer + rows, zero old footer markers; tsc + build ✓. (Repeat lesson: strip React's `<!-- -->` text-node comments before HTML assertions.)
- **Flagged**: one live paid turn (shared with the #30/#33 manual pass — no extra spend).

### Iteration 5 — Item 5: Directory endpoint data refresh (prod DB) ✅
- **Branch/PR**: `autopilot-directory-refresh` → [Yeetful/website#38](https://github.com/Yeetful/website/pull/38) (base `autopilot`).
- **Counts**: servers 71→71; endpoints 1768→1770 (ingest) →1771 (seed); yeetful-claude eps 0→1. All 7 callable services' wiring verified intact post-run.
- **Safety catch**: this branch's ingest CALLABLE map predated #33 — running naively would have UNWIRED the four BlockRun inference providers in prod. Map updated first (duplicates #33's hunk, declared in PR).
- **Hand-seed**: committed idempotent fixture `scripts/seed-yeetful-claude-endpoints.ts` (double-run proven) — POST anthropic.yeetful.com/api/mcp/mcp, $0.005 exact; provenance in description + script (mcp_endpoints has no source column — noted deviation). Detail page renders the endpoint (screenshot on branch); no anomalies.

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
