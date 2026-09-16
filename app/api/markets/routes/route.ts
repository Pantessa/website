import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor } from '@/lib/charts'
import { tokenHome } from '@/lib/token-home'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { dynamicTokenBySymbol, ensureTokenList } from '@/lib/token-list'
import { FEE_TIERS, QUOTER_V2_ABI } from '@/lib/uniswap-venue'
import { poolPriceFor, poolSellPriceFor, type PoolPrice } from '@/lib/pool-price'
import { fmtTapeGap, stockTapeFor, STOCK_TAPE_BOUND_PCT, type TapePrice } from '@/lib/stock-tape'
import { callMcpTool } from '@/lib/mcp-call'
import { AAVE_MCP } from '@/lib/aave-exec'
import { LIDO_MCP } from '@/lib/lido-stake'
import { hlInfo } from '@/lib/hl-guardian-store'
import { CROSS_CHAIN_FEE_BPS, HL_BUILDER_FEE_TENTH_BPS, SWAP_FEE_BPS } from '@/lib/fees'
import { HL_EXEC_SLIPPAGE_BPS } from '@/lib/hyperliquid-exec'
import { LIFI_MAX_QUOTE_SHORTFALL_BPS } from '@/lib/lifi-venue'
import {
  DEFAULT_ROUTE_USD,
  missingVenueNotes,
  venuesFor,
  GAS_FLOOR_ETH,
  VENUE_CHAIN_LABELS,
  ROUTE_TICKET_NOTE,
  SETTLES,
  type RouteQuote,
  type RouteTicket,
  type RoutesResponse,
  type VenueRoute,
} from '@/lib/symbol-venues'
import type { AaveReserveRow } from '@/lib/aave-supply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/routes?symbol=&amount=&last=&leverage= — the venue map
// (lib/symbol-venues, pure) with LIVE numbers per row: Uniswap v3 quote per
// chain (QuoterV2, sized at the real order so impact is IN the number), the
// CoW limit price the row rests at, Hyperliquid mark / hourly funding / max
// leverage, Aave supply + borrow APY, Lido's 7-day APR, the Robinhood Chain
// pool price beside the TAPE — the server's own read of it (lib/stock-tape),
// never a price derived from the same pool, so a broken pool can't read
// "+0.00% vs tape". Public (no wallet — every row is a sentence
// the wallet signs later); 30s cache per (symbol, amount, last-bucket,
// leverage); every provider fail-soft: a row with no quote carries
// `quote: null` and still sends (the build itself is the honest gate).
// "Best" is claimed only within the spot kind (best out for the same
// dollars) — never across kinds.

const TTL_MS = 30_000
const PROVIDER_TIMEOUT_MS = 8_000
const cache = new Map<string, { at: number; value: RoutesResponse }>()
const inflight = new Map<string, Promise<RoutesResponse>>()

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('provider timed out')), PROVIDER_TIMEOUT_MS))])
}

/** The symbol's token on a chain — the registry pin first, then the dynamic
 *  list; BTC is cbBTC/WBTC on our chains (lib/token-home: the real thing,
 *  not a squat). */
async function tokenOn(sym: string, chainId: number): Promise<{ address: `0x${string}`; decimals: number } | null> {
  const chain = chainById(chainId)
  if (!chain) return null
  if (sym === 'ETH') return { address: chain.wrappedNative, decimals: 18 }
  const pinned = chain.tokens[sym]
  if (pinned) return pinned
  await ensureTokenList(chainId).catch(() => undefined)
  const candidates = sym === 'BTC' ? ['CBBTC', 'WBTC'] : [sym]
  for (const c of candidates) {
    const t = dynamicTokenBySymbol(c, chainId)
    if (t && /^0x[0-9a-fA-F]{40}$/.test(t.address)) return { address: t.address as `0x${string}`, decimals: t.decimals }
  }
  return null
}

/** Uniswap v3: what `usd` of the chain stable buys right now — best fee tier. */
async function uniswapQuote(sym: string, chainId: number, usd: number): Promise<{ usdPerToken: number; tokenOut: number } | null> {
  const chain = chainById(chainId)
  const stable = primaryStable(chainId)
  const client = publicClientFor(chainId)
  if (!chain?.uniswap || !stable || !client) return null
  const token = await tokenOn(sym, chainId)
  if (!token) return null
  const amountIn = BigInt(Math.round(usd * 10 ** stable.decimals))
  const outs = await Promise.all(
    FEE_TIERS.map(async (fee): Promise<bigint | null> => {
      try {
        const { result } = await client.simulateContract({
          address: chain.uniswap!.quoterV2,
          abi: QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn: stable.address, tokenOut: token.address, amountIn, fee, sqrtPriceLimitX96: BigInt(0) }],
        })
        return result[0]
      } catch {
        return null
      }
    }),
  )
  let best: bigint | null = null
  for (const o of outs) if (o !== null && o > BigInt(0) && (best === null || o > best)) best = o
  if (best === null) return null
  const tokenOut = Number(best) / 10 ** token.decimals
  if (!Number.isFinite(tokenOut) || tokenOut <= 0) return null
  return { usdPerToken: usd / tokenOut, tokenOut }
}

interface HlCtx {
  markPx: number
  fundingHourlyPct: number | null
  openInterestUsd: number | null
  maxLeverage: number
}
async function hlContext(sym: string): Promise<HlCtx | null> {
  const info = hlInfo()
  const res = (await (info as unknown as { metaAndAssetCtxs: () => Promise<unknown> }).metaAndAssetCtxs()) as [
    { universe: { name: string; maxLeverage: number }[] },
    { markPx?: string; funding?: string; openInterest?: string }[],
  ]
  const [meta, ctxs] = res
  const idx = meta.universe.findIndex((u) => u.name === sym)
  if (idx < 0) return null
  const ctx = ctxs[idx]
  const markPx = Number(ctx?.markPx)
  if (!Number.isFinite(markPx) || markPx <= 0) return null
  const funding = Number(ctx?.funding)
  const oi = Number(ctx?.openInterest)
  return {
    markPx,
    fundingHourlyPct: Number.isFinite(funding) ? funding * 100 : null,
    openInterestUsd: Number.isFinite(oi) ? oi * markPx : null,
    maxLeverage: meta.universe[idx].maxLeverage,
  }
}

/** Aave lists the wrapped form (WETH, WBTC) — the reserve read asks for both. */
const AAVE_ALIASES: Record<string, string[]> = { ETH: ['WETH', 'ETH'], BTC: ['WBTC', 'CBBTC', 'BTC'] }
async function aaveApy(sym: string): Promise<{ supplyApyPct: number | null; borrowApyPct: number | null }> {
  const res = (await callMcpTool(AAVE_MCP, 'reserves', { symbols: AAVE_ALIASES[sym] ?? [sym], chainId: 1 }, { timeoutMs: PROVIDER_TIMEOUT_MS })) as { reserves?: AaveReserveRow[] }
  let supply: number | null = null
  let borrow: number | null = null
  for (const r of res?.reserves ?? []) {
    if (r.active === false) continue
    if (r.canSupply !== false && typeof r.supplyApyPct === 'number' && (supply === null || r.supplyApyPct > supply)) supply = r.supplyApyPct
    if (r.canBorrow !== false && typeof r.borrowApyPct === 'number' && (borrow === null || r.borrowApyPct < borrow)) borrow = r.borrowApyPct
  }
  return { supplyApyPct: supply, borrowApyPct: borrow }
}

async function lidoApr(): Promise<number | null> {
  const res = (await callMcpTool(LIDO_MCP, 'stats', {}, { timeoutMs: PROVIDER_TIMEOUT_MS })) as { apr?: { smaAprPct?: number | null; latestAprPct?: number | null } }
  const v = res?.apr?.smaAprPct ?? res?.apr?.latestAprPct
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const feeBpsOf = (fee: VenueRoute['fee']): number => {
  switch (fee) {
    case 'swap':
      return SWAP_FEE_BPS
    case 'hl':
      return HL_BUILDER_FEE_TENTH_BPS / 10
    case 'cross-chain':
      return CROSS_CHAIN_FEE_BPS
    case 'lifi':
      return 0 // funding legs are fee-free; the buy step that follows pays the swap tier
    default:
      return 0
  }
}

const fmtUsd = (n: number): string =>
  n >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`


// ── The order ticket per row (no build, no wallet, no address) ─────────────
const SWAP_SLIPPAGE_BPS = 50 // every swap builder's default (uniswap-venue / v4 / lifi / cow-build)
const gasLine = (chainId: number): string | null => {
  const floor = GAS_FLOOR_ETH[chainId]
  return floor ? `≈ ${floor} ETH floor on ${VENUE_CHAIN_LABELS[chainId] ?? chainId}` : null
}
const fmtUnits = (n: number, sym: string) => `${n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(4) : n.toPrecision(4)} ${sym}`
/** A stock row's side of the pool against the tape: the pool's per-share
 *  price for that side, and its gap from the tape (null without a tape). */
interface StockSide {
  pool: PoolPrice | null
  tapeUsd: number | null
  premPct: number | null
  /** Past the tape guard's bound — the card won't fill in this pool. */
  offTape: boolean
}
function stockSideOf(pool: PoolPrice | null, tapeUsd: number | null): StockSide {
  const premPct = pool && tapeUsd ? ((pool.usdPerToken - tapeUsd) / tapeUsd) * 100 : null
  return { pool, tapeUsd, premPct, offTape: premPct !== null && !(Math.abs(premPct) <= STOCK_TAPE_BOUND_PCT) }
}

function ticketFor(r: VenueRoute, feeBps: number, amount: number, sym: string, ctx: { spot?: { usdPerToken: number; tokenOut: number }; hl?: HlCtx | null; stock?: StockSide; lev?: number }): RouteTicket {
  const feeUsd = Math.round(((amount * feeBps) / 10_000) * 100) / 100
  const base = { feeBps, feeUsd, settles: SETTLES[r.venue] ?? r.venue, note: ROUTE_TICKET_NOTE }
  switch (r.kind) {
    case 'spot': {
      const out = ctx.spot ? ctx.spot.tokenOut * (1 - feeBps / 10_000) : null
      return { ...base, out: out != null ? (r.side === 'buy' ? fmtUnits(out, sym) : `≈ $${(amount * (1 - feeBps / 10_000)).toFixed(2)} USDC`) : null, slippageBps: SWAP_SLIPPAGE_BPS, minOut: out != null ? (r.side === 'buy' ? fmtUnits(out * (1 - SWAP_SLIPPAGE_BPS / 10_000), sym) : `≈ $${(amount * (1 - feeBps / 10_000) * (1 - SWAP_SLIPPAGE_BPS / 10_000)).toFixed(2)} USDC`) : null, gas: gasLine(r.chainId), signs: 'approve (if needed) + swap — one card, deadline-watched' }
    }
    case 'limit': {
      const m = r.ask.match(/(?:buy|sell) ([\d.]+) \w+ for at (?:most|least) ([\d.]+) USDC/)
      return { ...base, out: m ? (r.side === 'buy' ? `${m[1]} ${sym} (at-or-better)` : `${m[2]} USDC (at-or-better)`) : null, slippageBps: null, minOut: m ? (r.side === 'buy' ? `${m[1]} ${sym}` : `${m[2]} USDC`) : null, gas: null, signs: 'EIP-712 order — gasless, cancel any time' }
    }
    case 'stock': {
      const side = ctx.stock
      if (side?.offTape) {
        // The pool is past the tape guard's bound: the card won't fill there
        // (lib/stock-tape) — it tries the chain's own venue, or refuses. No
        // estimate from a price nobody will trade at.
        return { ...base, out: null, slippageBps: SWAP_SLIPPAGE_BPS, minOut: null, gas: gasLine(4663), settles: "Robinhood Chain's own venue via LiFi, checked against the tape — the Uniswap pool is off it", signs: 'approve (if needed) + swap on Robinhood Chain — one card, or a refusal by name', note: `pool ${fmtTapeGap(side.premPct!)}% off the tape · the card routes around it` }
      }
      const px = side?.pool?.usdPerToken
      if (r.side === 'buy') {
        const out = px ? (amount * (1 - feeBps / 10_000)) / px : null
        return { ...base, out: out != null ? fmtUnits(out, sym) : null, slippageBps: SWAP_SLIPPAGE_BPS, minOut: out != null ? fmtUnits(out * (1 - SWAP_SLIPPAGE_BPS / 10_000), sym) : null, gas: gasLine(4663), signs: 'approve (if needed) + swap on Robinhood Chain — one card' }
      }
      // A sell of $amount sizes its shares at the tape, then fills at the
      // pool's sell price.
      const usdOut = px && side?.tapeUsd ? amount * (px / side.tapeUsd) * (1 - feeBps / 10_000) : amount * (1 - feeBps / 10_000)
      return { ...base, out: `≈ $${usdOut.toFixed(2)} USDG`, slippageBps: SWAP_SLIPPAGE_BPS, minOut: px && side?.tapeUsd ? `≈ $${(usdOut * (1 - SWAP_SLIPPAGE_BPS / 10_000)).toFixed(2)} USDG` : null, gas: gasLine(4663), signs: 'approve (if needed) + swap on Robinhood Chain — one card' }
    }
    case 'perp': {
      const lev = ctx.lev ?? null
      const collateral = lev ? amount / lev : null
      return { ...base, out: ctx.hl ? `${(amount / ctx.hl.markPx).toPrecision(4)} ${sym} at $${ctx.hl.markPx}${lev ? ` · ${lev}x = $${collateral!.toFixed(2)} collateral` : ' · account leverage'}` : null, slippageBps: HL_EXEC_SLIPPAGE_BPS, minOut: ctx.hl ? `fills within ${HL_EXEC_SLIPPAGE_BPS / 100}% of mark (IOC)` : null, gas: null, signs: lev ? 'L1 actions: set leverage (1/2) + order (2/2) — consent-signed, no gas' : 'L1 order action — consent-signed, no gas' }
    }
    case 'lend':
      return { ...base, out: r.side === 'buy' ? `$${amount} of ${sym} supplied (aToken)` : `${amount} USDC borrowed`, slippageBps: null, minOut: null, gas: gasLine(1), signs: r.side === 'buy' ? 'approve (if needed) + supply — pinned selector' : 'borrow — health factor previewed first' }
    case 'stake':
      return { ...base, out: `${r.ask.match(/Stake ([\d.]+) ETH/)?.[1] ?? '?'} stETH (1:1)`, slippageBps: null, minOut: null, gas: gasLine(1), signs: 'submit() — one transaction, gas buffer kept' }
    case 'protect':
      return { ...base, out: r.venue === 'hyperliquid' ? 'a Guardian policy on your live perp' : 'a one-shot Spend Permission on Base', slippageBps: r.venue === 'hyperliquid' ? HL_EXEC_SLIPPAGE_BPS : 300, minOut: r.venue === 'hyperliquid' ? null : 'independent 3% floor at sweep', gas: null, signs: r.venue === 'hyperliquid' ? 'delegated agent — personal_sign consent' : 'EIP-712 Spend Permission (smart wallets)' }
    case 'fund':
      return r.venue === 'near'
        ? { ...base, out: `≈ $${(amount * (1 - feeBps / 10_000)).toFixed(2)} of ${sym} on the destination`, slippageBps: null, minOut: 'the 1Click quote, guard-verified to the deposit', gas: gasLine(r.chainId), signs: 'one deposit transfer to a one-time address' }
        : { ...base, out: `USDG + gas on Robinhood Chain, then the buy`, slippageBps: LIFI_MAX_QUOTE_SHORTFALL_BPS, minOut: `≥ ${100 - LIFI_MAX_QUOTE_SHORTFALL_BPS / 100}% of our own quote`, gas: gasLine(r.chainId), signs: 'two funding legs + a wait + the buy — one job card' }
  }
}

async function compose(sym: string, amount: number, lastIn: number | null, leverage: number | undefined): Promise<RoutesResponse> {
  const pair = chartPairFor(sym)!
  let last = lastIn
  let routes = venuesFor(sym, pair, { usd: amount, last: last ?? undefined, leverage })
  const failed: string[] = []
  const wantSpot = [...new Set(routes.filter((r) => r.kind === 'spot').map((r) => r.chainId))]
  const wantPerp = routes.some((r) => r.kind === 'perp')
  const wantAave = routes.some((r) => r.kind === 'lend')
  const wantStock = routes.some((r) => r.kind === 'stock')
  // The limit + stake rows size in token units, so they need a price. When
  // the caller has none, the venue quotes themselves supply it (best spot
  // quote → HL mark → the 4663 pool), and the map is composed again with it.
  const wantLidoFirst = routes.some((r) => r.kind === 'stake') || (last === null && sym === 'ETH' && !tokenHome(sym))

  const [spotR, hlR, aaveR, aaveUsdcR, lidoR, stockR, tapeR] = await Promise.allSettled([
    Promise.allSettled(wantSpot.map((id) => withTimeout(uniswapQuote(sym, id, amount)).then((q) => [id, q] as const))),
    wantPerp ? withTimeout(hlContext(sym)) : Promise.resolve(null),
    wantAave ? withTimeout(aaveApy(sym)) : Promise.resolve(null),
    wantAave ? withTimeout(aaveApy('USDC')) : Promise.resolve(null),
    wantLidoFirst ? withTimeout(lidoApr()) : Promise.resolve(null),
    wantStock ? withTimeout(poolPriceFor(sym)) : Promise.resolve(null),
    // The stock's tape, read server-side (the same read the build's tape guard
    // uses), and the SELL side of the pool sized at it.
    wantStock
      ? withTimeout(
          stockTapeFor(sym).then(async (tape): Promise<{ tape: TapePrice | null; sell: PoolPrice | null }> => {
            const sizeAt = tape?.usd ?? lastIn
            return { tape, sell: sizeAt ? await poolSellPriceFor(sym, sizeAt) : null }
          }),
        )
      : Promise.resolve(null),
  ])

  const spot = new Map<number, { usdPerToken: number; tokenOut: number }>()
  if (spotR.status === 'fulfilled') {
    for (const r of spotR.value) {
      if (r.status === 'fulfilled' && r.value[1]) spot.set(r.value[0], r.value[1])
      else failed.push(`uniswap:${r.status === 'fulfilled' ? r.value[0] : '?'}`)
    }
  }
  const hl = hlR.status === 'fulfilled' ? hlR.value : (failed.push('hyperliquid'), null)
  const aave = aaveR.status === 'fulfilled' ? aaveR.value : (failed.push('aave'), null)
  const aaveUsdc = aaveUsdcR.status === 'fulfilled' ? aaveUsdcR.value : null
  const lido = lidoR.status === 'fulfilled' ? lidoR.value : (failed.push('lido'), null)
  const stock = stockR.status === 'fulfilled' ? stockR.value : (failed.push('robinhood'), null)
  const stockTape = tapeR.status === 'fulfilled' ? tapeR.value : null
  if (wantStock && !stockTape?.tape) failed.push('tape')
  // The tape a stock row is compared with: the server's read, else the
  // caller's own chart tape (`last`) — never the pool itself.
  const tapeUsd = stockTape?.tape?.usd ?? (wantStock ? lastIn : null)
  const stockBuy = stockSideOf(stock, tapeUsd)
  const stockSell = stockSideOf(stockTape?.sell ?? null, tapeUsd)

  // Best spot = the most token for the same dollars (lowest effective price).
  let bestSpotChain: number | null = null
  for (const [id, q] of spot) if (bestSpotChain === null || q.usdPerToken < spot.get(bestSpotChain)!.usdPerToken) bestSpotChain = id

  if (last === null) {
    // A stock's `last` is its tape. Deriving it from the pool made the pool
    // read "+0.00% vs tape" against itself (AMAT, 2026-09-16: 156× the tape).
    const derived = (bestSpotChain !== null ? spot.get(bestSpotChain)!.usdPerToken : null) ?? hl?.markPx ?? stockTape?.tape?.usd ?? null
    if (derived && Number.isFinite(derived) && derived > 0) {
      last = derived
      routes = venuesFor(sym, pair, { usd: amount, last, leverage })
    }
  }

  const quoted: RouteQuote[] = routes.map((r) => {
    const feeBps = feeBpsOf(r.fee)
    const base = { ...r, feeBps }
    switch (r.kind) {
      case 'spot': {
        const q = spot.get(r.chainId)
        if (!q) return { ...base, quote: null }
        return {
          ...base,
          quote: { kind: 'price', value: q.usdPerToken, label: fmtUsd(q.usdPerToken), sub: r.side === 'buy' ? `${fmtUsd(amount)} → ${q.tokenOut.toPrecision(4)} ${sym}` : 'mid, from the buy quote' },
          best: r.side === 'buy' && r.chainId === bestSpotChain && spot.size > 1 ? true : undefined,
        }
      }
      case 'limit': {
        const m = r.note?.match(/\(\$([\d.]+)\)/)
        const px = m ? Number(m[1]) : NaN
        return { ...base, quote: Number.isFinite(px) ? { kind: 'price', value: px, label: fmtUsd(px), sub: r.side === 'buy' ? 'rests under market' : 'rests over market' } : null }
      }
      case 'perp': {
        if (!hl) return { ...base, quote: null }
        const f = hl.fundingHourlyPct
        return {
          ...base,
          quote: { kind: 'price', value: hl.markPx, label: fmtUsd(hl.markPx), sub: `${f != null ? `funding ${f >= 0 ? '+' : ''}${f.toFixed(4)}%/h · ` : ''}up to ${hl.maxLeverage}x` },
        }
      }
      case 'protect': {
        if (r.venue === 'hyperliquid' && hl) return { ...base, quote: { kind: 'none', value: null, label: 'watches every minute', sub: `mark ${fmtUsd(hl.markPx)}` } }
        return { ...base, quote: { kind: 'none', value: null, label: 'watches every minute' } }
      }
      case 'lend': {
        const apy = r.side === 'buy' ? aave?.supplyApyPct : aaveUsdc?.borrowApyPct
        if (apy == null) return { ...base, quote: null }
        return { ...base, quote: { kind: 'apy', value: apy, label: `${apy.toFixed(2)}% APY`, sub: r.side === 'buy' ? 'supply, best spoke' : 'USDC borrow, cheapest spoke' } }
      }
      case 'stake': {
        if (lido == null) return { ...base, quote: null }
        return { ...base, quote: { kind: 'apy', value: lido, label: `${lido.toFixed(2)}% APR`, sub: '7-day average, rebasing daily' } }
      }
      case 'stock': {
        const side = r.side === 'sell' ? stockSell : stockBuy
        const pool = side.pool ?? stock
        if (!pool) return { ...base, quote: null }
        const prem = side.pool ? side.premPct : null
        const sub =
          prem === null
            ? `pool price via ${pool.via} · no tape to compare`
            : side.offTape
              ? `pool ${prem >= 0 ? '+' : '-'}${fmtTapeGap(prem)}% vs tape · off tape, won't fill here`
              : `pool ${prem >= 0 ? '+' : ''}${prem.toFixed(2)}% vs tape`
        return { ...base, quote: { kind: 'price', value: pool.usdPerToken, label: fmtUsd(pool.usdPerToken), sub } }
      }
      case 'fund':
        return { ...base, quote: { kind: 'none', value: null, label: r.venue === 'near' ? 'settles in seconds' : 'one signed job' } }
    }
  })

  const withTickets: RouteQuote[] = quoted.map((r) => ({ ...r, ticket: ticketFor(r, r.feeBps, amount, sym, { spot: spot.get(r.chainId), hl, stock: r.side === 'sell' ? stockSell : stockBuy, lev: leverage }) }))

  return {
    symbol: sym,
    source: pair.source,
    amountUsd: amount,
    last,
    lastDerived: lastIn === null && last !== null ? true : undefined,
    leverage: leverage ?? null,
    routes: withTickets,
    notes: missingVenueNotes(sym, pair),
    failed,
    updatedAt: new Date().toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const symbolRaw = sp.get('symbol') ?? ''
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  const pair = chartPairFor(symbolRaw)
  if (!pair) return NextResponse.json({ error: `${symbolRaw.toUpperCase()} has no venue map — not a charted symbol.` }, { status: 404 })
  const amountRaw = Number(sp.get('amount') ?? DEFAULT_ROUTE_USD)
  const amount = Number.isFinite(amountRaw) && amountRaw >= 1 && amountRaw <= 100_000 ? Math.round(amountRaw * 100) / 100 : DEFAULT_ROUTE_USD
  const lastRaw = Number(sp.get('last') ?? NaN)
  const last = Number.isFinite(lastRaw) && lastRaw > 0 ? lastRaw : null
  const levRaw = Number(sp.get('leverage') ?? NaN)
  const leverage = Number.isInteger(levRaw) && levRaw >= 2 && levRaw <= 50 ? levRaw : undefined
  // The cache key buckets `last` to 0.5% so a ticking tape doesn't defeat it.
  const lastBucket = last ? Math.round(Math.log(last) / Math.log(1.005)) : 0
  const key = `${pair.symbol}|${amount}|${lastBucket}|${leverage ?? 0}`
  const now = Date.now()
  const hit = cache.get(key)
  const headers = { 'cache-control': 'no-store' }
  if (hit && now - hit.at < TTL_MS) return NextResponse.json({ ...hit.value, cached: true }, { headers })
  let p = inflight.get(key)
  if (!p) {
    p = compose(pair.symbol, amount, last, leverage)
      .then((v) => {
        cache.set(key, { at: Date.now(), value: v })
        return v
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  try {
    const value = await p
    return NextResponse.json({ ...value, cached: false }, { headers })
  } catch (err) {
    // Never a 500: the map itself is pure — serve it unquoted.
    const routes = venuesFor(pair.symbol, pair, { usd: amount, last: last ?? undefined, leverage }).map((r) => ({ ...r, feeBps: feeBpsOf(r.fee), quote: null }))
    const body: RoutesResponse = {
      symbol: pair.symbol,
      source: pair.source,
      amountUsd: amount,
      last,
      leverage: leverage ?? null,
      routes,
      notes: missingVenueNotes(pair.symbol, pair),
      failed: ['all: ' + (err instanceof Error ? err.message : String(err))],
      updatedAt: new Date().toISOString(),
    }
    return NextResponse.json({ ...body, cached: false }, { headers })
  }
}
