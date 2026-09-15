import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { chartPairFor } from '@/lib/charts'
import { getWalletViewCached } from '@/lib/wallet-view'
import { fetchPositions } from '@/lib/hl-guardian-store'
import { callMcpTool } from '@/lib/mcp-call'
import { AAVE_MCP } from '@/lib/aave-exec'
import { LIDO_MCP } from '@/lib/lido-stake'
import { parseUsd } from '@/lib/aave-supply'
import { listDcaSchedules } from '@/lib/dca-exec'
import { exitChipsFor, positionAliases, type LendPosition, type SpotHolding, type StakePosition, type SymbolPosition } from '@/lib/symbol-position'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/position?symbol=&address= — what THIS wallet holds in
// the symbol across venues: spot per chain (the Wallet panel's cached
// reads), the Hyperliquid perp with live uPnL, Aave supplied/borrowed,
// Lido stETH (ETH only), DCA schedules buying it, guardian + spot-guard
// policies — and the exits, each a sentence a native parser reads.
//
// Public BY ADDRESS, read-only (connect-to-act: balances of an address are
// on-chain public data — the same rule as /api/wallet and /w/<address>;
// nothing here mutates, and no session is read, so a client-asserted
// address can only ever LOOK). Every reader is fail-soft and NAMED in
// `failed` — a reader that didn't answer is never rendered as zero.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const PROVIDER_TIMEOUT_MS = 8_000
const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('provider timed out')), PROVIDER_TIMEOUT_MS))])

interface AavePortfolioPayload {
  positions?: { netBalanceUsd?: string | null; healthFactor?: string | null }[]
  supplies?: { token?: { symbol?: string | null } | null; balanceUsd?: string | null; balance?: string | null }[]
  borrows?: { token?: { symbol?: string | null } | null; debtUsd?: string | null; debt?: string | null }[]
}
interface LidoPositionPayload {
  hasPosition?: boolean
  stEth?: { balance?: string; usd?: number | null }
  totalStaked?: { stEth?: string; usd?: number | null }
  currentAprPct?: number | null
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const symbolRaw = sp.get('symbol') ?? ''
  const address = (sp.get('address') ?? '').trim()
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  if (!ADDRESS_RE.test(address)) return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  const pair = chartPairFor(symbolRaw)
  if (!pair) return NextResponse.json({ error: `${symbolRaw.toUpperCase()} is not a charted symbol.` }, { status: 404 })
  const sym = pair.symbol
  const aliases = new Set(positionAliases(sym))
  const wallet = address.toLowerCase()
  const failed: string[] = []

  const isPerpCandidate = true // the venue decides; a flat coin is just null
  const wantLend = pair.source !== 'robinhood'
  const wantStake = sym === 'ETH'

  const [viewR, perpR, aaveR, lidoR, dcaR, guardR, spotGuardR] = await Promise.allSettled([
    withTimeout(getWalletViewCached(address as `0x${string}`)),
    isPerpCandidate ? withTimeout(fetchPositions(address)) : Promise.resolve([]),
    wantLend ? withTimeout(callMcpTool(AAVE_MCP, 'portfolio', { user: address }, { timeoutMs: PROVIDER_TIMEOUT_MS })) : Promise.resolve(null),
    wantStake ? withTimeout(callMcpTool(LIDO_MCP, 'position', { user: address }, { timeoutMs: PROVIDER_TIMEOUT_MS })) : Promise.resolve(null),
    withTimeout(listDcaSchedules(wallet)),
    prisma.hlGuardianPolicy.findMany({
      where: { wallet, coin: sym, status: { not: 'done' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, kind: true, side: true, triggerMode: true, triggerValue: true, status: true },
    }),
    prisma.spotGuardPolicy.findMany({
      where: { wallet, tokenSymbol: { in: [...aliases] }, status: { in: ['active', 'paused', 'triggered', 'error'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, triggerMode: true, triggerValue: true, status: true, amountHuman: true },
    }),
  ])

  // ── Spot per chain ──
  const spot: SpotHolding[] = []
  if (viewR.status === 'fulfilled') {
    for (const c of viewR.value.view.chains) {
      if (c.unread) failed.push(`chain:${c.key}`)
      for (const h of c.holdings) {
        const hs = h.symbol.toUpperCase().replace(/^\$/, '')
        if (!aliases.has(hs)) continue
        const bal = Number(h.balance)
        if (!Number.isFinite(bal) || bal <= 0) continue
        spot.push({ chainId: c.id, chainName: c.name, symbol: h.symbol, balance: bal, valueUsd: h.valueUsd ?? null })
      }
    }
  } else failed.push('wallet')

  // ── Perp ──
  let perp: SymbolPosition['perp'] = null
  if (perpR.status === 'fulfilled') {
    const p = perpR.value.find((x) => x.coin === sym)
    if (p) {
      perp = {
        side: p.side,
        sizeUnits: Math.abs(p.szi),
        entryPx: p.entryPx,
        markPx: p.markPx,
        valueUsd: p.positionValueUsd,
        pnlUsd: p.unrealizedPnl,
        leverage: p.leverage,
        liquidationPx: p.liquidationPx,
      }
    }
  } else failed.push('hyperliquid')

  // ── Aave ──
  let lend: LendPosition | null = null
  if (wantLend) {
    if (aaveR.status === 'fulfilled' && aaveR.value) {
      const data = aaveR.value as AavePortfolioPayload
      const sup = (data.supplies ?? []).find((s) => s?.token?.symbol && aliases.has(s.token.symbol.toUpperCase()))
      const bor = (data.borrows ?? []).find((b) => b?.token?.symbol)
      const hf = data.positions?.[0]?.healthFactor != null ? Number(data.positions[0].healthFactor) : NaN
      if (sup || bor) {
        lend = {
          suppliedUsd: sup ? parseUsd(sup.balanceUsd) : null,
          suppliedLabel: sup ? `${sup.balance ?? ''} ${sup.token?.symbol ?? sym}`.trim() : null,
          borrowedUsd: bor ? parseUsd(bor.debtUsd) : null,
          borrowedLabel: bor ? `${bor.token?.symbol ?? ''} ${bor.debt ?? ''}`.trim() : null,
          healthFactor: Number.isFinite(hf) ? hf : null,
        }
      }
    } else if (aaveR.status === 'rejected') failed.push('aave')
  }

  // ── Lido ──
  let stake: StakePosition | null = null
  if (wantStake) {
    if (lidoR.status === 'fulfilled' && lidoR.value) {
      const pos = lidoR.value as LidoPositionPayload
      if (pos?.hasPosition) {
        const st = Number(pos.totalStaked?.stEth ?? pos.stEth?.balance ?? NaN)
        stake = { stEth: Number.isFinite(st) ? st : null, usd: pos.totalStaked?.usd ?? pos.stEth?.usd ?? null, aprPct: pos.currentAprPct ?? null }
      }
    } else if (lidoR.status === 'rejected') failed.push('lido')
  }

  // ── DCA ──
  const dca: SymbolPosition['dca'] = []
  if (dcaR.status === 'fulfilled') {
    for (const s of dcaR.value) {
      if (!aliases.has(s.buyToken.toUpperCase())) continue
      dca.push({ id: s.id, cadence: s.cadence === 'day' ? 'daily' : s.cadence === 'week' ? 'weekly' : 'monthly', buyUsd: s.buyUsd, status: s.status, mode: s.mode, chainName: s.chainName })
    }
  } else failed.push('dca')

  const guardian = guardR.status === 'fulfilled' ? guardR.value : (failed.push('guardian'), [])
  const spotGuard = spotGuardR.status === 'fulfilled' ? spotGuardR.value : (failed.push('spot-guard'), [])

  const totalUsd =
    spot.reduce((a, h) => a + (h.valueUsd ?? 0), 0) + (perp?.valueUsd ?? 0) + (lend?.suppliedUsd ?? 0) + (stake?.usd ?? 0)

  const body: SymbolPosition = {
    symbol: sym,
    address,
    spot,
    perp,
    lend,
    stake,
    dca,
    guardian,
    spotGuard,
    exits: exitChipsFor({ symbol: sym, spot, perp, lend, dca, spotGuard }, pair.source),
    totalUsd: Math.round(totalUsd * 100) / 100,
    failed,
    updatedAt: new Date().toISOString(),
  }
  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
