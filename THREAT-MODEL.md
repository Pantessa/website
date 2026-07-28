# Yeetful Threat Model

**Scope note first, so this doc and `GUARDRAILS.md` never overlap.**

`GUARDRAILS.md` answers one question exhaustively: *is the artifact a user is
asked to sign safe?* Seven guarantees, per-builder, harness-pinned, with its
own adversarial audit procedure. It is the authority on the signing path.

**This document covers everything around it** — the surfaces where an attacker
never needs the user to sign anything:

1. Keys we hold and money that moves without a human in the loop
2. Authorization on every surface that isn't a transaction build
3. Supply chain, infrastructure, and data boundaries
4. Operational and process risk (how we develop and verify)

Status: **first draft, 2026-07-27.** Written before the first traffic push, by
Claude, from the architecture — not from a completed audit. Every "open
question" below is genuinely open: nobody has checked it yet. Findings should
be promoted from question → verified guarantee (with the harness check that
pins it) as the audit runs.

---

## The assets, ranked by what losing them costs

| Asset | Where it lives | Loss means |
|---|---|---|
| Guardian delegated agent keys | encrypted at rest, `GUARDIAN_KEY_SECRET` | an attacker trades users' Hyperliquid accounts, autonomously |
| House burner key | `PRIVATE_KEY` (Vercel env) | direct theft of house funds; every chat turn can spend it |
| Session signing secret | `SESSION_SECRET` | forge any user's session; full account takeover, no wallet needed |
| Cron trigger secret | `CRON_SECRET` | drive the guardian runner on demand |
| API keys (`yf_`) | hashed in DB, held by users/agents | act as that owner: mint links, spend under their policy |
| Treasury address | `lib/fees.ts` (code constant) | fee revenue redirected (a code-review target, not a runtime one) |
| The user's own wallet | never ours | *by design, unreachable* — non-custodial is the whole posture |
| Chat/link/job data | Neon `yeetful` | privacy exposure; funnel and earnings tampering |

The last row of the "unreachable" column is the point of the product: we hold
no user funds. **Every tier-1 risk below is about the few places where that
statement gets qualified.**

## The adversaries worth modeling

- **The wallet-cycling script.** Free house inference, RPC quota, planner
  tokens. Cheapest attack, most likely first. (Partly fenced —
  `lib/turn-limits.ts`, PR #569.)
- **The malicious MCP.** A user can add any server to their set. Its tool
  results reach the planner and, in the worst case, a sign button. Also the
  prompt-injection vector: **tool output is untrusted input that steers an
  agent that takes actions.**
- **The malicious embed host.** `/embed` ships `frame-ancestors *` by design.
  The host page controls framing, postMessage, and the wallet relay's inputs.
- **The curious authenticated user.** Someone else's job id, link slug, chat
  id, capability token, or org. Classic IDOR, high value here because the
  objects are money-shaped.
- **The insider-ish path.** Anyone with repo access runs against the *shared
  production database* (see §4). Not malice — routine.
- **The supply-chain attacker.** We publish `yeetful` to npm and depend on a
  young x402 ecosystem.

---

## 1. Keys and autonomous execution — the highest blast radius

Everything else in this document is recoverable. This section is not.

### HL Guardian (delegated keys + per-minute cron)

The only component that **moves user money with no human present**. A user
approves an agent wallet on Hyperliquid; we store that key encrypted and a
cron fires it when a trigger hits. Non-custodial in the sense that it can only
trade, never withdraw — that boundary is doing enormous work and deserves to
be verified, not assumed.

Open questions:
- What exactly does the encryption at rest look like — algorithm, key
  derivation, rotation story? What happens on `GUARDIAN_KEY_SECRET` rotation
  to already-stored keys?
- Are decrypted keys ever logged, traced, put in an error message, or held in
  a variable that reaches an exception handler?
- Can the delegated key do anything except place/cancel orders on the pinned
  account? Confirm against HL's agent-wallet permission model — *our* fence
  and *their* fence should both be checked.
- `CRON_SECRET`: constant-time compare? What happens on an unauthenticated
  call — refuse, or refuse *and* alert?
- Replay/idempotency: can one trigger fire twice? What stops a stuck run from
  looping orders?
- Revocation: when a user retires a policy, is the key destroyed or just
  marked inactive?

### The funded house burner (`PRIVATE_KEY`)

Chat turns can spend real house USDC. Since #467 the spend policy is
**open by default** (agents on, `['*']` allowlist, $200/$200 caps) — a
deliberate product decision that makes the caps the primary control rather
than a backstop.

Open questions:
- Can an unauthenticated or rate-limited-out visitor cause house spend at all?
  Trace every path from an anonymous turn to `spendCredits` / a burner send.
- Are the daily/per-call caps enforced server-side on *every* path, including
  the x402 auto-pay lane (≤$0.05 exact-priced endpoints)?
- `policyCheckInflow` (#469) made sales exempt from spend gating. Can an
  attacker shape an *outflow* to look like an inflow?

### Session forgery (`SESSION_SECRET`)

Sessions are 30-day HS256 JWTs over `{address}`. Verified this session: with
the secret, a valid session for **any address** is a five-line script. That's
correct design for a signed cookie, and it means the secret's handling is the
whole security story.

Open questions:
- Rotation policy, and whether prod/preview/dev share a secret (if they do,
  a preview leak is a prod compromise).
- **No revocation path.** A stolen cookie is valid for 30 days. Is a session
  version/epoch column worth adding so "sign out everywhere" exists?
- Is `SESSION_SECRET` reachable from any client bundle or build artifact?
  (Should be trivially "no" — worth proving once, in CI.)

---

## 2. Authorization on non-signing surfaces

`GUARDRAILS.md` proves a *build* is safe. It says nothing about who may read,
mint, or mutate. That's this section.

- **Every route, owner-checked.** An inventory sweep: for each handler under
  `app/api/**`, what identity does it require (session / bearer `yf_` /
  embed `yfe_` / none), and is the object it touches owner-scoped? The
  interesting ones are jobs, intent links, chats, org membership, and
  anything admin-gated by `ADMIN_WALLETS` / `OWNER_WALLETS`.
- **Capability tokens.** Job `?t=` tokens exist so embeds can poll. Scope,
  expiry, and guessability need a look; these are bearer credentials in URLs,
  which means they land in logs and referrers.
- **IDOR on money-shaped objects.** Job ids are cuids (fine), link slugs are
  short (by design — they're public), chat ids distinguish local vs DB
  (`lib/chat-ids.ts`). Confirm no endpoint trusts a client-supplied id without
  re-checking ownership server-side.
- **The bearer `yf_` agent door.** A key mints intent links *as its owner*.
  Confirm revocation is immediate, scopes are least-privilege, and a leaked
  key can't escalate past its owner's own policy.
- **`/embed` and the wallet relay.** `frame-ancestors *` is intentional. The
  relay allowlists methods (`switch/addEthereumChain` noted in the arch docs)
  — that allowlist is a security control and should be pinned by a test, plus
  postMessage origin handling reviewed against a hostile parent frame.
- **SSRF.** `lib/brand-scan.ts` has a real fence (https-only, public hosts,
  default port, post-redirect re-validation) — re-verify it covers DNS
  rebinding and redirect chains, then sweep for *other* fetchers taking
  user-supplied URLs (OpenSea item URLs, MCP endpoints on add, `redirectUrl`
  on links).
- **The new rate fence** (`lib/turn-limits.ts`). It trusts platform-stamped
  IP headers. Confirm Vercel always overwrites `x-forwarded-for` on the edge;
  if a client can inject it, the IP tier is bypassable (the wallet tier still
  holds).

---

## 3. Supply chain

- No dependency scanning in CI today (`.github/workflows/` has
  `agentic-sync` and `self-heal` only). Dependabot or equivalent, plus
  `pnpm audit` in CI, is the cheapest win available.
- We **publish** `yeetful` to npm. npm account 2FA, publish provenance, and
  who holds publish rights are all part of the threat model — a compromised
  publish is an attack on our users' agents, not just on us.
- The x402 ecosystem is young; `@x402/*` and MCP-kit dependencies deserve a
  manual look rather than trust-by-default.
- Lockfile integrity: pnpm 8 lockfile is pinned (pnpm 11 rejects it — a known
  gotcha). Confirm CI installs with `--frozen-lockfile`.

## 4. Infrastructure and data boundaries

**The finding that prompted this section:** development and drill traffic
writes to the **production** Neon database. During one session on 2026-07-27
alone, drill scripts created and deleted real rows — creator handles, brand
records, intent links, jobs, DCA schedules — in prod. The Guardian has an
`originEnv` fence precisely because this bit us before; the general case has
no such fence. The blog publish tests are documented as writing to prod too.

This is not hypothetical risk: it is current, routine practice. Options worth
weighing — a Neon branch per environment, a `DATABASE_URL` guard that refuses
destructive helpers against the prod host, or an `originEnv`-style column
convention extended past jobs.

Also open:
- Vercel env var scoping (prod vs preview): does a preview deploy hold prod
  secrets? If yes, preview is prod for blast-radius purposes.
- Cookie scoping: localhost cookies are shared **across ports** — stale
  sessions leak between worktree servers (a known dev gotcha; confirm it's
  dev-only and that prod cookies are `Secure`, `HttpOnly`, `SameSite`).
- Logging: does any log line carry a private key, session JWT, bearer key, or
  full wallet+balance profile?

## 5. Process risk

- **The e2e session patch.** Verifying SIWE-gated surfaces headlessly requires
  temp-patching the orphan-signout effect in `lib/session.tsx` with a
  `yf_e2e_keep_session` localStorage escape, then reverting by hand before
  commit. It has been done many times, including twice on 2026-07-27. If it
  ever ships, sessions survive wallet disconnect. **Make it structural**: an
  env-gated guard that can't be enabled in production, or at minimum a CI
  check that the string never lands on `main`.
- **Secret scanning.** Real funded keys live in `.env.local` files across
  several worktrees. One `git add -A` in the wrong directory is unrecoverable.
  `gitleaks`/`trufflehog` over full history plus a pre-commit hook is an
  afternoon of work and removes a whole category.
- **Prompt injection as a standing concern.** Every new MCP integration widens
  the "untrusted text steering an agent" surface. `guardPlannerArtifact` is
  the backstop for *signable* output; the audit question is what an injected
  instruction can achieve *short of* a signature — spending house credits,
  triggering paid x402 calls, poisoning working context, or social-engineering
  the user through our own UI copy.

---

## How findings get closed

The same discipline as the rest of the repo: **a finding that doesn't become a
pinned check regresses.** `scripts/test-api.ts` (1000+ checks),
`audit:asks`, `audit:funding`, and `preflight:house` are the precedent —
security findings should land the same way, so a fix can't quietly come
undone. `GUARDRAILS.md` §"Running the audit" is the model for a repeatable
procedure.

Suggested order of work, cheapest-first:

1. Secret scanning over full history + pre-commit hook (hours)
2. Dependency scanning in CI (hours)
3. The §5 process fixes — they're small and they stop future self-inflicted wounds
4. The §2 route/authz inventory sweep (a day, highly parallelizable)
5. The §1 key-custody review — slowest and most valuable; worth an **external**
   adversarial review of the guardian delegation design before scaling it
6. The §4 prod-data boundary decision (a product/infra call, not a code fix)
