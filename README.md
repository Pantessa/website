# Yeetful

An x402 agent platform. Browse a directory of MCP / x402 agents (inference + data),
chat with them, and pay **per call in USDC on Base** — no API keys. Yeetful is the
control plane for agentic payments: budgets, allowlists, receipts, and
wallet-signature approvals, not the custodial rails.

Live at [yeetful.com](https://yeetful.com).

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Tailwind CSS** + Framer Motion
- **Postgres on [Neon](https://neon.tech)** via Prisma
- **wagmi / viem / RainbowKit** for wallet connection (Coinbase Wallet, WalletConnect)
- **SIWE** (Sign-In with Ethereum) + JWT cookies for auth
- **x402** for per-call USDC payments on Base
- Deployed on **Vercel**

## Getting started

```bash
pnpm install              # also runs `prisma generate` via postinstall
cp .env.example .env.local 2>/dev/null || touch .env.local   # then fill in vars below
pnpm dev                  # http://localhost:3000
```

The app runs without a database (`USE_DB` unset → static catalog from
`lib/mcp-data.ts`) and without a wallet, so `pnpm dev` alone gets you a working
directory + UI. Database and payments are opt-in via env vars.

### Environment variables (`.env.local`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | for DB features | Neon Postgres connection string (use the **pooler** host) |
| `USE_DB` | prod | `true` → `/api/servers` and chat persistence read the DB; unset → static catalog, ephemeral chats |
| `SESSION_SECRET` | for auth | ≥16 chars; signs SIWE session JWTs |
| `PRIVATE_KEY` | for server-side payments | Funded Base burner ("house wallet") used when the server pays x402 calls |
| `NEXT_PUBLIC_WC_PROJECT_ID` | optional | WalletConnect project ID; enables WalletConnect/Rainbow connectors (hidden when unset) |

> Note: Prisma CLI reads `.env`, not `.env.local`. Pass `DATABASE_URL=... ` inline
> when running `prisma`/`db:*` commands from the shell.

### Database setup

```bash
DATABASE_URL=... pnpm db:push     # create/update tables (additive — see warning below)
DATABASE_URL=... pnpm db:ingest   # populate the MCP directory from api.agentic.market
DATABASE_URL=... pnpm db:studio   # browse data
```

The ingest script (`scripts/ingest-agentic.ts`) pages the agentic.market JSON API,
filters unbranded provider domains, and upserts brand services. It is **additive by
default**; pass `--prune` to drop rows no longer present upstream.

⚠️ **Never run `db:reset` / `prisma db push --force-reset` casually** — it wipes the
directory data. Plain `db:push` is additive and safe.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | `prisma generate` + production build |
| `pnpm lint` | ESLint |
| `pnpm db:push` | Push Prisma schema to the database (additive) |
| `pnpm db:ingest` | Ingest/refresh the MCP directory from agentic.market |
| `pnpm db:studio` | Prisma Studio |
| `pnpm test:auth` | SIWE auth + chat-persistence integration tests (needs dev server + DB) |

Verify changes with `npx tsc --noEmit` and `pnpm build` before opening a PR.

## How it works

### Directory

`/api/servers` serves the agent catalog — from Postgres when `USE_DB=true`, else
from the static list in `lib/mcp-data.ts`. Services are ingested from
agentic.market with real per-endpoint USDC pricing. Only a few services are
*callable* from chat (hand-wired in the ingest script's `CALLABLE` map), since
callability can't be auto-derived from the upstream API.

### Chat + payments

Users pick services as chips and chat through `/api/chat`. Each paid call goes
through the x402 protocol (`lib/x402.ts`, version-aware v1+v2) in one of two modes:

- **Connected wallet** — the client signs payments in a two-phase plan/execute flow.
- **Burner wallet** — the server pays from the `PRIVATE_KEY` house wallet
  (`lib/agent-wallet.ts`).

### Auth + persistence

Sign-in is SIWE (`lib/auth.ts`: viem/siwe + jose JWT cookie; routes under
`/api/auth/*`). Signed-in users get DB-backed chats (`/api/chats*`) keyed to their
wallet; guests get ephemeral in-memory chats. Chats can be shared read-only via an
opt-in public slug (`/p/[slug]`).

## Project layout

```
app/                  # Next.js App Router pages + API routes
  api/auth/           #   SIWE: nonce, verify, me, logout
  api/chat/           #   chat orchestrator (x402 payments happen here)
  api/chats/          #   chat persistence CRUD
  api/servers/        #   agent directory (DB or static)
  api/p/[slug]/       #   public shared-chat read
  chat/[id]/          #   chat workspace
  p/[slug]/           #   read-only shared chat page
components/           # UI (ChatWorkspace, McpServerCard, AuthButton, ...)
lib/
  x402.ts             #   x402 payer (v1+v2)
  agent-wallet.ts     #   server-side burner wallet
  auth.ts             #   SIWE + JWT sessions
  session.tsx         #   client SessionProvider / useSession
  store.ts            #   chat store (write-through to API when signed in)
  wagmi.ts            #   wallet connectors (Coinbase pinned to eoaOnly)
  mcp-data.ts         #   static fallback catalog
prisma/schema.prisma  # McpServer, Chat, Message
scripts/              # ingest + auth tests (see scripts/README.md)
```

## Gotchas

- **Coinbase Wallet is pinned to `eoaOnly`** in `lib/wagmi.ts` — the Smart Wallet
  popup broke multi-signature chat turns and redirected to `/`.
- **`lib/indexeddb-polyfill.ts` must stay the first import in `app/layout.tsx`** —
  WalletConnect touches `indexedDB` during SSR and crashes Next 16 without it.
- **Prod requires `USE_DB=true` on Vercel**, otherwise the site silently serves the
  static catalog instead of the live directory.

## In flight

Open PRs add a 1-to-many `mcp_endpoints` table (a service can expose many x402
endpoints) and **spend grants** — wallet-scoped allowlists + USD caps with a
ledger/receipt trail, the first slice of the "agent expense account". See
`CLAUDE.md` at the repo root for the full roadmap.
