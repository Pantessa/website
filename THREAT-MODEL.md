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
| The autopilot spender | CDP server wallet (`CDP_WALLET_SECRET`) | pull up to every live Spend Permission's allowance, then send the pull anywhere |
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
- **The malicious MCP.** A user can REQUEST any server; it reaches other
  users only after a reviewer wallet approves it (`lib/mcp-review.ts`,
  2026-09-08 — before that, any signed-in wallet's add was planner-callable
  for everyone). Its tool results reach the planner and, in the worst case,
  a sign button. Also the prompt-injection vector: **tool output is
  untrusted input that steers an agent that takes actions.** Closed
  2026-09-08: only a first-party source can produce a signable through the
  planner at all (#720); a 402 challenge is bounded to the listed price, the
  chain's USDC, the recorded receiver, $2/call and a house daily ceiling
  (§E1, `lib/x402.ts` + `lib/house-spend.ts`); every tool result in a prompt
  sits between per-turn nonce markers with one rule — data, not instructions
  (§E3, `lib/tool-output-fence.ts`); a planner-sourced signable says who
  built it, prints every `to` in full with the value attached and the
  guard's warnings, and never auto-fires step 2+ (§E3,
  `components/ExternalBuildNotice.tsx`).
- **The malicious embed host.** `/embed` ships `frame-ancestors *` by design.
  The host page controls framing, postMessage, and the wallet relay's inputs.
  Closed 2026-09-08 (§E5): a host-injected `prompt {send:true}` that routes
  value to an outside party (a send to 0x…/ENS, a token typed as an address,
  an NFT sale) downgrades to a prefill; a swap into a raw-address token on
  embed origin refuses by name; the connect-gate re-run never carries such an
  ask. What remains: the host chooses the `contextAddress` the guard reads as
  `from` (balance, self-send, grant lookup) — the signature is still the
  wallet's, so the host can mislead the build, not sign it.
- **The malicious link creator.** Anyone signed in mints `/i/<slug>` and
  hands the URL to a stranger — the page wears Pantessa's chrome and runs
  the creator's sentence on the visitor's wallet the moment it connects. The
  sentence is the attack surface: "send 0.5 ETH to 0x…", "swap all my ETH for
  0x<attacker token>", "sell #2489 for 0.02 ETH", a byline "Coinbase Support",
  a brand scan of a site whose `og:site_name` says "Uniswap". Closed
  2026-09-08 (§E5, `lib/content-origin.ts`): `outbound_third_party` is
  computed SERVER-SIDE at mint (every A/B phrasing) and stored; the /i runtime
  holds such a link to prefill — a human presses send; raw-address token
  slots refuse on link origin; a below-floor NFT listing blocks on link
  origin; the transfer guard's full-address "LEAVES your wallet to 0x…" line
  is rendered on the card; brand name/logo, byline and page name pass the
  mark denylist (`isDeniedBrandName`); an addressed link is capped in
  notional. The fence is deliberately over-inclusive — a false positive
  costs one tap. What remains: the creator still chooses the ask and the MCP
  set; a legitimate-looking sentence ("Buy $500 of AAPL") is exactly what the
  product is for, and the native guards + the wallet's own confirmation are
  the last line.
- **The self-dealing creator (money on a stranger's word).** A link creator
  opens their own link from any wallet — or just `curl`s
  `/api/embed/telemetry` with `firstParty:true`, the deployment's own host as
  `page`, `outcome:'signed'`, `valueUsd: 4999`, `feeBps: 50` and their slug —
  and the row minted creator earnings, claimable USDC, a lifetime referral
  stamp, the public money-moved number, the /i + /l share cards, the links
  board and the agent record on the browser's word alone (QA's round-2
  stranger: the #685 verifier stamped the funnel event `mismatch`, the studio
  still read "$1.00 moved · $0.0025 claimable"). Closed 2026-09-08 (S-2):
  **money follows the receipt** — the telemetry write site runs the same
  verifier and stamps `embed_turns.verification`; every reader a stranger can
  see money on composes `COUNTED_TURN_WHERE` (folded into `REAL_TRAFFIC_*`,
  spelled out in the creator-scoped reads); the referral stamps only on a
  counted sign; the sign cap counts only counted signs (a spoofer could
  otherwise exhaust a link's cap); the creator funnel's decisive kinds read
  `COUNTED_EVENT_WHERE`. What remains: the `attested` classes (CoW / HL /
  Snapshot / NFT orders, job legs) count without a receipt read, exactly as
  #685 documented for events — a creator who mints an order-class link can
  still self-report on it until those are ledgered at their relays
  (`/api/cow/submit`, `/api/hl/submit`, the jobs runner know the truth); the
  $10 claim floor and Nate's manual payout bound the money, not the number.
  And a legitimate `signed` beacon whose chain is unreadable at beacon time
  shows $0 until the lazy re-check (studio poll, claims door, /activity)
  catches up — honest, and the only correct default.
- **The malicious inbox sender.** The wallet inbox (`/inbox/<address>`)
  takes cards from strangers: a desk agent via `broker_send`, or a human via
  the mint door's `recipient`. A "$50,000" card "from MetaMask Team" is a
  phishing prop. Closed 2026-09-08 (§C5/§E5): `broker_send` requires
  `agent_key` (attributable to a track record; anonymous agents keep
  `broker_handoff`), sender labels and agent names pass the mark denylist,
  every addressed send is capped (`DESK_MAX_INBOX_USD`, default = the desk's
  $500), and an outbound-shaped card prefills in the recipient's runtime.
  What remains: volume — a keyed agent can still fill an inbox with
  plausible cards; the recipient's Decline verb and the per-IP desk rate
  fence are the current answer, a per-recipient unread cap the next one.
- **The malicious broker agent.** The desk (`/api/broker/mcp`) is open to any
  agent with a key. It cannot obtain calldata (sentences in, sign links out;
  the guarded builders rebuild everything) — the risk is the SENTENCE it
  hands a human and the marks it wears. Same closures as the link creator +
  inbox sender above, plus M1's identity binding, the per-intent USD cap and
  the hourly per-IP POST fence (`lib/broker-policy.ts`). What remains: an
  agent's track record (`/agents/<hash>`) is only as honest as the signed
  turns behind it — verified receipts (#685) keep the harness out, but a
  patient agent can earn a real record and then send a bad card; the human
  signs, the human decides.
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

### Spend-Permission autopilots (DCA autopilot, Spot Guardian)

The other place user money moves with no human present. A smart wallet signs
a Spend Permission naming Pantessa's CDP spender. A cron (hourly for DCA,
every minute for spot stops) pulls within it, then buys (DCA) or sells (a
fired spot stop) through a guarded Uniswap v3 swap whose output is pinned to
the owner. The on-chain
SpendPermissionManager caps the pull whatever this codebase does. Everything
after the pull is ours.

Verified (2026-09-16, #807):
- **The spot sell can only pay the owner, minus the pinned treasury fee.**
  `guardSpotSell` re-decodes every step before the pull:
  - the exact wrap and approval, and the pinned router;
  - both builder shapes:
    - fee off: the swap pays the owner;
    - fee on: the swap pays the router, then `sweepTokenWithFee` pays the
      owner in USDC, with the fee to `TREASURY_ADDRESS` at a canonical tier
      and a sweep minimum equal to the swap's;
  - the owner's post-fee minimum clears an independent floor off the mark;
  - no price limit (a partial fill would leave the rest on the spender);
  - a real v3 pool tier.

  Hostile shapes tried: the router's sentinels (`0x…01`, `0x…02`) as
  recipient, the contract-balance amount flag, trailing calldata, dirty
  address bits (the router reads the same 20-byte recipient), price limits,
  and bogus tiers. Pinned by the `spot guard` checks in `scripts/test-api.ts`.
  They include a live build of the sweep's own `buildSpotSell`, and a
  mutation run showed each check has a pin that fails without it.
- **A reverted transaction fails the run.** Both executors' `waitTx` throw on
  a non-success receipt. Before #807 the spot sweep recorded a reverted sell
  as `sold` (proven on a Base fork).
- Claim before build, one run per policy (`spot_guard_runs` is unique on the
  policy), and the kill switch (`paused`) holds without claiming.

Verified for the DCA autopilot (2026-09-17, #812):
- **An autonomous buy can only pay the owner, minus the pinned treasury fee,
  and the owner's guaranteed minimum sits within 3% of the token's market
  mark.** The sweep builds, `guardAutoBuy` re-decodes every step, and only
  then does it pull. The guard checks:
  - the exact USDC approval, and the pinned router;
  - the builder's payout shapes:
    - an ERC-20, fee off: the swap pays the owner;
    - an ERC-20, fee on: the swap pays the router, then `sweepTokenWithFee`
      pays the owner in the schedule's token;
    - native ETH: the swap pays the router, then `unwrapWETH9WithFee` (or
      `unwrapWETH9`, fee off) pays the owner in ETH;
    - fee on, the cut goes to `TREASURY_ADDRESS` at a canonical tier, and the
      payout's minimum equals the swap's;
  - an independent floor. The sweep prices the token with `usdPerToken`, and
    the floor is what the pull buys at that mark, less `AUTO_BUY_FLOOR_BPS`
    (3%). The swap's minimum and, fee on, the owner's minimum after the cut
    must clear it. A buy with no floor refuses;
  - no price limit (a partial fill would leave the rest of the pull on the
    spender);
  - a real v3 pool tier.

  Hostile shapes tried, across the payout shapes each one applies to: a
  minimum of 1, a foreign fee recipient, 0 bps and 100 bps, a weakened payout
  minimum, a price limit, and a bogus tier. Before this, a regressed builder
  could set a minimum of 1, and a thin pool's fill passed. Measured on Base
  the same day: the minimum on a $100 DEGEN buy sat 44% under the mark, and
  on $10 of BRETT 37%. Both refuse now. Pinned by the `dca autopilot` checks
  in `scripts/test-api.ts`. They include a live build of the sweep's own
  `buildAutoBuy` (an ETH buy and a cbBTC buy), and a mutation run showed each
  check has a pin that fails without it.
- **The sweep's order is pinned.** A source pin holds it: the build and
  floor, then the guard, then the pull (a reverted receipt is the unwind's
  `sendRunTx`, below).

Verified (2026-09-17, lib/autopilot-unwind):
- **A pull never strands on the spender.** Before this, a sale that failed
  after the pull (the swap is bounded 50 bps from a quote taken before 3–4
  spender transactions, in a falling market) left the run `failed` and the
  asset on the spender for good, proven on a Base fork for both autopilots.
  Now, after the pull, a run ends only where the chain proves the money went:
  `sold`/`bought` (a swap receipt succeeded) or `refunded` (the pull went
  back to the owner). Until then it is `unwinding`, says so to the owner, and
  a DCA schedule pulls nothing new. The in-pass order is one fresh retry
  (rebuilt, re-guarded against the same floor, not while the kill switch is
  paused), then the refund. A later pass's reconcile returns the money and
  never sells late.
- **A refund can only return exactly the pull, in the pulled asset, to the
  wallet it came from.** `guardRefund` re-decodes every step: a plain ETH
  send of the pull to the permission's account (no calldata), an
  `unwrap(pull)` on the pinned WETH first when the sale had wrapped it, or
  `transfer(owner, pull)` on the permission's own token. The amount is sized
  by the pull, never by the spender's balance (every permission shares it),
  and the pull must be proven by its receipt: the manager's own
  `SpendPermissionUsed` for the stored permission hash, plus the token's
  exact `Transfer`, so a token that delivers less than it moves can't size a
  refund. Hostile shapes pinned by the `autopilot unwind` checks, each
  mutation-tested.
- **No spender transaction is sent twice.** Every send is written to the
  run's ledger (`tx_log`) before it goes out and carries a CDP idempotency key
  derived from (run, step, attempt). The SDK's HTTP client retries dropped
  POSTs, so an unkeyed transfer could broadcast twice, paid from other users'
  money on the shared spender. A pass that dies mid-send is reconciled by
  re-issuing the ledger's own request under its key: CDP replays its first
  answer. A re-issue must match a fresh encoding byte for byte; a swap is
  only re-issued past its deadline, when it can only revert. Proven on the
  fork (a pass killed after its swap broadcast: one replay, no second send,
  refunded).

Open questions:
- A send whose outcome stays unknown for more than an hour (a dropped
  transaction, a CDP answer that never comes back, a key past its 24h memory)
  becomes an operator case: the run stays `unwinding`, the owner is told
  nothing more moves until a person checks, and the function logs
  `needs an operator`. Nobody is paged by it yet.
- A refunded run leaves its exact-amount router approval on the spender. Only
  the spender's own router calls can use it, and every sell re-approves
  exactly, but nothing resets it.
- **An armed schedule re-resolves its token by symbol every period.** Nothing
  pins the address at arm, and `guardAutoBuy`'s `expectedBuyAddr` and the
  floor's mark both come from that same resolution, so neither can notice a
  different token. Symbols aren't ambiguity-checked the way names are: the
  first list and the first entry win. Measured 2026-09-17 on Base: 6 symbols
  resolve to a different address when only CoinGecko's list loads (a cold
  instance whose tokens.uniswap.org fetch fails), among them TAO, AUSD and
  ABT (Arcblock → Abbott Laboratories' tokenized stock). 113 symbols sit at
  more than one CoinGecko address. (Task filed 2026-09-17.)
- **The floor's mark moves with the pools it reads.** The mark comes from the
  same v3 pools, through the same RPC client, as the build's quote, so the
  floor catches a regressed builder and a thin pool, but not a pool pushed
  before the quote. Shown on a Base fork
  (2026-09-17): a $100 DEGEN buy pushed the thin 30 bps DEGEN/USDC pool about
  3×. The next sweep's mark read the pushed pool, and a $100 buy through the
  100 bps pool passed the floor. The owner got 33,084 DEGEN, worth $99.85 at
  the pushed mark but $32.16 at the mark before the push. A v3 TWAP mark or an
  off-chain reference would catch that. The spot stop reads the same kind of
  mark for its trigger and its floor.
- The spender is one CDP server wallet for every permission on the platform.
  What does CDP's own policy engine allow it to sign, and is there an
  allowlist of destinations (SpendPermissionManager, WETH, the pinned router,
  the sell tokens) enforced at CDP, beneath our guards?

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
- **Capability tokens.** Job `?t=` tokens exist so embeds can poll. They are
  bearer credentials in URLs (logs, referrers). Since 2026-09-08 (§E6,
  `lib/job-token.ts`) a token is `v2.<exp>.<hmac>`: HMAC over the job id +
  the job's WALLET + the expiry, 7-day TTL (jobs age out at 7 days), verified
  against the row it names; the v1 id-only shape verifies until
  `JOB_TOKEN_V1_SUNSET`. A leaked token can still post sign evidence to
  `/complete` for its one job during its window — the runner's wait
  predicates and build-time balance checks re-verify, so a lie fails the job
  closed one step later.
- **Client-asserted `walletAddress` on `/api/chat`.** Builds run on it alone
  (the signature is the proof), but four turns changed standing state with
  no signature at all — guardian arm, DCA / spot manage, a compound job
  ending in a guardian arm. Closed 2026-09-08 (§E4,
  `lib/chat-mutation-gate.ts`): those proceed only when the SIWE session
  owns the asserted wallet; otherwise a sign-in invitation and nothing
  changes.
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
  rebinding and redirect chains. Swept 2026-09-08: `/api/fetch-meta` fetched
  ANY url for ANY caller (cloud-metadata IPs, localhost, private CIDRs) and
  returned the page's meta — now signed-in only, wearing `validateBrandUrl`
  + a re-validation of where the fetch landed + a bounded read;
  `/api/servers/discover` (already `assertPublicHttps`) is signed-in only
  too. Still to re-read: OpenSea item URLs, `redirectUrl` on links (validated
  at mint, never fetched by us), the broker webhook fence.
- **The journey log's beacon** (`POST /api/journey`, 2026-09-18). Public and
  unauthenticated by design: its subject is visitors who have not signed in.
  Everything it receives is a stranger's claim. Verified, harness-pinned:
  a closed set of kinds, pathnames only (no query string ever reaches the
  table), short scrubbed strings (a 64-hex key, a seed phrase and an email
  are cut before the write), a flat eight-key detail bag, a 24 KB body cap,
  thirty events a batch, and an hourly per-IP cap counted in EVENTS
  (`lib/journey-limits`, the same window table as the fence below). It
  answers 204 before it writes, so a prober learns nothing from status or
  timing. What it cannot do: authorize, pay, or gate anything. No read path
  outside the admin-gated `/api/admin/flows` touches `visitor_events`, and
  that screen renders every string as text, behind the admin SESSION only
  (never a bearer key: the answer carries emails and ask text). The `wallet`
  and `team` fields are self-reported, so they are weighed as claims
  (`lib/user-flows teamVerdict`, harness-pinned). The first cut got this
  wrong and the security review caught it: a stranger posting
  `{ w: <victim>, team: true }` took the victim's whole timeline off the
  default view. Now only VERIFIED evidence hides a person: an admin's or
  test wallet's session cookie on the request (`is_team`), that session's
  network that day, a hand mark, our own wallet list. A claim
  (`team_claimed`) hides the visitor id that made it and nothing else. A
  false wallet still puts a stranger's own clicks on that wallet's admin
  timeline; it cannot hide it, and table history is stitched only for a
  person's own wallet. A label is a stranger's string all the way to the
  screen: it is looked up with `Object.hasOwn`, never as a bare object key
  (`constructor` once crashed the page). Asks sent from the chat embedded
  on another site are not recorded on either half.
  Open: the log is only as private as its salt rotation. `visitor_salts`
  rows older than yesterday are deleted lazily by the next write; on a day
  with no traffic at all an old salt outlives its two days until the next
  visit. A cron would close it.
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
- **A pinned RPC that cannot read receipts makes a verifier dead on arrival.**
  Measured 2026-09-08: publicnode's free tier answers
  `eth_getTransactionReceipt` on Base / Arbitrum / Optimism with "Archive
  requests require a personal token" for a tx FIVE blocks old — every
  receipt, every age (Ethereum's endpoint answers). `lib/chains.ts` pins
  publicnode for the server, so from 2026-09-01 (#685) to this fix the
  `verified` verdict was unreachable on three of five chains: every honest
  link sign stayed `unverified` forever, no desk webhook ever fired on a
  counted verdict, no inbox card ever dropped on verification. Receipt reads
  now run on `receiptClientFor` — the pin first, the chain's default RPC when
  the pin refuses. The standing rule stands: MEASURE an RPC against the
  exact method you need before pinning it anywhere.
- Vercel env var scoping (prod vs preview): does a preview deploy hold prod
  secrets? If yes, preview is prod for blast-radius purposes.
- Cookie scoping: localhost cookies are shared **across ports** — stale
  sessions leak between worktree servers (a known dev gotcha; confirm it's
  dev-only and that prod cookies are `Secure`, `HttpOnly`, `SameSite`).
- Logging: does any log line carry a private key, session JWT, bearer key, or
  full wallet+balance profile?
- **`visitor_events` holds no IP address and no full user agent** (2026-09-18).
  The visitor id is `sha256(day's salt · IP · UA)`, the salt is random and
  deleted after two days (`lib/visitor-id.ts`), and the stored device is a
  family string ("mobile · iOS · Safari"). What it does hold that is worth
  protecting: the text of asks (240 chars), which page a wallet was on, and
  when. Rows are swept after 120 days. Account emails on the flows screen are
  read live from Coinbase for the admin request and stored nowhere.

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
