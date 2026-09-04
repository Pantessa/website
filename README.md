# Pantessa

**You have an intent. We do the rest.**

Pantessa is a non-custodial transaction layer for on-chain intent. A person (or
an agent) says what they want in plain language — *"buy $50 of AAPL"*, *"stake
0.5 ETH with Lido"*, *"protect my HYPE long with a 5% stop"*, *"tile my wallet
50% ETH / 30% USDC / 20% wstETH"* — and Pantessa scans the wallet, funds the
gap across chains, compiles the ask into deterministically-built transactions,
re-verifies every artifact against independent guards, and hands the user a
signature request plus a receipt.

Pantessa never holds keys and never takes custody. **The language model never
writes calldata, an address, or an amount.** It classifies intent; per-venue
builders in this repo produce the bytes; separate fail-closed guards re-decode
them before anything reaches a wallet.

Live at **[www.pantessa.com](https://www.pantessa.com)** · Formerly *Yeetful*
(see [/rebrand](https://www.pantessa.com/rebrand))

---

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Surfaces](#surfaces)
- [Stack](#stack)
- [Running it locally](#running-it-locally)
- [Environment](#environment)
- [Scripts](#scripts)
- [Verification](#verification)
- [Deployment](#deployment)
- [Repo layout](#repo-layout)
- [Related repositories](#related-repositories)
- [Gotchas](#gotchas)
- [Security](#security)

---

## What it does

**Intent links are the primary product.** Anyone can mint a link that carries
an ask (`/i/<slug>`). Whoever opens it connects their own wallet; Pantessa
personalizes and executes the ask against *their* balances. Creators get a
branded page (`/l/<handle>`), a conversion funnel, and a 50% lifetime share of
the fees their links produce. Chat is how you build and test a link.

**One chat reaches every dapp.** A working set of MCP servers (Uniswap, CoW,
Aave, Morpho, Lido, Hyperliquid, OpenSea, NEAR Intents, Snapshot, Robinhood
Chain, a wallet reader, plus anything you add) supplies live reads. Pantessa
supplies the transaction half.

**Standing intents run between turns.** Jobs (multi-step orchestration),
recurring buys (DCA), and Guardians (Hyperliquid and spot stop-loss /
take-profit) keep working on a per-minute cron. Autonomy without custody:
delegated agent keys and one-shot spend permissions, never your private key.

**It embeds anywhere.** `/embed` plus the [`pantessa`](https://www.npmjs.com/package/pantessa)
npm SDK mounts the whole chat on any site in a few lines and signs with the
host page's wallet.

**Agents can use it too.** An agent-facing MCP desk (`/api/broker`) lets another
agent open an intent, hand it to its human to sign, and hear back over a signed
webhook — with a public, signature-verified track record per agent
(`/agents/<handle>`) and a wallet inbox (`/inbox/<address>`) for intents
addressed to a person.

---

## How it works

### The turn

```
ask ──▶ deterministic gate ladder ──▶ MCP reads ──▶ per-venue builder
                                                        │
        receipt ◀── wallet signature ◀── independent guard ◀┘
```

1. **Parse.** The ask hits an ordered ladder of deterministic parsers — no
   model in the path. Order matters and is the safety property: the multi-step
   jobs compiler sits *above* every single-venue gate, so a compound ask can
   never have half of it silently dropped. The canonical order lives in
   [`app/api/chat/route.ts`](app/api/chat/route.ts) and is mirrored, gate for
   gate, in [`scripts/ask-ladder.ts`](scripts/ask-ladder.ts) — the pure replica
   the costless audits replay against.

2. **Read.** The claimed gate pulls live state through MCP tools (quotes, pool
   state, reserves, positions, balances, NFT holdings) and the wallet scan.

3. **Build.** A per-venue builder in `lib/` composes the artifact: an EVM
   transaction, a chain of them, or EIP-712 typed data. Builders are
   deterministic and pinned — selectors, routers, and settlement contracts are
   constants in this repo, not values a tool returned.

4. **Guard.** A *separate* guard re-decodes the built artifact and fails closed
   on any mismatch: recipient, token identity read from the chain (never a
   symbol→address hop an agent asserted), amounts, deadlines, fee legs,
   approval scope. The shared policy gate
   ([`lib/tx-guardrails.ts`](lib/tx-guardrails.ts)) then applies spend caps,
   host allowlists, and the kill switch. Outflows are gated; inflows (sales)
   are not. The generic planner path has its own guard
   ([`lib/planner-artifact-guard.ts`](lib/planner-artifact-guard.ts)) that
   refuses third-party transfers, unlimited approvals, `setApprovalForAll`, and
   Permit2 targets outright.

5. **Sign.** The user's wallet signs. Multi-step chains self-advance and
   re-quote; deadline-bearing calldata always ships with a refresh recipe so a
   stale transaction is never offered.

6. **Receipt.** Every signed turn writes value, venue, build path, and
   guardrail report — powering receipts, the public
   [`/activity`](https://www.pantessa.com/activity) feed, creator earnings, and
   the money-moved metric.

### Native venues

Each is a first-party builder + guard pair, not a passthrough:

| Venue | What Pantessa builds |
| --- | --- |
| **Uniswap v3** | QuoterV2 fee-tier scan → `SwapRouter02` multicall, approve→swap as one chain |
| **Uniswap v4** | No-hook pool scan → single Universal Router `execute`, exact-amount Permit2 |
| **CoW Protocol** | EIP-712 swap + limit orders, policy re-gated at submit |
| **LiFi** | Pinned settlement venue with an independent on-chain price check |
| **NEAR Intents** | Cross-chain swaps; the guard verifies the transfer matches the quote's one-time deposit address exactly |
| **Aave v4 / Morpho** | Supply, withdraw, borrow, repay with health-factor preview and on-chain token-identity binding |
| **Lido** | Stake / wrap / unwrap / withdraw |
| **Hyperliquid** | Perp orders, leverage, closes — delegated-signature path for wallets that refuse the venue's constant chain id |
| **OpenSea / Seaport 1.6** | Guarded ERC-721/1155 transfers, listings, cancels, fills; fees derived from the live schedule |
| **Robinhood Chain** | Canonical bridge only, tokenized-stock swaps, brokerage orders |
| **Snapshot** | EIP-712 governance votes |

Chains are one registry ([`lib/chains.ts`](lib/chains.ts)): Base, Ethereum,
Arbitrum, and Robinhood Chain (4663).

### Funding is an offer, not a wall

"Insufficient funds" is never the answer. A shortfall triggers a scan across
chains and tokens, then a ranked plan
([`lib/funding-plan.ts`](lib/funding-plan.ts)): bridge legs, same-chain swaps,
destination-gas legs, and rescue plans for gas-stranded balances — compiled
into a single job whose final step is the thing the user originally asked for.
Balances that genuinely cannot help are named out loud rather than hidden.

### Autonomy without custody

- **Jobs** — a compiler turns a compound ask into ordered steps; a runner
  advances them, re-building and re-guarding each step at *its* sign turn.
- **DCA** — recurring buys; each due UTC period compiles a one-step swap. A
  unique run claim per period makes double-buys impossible.
- **Guardians** — Hyperliquid stop-loss/take-profit via a venue-approved
  delegated agent key, and spot stops via one-shot spend permissions
  (allowance = the exact amount). Both sweep on a per-minute cron with
  fail-closed guards and an independent price floor.

### Money

Fees are venue-native where the venue supports it (CoW `appData` partner fee,
v3 `sweepTokenWithFee`, v4 `PAY_PORTION`) and a visible transfer step where it
does not. Defaults: 0.20% on swaps, 0.50% on link-origin spot, Hyperliquid
builder fee at cap; 50% of link-attributed fees accrue to the creator, lifetime,
first-touch. All of it is one source: [`lib/fees.ts`](lib/fees.ts). Plans
(Builder / Growth / Scale) and YEET credits run through Stripe.

---

## Surfaces

| Route | Purpose |
| --- | --- |
| `/` | Landing — the link economy |
| `/chat`, `/chat/[id]` | First-party chat: the link builder and execution surface |
| `/i/[slug]` | **Intent link runtime** — the ask, personalized to whoever opens it |
| `/l/[handle]` | Creator storefront (white-labeled from one URL scan) |
| `/links` | Link studio: mint, brand, earnings, funnel |
| `/embed` | Embeddable chat (iframe + SDK target) |
| `/inbox/[address]` | Intents addressed to a wallet |
| `/agents/[handle]` | Public, signature-verified agent track record |
| `/mosaic` | Portfolio allocations as an executable link |
| `/w/[address]` | Public wallet briefing |
| `/t/[symbol]` | Live token candles |
| `/r/[slug]`, `/p/[slug]` | Share receipts and read-only shared chats |
| `/dashboard` | Keys, embeds, links, plan, orgs, guardian, treasury, failures |
| `/servers` | MCP directory |
| `/activity` | Public routing + money-moved feed |
| `/docs`, `/pricing`, `/blog` | Docs (four doors: earn / embed / trust / hands), pricing, posts |
| `/api/broker/[transport]` | The agent-facing MCP desk |

---

## Stack

- **Next.js 16** (App Router) · React 19 · TypeScript 5.6
- **Tailwind CSS 3** · Framer Motion · Recharts
- **Postgres on [Neon](https://neon.tech)** via **Prisma 5** (53 models)
- **wagmi / viem / RainbowKit** for wallets; **Coinbase CDP embedded wallets**
  for email + social sign-in
- **SIWE** + `jose` JWT cookies for sessions
- **MCP** (`mcp-handler`, `@modelcontextprotocol/sdk`) for tool servers, both
  consumed and served
- **Stripe** for subscriptions; **x402** for pay-per-call MCP endpoints
- Deployed on **Vercel** (per-minute crons for the autonomy layer)

---

## Running it locally

### Prerequisites

- **Node 20.9+** (22+ recommended)
- **pnpm 8** — invoke as `npx pnpm@8`. pnpm 9+ rewrites this repo's
  `lockfileVersion: '6.0'` and breaks the install.
- A **Postgres database with the `pgvector` extension available** — the schema
  declares `extensions = [vector]` (used for semantic routing), so `db:push`
  runs `CREATE EXTENSION vector`. [Neon](https://neon.tech)'s free tier ships
  pgvector and is the path of least resistance; use the *pooler* host in
  `DATABASE_URL`. On a local Postgres, install pgvector first or `db:push`
  fails on the extension.

### Setup

```bash
git clone git@github.com:Pantessa/website.git && cd website
npx pnpm@8 install            # postinstall runs `prisma generate`
cp .env.example .env.local    # then fill in the values below
```

Prisma's CLI reads `.env`, **not** `.env.local`. Either put `DATABASE_URL` in
both, or pass it inline on every Prisma command (shown below).

```bash
DATABASE_URL='postgresql://…' npx pnpm@8 db:push          # create the schema
DATABASE_URL='postgresql://…' npx pnpm@8 db:seed-free-mcps # seed the MCP fleet
npx pnpm@8 dev                                             # http://localhost:3000
```

`db:push` is additive and safe against a **fresh** database. Against a database
that has drifted from `schema.prisma`, Prisma will offer to drop the drifted
tables — use raw SQL for additive changes instead, and never run `db:reset`
(`--force-reset`) on anything you care about.

### What works with how little

| You have | You get |
| --- | --- |
| Nothing but the code | The site builds and the marketing/docs surfaces render |
| `DATABASE_URL` + `USE_DB=true` + `SESSION_SECRET` | Sign-in, chat persistence, links, jobs, dashboard — the product |
| …plus `ALCHEMY_API_KEY` | Multi-chain wallet scans, portfolio cards, funding plans across chains |
| …plus a connected wallet | The whole native transaction layer: build, guard, sign, receipt |
| …plus `ANTHROPIC_API_KEY` | The planner fallback for asks no native gate claims |

The native gates are deterministic parsers, so **transaction building needs no
model key at all**. `ANTHROPIC_API_KEY` only powers the generic planner that
catches everything the ladder doesn't.

---

## Environment

Full annotated list in [`.env.example`](.env.example). The ones that matter
most:

| Variable | Needed for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Everything stateful | Neon pooler host |
| `USE_DB` | The live directory | `true` → read the DB; unset → static catalog from `lib/mcp-data.ts` |
| `SESSION_SECRET` | Auth | ≥16 chars; signs SIWE session JWTs |
| `ANTHROPIC_API_KEY` | Planner fallback | Direct Anthropic API — the planner deliberately never runs through a paid/metered engine |
| `ALCHEMY_API_KEY` | Multi-chain reads | One key covers Ethereum / Base / Arbitrum |
| `NEXT_PUBLIC_CDP_PROJECT_ID` | Email + social sign-in | Coinbase CDP embedded wallets; allowlist your origin in the CDP portal |
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect | Connector hidden when unset |
| `PRIVATE_KEY` | Server-paid x402 calls | **A funded burner only.** Chat turns can spend from it |
| `NEXT_PUBLIC_SITE_URL` | Canonical metadata | The exact host that serves 200, with `www`, no trailing slash |
| `ADMIN_WALLETS` | Admin surfaces | Comma-separated addresses |
| `CRON_SECRET`, `GUARDIAN_KEY_SECRET` | Autonomy layer | Required for jobs / DCA / guardian crons |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Billing | Optional locally |
| `OPENSEA_API_KEY` | The NFT layer | Every NFT ask refuses by name without it, rather than guessing |
| `LIFI_API_KEY` | LiFi quotes | Optional — quotes work keyless; a key raises the rate limit |

Feature flags: `BROKER_DESK_ENABLED` (agent desk, fails closed),
`ROSTER_ENABLED` / `NEXT_PUBLIC_ROSTER_ENABLED` (in-development surface),
`ONRAMP_ENABLED` (card / bank on-ramp, needs the CDP keys too).

The NEAR Intents and Robinhood venues reach hosted MCP services that hold
their own credentials — this app has no env var for either.

---

## Scripts

Run with `npx pnpm@8 <script>`.

**Build & quality**

| Script | What it does |
| --- | --- |
| `dev` | Dev server |
| `build` | `prisma generate` + production build |
| `lint` | ESLint |
| `test:api` | **The standing harness** — the whole API surface against a running production build (~1,700 checks) |
| `test:splash`, `test:router`, `test:auth`, `test:host-wallet` | Focused harnesses |
| `guard:test`, `guard:sync` | `@pantessa/guard` tests, plus the drift check that fails if a copied guard diverges from its `lib/` source |

**Costless audits** (no network, no RPC — pure replays of the real ladder)

| Script | What it does |
| --- | --- |
| `audit:asks` | Replays every surfaced example ask; fails on dead-ends |
| `audit:funding` | Replays fabricated wallet states through the funding planner |
| `mcp:lint` | Grades MCP servers A–F on routability |
| `eval:routing`, `eval:conversations` | Router quality harnesses |

**Live drills** (hit real endpoints; some cost money)

| Script | What it does |
| --- | --- |
| `preflight:house` | Every flagship ask end-to-end over HTTP with a real wallet |
| `fingerprint:deploy` | Proves what a *live* deployment actually serves |
| `drill:kickback` | Rehearses the creator-earnings loop on a local build |
| `digest:gtm` | Daily funnel + reputation digest into `digests/` |

**Database**

| Script | What it does |
| --- | --- |
| `db:push` | Push `schema.prisma` (additive on a fresh DB — read the warning above) |
| `db:seed-free-mcps` | Seed the first-party MCP fleet |
| `db:ingest` / `db:audit` | Ingest / audit the paid x402 catalog from agentic.market |
| `db:studio` | Prisma Studio |

---

## Verification

The expected pre-PR loop:

```bash
npx tsc --noEmit
npx pnpm@8 build
npx pnpm@8 exec next start -p 3400              # terminal 1
BASE=http://localhost:3400 npx pnpm@8 test:api  # terminal 2
```

`test:api` targets `BASE`, defaulting to `http://localhost:3000`.

Run `test:api` against a **production build** (`start`), not the dev server —
Next 16 allows one dev server per project, and dev-mode timing hides real
failures. The harness creates every row under throwaway wallets and deletes
them at the end.

Extend `scripts/test-api.ts` rather than writing throwaway test scripts: it is
the standing contract, and a new gate or signer is expected to arrive with its
pins. Note that the harness proves the **build**, never the **signature** — it
signs with raw keys, so wallet-side refusals only surface in real wallets. The
artifact × wallet matrix lives in [`WALLET-MATRIX.md`](WALLET-MATRIX.md).

---

## Deployment

Vercel, `framework: nextjs`, build command `npm run db:generate && next build`
([`vercel.json`](vercel.json)). Crons are declared there and are load-bearing:

| Path | Schedule |
| --- | --- |
| `/api/cron/jobs` | every minute |
| `/api/cron/hl-guardian` | every minute |
| `/api/cron/spot-guard` | every minute |
| `/api/cron/dca` | hourly |
| `/api/cron/roster` | every 5 minutes |

They require `CRON_SECRET`; the guardians additionally require
`GUARDIAN_KEY_SECRET`. Without those, standing intents silently stop advancing
— `fingerprint:deploy` is the check that a deployment is actually whole.

---

## Repo layout

```
app/                        Next.js App Router — pages + API routes
  api/chat/route.ts           the turn: the gate ladder and every native venue
  api/broker/[transport]/     the agent-facing MCP desk
  api/cron/                   jobs · dca · guardians · roster
  i/ l/ links/ inbox/ agents/ mosaic/   the link + agent economy
  chat/ embed/ dashboard/ docs/         chat, embed, account, docs
components/                 UI (~180 files; chat, cards, sign surfaces)
lib/
  chains.ts                   THE chain registry
  transaction-layer.ts        artifact detection: evm-tx · tx-chain · EIP-712
  tx-guardrails.ts            the shared policy gate
  planner-artifact-guard.ts   the fail-closed fence on planner output
  uniswap-venue.ts uniswap-v4.ts cow*.ts lifi-venue.ts
  cross-chain-swap.ts aave-*.ts morpho-*.ts lido-stake.ts
  hyperliquid-exec.ts nft-layer.ts robinhood-bridge.ts   per-venue builders
  jobs.ts jobs-runner.ts dca*.ts hl-guardian.ts spot-guard.ts   standing intents
  funding-plan.ts funding-path.ts inflight-funding.ts     the funding layer
  intent-links.ts links-board.ts house-links.ts mosaic.ts the link economy
  broker*.ts inbox.ts agent-record.ts                     the agent desk
  fees.ts plans.ts spend-grant.ts value-origin.ts         money
  free-fleet.ts catalog.ts router.ts                      the MCP fleet
guard-sdk/                  @pantessa/guard — the guards, as a standalone package
prisma/schema.prisma        53 models
registry/                   MCP registry submission manifests
scripts/                    harnesses, audits, drills, seeds (see above)
```

Worth reading before large changes: [`GUARDRAILS.md`](GUARDRAILS.md) (what the
guards actually enforce), [`THREAT-MODEL.md`](THREAT-MODEL.md),
[`WALLET-MATRIX.md`](WALLET-MATRIX.md) (artifact × wallet coverage), and
[`STORY.md`](STORY.md) (the positioning every surface has to agree with).

### A note on internal design notes

Comments throughout the codebase cite planning documents by bare filename —
`HANDOFF-*.md`, `ROADMAP-*.md`, `ROSTER-*.md`, `AUTOPILOT.md`,
`FOUNDING-MANAGERS.md`, `PRICING.md`, `KICKBACK-DRILL.md`,
`ARCHITECTURE-reason-router.md`, `CLAUDE.md`. **Those are internal working
notes and do not live in this repository.** They sit one level up in the
private workspace alongside the sibling repos. The citation is kept because it
records *why* a decision was made and is useful to anyone with workspace
access; if you are reading this repo on its own, treat such a reference as
provenance rather than a link you can follow. Everything needed to understand,
build, run, and verify the code is in this repo.

---

## Related repositories

| Repo | What it is |
| --- | --- |
| [`Pantessa/free-mcps`](https://github.com/Pantessa/free-mcps) | The first-party free MCP fleet (Uniswap, CoW, Aave, Morpho, Lido, Hyperliquid, OpenSea, NEAR Intents, Robinhood, wallet, hands) + `@yeetful/mcp-kit` |
| [`pantessa`](https://www.npmjs.com/package/pantessa) (npm) | The published SDK: x402 client, agent wrapper, and `mountPantessaChat` |
| `@pantessa/guard` | The transaction guards as a standalone package (`guard-sdk/` here) |

---

## Gotchas

Hard-won, and cheap to re-learn the expensive way:

- **The model never writes bytes.** Anything signable comes from a builder in
  this repo and is re-decoded by an independent guard. New venue? Ship the gate
  *and* the guard together — a tool-returned address is not an address.
- **A green local build does not mean a dependency is declared.** A stray
  `node_modules` above the repo means Node's resolver can satisfy imports that
  aren't in `package.json`. Grep `package.json` when adding an import; add deps
  with `npx pnpm@8`.
- **Prisma reads `.env`, not `.env.local`.** Pass `DATABASE_URL` inline for CLI
  commands.
- **MetaMask refuses typed data whose `domain.chainId` ≠ the wallet's active
  chain**, before any popup. Every `signTypedDataAsync` caller must switch
  chains first — or, where the venue's chain is unswitchable, use the delegated
  path (`personal_sign` consent + an approved agent key). `test:api` audits
  this.
- **`lib/indexeddb-polyfill.ts` must stay the first import in
  `app/layout.tsx`** — WalletConnect touches `indexedDB` during SSR.
- **Coinbase Wallet stays pinned to `eoaOnly`** in `lib/wagmi.ts`; a popup
  opened after an `await` breaks second signatures.
- **Tailwind cannot opacity-modify CSS-variable colors** —
  `bg-[color:var(--x)]/90` paints transparent. Use plain CSS.
- **Kill ports, not process names.** `lsof -ti :3400 | xargs kill -9`. Killing
  by name leaves a stale `next-server` child serving an old build.
- **Never host or brand a fork of someone else's interface** on a Pantessa
  domain. A DEX UI on a domain that isn't the DEX's is the signature of a
  wallet drainer, and it gets you blocklisted. Demo installs on our own
  surfaces.

---

## Security

Pantessa is non-custodial: it holds no user keys and takes no custody. Guards
fail closed, spend policy is enforced at build *and* submit time, and every
signed turn leaves a receipt. Threat model:
[`THREAT-MODEL.md`](THREAT-MODEL.md). Guard behavior:
[`GUARDRAILS.md`](GUARDRAILS.md).

Found something? Please report it privately rather than opening a public issue.
