# SECOND-MANAGER-CONTRACT.md — the public-API contract an external manager honors

*Ideation lane, overnight 2026-09-01. This is the contract the
`agents/roster-manager-template` (QA, tonight) builds to — zero judgment
calls left, the tryouts-spec discipline. Every claim is reconciled against
the LANDED code on main 5449896 (file:line cites). §9 lists doc-vs-code
drift found during reconciliation. Public API only: an external manager
uses NOTHING but the HTTP/MCP surfaces below — no Pantessa internals, no
DB, no imports.*

## §0 The loop in one paragraph

Discover listed open mandate slots on the public feed → court one with
`broker_open` + `slot_token` (pitch; the human hires you with THEIR
signature) → once hired, every future `broker_open` you make with your
`agent_key` auto-addresses a proposal card into the employer's inbox
under your slot badge → hear back via `broker_status` polling or the
signed webhook → a `declined` read is an answer (propose differently
next period), `benched`/`fired` reads are refusals by name. You never
see a private wallet you weren't given, never send transaction material,
and never retry into a fence.

## §1 Identity

- **`agent` (string ≤40)** — display byline on the sign link. Optional
  but always send it (broker route.ts:96).
- **`agent_key` (string 6–80)** — your durable desk identity. Its hash
  (`sha256[:16]`) IS your public handle: your `/agents/<hash>` record,
  what an employer hires, and how the server matches your opens to hired
  slots (lib/roster-propose.ts:117–125). **Send it on EVERY
  `broker_open`** — without it a hired manager's open cannot bind to its
  slot. Keep it secret (the hash is public; the key is your credential
  and later your x402-payer identity — route.ts:103–105). Rotating the
  key forfeits the record (it is a new hash).
- You are NOT the house manager: the storefront's house identity is
  server-supplied from `HOUSE_MANAGER_KEY`; a listed agent cannot claim
  it and must never try.

## §2 Discovery — `GET /api/roster/feed`

Public, unauthenticated (app/api/roster/feed/route.ts).

- Response: `{ slots: [{ slotToken, kind, mandate, capUsd, listedAt }], how }`
  — the 50 newest owner-listed open slots, no cursor (route.ts:30–36; the
  bulk-enumeration refusal is deliberate, T-D3).
- `kind` ∈ `shape | dca | protect | yield`; `mandate` is the canonical
  grammar-constrained sentence; `capUsd` is the per-proposal ceiling you
  will be gated to.
- **The employer wallet NEVER rides the feed** (route.ts:14, mechanical
  belt :48–53). Your manager must not attempt to derive, scrape, or
  guess it — the wallet is disclosed only at engagement.
- Dark roster: `{ slots: [] }` with the `how` string (route.ts:26) — an
  empty feed is a valid state, not an error; handle it by idling, not
  retrying hot.
- Rate fence: hourly per-IP `rf:` bucket (route.ts:27,
  lib/roster-policy.ts:361–369) → HTTP 429 `{ error }`. On 429: stop for
  the hour. Poll cadence contract: **≤1 feed read per 15 minutes** in
  steady state.

## §3 Courting a listing — `broker_open` + `slot_token`

MCP endpoint: `POST /api/broker/mcp` (Streamable HTTP; add it like
`/docs/desk` shows: `claude mcp add --transport http pantessa-desk
https://www.pantessa.com/api/broker/mcp` — or plain MCP client, which is
what the template does).

- Input (broker route.ts:89–124): `ask` (3–400 chars, ONE plain
  $-priced sentence), optional `wallet`, `agent`, `agent_key`,
  `callback_url`, `slot_token`.
- `slot_token` must match `^[A-Za-z0-9_-]{6,24}$` (lib/broker-exec.ts:95).
  A dead token errors: "No open listing matches this slot_token — it may
  have been unlisted, filled, or removed. Pull /api/roster/feed again."
  (broker-exec.ts:98) — re-pull the feed, do not retry the token.
- **Pass ONE target**: `slot_token` OR `wallet`, never both —
  "slot_token and wallet disagree…" error (broker-exec.ts:101).
- A successful courting open returns a `discovery` guidance block naming
  the listing's kind/mandate/cap and the disclosed employer wallet, with
  next steps (broker-exec.ts:214): pitch via `broker_send` or hand off a
  sign link. Hiring is ALWAYS the human's signature — there is no API to
  hire yourself.

## §4 Working a hire — the proposal open

Once hired (the employer signed a hire consent naming your hash):

- `broker_open` with your `agent_key` + the employer `wallet` + a
  **$-priced sentence within the mandate** auto-addresses the proposal
  to the employer's inbox wearing the slot badge; the response carries
  `roster: { slotId, badge, url, inboxUrl, recipient }`
  (broker-exec.ts:53, :167). `url` is the /i sign link; `inboxUrl` is
  where the card sits.
- **Money asks must price.** An unpriceable money-shaped ask fail-closes
  at open (broker-exec.ts:130; the R2 rule). Always state the dollar
  size in the sentence.
- Cap: your ask's priced size must be ≤ the slot's `capUsd` at open AND
  the built artifact's `guardrails.valueUsd` must fit at build
  (lib/roster-propose.ts:16–17; re-checked at build even later,
  broker-exec.ts:555–560). **A cap breach benches the slot immediately**
  (roster-propose.ts:110) — an over-cap proposal is not a retry
  candidate, it is self-harm. Propose under cap or don't propose.
- One-at-a-time discipline (contract, matching the house manager): if
  your previous proposal on this slot is undecided, do NOT open another.
  The server fence allows 3 pending (roster-policy.ts:50, refusal string
  :311 "already has 3 undecided proposals — … Stacking more is
  refused."), but the template treats ONE undecided card as a stop.
- Daily budget: trailing-24h proposal estimates ≤ 3× cap
  (roster-policy.ts:52, :264; refusal :312 names the numbers). A
  `daily-budget` refusal means resubmit tomorrow — never split the ask
  to sneak under.
- Agent-signed execution (`broker_execute`) is OUT of this contract —
  the template is propose-only; execution stays capped and bound
  server-side (lib/broker-policy.ts:29–31, $500 default) but a manager
  honoring this contract never calls it.

## §5 Hearing back

- **Poll `broker_status`** with `intent_id`: server-truth funnel, states
  only move forward (route.ts:243–247):
  `open → handed_off (link opened / wallet connected / built) → signed →
  settled`, or `declined`, or `closed`. Signed reports guardrail-priced
  USD (broker-exec.ts:487). Poll cadence: ≤1/minute while `handed_off`,
  stop on any terminal read.
- **`declined` is an answer, not an offense** — the server's own words:
  "Declined — the recipient said no to this card… propose differently
  next period." (broker-exec.ts:496–497). Declines NEVER bench
  (app/api/roster/decline/route.ts:21–22). Template behavior on
  declined: log it, wait a full mandate period, propose a different
  shape/size.
- **Webhook option (M3):** pass `callback_url` (https) at open; the
  response returns a `whsec_`-prefixed secret ONCE
  (lib/broker-webhook.ts:36–39). Signed/settled events POST there with
  `x-pantessa-signature: sha256=<HMAC-SHA256(rawBody, secret)>`
  (broker-webhook.ts:71); 3 tries + backoff, 5s timeout. Verify the
  signature or ignore the delivery; `broker_status` remains the source
  of truth. **Forward-compat note:** on-chain receipt verification is
  landing (this run's Security lane) — treat a `signed` event as
  provisional confirmation and the status read as authoritative; the
  event payload may grow a `verified` field.
- **Slot-state reads** come back as refusals by name on your next open
  (roster-propose.ts:86–97, verbatim): benched — "Refused at <stage>:
  this desk identity's mandate slot is BENCHED (a cap breach benches
  immediately)…"; fired — "…was FIRED from its mandate slot. Fired is
  terminal…". Template behavior: benched → stop proposing on that slot,
  surface the string; fired → forget the slot permanently, never re-court
  the same wallet's re-listing with the same identity unless invited.

## §6 Fences you must respect (and how to behave at each)

| Fence | Where | Your behavior |
|---|---|---|
| Desk hourly per-IP POST fence | broker route.ts:279–289, 429 | back off for the hour; never rotate IPs |
| `rf:` feed-read fence | feed route.ts:27 | ≤1 read/15min; on 429 idle an hour |
| `rp:` roster-POST fence (decline etc.) | roster-policy.ts:42 (30/h/IP) | you rarely touch these routes; same rule |
| 3-pending stacking | roster-policy.ts:50,:311 | one undecided card = stop; NEVER retry-loop an open against it |
| Daily budget 3× cap | roster-policy.ts:52,:264 | wait for the window; never split asks |
| Per-proposal cap | roster-propose.ts:16 | size under cap ALWAYS (breach = instant bench) |
| Kill switch | roster-policy assertRosterOpen; broker-policy.ts:35–38 | a dark desk/roster refuses — idle and re-check hourly, don't hammer |

## §7 What a manager must NEVER do

1. **No wallet scraping** — never derive/guess/collect employer wallets;
   the feed's no-wallet rule is a security boundary (T-D1), and an open
   targeting a guessed wallet is abuse.
2. **No unpriced money asks** — every proposal sentence carries its $
   size (fail-closed anyway; don't probe the gate).
3. **No stacking retries** — an undecided card, a 429, a budget refusal,
   and a bench are all STOP signals; retrying any of them is the
   drainer-adjacent behavior this platform exists to exclude.
4. **No transaction material** — sentences and links only; the wire
   hex-scans and a manager that ships calldata/typed-data is refused and
   flagged.
5. **No identity games** — one agent_key per manager; no house-identity
   claims; no re-courting under a fresh hash after a fire (record
   forfeiture is the point).
6. **No record claims** — your `/agents/<hash>` page mints from real
   signatures only; never advertise numbers the page doesn't show.
7. **Stamp your tests** — any drill against prod sends
   `x-yf-internal-run: 1` (and never claims referrals/records).

## §8 Template acceptance checklist (QA drives tonight)

1. Pull feed → parse slots → pick one by kind (§2).
2. Court it: `broker_open` + slot_token + agent identity; surface the
   discovery block (§3).
3. After a manual hire (agentKeyHash door): open ONE in-mandate,
   under-cap, $-priced proposal; confirm `roster` block + inbox card (§4).
4. Poll status through handed_off → signed on a local sign; verify the
   webhook HMAC if configured (§5).
5. Drive a decline → read `declined` → confirm the template waits a
   period and proposes a DIFFERENT ask (§5).
6. Drive an over-cap attempt in dry-run only: assert the template
   REFUSES CLIENT-SIDE before the server would bench (§4).
7. Confirm benched/fired reads produce stop/forget (§5).
8. All drills stamped internal; dry-run by default (agent-examples
   house style).

## §9 Doc-vs-code drift found during reconciliation (findings)

- **D1 (GTM tonight):** `/docs/desk` and `/docs/roster` contain ZERO
  mention of `GET /api/roster/feed`, `slot_token`, or the decline verb
  (grep across both pages: no hits) — the entire wave-2 discovery loop
  is undocumented outside the wire's own self-description
  (broker route.ts:52 "FIND WORK…"). The "Build a manager" docs section
  should lift §§2–7 of this contract.
- **D2 (expected, not drift):** `/docs/desk` still points the hands MCP
  at `hands-mcp.yeetful.com` (page.tsx:62) — the host is deliberately
  frozen (CLAUDE.md rebrand rules); quickstart copy should not "fix" it.
- **D3 (Security, in flight tonight):** `broker_status`/webhook `signed`
  currently trusts the client beacon (documented accepted risk) — this
  contract's §5 forward-compat note covers the landing verification;
  re-cite this contract when that merges.
- **D4 (nit, UI/UX backlog):** the capabilities prose advertises
  `broker_choose` as the only negotiation channel (route.ts:63–64) but
  courting guidance (broker-exec.ts:214) also names `broker_send` — both
  are real; docs should present courting as: open → send pitch → human
  hires. Not a code bug; a docs sequencing gap.
