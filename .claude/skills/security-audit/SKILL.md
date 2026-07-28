---
name: security-audit
description: Run a security review of Yeetful using its own threat model — key custody and autonomous execution, authorization on non-signing surfaces, supply chain, data boundaries, and prompt injection. Use when asked to audit security, review a surface for vulnerabilities, check authorization or key handling, threat-model a new feature, or triage a suspected security issue. Also use before shipping anything that touches keys, sessions, spend policy, delegated execution, or a new MCP integration.
---

# Auditing Yeetful

Yeetful is a **non-custodial transaction layer**: it builds guarded calldata
that users sign with their own wallets. Generic web-app audit checklists
mostly miss the point here. Read this before spending effort.

## Read these two documents first — they split the surface

- **`GUARDRAILS.md`** — the authority on *"is what the user signs safe?"*
  Seven guarantees, per-builder, harness-pinned, with its own adversarial
  audit procedure. **Do not re-derive its conclusions.** If the finding is
  about calldata, recipients, approvals, deadlines, relays, or fees, that
  document owns it — extend it there.
- **`THREAT-MODEL.md`** — everything around the signing path: key custody and
  autonomous execution, authorization on non-signing surfaces, supply chain,
  data boundaries, process risk. Its "open questions" are the live audit
  backlog; promote them to verified guarantees as they're checked.

## What actually matters here, in order

1. **Autonomous money.** The HL Guardian holds delegated agent keys and a
   per-minute cron fires them with no human present. This is the only place
   user money moves unattended. Highest blast radius in the system.
2. **The house burner.** `PRIVATE_KEY` is funded; chat turns can spend real
   USDC. Spend policy is open-by-default since #467, so the $200/$200 caps
   are the primary control, not a backstop.
3. **Session forgery.** 30-day HS256 JWTs over `{address}`, no revocation.
   With `SESSION_SECRET`, forging any user's session is trivial — so the
   secret's handling *is* the control.
4. **Untrusted tool output steering an agent.** Users can add any MCP. Treat
   prompt injection as a security issue, not a curiosity: ask what an
   injected instruction achieves *short of* a signature (house spend, paid
   x402 calls, poisoned working context, hostile UI copy).
5. **Authorization on non-signing surfaces.** Owner checks per route, job
   `?t=` capability tokens, bearer `yf_` keys, admin wallet gating, IDOR on
   money-shaped objects.

## Rules for auditing this repo

- **Never run destructive helpers against the production database.** The app
  DB is `yeetful` on Neon project `red-scene-95674385` and dev/drill traffic
  already writes to it (a documented finding — `THREAT-MODEL.md` §4). Reads
  and additive writes are fine; clean up any rows you create.
- **Never commit the e2e session patch.** Verifying signed-in surfaces
  headlessly uses a temp `yf_e2e_keep_session` guard in `lib/session.tsx`.
  Revert before every commit; `git status` before you stage.
- **Never move real money to prove a finding.** Build artifacts and refuse to
  sign them; a guarded build that *would* be wrong is proof enough. Real
  transactions need Nate's explicit consent (standing rule 4).
- **Don't paste secrets into findings.** Reference `SESSION_SECRET` by name,
  never by value — findings end up in PR bodies.
- **Verify before asserting.** This codebase's docs are dense and mostly
  accurate, but a claim in `CLAUDE.md` or a memory is a starting point, not
  evidence. Read the code path.

## How to run a pass

1. **Scope it.** One surface per pass (a route group, a key path, one
   integration). Whole-system passes produce shallow findings.
2. **Attack it on paper first.** Who is the adversary, what do they already
   have (a wallet? a session? an MCP in the set? a hostile parent frame?),
   what's the win condition? An audit without a stated adversary drifts into
   style review.
3. **Trace the real path in code**, including error branches — "fail closed"
   is a claim to verify, and guard bypasses usually live in the exception
   handler, not the happy path.
4. **Try to disprove your own finding** before reporting it. The most common
   false positive here is a control that exists one layer up (server-side
   re-gating on submit relays, the policy gate, the planner-artifact guard).
5. **Rate honestly**: what does an attacker actually get, and what do they
   need first? "Requires the session secret" is not a vulnerability, it's the
   design.

## Closing a finding

A finding that doesn't become a pinned check regresses. The repo's own
precedent is the standard:

- `scripts/test-api.ts` — the standing harness (1000+ checks), run against a
  prod build via `BASE=… npm run test:api`. Most security invariants belong
  here as explicit refusal checks.
- `npm run audit:funding` / `audit:asks` / `preflight:house` — scenario
  sweeps where a table row *is* the regression test.
- `GUARDRAILS.md` — extend the relevant guarantee and its "Tested:" line.
- `THREAT-MODEL.md` — move the item from open question to answered, naming
  the check that pins it.

Then follow the standing rules: branch, PR, never merge to `main`.
