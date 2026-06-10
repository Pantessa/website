# Autopilot run — 2026-06-10

Unattended build experiment. Claude works through the queue below, one item per
iteration, while the owner is away. **Nothing here merges to `main`** — every
item becomes a PR into the `autopilot` branch for human review.

## Rules (constitution — apply to every iteration)

1. **Branching**: each item gets its own branch `autopilot/<slug>` cut from
   `autopilot`. PRs target `autopilot`, never `main`. Items are independent —
   never stack one item's branch on another's.
2. **Never**: merge any PR, push to `main`, force-push, deploy, publish,
   or make live paid x402 calls. No spending of any kind.
3. **DB (owner-expanded 2026-06-10)**: schema may be rearranged — add, alter,
   drop, rename — PROVIDED the system keeps working end-to-end (code migrated
   in the same branch, verification proves the affected routes still work).
   Never destroy user data (grants, ledger, chats, approvals) without a
   migration path; `--force-reset` remains forbidden. Test rows always cleaned.
4. **New repos (owner-authorized)**: may create a new directory under
   /Users/nategeier/yeetful and a new PUBLIC repo under the Yeetful org for
   the example integration. HARD RULE before any push to a public repo: grep
   the tree for secrets (sk-, key, PRIVATE, token, 0x[64 hex], .env) — only
   .env.example ships, never .env. The demo/ directory and the sdk/ repo may
   also be modified on branches per the same PR rules.
5. **Verify before PR**: `npx tsc --noEmit` + `npm run build` minimum. UI items
   need preview screenshots at 1440px in the PR body. Server-logic items need a
   temp verification script against Neon (test rows under a `0x…dead/beef/feed`
   owner, ALWAYS cleaned up, script deleted before commit).
6. **Honesty**: anything unverifiable headlessly (wallet signatures, SIWE-gated
   UI states) is flagged "needs manual pass" in the PR — never claimed as done.
7. **Logging**: after each item, update the Progress log below on the
   `autopilot` branch and push. If an item fails verification twice, log it,
   close its branch, move on. Two consecutive failed items → stop the run.
8. **Isolation**: work in this session's worktree only. Don't touch other
   branches, other sessions' work, or open PRs from earlier today.
9. **Stop conditions**: queue exhausted, two consecutive failures, or owner
   sends any message. Final iteration writes a run summary below.

## Queue (ordered; one per iteration)

- [x] **1. API keys for headless agents** — `ApiKey` model (sha256-hashed
  secret, owner, label, lastUsedAt; plaintext shown once at mint). SIWE-gated
  `/api/keys` CRUD. Accept `Authorization: Bearer yf_…` as an auth alternative
  on `/api/grants*`, plus new `POST /api/grants/[id]/ledger` so the `yeetful`
  SDK's `onReceipt` can sync receipts into the dashboard. Verify with a Neon
  script (mint → authed request → ledger row → cleanup). Then wire the
  `yeetful` SDK (../sdk repo, own branch + PR): `yeetful/agent` accepts
  `{ apiKey, ledgerUrl }` and ships an onReceipt-based hosted-ledger sync.
- [x] **2. EIP-712 grant signing (server side)** — typed-data schema for grant
  terms (allow/caps/expiry), `PUT /api/grants/[id]/signature` verifying the
  signature recovers the owner (viem `verifyTypedData`), persist to the
  existing `signature` column; expose `signed: boolean` in grant reads. Verify
  by signing with a throwaway key in a script. Wallet UI button = follow-up,
  flagged.
- [x] **3. Service detail page `/servers/[slug]`** — endpoint browser UI over
  the existing detail API: header (icon, category, price, networks, callable
  badge), endpoint list (method chip, path, description, price, provider,
  params), link from directory cards. Preview-verified with screenshots.
- [x] **4. Cost-at-volume warnings** — on the service detail page: implied
  cost at 1 call/min and 1 call/sec from the endpoint price ("$0.01/call ≈
  $864/day at 1 call/sec"), amber styling past a threshold. Tiny, honest UX
  for the per-call pricing critique. Preview-verified.
- [x] **5. Example integration (public repo)** — new directory
  `/Users/nategeier/yeetful/example-agent` + public repo `Yeetful/example-agent`:
  a small standalone Node script that uses the published `yeetful` SDK with a
  spend grant (and, if item 1 landed, API-key ledger sync) to call x402
  endpoints — the "how an app adds this" artifact. README with the 3-line
  pitch. `.env.example` only; run the secrets grep before EVERY push. Also
  refresh `../demo` to consume the same flow where it overlaps.
- [ ] **6. Receipts → `Message.meta`** — chat client persists the receipts
  array into `Message.meta` on save; `/chat/[id]` renders a compact receipt
  footnote under assistant messages from stored meta. API path verifiable
  (meta already accepted); rendered state needs SIWE → flag manual.

## Progress log

_(autopilot appends here — branch, PR, verification evidence, caveats)_

### Iteration 1 — Item 1: API keys for headless agents ✅
- **Branches/PRs**: website `autopilot-api-keys` → [Yeetful/website#26](https://github.com/Yeetful/website/pull/26) (base `autopilot`); sdk `hosted-ledger-sync` → [Yeetful/sdk#2](https://github.com/Yeetful/sdk/pull/2) (base `main` — that repo has no `autopilot` branch; PR is marked review-only/no-merge, and merging would imply an npm publish autopilot can't do).
- **Naming deviation**: constitution says `autopilot/<slug>`, but git refuses `autopilot/*` refs while the `autopilot` branch exists → using `autopilot-<slug>`.
- **Website**: `ApiKey` model (sha256 hash, prefix, lastUsedAt; plaintext `yf_…` shown once at mint), SIWE-gated `/api/keys` + `/api/keys/[id]`, Bearer-or-SIWE `getAuthAddress()` on all `/api/grants*`, new `POST /api/grants/[id]/ledger` for SDK receipt sync. Additive `prisma db push` applied to Neon (`api_keys` table).
- **SDK**: `yeetful({ apiKey, ledgerUrl })` → ordered best-effort receipt sync (settlements AND denials) to the hosted ledger with Bearer auth; `pay.flushLedger()`; README section.
- **Verification**: temp script (deleted before commit) vs dev server + real Neon — SIWE mint → Bearer CRUD → ledger row (host normalized, spentTodayUsd correct) → cross-wallet 404 → revoked key 401 → full cleanup, **17/17 green**; `tsc --noEmit` + `npm run build` ✓. SDK: **10/10 vitest** (4 new sync tests), typecheck + tsup ✓, secrets grep clean before push.
- **Caveats**: live SDK↔prod sync untestable until #26 deploys (flagged in sdk#2). No dashboard UI for key management (not in scope). Key minting deliberately stays SIWE-only.

### Iteration 2 — Item 2: EIP-712 grant signing (server side) ✅
- **Branch/PR**: `autopilot-eip712-grants` → [Yeetful/website#27](https://github.com/Yeetful/website/pull/27) (base `autopilot`; independent of #26 — route uses `getSessionAddress`, switch to `getAuthAddress` after both merge).
- **What**: `lib/grant-typed-data.ts` (canonical SpendGrant struct — Base chainId, sorted lowercased allow, USD as 1e6 micros, unix-seconds expiry; always built from the stored row), `GET`+`PUT /api/grants/[id]/signature` (verify via `publicClient.verifyTypedData` — EOA + ERC-1271/6492 — persist to existing `signature` column), `signed: boolean` in grant reads, signature voided when terms change (PATCH caps, approval-toggle allowlist re-derivation).
- **Verification**: temp script (deleted) vs dev + Neon — throwaway-key sign → persisted; foreign/malformed sig → 400; cap change voids; re-sign from GET payload; anon 401/foreign 404; cleanup. **12/12 green**; tsc + build ✓. No schema change.
- **Flagged**: wallet UI "Sign grant" button is a follow-up; wallet-popup + smart-wallet signing can't be verified headlessly (EOA path script-proven).

### Iteration 3 — Item 3: Service detail page /servers/[slug] ✅
- **Branch/PR**: `autopilot-service-detail` → [Yeetful/website#28](https://github.com/Yeetful/website/pull/28) (base `autopilot`).
- **What**: server-rendered endpoint browser over the directory DB — header (brand tile, category/price/networks, green "Callable in chat" badge, agentic.market link), endpoint rows (method chip, path, provider/host, flat or metered price, description, zero-JS `<details>` param schemas). Directory card names now link to it (stopPropagation keeps the add/remove toggle intact). Unknown slug / DB down → 404.
- **Verification**: preview at 1440px — tripadvisor (callable, 5 eps), exa (params expanded), blockrun-ai (122 eps); card-link navigation; zero console errors; 404 path; tsc + build ✓. Screenshots committed under `docs/autopilot/` on the PR branch (raw links in PR body; folder can be dropped at merge).
- **Caveats**: preview-tool screenshots came back black when scrolled, so captures were re-done with headless Chrome. `yeetful-claude` has no mcp_endpoints rows in the DB → its page shows the empty state (ingest content gap, noted in PR).

### Iteration 4 — Item 4: Cost-at-volume warnings ✅
- **Branch/PR**: `autopilot-cost-warnings` → [Yeetful/website#29](https://github.com/Yeetful/website/pull/29) (base `autopilot`). **Stacked on `autopilot-service-detail` by necessity** — the item annotates item 3's page; PR body says merge #28 first (then #29 is a +42-line delta) and warns against merging into the side branch.
- **What**: per-endpoint "AT VOLUME ≈ $X/day @ 1 call/min · ≈ $Y/day @ 1 call/sec" computed from the per-call price; amber at ≥$500/day; metered (upto) endpoints prefixed "from" (only the floor is known); unpriced endpoints show nothing. Zero client JS.
- **Verification**: math reproduces the queue's example ($0.01 → $864/day amber); preview at 1440px on exa (muted + amber-metered) and tripadvisor (all amber); console errors unchanged from baseline (pre-existing Coinbase-SDK COOP noise, present on home page too); tsc + build ✓. Screenshots in `docs/autopilot/` on the branch.
- **Interruption note**: owner messaged twice mid-run (caffeinate/sleep questions) — run paused per stop rule and resumed by owner re-invoking /loop both times.

### Iteration 5 — Item 5: Example integration (public repo) ✅ (demo refresh skipped — see caveat)
- **Repo**: [Yeetful/example-agent](https://github.com/Yeetful/example-agent) (PUBLIC), new dir `/Users/nategeier/yeetful/example-agent`. Initial commit pushed to its `main` — unavoidable for a brand-new repo (no base branch to PR against); this is the owner-authorized "create the repo" act, not a push to website/sdk main.
- **What**: standalone Node script on the published `yeetful@0.2.0` — `yeetful({ wallet, grant })` expense account with allowlist + caps; free-by-default demo (throwaway key: allowlisted free call receipted at $0, off-allowlist call denied pre-network with receipt); `LIVE=1` + `PRIVATE_KEY` documented for one real $0.01 TripAdvisor call (NOT run — no spending). README has the 3-line pitch + dashboard-sync section (notes `apiKey`/`grant.id` sync activates with yeetful ≥ 0.3 / sdk#2 — 0.2.x ignores it harmlessly). `.env.example` only.
- **Verification**: `npm start` demo run green (receipts + denial as designed, $0 spent). **Secrets grep before push: zero hits**, no `.env` in tree.
- **Caveat — demo/ refresh SKIPPED**: `demo/` has no git repository (checked: no `.git`, not nested in any repo), so the constitution's required branch+PR workflow is impossible there, and unversioned edits would be unrevertable. Left untouched; owner may want to `git init` demo/ first.
