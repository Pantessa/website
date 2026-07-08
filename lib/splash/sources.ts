// Splash sources: for each connected MCP, how to turn its "overview" read tool
// into a SplashTile. THE scalability seam — a new MCP is one entry here, no new
// API route and (if it reuses a render primitive) no new frontend.
//
// Each source: match a connected server, call ≤1 read tool with the connected
// address, shape the result into a tile + suggested prompts. Failures are
// isolated per source (buildSplash filters nulls) so one dead MCP never blanks
// the whole splash.

import type { McpServer } from '@/lib/store'
import { callMcpTool } from '@/lib/mcp-call'
import { overrideFreeMcpBase } from '@/lib/endpoint-planner'
import type { HoldingRow, ProposalRow, SpaceRow, SplashTile, StatRow, SuggestedPrompt } from './types'

/** Snapshot's stamp service resolves a space logo from its id — always
 *  available, no IPFS gateway flakiness. */
const spaceLogo = (spaceId: string) => `https://cdn.stamp.fyi/space/${encodeURIComponent(spaceId)}?s=96`

type McpCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>

interface SplashSource {
  id: string
  /** Does this source apply to a connected server? */
  match: (s: McpServer) => boolean
  /** Build a tile (or null to contribute nothing). `call` is bound to this
   *  server's endpoint; `address` is the connected wallet. */
  build: (call: McpCaller, address: string, server: McpServer) => Promise<SplashTile | null>
}

// ── Uniswap → portfolio (holdings) ──────────────────────────────────────────

interface PortfolioPayload {
  totalUsd: number
  holdings: HoldingRow[]
  chainId: number
}

const uniswapSource: SplashSource = {
  id: 'uniswap',
  match: (s) => s.slug === 'uniswap' || s.slug === 'uniswap-free' || /uniswap/i.test(s.name),
  build: async (call, address, server) => {
    const data = (await call('balances', { owner: address })) as PortfolioPayload
    const holdings = Array.isArray(data.holdings) ? data.holdings : []
    const base = { id: 'uniswap-holdings', mcpSlug: server.slug, mcpName: server.name }
    if (holdings.length === 0) {
      return {
        ...base,
        render: 'empty',
        title: 'Your Base portfolio',
        message: 'No tokens found on Base for this wallet.',
        prompts: [{ label: 'Get a quote', prompt: 'What would it cost to swap 100 USDC into ETH on Base?' }],
      }
    }
    // Suggested prompts derived from what they actually hold.
    const prompts: SuggestedPrompt[] = []
    const stable = holdings.find((h) => /^(USDC|DAI|USDbC)$/i.test(h.symbol) && (h.valueUsd ?? 0) >= 10)
    if (stable) {
      const amt = Math.min(Math.floor(Number(stable.balance)), 100) || 1
      prompts.push({ label: `Put ${stable.symbol} to work`, prompt: `Swap ${amt} ${stable.symbol} into ETH on Base` })
    }
    const eth = holdings.find((h) => h.symbol === 'ETH' && (h.valueUsd ?? 0) >= 5)
    if (eth) prompts.push({ label: 'Best swap for my ETH', prompt: 'What is the best swap I could make with my ETH right now?' })
    const top = holdings.find((h) => !/^(USDC|DAI|USDbC|ETH|WETH)$/i.test(h.symbol) && (h.valueUsd ?? 0) >= 1)
    if (top) prompts.push({ label: `Sell my ${top.symbol}`, prompt: `Quote selling all my ${top.symbol} for USDC on Base` })
    if (prompts.length === 0) prompts.push({ label: 'Review my holdings', prompt: 'What can I do with the tokens in my wallet?' })

    return {
      ...base,
      render: 'holdings',
      title: 'Your Base portfolio',
      subtitle: `via ${server.name}`,
      chain: 'Base',
      totalUsd: typeof data.totalUsd === 'number' ? data.totalUsd : null,
      holdings: holdings.slice(0, 8),
      prompts: prompts.slice(0, 3),
    }
  },
}

// ── Snapshot → open proposals in followed spaces ─────────────────────────────

interface SnapshotProposal {
  id: string
  title: string
  choices: string[]
  scores?: number[]
  end: number
  space: { id: string; name: string }
}

const snapshotSource: SplashSource = {
  id: 'snapshot',
  match: (s) => /snapshot/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server) => {
    const data = (await call('list_proposals', { follower: address, state: 'active', first: 12 })) as {
      proposals?: SnapshotProposal[]
      note?: string
    }
    const raw = Array.isArray(data.proposals) ? data.proposals : []
    const base = { id: 'snapshot-proposals', mcpSlug: server.slug, mcpName: server.name }
    if (raw.length === 0) {
      return {
        ...base,
        render: 'empty',
        title: 'Governance',
        message: data.note || 'No open proposals in the spaces this wallet follows.',
        prompts: [{ label: 'Find active DAOs', prompt: 'What are the most active DAOs on Snapshot right now?' }],
      }
    }
    const proposals: ProposalRow[] = raw.map((p) => {
      const leadIdx = Array.isArray(p.scores) && p.scores.length
        ? p.scores.reduce((best, s, i, arr) => (s > arr[best] ? i : best), 0)
        : -1
      const hasVotes = Array.isArray(p.scores) && p.scores.some((s) => s > 0)
      return {
        id: p.id,
        title: p.title,
        spaceId: p.space.id,
        spaceName: p.space.name,
        avatarUrl: spaceLogo(p.space.id),
        choices: p.choices ?? [],
        leadingChoice: hasVotes && leadIdx >= 0 ? p.choices[leadIdx] ?? null : null,
        endsAt: p.end,
      }
    })
    // Unique followed spaces (for the logo strip).
    const spaces: SpaceRow[] = [...new Map(proposals.map((p) => [p.spaceId, p])).values()].map((p) => ({
      id: p.spaceId,
      name: p.spaceName,
      avatarUrl: p.avatarUrl,
    }))
    const first = proposals[0]
    const prompts: SuggestedPrompt[] = [
      { label: `Summarize “${truncate(first.title, 32)}”`, prompt: `Summarize the ${first.spaceName} proposal "${first.title}" and tell me what's at stake.` },
      { label: 'What needs my vote?', prompt: 'Which of my open Snapshot proposals should I prioritize, and why?' },
    ]
    if (spaces.length > 1) {
      prompts.push({ label: `${spaces.length} DAOs open`, prompt: `Give me a one-line summary of each open proposal across the ${spaces.length} DAOs I follow.` })
    }
    return {
      ...base,
      render: 'proposals',
      title: 'Proposals to vote on',
      subtitle: `${proposals.length} open · ${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'} you follow`,
      spaces,
      proposals,
      prompts,
    }
  },
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

// ── CoW Protocol → open orders + recent fills (rows) ─────────────────────────

interface CowChainView {
  chain: string
  error?: string
  openOrders?: {
    pair: string
    kind: string
    status: string
    filledPct: number | null
    validTo: number
  }[]
  tradeCount?: number
  recentFills?: { pair: string; txHash: string }[]
}

// The order book returns raw addresses for tokens outside the service's
// curated symbol list — shorten them (and map the native-ETH sentinel).
const prettyToken = (t: string) => {
  if (/^0xe{40}$/i.test(t)) return 'ETH'
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? `${t.slice(0, 6)}…${t.slice(-4)}` : t
}
const prettyPair = (pair: string) =>
  pair
    .split('→')
    .map((s) => prettyToken(s.trim()))
    .join(' → ')

const cowSource: SplashSource = {
  id: 'cow',
  match: (s) => /(^|\b)cow(\b|-)/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server) => {
    // Two chains keeps the scan snappy (the full default is four).
    const data = (await call('portfolio', { owner: address, chains: 'mainnet,base' })) as {
      chains?: CowChainView[]
    }
    const chains = Array.isArray(data.chains) ? data.chains.filter((c) => !c.error) : []
    const open = chains.flatMap((c) => (c.openOrders ?? []).map((o) => ({ ...o, chain: c.chain })))
    const fills = chains.flatMap((c) => (c.recentFills ?? []).map((f) => ({ ...f, chain: c.chain })))
    const trades = chains.reduce((n, c) => n + (c.tradeCount ?? 0), 0)
    const base = { id: 'cow-activity', mcpSlug: server.slug, mcpName: server.name }

    if (open.length === 0 && fills.length === 0) {
      return {
        ...base,
        render: 'empty',
        title: 'CoW Protocol',
        message: 'No CoW orders or trades for this wallet yet — MEV-protected swaps start here.',
        prompts: [
          { label: 'Quote a swap', prompt: 'Quote swapping 100 USDC to WETH on CoW' },
          { label: 'Place a limit order', prompt: 'Build a limit order selling 1 WETH at 4000 USDC on CoW' },
        ],
      }
    }

    const rows: StatRow[] = [
      ...open.slice(0, 4).map((o) => ({
        label: `${prettyPair(o.pair)} · ${o.kind}`,
        value: o.filledPct != null ? `${Math.round(o.filledPct)}% filled` : o.status,
        sub: `open on ${o.chain}`,
      })),
      ...fills.slice(0, Math.max(0, 4 - Math.min(open.length, 4))).map((f) => ({
        label: prettyPair(f.pair),
        value: 'filled',
        sub: `recent trade on ${f.chain}`,
        tone: 'pos' as const,
      })),
    ]
    const prompts: SuggestedPrompt[] = open.length
      ? [
          { label: 'Check my open orders', prompt: 'Show my open CoW orders — are any close to filling?' },
          { label: 'Cancel an order', prompt: 'Help me cancel one of my open CoW orders' },
        ]
      : [
          { label: 'Trade again', prompt: 'Quote my last CoW pair again at today’s price' },
          { label: 'Quote a swap', prompt: 'Quote swapping 100 USDC to WETH on CoW' },
        ]
    return {
      ...base,
      render: 'rows',
      title: 'Your CoW activity',
      subtitle: `${open.length} open · ${trades} trades`,
      rows,
      prompts,
    }
  },
}

// ── Hyperliquid → positions + account value (rows) ───────────────────────────

interface HlPosition {
  coin?: string
  szi?: string
  entryPx?: string
  positionValue?: string
  unrealizedPnl?: string
  liquidationPx?: string | null
  leverage?: { value?: number }
}

const hyperliquidSource: SplashSource = {
  id: 'hyperliquid',
  match: (s) => /hyperliquid/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server) => {
    const data = (await call('portfolio', { user: address })) as {
      perp?: {
        accountValueUsd?: string | null
        withdrawableUsd?: string | null
        positions?: HlPosition[]
      }
      pnl?: Record<string, { pnl: string | null }> | null
    }
    const positions = Array.isArray(data.perp?.positions) ? data.perp!.positions! : []
    const accountValue = Number(data.perp?.accountValueUsd ?? 0)
    const base = { id: 'hyperliquid-positions', mcpSlug: server.slug, mcpName: server.name }

    if (positions.length === 0 && accountValue === 0) {
      return {
        ...base,
        render: 'empty',
        title: 'Hyperliquid',
        message: 'No Hyperliquid account activity for this wallet.',
        prompts: [
          { label: 'Market snapshot', prompt: "What's trading on Hyperliquid right now — top markets by volume?" },
          { label: 'BTC funding', prompt: "What's the BTC funding rate on Hyperliquid?" },
        ],
      }
    }

    const rows: StatRow[] = positions.slice(0, 5).map((p) => {
      const size = Number(p.szi ?? 0)
      const pnl = Number(p.unrealizedPnl ?? 0)
      const lev = p.leverage?.value
      return {
        label: `${p.coin} ${size >= 0 ? 'long' : 'short'}${lev ? ` ${lev}x` : ''}`,
        value: `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)} PnL`,
        sub: `entry $${p.entryPx ?? '—'}${p.liquidationPx ? ` · liq $${p.liquidationPx}` : ''}`,
        tone: pnl >= 0 ? ('pos' as const) : ('neg' as const),
      }
    })
    const dayPnl = Number(data.pnl?.day?.pnl ?? NaN)
    const prompts: SuggestedPrompt[] = [
      { label: 'How am I doing?', prompt: 'Summarize my Hyperliquid positions — PnL, risk, anything near liquidation?' },
      { label: 'My open orders', prompt: 'What orders do I have resting on Hyperliquid?' },
    ]
    if (Number.isFinite(dayPnl) && dayPnl < 0) {
      prompts.push({ label: 'What went wrong today?', prompt: 'My Hyperliquid PnL is down today — which position is dragging?' })
    }
    return {
      ...base,
      render: 'rows',
      title: 'Your Hyperliquid account',
      subtitle: `${positions.length} open ${positions.length === 1 ? 'position' : 'positions'}`,
      headline:
        accountValue > 0
          ? { value: `$${accountValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, caption: 'account value' }
          : undefined,
      rows,
      prompts,
    }
  },
}

/** All registered splash sources. Exported for tests; a new MCP appends here. */
export const SPLASH_SOURCES: SplashSource[] = [uniswapSource, snapshotSource, cowSource, hyperliquidSource]

// ── Generic featured-endpoint source (any MCP, zero hand-coding) ─────────────
// An MCP with no dedicated source above still gets a connect-time quick view
// when its owner flagged featured ("ping first") endpoints — the add-MCP modal
// and the admin star on /servers/[slug] both set mcp_endpoints.featured. We
// call up to two featured tools with the connected address filled into their
// address-shaped params and summarize whatever comes back into a rows tile.
// This is also the learning loop: which flagged endpoints produce a useful
// first paint tells us what "important" means per MCP.

/** A featured endpoint row as the splash route loads it from mcp_endpoints. */
export interface FeaturedEndpoint {
  url: string
  description: string | null
  parameters: { name?: string; description?: string; required?: boolean; type?: string }[] | null
}

/** A server plus its featured endpoints (the splash route attaches them). */
export type SplashServer = McpServer & { featuredEndpoints?: FeaturedEndpoint[] }

/** Param names that mean "the user's own address" — same intent as the
 *  planner's $USER_ADDRESS guidance, matched structurally here. */
const ADDRESS_PARAM_RE = /^(owner|user|address|wallet|account|follower|voter|holder|trader)$/i

/** Tool name from the stored url convention `<base>/mcp#tool` or `…/mcp/tool`. */
function toolNameOf(url: string): string | null {
  const m = url.match(/\/mcp[#/]([^#/?]+)$/)
  return m ? m[1] : null
}

/** Fill a featured tool's params: connected address into address-shaped ones;
 *  null when a required param exists we can't supply (the call would fail). */
function fillFeaturedArgs(ep: FeaturedEndpoint, address: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {}
  for (const p of ep.parameters ?? []) {
    if (!p.name) continue
    const wantsAddress = ADDRESS_PARAM_RE.test(p.name) || /\$USER_ADDRESS/.test(p.description ?? '')
    if (wantsAddress) args[p.name] = address
    else if (p.required) return null
  }
  return args
}

/** Summarize an arbitrary tool payload into ≤5 StatRows — scalars become
 *  label/value rows, arrays become counts (with a peek at the first entry). */
function summarizedRows(data: unknown): StatRow[] {
  const rows: StatRow[] = []
  const push = (label: string, value: string, sub?: string) => {
    if (rows.length < 5) rows.push({ label, value, sub })
  }
  const preview = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') {
      const s = Object.values(v as Record<string, unknown>).find((x) => typeof x === 'string' && x.length < 48)
      return typeof s === 'string' ? s : ''
    }
    return String(v).slice(0, 48)
  }
  if (Array.isArray(data)) {
    push('entries', String(data.length), preview(data[0]) || undefined)
    return rows
  }
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v === null || v === undefined) continue
      if (Array.isArray(v)) push(k, `${v.length} ${v.length === 1 ? 'item' : 'items'}`, preview(v[0]) || undefined)
      else if (typeof v === 'object') {
        const inner = summarizedRows(v)
        if (inner[0]) push(k, inner[0].value ?? '', inner[0].label)
      } else push(k, String(v).slice(0, 64))
    }
    return rows
  }
  if (typeof data === 'string' && data.trim()) push('result', data.slice(0, 64))
  return rows
}

/** Build the generic quick-view tile from a server's featured endpoints. */
async function buildFeaturedTile(
  call: McpCaller,
  address: string,
  server: SplashServer,
): Promise<SplashTile | null> {
  const eps = (server.featuredEndpoints ?? []).slice(0, 2)
  const base = { id: `${server.slug}-featured`, mcpSlug: server.slug, mcpName: server.name }
  const rows: StatRow[] = []
  let usedTool: string | null = null
  for (const ep of eps) {
    const tool = toolNameOf(ep.url)
    if (!tool) continue
    const args = fillFeaturedArgs(ep, address)
    if (args === null) continue
    try {
      const data = await call(tool, args)
      // Drop input echoes (the address we just sent) and repeated labels —
      // "user: 0x…" twice tells the user nothing about their account.
      const seen = new Set(rows.map((r) => r.label))
      const got = summarizedRows(data).filter(
        (r) => r.value?.toLowerCase() !== address.toLowerCase() && !seen.has(r.label),
      )
      if (got.length > 0) {
        usedTool ??= tool
        rows.push(...got.slice(0, 5 - rows.length))
      }
      if (rows.length >= 5) break
    } catch {
      // A dead featured tool contributes nothing — the other one may still land.
    }
  }
  if (rows.length === 0 || !usedTool) return null
  const prompts: SuggestedPrompt[] = (server.exampleQueries ?? [])
    .slice(0, 2)
    .map((q) => ({ label: truncate(q, 32), prompt: q }))
  if (prompts.length === 0) {
    prompts.push({ label: `What can ${server.name} do?`, prompt: `What can ${server.name} do for my account right now?` })
  }
  return {
    ...base,
    render: 'rows',
    title: `Your ${server.name} view`,
    subtitle: `via ${usedTool}`,
    rows,
    prompts,
  }
}

/**
 * Build the splash tiles for a connected wallet across the connected MCP set.
 * Runs every matching source in parallel; a source that throws or times out
 * is dropped so one bad MCP can't blank the dashboard. Servers no dedicated
 * source claims fall through to the generic featured-endpoint tile.
 */
export async function buildSplash(address: string, servers: SplashServer[]): Promise<SplashTile[]> {
  const jobs: Promise<SplashTile | null>[] = []
  for (const server of servers) {
    if (!server.endpoint) continue
    const endpoint = overrideFreeMcpBase(server.endpoint)
    const call: McpCaller = (name, args) => callMcpTool(endpoint, name, args)
    let matched = false
    for (const source of SPLASH_SOURCES) {
      if (!source.match(server)) continue
      matched = true
      jobs.push(source.build(call, address, server).catch(() => null))
    }
    if (!matched && (server.featuredEndpoints?.length ?? 0) > 0) {
      jobs.push(buildFeaturedTile(call, address, server).catch(() => null))
    }
  }
  const tiles = await Promise.all(jobs)
  return tiles.filter((t): t is SplashTile => t !== null)
}
