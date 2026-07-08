#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party Hyperliquid MCP — `hyperliquid-free`
// (repo Yeetful/free-mcps, service `hyperliquid`) — as a directory row with
// one mcp_endpoints child per TOOL, mirroring seed-cow-free.ts exactly
// (endpoint url convention `<base>/<toolName>` where base = <origin>/mcp;
// the planner posts tools/call to the /mcp base — see lib/endpoint-planner.ts
// mcpToolOf). priceUsd '0' = explicitly free; calls skip the 402 handshake
// but stay policy-gated + ledgered.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/hyperliquid/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Re-align if the service surface changes.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run:
//   DATABASE_URL=... npx tsx scripts/seed-hyperliquid-free.ts
// Local-dev overlay without touching Neon:
//   npx tsx scripts/seed-hyperliquid-free.ts --print-extra-env
import { Prisma } from '@prisma/client'

type Param = {
  group: 'body'
  name: string
  type: string
  description: string
  required: boolean
}

const p = (name: string, type: string, description: string, required = false): Param => ({
  group: 'body',
  name,
  type,
  description,
  required,
})

const HL_BASE = process.env.FREE_HYPERLIQUID_MCP_BASE ?? 'https://hyperliquid-mcp.yeetful.com/mcp'

const user = () =>
  p(
    'user',
    'string',
    "EVM address (0x…) of the Hyperliquid account — for the connected user's own portfolio/orders/fills use \"$USER_ADDRESS\".",
    true,
  )

const coins = () =>
  p('coins', 'string', 'Coin filter, comma-separated, e.g. "BTC,ETH". Spot pairs like "PURR/USDC" or bare "PURR" also resolve.')

const first = () => p('first', 'number', 'How many to return (default ~20, max 100).')

const SERVICE = {
  slug: 'hyperliquid-free',
  name: 'Hyperliquid (Free)',
  description:
    'Hyperliquid, free and non-gated: live perp + spot markets, prices, L2 orderbooks, candles, funding (with cross-venue predictions), and the full per-address account surface — positions, margin, PnL, open orders, fills, USDC ledger — plus await_settlement, a real-time WebSocket watch that returns the moment an order fills. Read-only by construction (never touches /exchange, nothing signable). Rate-limited. By Yeetful.',
  category: 'Trading',
  kind: 'data',
  priceUsd: '0',
  networks: ['Hyperliquid'],
  websiteUrl: 'https://github.com/Yeetful/free-mcps',
  // callable:false like the sibling free rows — free MCP rows are
  // PLANNER-driven: the endpoint planner picks among the mcp_endpoints
  // children below (a callable data row without a wired `tool` matches none
  // of the chat orchestrator's dispatch buckets and would go dead).
  callable: false,
  protocol: 'mcp',
  endpoint: HL_BASE,
  tags: ['trading', 'perps', 'spot', 'funding', 'portfolio', 'orderbook', 'realtime'],
  exampleQueries: [
    'what are my positions on Hyperliquid?',
    "what's the BTC funding rate?",
    'show the HYPE/USDC orderbook',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; plannable?: boolean }> = [
  {
    name: 'markets',
    description:
      "Hyperliquid perpetual markets: mark/mid/oracle price, 24h change + volume, open interest (USD), hourly + annualized funding, max leverage. Default = top markets by 24h volume; pass coins for specific ones. Answers \"what's trading on Hyperliquid\" / \"BTC funding rate\".",
    params: [coins(), first()],
  },
  {
    name: 'spot_markets',
    description:
      "Hyperliquid spot pairs (HYPE/USDC, PURR/USDC, …): mark/mid price, 24h change + volume. Native '@N' pair names are resolved to token names; the returned nativeName is what orderbook/candles/await_settlement expect for spot coins.",
    params: [coins(), first()],
  },
  {
    name: 'price',
    description:
      'Live mid prices. With coins, resolves perp names (BTC) and spot aliases (PURR, HYPE/USDC) in one call — the cheapest way to answer "what\'s ETH at?". Without coins, returns all perp mids.',
    params: [coins()],
  },
  {
    name: 'orderbook',
    description:
      'L2 orderbook for one coin (perp or spot): best bid/ask, mid, spread %, and up to 20 aggregated levels per side.',
    params: [
      p('coin', 'string', 'Coin: perp name ("ETH") or spot pair ("HYPE/USDC", "@107").', true),
      p('depth', 'number', 'Levels per side (default 10, max 20).'),
      p('nSigFigs', 'number', 'Aggregate price levels to N significant figures (2–5; omit for full precision).'),
    ],
  },
  {
    name: 'candles',
    description:
      'OHLCV candle history for one coin (perp or spot). Choose an interval and either hoursBack (default 24) or explicit startTime/endTime (ms). Keep interval × window sane — the response is capped.',
    params: [
      p('coin', 'string', 'Coin: perp name ("BTC") or spot pair ("HYPE/USDC").', true),
      p('interval', 'string', 'Candle interval: 1m 3m 5m 15m 30m 1h 2h 4h 8h 12h 1d 3d 1w 1M.', true),
      p('hoursBack', 'number', 'Lookback window in hours (default 24).'),
      p('startTime', 'number', 'Window start, ms since epoch (overrides hoursBack).'),
      p('endTime', 'number', 'Window end, ms since epoch (default now).'),
    ],
  },
  {
    name: 'funding',
    description:
      'Funding for one perp: recent hourly funding history plus the PREDICTED next rate on Hyperliquid vs Binance/Bybit (cross-venue basis). Rates are hourly fractions — ×24×365 for APR.',
    params: [
      p('coin', 'string', 'Perp coin name, e.g. "ETH".', true),
      p('hoursBack', 'number', 'History window in hours (default 24).'),
    ],
  },
  {
    name: 'portfolio',
    description:
      'Full Hyperliquid account view for an address: perp positions (size, entry, liquidation px, unrealized PnL, leverage), margin + withdrawable USDC, spot balances, and day/week/month/all-time PnL. THE tool for "what are my positions" / "how is my account doing" (user:"$USER_ADDRESS").',
    params: [user()],
  },
  {
    name: 'open_orders',
    description:
      'An address\'s resting orders with full detail: side, size, limit price, order type, trigger/TP-SL info, reduce-only flag, oid + cloid. Answers "what orders do I have open?" (user:"$USER_ADDRESS").',
    params: [user()],
  },
  {
    name: 'fills',
    description:
      'An address\'s executed trades (fills): price, size, side, direction (Open Long / Close Short…), closed PnL, fee, oid, tx hash. Most recent first; optionally time-bounded. Answers "what did I trade today?" / "did my order execute?".',
    params: [
      user(),
      p('startTime', 'number', 'Only fills at/after this ms timestamp.'),
      p('endTime', 'number', 'Only fills at/before this ms timestamp.'),
      first(),
    ],
  },
  {
    name: 'order_status',
    description:
      'Status of ONE order by oid or cloid: open / filled / canceled / rejected (+ the order\'s details and status timestamp). For live "tell me when it settles", use await_settlement instead.',
    params: [user(), p('oid', 'string', 'Order id: the numeric oid from open_orders/fills, or the 0x… cloid.', true)],
  },
  {
    name: 'ledger',
    description:
      "An address's USDC ledger: kind=funding for funding payments paid/received per position, kind=transfers for deposits, withdrawals, transfers and liquidations. Defaults to the last 7 days.",
    params: [
      user(),
      p('kind', 'string', '"funding" = funding payments; "transfers" = deposits/withdrawals/transfers/liquidations.', true),
      p('startTime', 'number', 'Window start, ms since epoch (default 7 days ago).'),
      p('endTime', 'number', 'Window end, ms since epoch (default now).'),
    ],
  },
  {
    name: 'await_settlement',
    description:
      'BLOCK until an order settles, then report it — the real-time "did it go through?" tool. Subscribes to the address\'s fills + order updates over WebSocket and returns as soon as a matching fill or terminal status lands, or after timeoutSeconds (default 30, max 45). With oid it watches that order (checking first whether it ALREADY settled); with just coin or nothing it resolves on the address\'s next fill.',
    params: [
      user(),
      p('oid', 'string', 'Order id to watch: numeric oid or 0x… cloid (optional).'),
      p('coin', 'string', 'Only settle on events for this coin (perp name or spot nativeName).'),
      p('timeoutSeconds', 'number', 'Max seconds to wait (default 30, max 45).'),
    ],
  },
  {
    name: 'info_query',
    description:
      'Escape hatch: run any READ-ONLY Hyperliquid /info request for data the other tools don\'t cover (vaults, staking, fees, sub-accounts, TWAP fills…). Pass the JSON body, e.g. {"type":"userFees","user":"$USER_ADDRESS"}. Allowlisted types only; read-only by construction.',
    params: [
      p('request', 'string', 'The /info request body as JSON, e.g. {"type":"vaultDetails","vaultAddress":"0x…"}.', true),
    ],
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.filter((t) => t.plannable !== false).map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${HL_BASE}/${t.name}`,
    description: t.description,
    priceUsd: '0',
    parameters: t.params,
    category: SERVICE.category,
    tags: SERVICE.tags,
    exampleQueries: SERVICE.exampleQueries,
  }))
  console.log(`EXTRA_MCP_ROWS='${JSON.stringify(rows)}'`)
  console.log(`EXTRA_MCP_ENDPOINTS='${JSON.stringify(endpoints)}'`)
}

async function main() {
  const { default: prisma } = await import('../lib/db')
  const server = await prisma.mcpServer.upsert({
    where: { slug: SERVICE.slug },
    create: { ...SERVICE, gated: false },
    update: { ...SERVICE, gated: false },
  })

  await prisma.mcpEndpoint.deleteMany({ where: { serverId: server.id } })
  await prisma.mcpEndpoint.createMany({
    data: TOOLS.map((t, i) => ({
      serverId: server.id,
      method: 'POST',
      // Path style (`/mcp/<tool>`) — matches the x402 fleet's endpoint
      // display; buildSmartRequest posts the tools/call to the /mcp base.
      url: `${HL_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'Hyperliquid',
      provider: 'Yeetful (free)',
      position: i,
      parameters: t.plannable === false ? Prisma.DbNull : (t.params as unknown as object),
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${HL_BASE}`)
  await prisma.$disconnect()
}

if (process.argv.includes('--print-extra-env')) {
  printExtraEnv()
} else {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
