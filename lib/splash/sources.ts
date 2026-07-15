// Splash sources: for each connected MCP, how to turn its "overview" read tool
// into a SplashTile. THE scalability seam — a new MCP is one entry here, no new
// API route and (if it reuses a render primitive) no new frontend.
//
// Each source: match a connected server, call ≤1 read tool with the connected
// address, shape the result into a tile + suggested prompts. Failures are
// isolated per source (buildSplash filters nulls) so one dead MCP never blanks
// the whole splash.
//
// THE AFFINITY CONTRACT (Nate, 2026-07-10): a card earns its place by showing
// something REAL for this wallet. A source that finds no activity returns
// null — no card — instead of an empty-state tile. Errors still surface as
// retryable error cards ("broke" must stay distinguishable from "nothing
// here"). Uniswap additionally gates on an on-chain router-interaction probe
// (lib/splash/affinity.ts) because its card is a generic wallet portfolio.
//
// THE MANUAL-PICK EXCEPTION (Nate, 2026-07-13): an MCP the user EXPLICITLY
// toggled on (rail click / add-MCP modal → `forceShow` on the server) always
// gets a card. No activity → a "preview" card: what this MCP can do for you,
// with prompt chips — so a hand-picked MCP shows its face instead of nothing.

import type { McpServer } from '@/lib/store'
import { callMcpTool } from '@/lib/mcp-call'
import { overrideFreeMcpBase } from '@/lib/endpoint-planner'
import { alchemyEnabled, getMultichainPortfolio, getRecentActivity } from '@/lib/alchemy'
import type { AppChain } from '@/lib/chains'
import { hasUniswapHistory } from './affinity'
import type { EmptyTile, HoldingRow, ProposalRow, SpaceRow, SplashTile, StatRow, SuggestedPrompt } from './types'

/** Snapshot's stamp service resolves a space logo from its id — always
 *  available, no IPFS gateway flakiness. */
const spaceLogo = (spaceId: string) => `https://cdn.stamp.fyi/space/${encodeURIComponent(spaceId)}?s=96`

type McpCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>

interface SplashSource {
  id: string
  /** Does this source apply to a connected server? */
  match: (s: McpServer) => boolean
  /** Build one or more tiles (or null to contribute nothing). `call` is bound
   *  to this server's endpoint; `address` is the connected wallet; `chain` is
   *  the chain picker's selection (null/undefined = all supported chains) —
   *  chain-scoped sources narrow their reads to it, chain-agnostic sources
   *  (governance, perps) ignore it. */
  build: (call: McpCaller, address: string, server: McpServer, chain?: AppChain | null) => Promise<SplashTile | SplashTile[] | null>
}

// ── Uniswap slot → wallet portfolio + recent transactions ────────────────────
// When ALCHEMY_API_KEY is set this is a WHOLE-WALLET view across Ethereum, Base
// and Arbitrum (holdings priced to USD + recent transactions). Without a key it
// falls back to the keyless Base-only on-chain read from the uniswap MCP's
// `balances` tool — so the card always works, it's just single-chain.

interface PortfolioPayload {
  totalUsd: number
  holdings: HoldingRow[]
  chainId: number
}

/** chainId → display label for the keyless fallback (the MCP is Base-only, but
 *  read the real chainId rather than hardcoding the label). */
function chainLabel(chainId: number): string {
  const map: Record<number, string> = { 1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism', 137: 'Polygon' }
  return map[chainId] ?? `chain ${chainId}`
}

/** Holdings → up to 3 "do something" prompt chips. `where` scopes the swap
 *  prompts to the right venue phrasing. */
function holdingPrompts(holdings: HoldingRow[], where: string): SuggestedPrompt[] {
  // ACTIONS WITHIN REACH only: every chip sends a message a native builder
  // parses into a signable artifact, sized from the LIVE balance — never a
  // question we can't deterministically answer.
  const prompts: SuggestedPrompt[] = []
  const stable = holdings.find((h) => /^(USDC|DAI|USDbC|USDT)$/i.test(h.symbol) && (h.valueUsd ?? 0) >= 10)
  if (stable) {
    const amt = Math.min(Math.floor(Number(stable.balance)), 100) || 1
    prompts.push({ label: `Swap ${amt} ${stable.symbol} → ETH`, prompt: `Swap ${amt} ${stable.symbol} for ETH ${where}` })
  }
  const eth = holdings.find((h) => h.symbol === 'ETH' && (h.valueUsd ?? 0) >= 8 && h.priceUsd)
  if (eth) {
    // A ~$10 slice (or a quarter of the stack, whichever is smaller).
    const amt = Math.min(10 / eth.priceUsd!, Number(eth.balance) * 0.25)
    if (amt > 0.0001) prompts.push({ label: 'Swap some ETH → USDC', prompt: `Swap ${amt.toFixed(4)} ETH for USDC ${where}` })
  }
  const top = holdings.find((h) => !/^(USDC|DAI|USDbC|USDT|ETH|WETH)$/i.test(h.symbol) && (h.valueUsd ?? 0) >= 1 && Number(h.balance) > 0)
  if (top) {
    const bal = Number(top.balance)
    const amt = bal >= 1 ? String(Math.floor(bal * 10000) / 10000) : top.balance
    prompts.push({ label: `Sell my ${top.symbol}`, prompt: `Swap ${amt} ${top.symbol} for USDC ${where}` })
  }
  if (prompts.length === 0) prompts.push({ label: 'Show my full portfolio', prompt: 'Show my full portfolio across chains.' })
  return prompts.slice(0, 3)
}

/** Multichain path (Alchemy): a portfolio holdings tile + a recent-transactions
 *  tile spanning every covered chain — or scoped to ONE when the chain picker
 *  has a selection. */
async function buildMultichainTiles(address: string, server: McpServer, chain?: AppChain | null): Promise<SplashTile[]> {
  const onlyNet = chain?.alchemyNet
  const [portfolio, activity] = await Promise.all([
    getMultichainPortfolio(address, onlyNet),
    getRecentActivity(address, 6, onlyNet).catch(() => []), // activity is a bonus — never fail the card over it
  ])
  const holdings = portfolio.holdings
  const scope = chain
    ? chain.name
    : portfolio.chainLabels.length ? portfolio.chainLabels.join(' · ') : 'Ethereum · Base · Arbitrum'
  const tiles: SplashTile[] = []

  // Empty wallet → no portfolio card (the affinity contract). A wallet with
  // recent activity but zero priced holdings still gets the activity tile.
  if (holdings.length > 0) {
    tiles.push({
      id: 'portfolio-holdings',
      mcpSlug: server.slug,
      mcpName: server.name,
      render: 'holdings',
      title: chain ? `Your ${chain.short} portfolio` : 'Your portfolio',
      subtitle: chain
        ? `${holdings.length} on ${chain.name}`
        : `${holdings.length} across ${portfolio.chainsWithHoldings} ${portfolio.chainsWithHoldings === 1 ? 'chain' : 'chains'}`,
      chain: scope,
      totalUsd: portfolio.totalUsd,
      // Keep the card compact — it shares one uniform-height grid with
      // single-section cards, and the subtitle already carries the full count.
      holdings: holdings.slice(0, 4),
      prompts: holdingPrompts(holdings, `on ${chain?.name ?? 'Base'}`),
    })
  }

  if (activity.length > 0) {
    tiles.push({
      id: 'recent-activity',
      mcpSlug: server.slug,
      mcpName: server.name,
      render: 'activity',
      title: 'Recent transactions',
      subtitle: `${scope}`,
      rows: activity.slice(0, 2),
      prompts: [
        { label: 'Explain my last tx', prompt: `Explain my most recent transaction (${activity[0].asset} on ${activity[0].chain}) in plain English.` },
        { label: 'Summarize my activity', prompt: chain ? `Summarize my recent on-chain activity on ${chain.name}.` : 'Summarize my recent on-chain activity across Ethereum, Base, and Arbitrum.' },
      ],
    })
  }
  return tiles
}

/** Keyless fallback (Base-only, via the uniswap MCP `balances` tool). Empty
 *  wallet → null (no card). */
async function buildBaseFallbackTile(call: McpCaller, address: string, server: McpServer): Promise<SplashTile | null> {
  const data = (await call('balances', { owner: address })) as PortfolioPayload
  const holdings = Array.isArray(data.holdings) ? data.holdings : []
  const label = typeof data.chainId === 'number' ? chainLabel(data.chainId) : 'Base'
  if (holdings.length === 0) return null
  return {
    id: 'portfolio-holdings',
    mcpSlug: server.slug,
    mcpName: server.name,
    render: 'holdings',
    title: `Your ${label} portfolio`,
    subtitle: `via ${server.name}`,
    chain: label,
    totalUsd: typeof data.totalUsd === 'number' ? data.totalUsd : null,
    holdings: holdings.slice(0, 5),
    prompts: holdingPrompts(holdings, `on ${label}`),
  }
}

const uniswapSource: SplashSource = {
  id: 'uniswap',
  match: (s) => s.slug === 'uniswap' || s.slug === 'uniswap-free' || /uniswap/i.test(s.name),
  build: async (call, address, server, chain) => {
    if (alchemyEnabled()) {
      // The Uniswap card is a generic wallet view — earn it by actual Uniswap
      // usage (router-interaction probe; runs concurrently with the portfolio
      // fetch, so a shown card pays zero extra latency). Unknown (probe
      // failed) fails open. When the wallet MCP is also connected its
      // identical tiles win the dedupe anyway, so a false negative here still
      // leaves the user their portfolio. A manual pick (forceShow) skips the
      // probe entirely — the user asked for this card. The usage probe stays
      // whole-wallet even when a chain is selected ("has this wallet ever
      // used Uniswap anywhere") — only the rendered holdings narrow.
      if ((server as SplashServer).forceShow) return buildMultichainTiles(address, server, chain)
      const [used, tiles] = await Promise.all([hasUniswapHistory(address), buildMultichainTiles(address, server, chain)])
      if (used === false) return null
      return tiles
    }
    // Keyless: no way to probe usage — fail open to the Base-only balances
    // view (which can't scope to another chain; skip when one is selected).
    if (chain && chain.key !== 'base') return null
    return buildBaseFallbackTile(call, address, server)
  },
}

// ── Snapshot → open proposals in followed spaces ─────────────────────────────

interface SnapshotProposal {
  id: string
  title: string
  choices: string[]
  scores?: number[]
  end: number
  /** Snapshot voting type — the MCP's PROPOSAL_FIELDS always selects it. */
  type?: string
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
    // No follows / nothing open → no card (the affinity contract).
    if (raw.length === 0) return null
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
        ...(typeof p.type === 'string' ? { type: p.type } : {}),
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
      // The vote itself is a native signable (EIP-712 prepare_vote →
      // SignVoteButton) — the action chip leads, the reads follow.
      { label: `Vote on “${truncate(first.title, 28)}”`, prompt: `Prepare my vote on the ${first.spaceName} proposal "${first.title}" — show me the choices.` },
      { label: `Summarize “${truncate(first.title, 32)}”`, prompt: `Summarize the ${first.spaceName} proposal "${first.title}" and tell me what's at stake.` },
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
  build: async (call, address, server, chain) => {
    // Two chains keeps the scan snappy (the full default is four). A chain
    // picker selection narrows to that chain — or drops the card entirely on
    // chains CoW isn't live on (Robinhood).
    const cowChainOf: Record<string, string> = { ethereum: 'mainnet', base: 'base', arbitrum: 'arbitrum_one' }
    if (chain && !cowChainOf[chain.key]) return null
    const data = (await call('portfolio', { owner: address, chains: chain ? cowChainOf[chain.key] : 'mainnet,base' })) as {
      chains?: CowChainView[]
    }
    const chains = Array.isArray(data.chains) ? data.chains.filter((c) => !c.error) : []
    const open = chains.flatMap((c) => (c.openOrders ?? []).map((o) => ({ ...o, chain: c.chain })))
    const fills = chains.flatMap((c) => (c.recentFills ?? []).map((f) => ({ ...f, chain: c.chain })))
    const trades = chains.reduce((n, c) => n + (c.tradeCount ?? 0), 0)
    const base = { id: 'cow-activity', mcpSlug: server.slug, mcpName: server.name }

    // Never traded on CoW → no card. A wallet with lifetime trades but no
    // open orders / recent fills is still a CoW user — show the trade count.
    if (open.length === 0 && fills.length === 0 && trades === 0) return null

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
    if (rows.length === 0) rows.push({ label: 'Lifetime trades', value: String(trades), sub: 'mainnet · base' })
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

    // No account, no positions → no card (the affinity contract).
    if (positions.length === 0 && accountValue === 0) return null

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
    // ACTIONS FIRST: each open position gets a real guardian arm + a real
    // reduce-only close — both native, deterministic, signable. The read chip
    // rides last (the portfolio tool genuinely answers it).
    const prompts: SuggestedPrompt[] = []
    for (const p of positions.slice(0, 2)) {
      const side = Number(p.szi ?? 0) >= 0 ? 'long' : 'short'
      if (p.coin) {
        prompts.push({ label: `Protect ${p.coin} (10% stop)`, prompt: `Protect my ${p.coin} ${side} with a 10% stop loss` })
        if (prompts.length < 3) prompts.push({ label: `Close ${p.coin}`, prompt: `Close my ${p.coin} ${side} on Hyperliquid` })
      }
    }
    const withdrawable = Number(data.perp?.withdrawableUsd ?? 0)
    if (positions.length === 0 && withdrawable >= 12) {
      prompts.push({ label: 'Long $12 of ETH', prompt: 'Long $12 of ETH on Hyperliquid' })
    }
    if (prompts.length < 3) prompts.push({ label: 'How am I doing?', prompt: 'Summarize my Hyperliquid positions — PnL, risk, anything near liquidation?' })
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

// ── Aave v4 → positions, supplies, borrows (rows) ────────────────────────────
// Matches any aave-ish row (the seeded free row or a custom add-MCP row —
// Nate's live one is `aave-mcp-yeetful`). Calls the aave MCP's `portfolio`
// tool (default chain = the Ethereum hub, where v4 lives). No position at
// all → null (the affinity contract).

interface AaveToken {
  symbol?: string | null
}
interface AavePortfolioPayload {
  note?: string
  positions?: {
    spoke?: string | null
    netBalanceUsd?: string | null
    netApyPct?: number | null
    healthFactor?: string | null
    totalDebtUsd?: string | null
    remainingBorrowingPowerUsd?: string | null
  }[]
  supplies?: {
    token?: AaveToken | null
    balance?: string | null
    balanceUsd?: string | null
    earnedInterestUsd?: string | null
    supplyApyPct?: number | null
    isCollateral?: boolean | null
  }[]
  borrows?: {
    token?: AaveToken | null
    debt?: string | null
    debtUsd?: string | null
    borrowApyPct?: number | null
  }[]
}

const aaveSource: SplashSource = {
  id: 'aave',
  match: (s) => /aave/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server, chain) => {
    // Aave v4 is Ethereum-only — a picker selection of any other chain has
    // no Aave data to show.
    if (chain && chain.key !== 'ethereum') return null
    const data = (await call('portfolio', { user: address })) as AavePortfolioPayload
    const positions = Array.isArray(data.positions) ? data.positions : []
    const supplies = Array.isArray(data.supplies) ? data.supplies : []
    const borrows = Array.isArray(data.borrows) ? data.borrows : []
    if (positions.length === 0 && supplies.length === 0 && borrows.length === 0) return null

    const rows: StatRow[] = [
      ...supplies.slice(0, 3).map((s) => ({
        label: `${s.token?.symbol ?? 'Token'} supplied${s.isCollateral ? ' · collateral' : ''}`,
        value: s.balanceUsd ?? s.balance ?? '—',
        sub: [
          s.supplyApyPct != null ? `${s.supplyApyPct}% APY` : null,
          s.earnedInterestUsd ? `${s.earnedInterestUsd} earned` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
        tone: 'pos' as const,
      })),
      ...borrows.slice(0, 2).map((b) => ({
        label: `${b.token?.symbol ?? 'Token'} borrowed`,
        value: b.debtUsd ?? b.debt ?? '—',
        sub: b.borrowApyPct != null ? `${b.borrowApyPct}% APY accruing` : undefined,
        tone: 'neg' as const,
      })),
    ]
    const pos = positions[0]
    const hf = pos?.healthFactor != null ? Number(pos.healthFactor) : NaN
    if (Number.isFinite(hf) && borrows.length > 0 && rows.length < 5) {
      rows.push({
        label: 'Health factor',
        value: hf.toFixed(2),
        sub: hf < 1.5 ? 'getting close to liquidation' : 'comfortable',
        tone: hf < 1.5 ? ('neg' as const) : ('pos' as const),
      })
    }

    // Concrete native ops with LIVE amounts (the aave layer parses repay/
    // withdraw imperatives into guarded builds); the reads that remain are
    // ones the portfolio tool actually answers.
    const prompts: SuggestedPrompt[] = []
    const firstBorrow = borrows.find((b) => b.token?.symbol && Number(b.debt) > 0)
    if (firstBorrow) {
      prompts.push({ label: `Repay my ${firstBorrow.token!.symbol}`, prompt: `Repay all my ${firstBorrow.token!.symbol} on Aave` })
    }
    const firstSupply = supplies.find((s) => s.token?.symbol && Number(s.balance) > 0)
    if (firstSupply && prompts.length < 2) {
      prompts.push({ label: `Withdraw my ${firstSupply.token!.symbol}`, prompt: `Withdraw all my ${firstSupply.token!.symbol} from Aave` })
    }
    prompts.push({ label: 'How is my position?', prompt: 'Summarize my Aave position — health factor, borrowing power, anything at risk?' })

    return {
      id: 'aave-position',
      mcpSlug: server.slug,
      mcpName: server.name,
      render: 'rows',
      title: 'Your Aave position',
      subtitle: `${supplies.length} supplied · ${borrows.length} borrowed${pos?.netApyPct != null ? ` · net ${pos.netApyPct}% APY` : ''}`,
      headline: pos?.netBalanceUsd ? { value: pos.netBalanceUsd, caption: 'net balance on Aave' } : undefined,
      rows,
      prompts,
    }
  },
}

// ── Lido slot → staking position + the guided stake-in moment ────────────────

interface LidoPositionPayload {
  hasPosition?: boolean
  eth?: { balance?: string; usd?: string | null }
  stEth?: { balance?: string; usd?: string | null }
  wstEth?: { balance?: string; asStEth?: string; usd?: string | null }
  totalStaked?: { stEth?: string; usd?: string | null }
  currentAprPct?: number | null
  withdrawals?: { pendingRequests?: number; claimableRequests?: number; claimableEth?: string }
}

const lidoSource: SplashSource = {
  id: 'lido',
  match: (s) => /lido/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server, chain) => {
    // Lido is Ethereum-only — any other picker selection has nothing to show.
    if (chain && chain.key !== 'ethereum') return null
    const pos = (await call('position', { user: address })) as LidoPositionPayload
    if (!pos.hasPosition) return null // no activity → no card (manual picks get the preview)

    const rows: StatRow[] = []
    if (Number(pos.stEth?.balance) > 0) {
      rows.push({ label: 'stETH', value: pos.stEth?.usd ?? pos.stEth?.balance ?? '—', sub: `${pos.stEth?.balance} stETH · rebasing daily`, tone: 'pos' as const })
    }
    if (Number(pos.wstEth?.balance) > 0) {
      rows.push({ label: 'wstETH', value: pos.wstEth?.usd ?? pos.wstEth?.balance ?? '—', sub: `${pos.wstEth?.balance} wstETH (${pos.wstEth?.asStEth} stETH)`, tone: 'pos' as const })
    }
    const wd = pos.withdrawals
    if ((wd?.pendingRequests ?? 0) > 0 || (wd?.claimableRequests ?? 0) > 0) {
      rows.push({
        label: 'Withdrawals',
        value: `${(wd?.pendingRequests ?? 0) + (wd?.claimableRequests ?? 0)} in queue`,
        sub: (wd?.claimableRequests ?? 0) > 0 ? `${wd?.claimableEth} ETH claimable now` : 'still pending',
        tone: (wd?.claimableRequests ?? 0) > 0 ? ('pos' as const) : undefined,
      })
    }

    // Chips round-trip through the native lido layer (harness-checked):
    // live-amount stake when there's spare ETH, the guided ask otherwise.
    const prompts: SuggestedPrompt[] = []
    const stakeableEth = Number(pos.eth?.balance) - 0.002
    if (stakeableEth >= 0.003) {
      const amt = Math.floor(stakeableEth * 10_000) / 10_000
      prompts.push({ label: `Stake ${amt} ETH`, prompt: `Stake ${amt} ETH on Lido` })
    } else {
      prompts.push({ label: 'Help me stake more', prompt: 'Help me stake on Lido' })
    }
    prompts.push({ label: 'What have I earned?', prompt: 'What has my Lido position earned so far?' })

    return {
      id: 'lido-position',
      mcpSlug: server.slug,
      mcpName: server.name,
      render: 'rows',
      title: 'Your Lido position',
      subtitle: pos.currentAprPct != null ? `earning ~${pos.currentAprPct}% APR` : 'staked with Lido',
      headline: pos.totalStaked?.usd ? { value: pos.totalStaked.usd, caption: `${pos.totalStaked.stEth} stETH total staked` } : undefined,
      rows,
      prompts,
    }
  },
}

// ── Robinhood Chain → tokenized-stock portfolio + the bridge-in moment ───────
// The robinhood MCP's `portfolio` tool returns the wallet-MCP display contract
// (kind:'portfolio') but with Robinhood-specific fields: per-holding `kind`
// (native/stock/etf/stable) and `usd` instead of `valueUsd`. A dedicated
// source gives it its own tile id — the generic featured path used to map it
// onto the shared 'portfolio-holdings' id, where the wallet card's identical
// id deduped it out of existence.

interface RobinhoodHolding {
  symbol?: string
  kind?: string
  balance?: string
  usd?: number | null
  priceUsd?: number | null
}

/** Robinhood holdings → up to 3 action chips: buy a stock with idle USDG,
 *  sell a held stock, turn loose ETH into USDG (WETH↔USDG v3 is liquid), and
 *  always offer the bridge as the way in for more. */
function robinhoodPrompts(holdings: RobinhoodHolding[]): SuggestedPrompt[] {
  const prompts: SuggestedPrompt[] = []
  const usdg = holdings.find((h) => h.symbol === 'USDG' && (h.usd ?? 0) >= 5)
  if (usdg) {
    const amt = Math.min(Math.floor(Number(usdg.balance)), 50) || 5
    prompts.push({ label: `Buy AAPL with ${amt} USDG`, prompt: `Swap ${amt} USDG for AAPL on Robinhood Chain` })
  }
  const stock = holdings.find((h) => (h.kind === 'stock' || h.kind === 'etf') && (h.usd ?? 0) >= 1 && Number(h.balance) > 0)
  if (stock) {
    const bal = Number(stock.balance)
    const amt = bal >= 1 ? String(Math.floor(bal * 10000) / 10000) : stock.balance
    prompts.push({ label: `Sell my ${stock.symbol}`, prompt: `Swap ${amt} ${stock.symbol} for USDG on Robinhood Chain` })
  }
  const eth = holdings.find((h) => h.symbol === 'ETH' && (h.usd ?? 0) >= 8 && h.priceUsd)
  if (!usdg && eth && prompts.length < 2) {
    const amt = Math.min(10 / eth.priceUsd!, Number(eth.balance) * 0.25)
    if (amt > 0.0001) prompts.push({ label: 'Swap some ETH → USDG', prompt: `Swap ${amt.toFixed(4)} ETH for USDG on Robinhood Chain` })
  }
  if (!usdg && prompts.length < 3) {
    // No USDG doesn't block the buy: an unfunded ask triggers the Base
    // funding plan (LiFi legs + the swap, compiled into one job).
    prompts.push({ label: 'Buy $10 of AAPL', prompt: 'Buy $10 of AAPL on Robinhood Chain' })
  }
  if (prompts.length < 3) {
    prompts.push({ label: 'Bridge more ETH in', prompt: 'Bridge 0.01 ETH from Ethereum to Robinhood Chain' })
  }
  if (prompts.length < 3) {
    prompts.push({ label: 'What can I trade here?', prompt: 'What tokenized stocks can I trade on Robinhood Chain?' })
  }
  return prompts.slice(0, 3)
}

const robinhoodSource: SplashSource = {
  id: 'robinhood',
  match: (s) => /robinhood/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server, chain) => {
    // Robinhood Chain only — any other picker selection has nothing to show.
    if (chain && chain.key !== 'robinhood') return null
    const data = (await call('portfolio', { user: address })) as {
      totalUsd?: number
      holdings?: RobinhoodHolding[]
    }
    const holdings = (Array.isArray(data.holdings) ? data.holdings : []).filter(
      (h): h is RobinhoodHolding & { symbol: string; balance: string } =>
        typeof h?.symbol === 'string' && typeof h?.balance === 'string',
    )
    // Nothing on Robinhood Chain → no card (manual picks get the preview,
    // whose chips lead with the bridge-in moment).
    if (holdings.length === 0) return null
    const rows: HoldingRow[] = holdings.slice(0, 4).map((h) => ({
      symbol: h.symbol,
      address: '0x0000000000000000000000000000000000000000',
      balance: h.balance,
      priceUsd: typeof h.priceUsd === 'number' ? h.priceUsd : null,
      valueUsd: typeof h.usd === 'number' ? h.usd : null,
      ...(h.kind === 'native' ? { native: true } : {}),
      chain: 'Robinhood Chain',
    }))
    const stocks = holdings.filter((h) => h.kind === 'stock' || h.kind === 'etf').length
    return {
      id: 'robinhood-portfolio',
      mcpSlug: server.slug,
      mcpName: server.name,
      render: 'holdings',
      title: 'Your Robinhood Chain portfolio',
      subtitle: stocks > 0 ? `${stocks} ${stocks === 1 ? 'stock' : 'stocks'} · ${holdings.length} total` : `${holdings.length} on Robinhood Chain`,
      chain: 'Robinhood Chain',
      totalUsd: typeof data.totalUsd === 'number' ? data.totalUsd : null,
      holdings: rows,
      prompts: robinhoodPrompts(holdings),
    }
  },
}

const walletSource: SplashSource = {
  id: 'wallet',
  // The first-party multichain wallet MCP (yeetful-tool-*). Alchemy-backed —
  // without the key the generic featured tile still covers it (which now
  // renders kind:'portfolio' payloads as holdings, not raw rows).
  match: (s) => (s.slug === 'yeetful-tool-wallet' || /yeetful\s*wallet/i.test(s.name)) && alchemyEnabled(),
  build: (_call, address, server, chain) => buildMultichainTiles(address, server, chain),
}

/** All registered splash sources. Exported for tests; a new MCP appends here. */
export const SPLASH_SOURCES: SplashSource[] = [walletSource, uniswapSource, snapshotSource, cowSource, hyperliquidSource, aaveSource, lidoSource, robinhoodSource]

// ── Preview cards (the manual-pick exception) ────────────────────────────────
// What each source's card says when the user hand-picked the MCP but the
// wallet has no activity on it: an honest "nothing here yet" plus prompt chips
// that show what the MCP can do. Same card chrome as a live tile — the user
// sees the MCP's face and a way in, not a blank column.

const SOURCE_PREVIEWS: Record<string, { message: string; prompts: SuggestedPrompt[] }> = {
  wallet: {
    message: 'No holdings found for this wallet yet — once anything lands on Ethereum, Base, or Arbitrum it shows up here.',
    prompts: [
      { label: 'What can you show me?', prompt: 'What can the wallet agent show me about any address?' },
      { label: 'Check gas balances', prompt: 'What are my gas balances across chains?' },
    ],
  },
  uniswap: {
    message: 'No swappable holdings yet. Uniswap quotes and builds swaps the moment you hold something.',
    prompts: [
      { label: 'Price of ETH', prompt: 'What is the current price of ETH in USDC on Uniswap?' },
      { label: 'Quote a swap', prompt: 'Quote swapping 100 USDC to ETH on Base' },
      { label: 'How do swaps work here?', prompt: 'How do I make a swap through this chat — what are the steps?' },
    ],
  },
  snapshot: {
    message: 'This wallet doesn’t follow any Snapshot spaces yet — follow a DAO and its open votes appear here.',
    prompts: [
      { label: 'Find popular DAOs', prompt: 'What are the most active DAOs on Snapshot right now?' },
      { label: 'What’s hot in governance?', prompt: 'Show me interesting governance proposals closing soon on Snapshot' },
    ],
  },
  cow: {
    message: 'No CoW Protocol trades from this wallet yet. CoW gets you MEV-protected swaps at the best on-chain price.',
    prompts: [
      { label: 'Quote a swap', prompt: 'Quote swapping 100 USDC to WETH on CoW' },
      { label: 'Why CoW?', prompt: 'What makes CoW Protocol swaps different from a regular DEX swap?' },
    ],
  },
  hyperliquid: {
    message: 'No Hyperliquid account for this wallet yet — fund it in one move (or one job) and the guardian can watch your positions.',
    prompts: [
      { label: 'Deposit 10 USDC', prompt: 'Deposit 10 USDC to Hyperliquid' },
      { label: 'Fund + protected long (1 job)', prompt: 'Deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop' },
      { label: 'Top markets', prompt: 'What are the top Hyperliquid markets by volume today?' },
    ],
  },
  aave: {
    message: 'No Aave position for this wallet yet. Supply an asset and your balances, APY, and health factor live here.',
    prompts: [
      { label: 'Supply 10 USDC', prompt: 'Supply 10 USDC to Aave on Ethereum' },
      { label: 'Best supply APYs', prompt: 'What are the best supply APYs on Aave right now?' },
    ],
  },
  lido: {
    message: 'Nothing staked with Lido yet. Staking mints stETH that earns via daily rebases — and the chat sizes the stake to your live balance.',
    prompts: [
      // The guided moment: a deterministic balance check that proposes the
      // exact ask (or the whole bridge→stake job) as a chip.
      { label: 'Help me stake on Lido', prompt: 'Help me stake on Lido' },
      { label: 'Current APR', prompt: 'What is the current Lido staking APR?' },
    ],
  },
  robinhood: {
    message: 'Nothing on Robinhood Chain yet — buy a tokenized stock and Yeetful funds the chain from your Base USDC on the way (gas included), all in one guided job.',
    prompts: [
      // The killer ask leads: an unfunded buy triggers the funding plan
      // (Base USDC → gas + USDG → the stock, compiled into a job).
      { label: 'Buy $10 of AAPL', prompt: 'Buy $10 of AAPL on Robinhood Chain' },
      { label: 'Bridge ETH to Robinhood Chain', prompt: 'Bridge 0.01 ETH from Ethereum to Robinhood Chain' },
      { label: 'What can I trade here?', prompt: 'What tokenized stocks can I trade on Robinhood Chain?' },
    ],
  },
}

/** The preview card for a hand-picked MCP with no activity: source-specific
 *  copy when we have it, else the server's own example asks. Exported for
 *  tests and reused by the generic featured path. */
export function previewTile(server: SplashServer, sourceId?: string): EmptyTile {
  const canned = sourceId ? SOURCE_PREVIEWS[sourceId] : undefined
  const examplePrompts: SuggestedPrompt[] = (server.exampleQueries ?? [])
    .slice(0, 3)
    .map((q) => ({ label: truncate(q, 32), prompt: q }))
  const prompts = canned?.prompts ?? (examplePrompts.length
    ? examplePrompts
    : [{ label: `What can ${server.name} do?`, prompt: `What can ${server.name} do for me? Give me a few example asks.` }])
  return {
    id: `${server.slug}-preview`,
    mcpSlug: server.slug,
    mcpName: server.name,
    render: 'empty',
    title: 'Nothing here yet',
    subtitle: 'try one of these',
    message: canned?.message ?? (server.description ? truncate(server.description, 140) : `${server.name} is connected and ready.`),
    prompts,
  }
}

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
export type SplashServer = McpServer & {
  featuredEndpoints?: FeaturedEndpoint[]
  /** The user explicitly picked this MCP (rail toggle / add-MCP modal) —
   *  always paint a card, falling back to a preview when there's no activity.
   *  Set by /api/splash from the client's manualSlugs. */
  forceShow?: boolean
}

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

/** Map a kind:'portfolio' tool payload (wallet MCP shape) onto a holdings tile. */
function holdingsTileFromPortfolio(data: unknown, server: SplashServer): SplashTile | null {
  if (!data || typeof data !== 'object') return null
  const p = data as {
    kind?: string
    totalUsd?: number
    chains?: { chain?: string }[]
    holdings?: { symbol?: string; chain?: string; balance?: string; priceUsd?: number | null; valueUsd?: number | null; native?: boolean; address?: string | null }[]
  }
  if (p.kind !== 'portfolio' || !Array.isArray(p.holdings) || p.holdings.length === 0) return null
  const holdings: HoldingRow[] = p.holdings
    .filter((h): h is NonNullable<typeof h> => !!h && typeof h.symbol === 'string' && typeof h.balance === 'string')
    .map((h) => ({
      symbol: h.symbol as string,
      address: h.address ?? '0x0000000000000000000000000000000000000000',
      balance: h.balance as string,
      priceUsd: typeof h.priceUsd === 'number' ? h.priceUsd : null,
      valueUsd: typeof h.valueUsd === 'number' ? h.valueUsd : null,
      ...(h.native ? { native: true } : {}),
      ...(typeof h.chain === 'string' ? { chain: h.chain } : {}),
    }))
  if (holdings.length === 0) return null
  const chainLabels = [...new Set((p.chains ?? []).map((c) => c?.chain).filter((c): c is string => !!c))]
  const prompts: SuggestedPrompt[] = (server.exampleQueries ?? [])
    .slice(0, 2)
    .map((q) => ({ label: truncate(q, 32), prompt: q }))
  return {
    id: 'portfolio-holdings', // shared with the dedicated sources → dedupes
    mcpSlug: server.slug,
    mcpName: server.name,
    render: 'holdings',
    title: 'Your portfolio',
    subtitle: chainLabels.length ? `${holdings.length} across ${chainLabels.length} ${chainLabels.length === 1 ? 'chain' : 'chains'}` : `${holdings.length} holdings`,
    chain: chainLabels.join(' · ') || 'multichain',
    totalUsd: typeof p.totalUsd === 'number' ? p.totalUsd : null,
    holdings: holdings.slice(0, 6),
    prompts: prompts.length ? prompts : [{ label: 'Review my holdings', prompt: 'What can I do with the tokens in my wallet?' }],
  }
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
      // A kind:'portfolio' payload (the wallet-MCP display contract) gets the
      // REAL holdings renderer — raw label/value rows made the first-party
      // wallet card the ugliest tile on the board (Nate, 2026-07-10).
      const asHoldings = holdingsTileFromPortfolio(data, server)
      if (asHoldings) return asHoldings
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

/** A dedicated source that failed becomes a retryable error card rather than
 *  silently vanishing — the user (and we) can tell "broke" from "nothing here". */
function errorTile(source: SplashSource, server: McpServer): SplashTile {
  return {
    id: `${server.slug}-${source.id}-error`,
    mcpSlug: server.slug,
    mcpName: server.name,
    render: 'error',
    title: `Your ${server.name} view`,
    message: "Couldn't load this right now.",
    prompts: [],
  }
}

/** One source's (or the generic path's) tiles for one server — buildSplash
 *  keeps the attribution so the dedupe can honor the manual-pick contract. */
export interface SourceResult {
  server: SplashServer
  sourceId?: string
  tiles: SplashTile[]
}

/**
 * De-dupe by tile id (two connected uniswap servers → one portfolio card) —
 * WITHOUT letting the dedupe break the manual-pick contract. A hand-picked
 * server whose every tile lost the dedupe did build a live view; it's just
 * already on the board under another MCP's name (wallet + uniswap produce
 * identical multichain tiles, and the robinhood/generic portfolio used to
 * share the wallet card's id). That server still paints its face: a preview
 * card with its action chips, instead of silently vanishing. Exported for
 * tests.
 */
export function finalizeSplashTiles(results: SourceResult[]): SplashTile[] {
  const byId = new Map<string, SplashTile>()
  for (const r of results) for (const tile of r.tiles) if (!byId.has(tile.id)) byId.set(tile.id, tile)
  const surviving = new Set([...byId.values()].map((t) => t.mcpSlug))
  for (const r of results) {
    const { server } = r
    if (!server.forceShow || r.tiles.length === 0 || surviving.has(server.slug)) continue
    const fallback = previewTile(server, r.sourceId)
    if (byId.has(fallback.id)) continue
    byId.set(fallback.id, {
      ...fallback,
      title: 'Ready when you are',
      message: `Your holdings are already on the portfolio card — here's what ${server.name} can do with them.`,
    })
    surviving.add(server.slug)
  }
  return [...byId.values()]
}

/**
 * Build the splash tiles for a connected wallet across the connected MCP set.
 * Runs every matching source in parallel; a dedicated source that throws or
 * times out surfaces a retryable error card (never blanks the dashboard).
 * Servers no dedicated source claims fall through to the generic
 * featured-endpoint tile (best-effort — silent on failure).
 */
export async function buildSplash(address: string, servers: SplashServer[], chain?: AppChain | null): Promise<SplashTile[]> {
  const jobs: Promise<SourceResult>[] = []
  for (const server of servers) {
    if (!server.endpoint) {
      // Not callable (endpoint-less custom row) — a hand-picked MCP still
      // shows its preview face; anything else contributes nothing.
      if (server.forceShow) jobs.push(Promise.resolve({ server, tiles: [previewTile(server)] }))
      continue
    }
    const endpoint = overrideFreeMcpBase(server.endpoint)
    const call: McpCaller = (name, args) => callMcpTool(endpoint, name, args)
    let matched = false
    for (const source of SPLASH_SOURCES) {
      if (!source.match(server)) continue
      matched = true
      jobs.push(
        Promise.resolve()
          .then(() => source.build(call, address, server, chain))
          .then((t) => {
            const tiles = Array.isArray(t) ? t : t ? [t] : []
            // Hand-picked MCP with no activity → preview card, never nothing.
            if (tiles.length === 0 && server.forceShow) return { server, sourceId: source.id, tiles: [previewTile(server, source.id)] }
            return { server, sourceId: source.id, tiles }
          })
          .catch(() => ({ server, sourceId: source.id, tiles: [errorTile(source, server)] })),
      )
    }
    if (!matched) {
      // No dedicated source: featured endpoints paint the generic quick view;
      // a hand-picked MCP still gets its preview card when that comes up empty
      // (or when it has no featured endpoints at all).
      const featured = (server.featuredEndpoints?.length ?? 0) > 0
        ? buildFeaturedTile(call, address, server).catch(() => null)
        : Promise.resolve<SplashTile | null>(null)
      jobs.push(featured.then((t) => ({ server, tiles: t ? [t] : server.forceShow ? [previewTile(server)] : [] })))
    }
  }
  return finalizeSplashTiles(await Promise.all(jobs))
}
