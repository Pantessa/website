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

- [ ] **1. API keys for headless agents** — `ApiKey` model (sha256-hashed
  secret, owner, label, lastUsedAt; plaintext shown once at mint). SIWE-gated
  `/api/keys` CRUD. Accept `Authorization: Bearer yf_…` as an auth alternative
  on `/api/grants*`, plus new `POST /api/grants/[id]/ledger` so the `yeetful`
  SDK's `onReceipt` can sync receipts into the dashboard. Verify with a Neon
  script (mint → authed request → ledger row → cleanup). Then wire the
  `yeetful` SDK (../sdk repo, own branch + PR): `yeetful/agent` accepts
  `{ apiKey, ledgerUrl }` and ships an onReceipt-based hosted-ledger sync.
- [ ] **2. EIP-712 grant signing (server side)** — typed-data schema for grant
  terms (allow/caps/expiry), `PUT /api/grants/[id]/signature` verifying the
  signature recovers the owner (viem `verifyTypedData`), persist to the
  existing `signature` column; expose `signed: boolean` in grant reads. Verify
  by signing with a throwaway key in a script. Wallet UI button = follow-up,
  flagged.
- [ ] **3. Service detail page `/servers/[slug]`** — endpoint browser UI over
  the existing detail API: header (icon, category, price, networks, callable
  badge), endpoint list (method chip, path, description, price, provider,
  params), link from directory cards. Preview-verified with screenshots.
- [ ] **4. Cost-at-volume warnings** — on the service detail page: implied
  cost at 1 call/min and 1 call/sec from the endpoint price ("$0.01/call ≈
  $864/day at 1 call/sec"), amber styling past a threshold. Tiny, honest UX
  for the per-call pricing critique. Preview-verified.
- [ ] **5. Example integration (public repo)** — new directory
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
