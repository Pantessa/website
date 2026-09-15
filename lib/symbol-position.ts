// ─────────────────────────────────────────────────────────────────────────
//  What THIS wallet holds in a symbol across venues — the wire shape of
//  GET /api/markets/position and the pure helpers the PositionPanel and the
//  header pill read (MK2/EXEC, 2026-09-15). Client-safe: no fetch, no
//  prisma. The route composes it from reads that already exist (the Wallet
//  panel's chain reads, the HL clearinghouse, the Aave + Lido MCP position
//  tools, the DCA list, the guardian policy tables); every exit chip here is
//  a sentence a native parser reads (pinned through the ladder replica).
// ─────────────────────────────────────────────────────────────────────────

export interface SpotHolding {
  chainId: number
  chainName: string
  /** The row's own symbol (WETH on a chain where ETH is wrapped, cbBTC…). */
  symbol: string
  balance: number
  valueUsd: number | null
}

export interface PerpPosition {
  side: 'long' | 'short'
  sizeUnits: number
  entryPx: number
  markPx: number | null
  valueUsd: number
  pnlUsd: number
  leverage: number
  liquidationPx: number | null
}

export interface LendPosition {
  suppliedUsd: number | null
  suppliedLabel: string | null
  borrowedUsd: number | null
  borrowedLabel: string | null
  healthFactor: number | null
}

export interface StakePosition {
  stEth: number | null
  usd: number | null
  aprPct: number | null
}

export interface DcaRow {
  id: string
  cadence: string
  buyUsd: number
  status: string
  mode: string
  chainName: string
}

export interface GuardianRow {
  id: string
  kind: string
  side: string
  triggerMode: string
  triggerValue: number
  status: string
}

export interface SpotGuardRow {
  id: string
  triggerMode: string
  triggerValue: number
  status: string
  amountHuman: string
}

export interface ExitChip {
  label: string
  /** A complete ask — sends on click (the chip IS the contract). */
  ask: string
  kind: 'spot' | 'perp' | 'lend' | 'dca' | 'protect'
  tone?: 'sell' | 'neutral'
}

export interface SymbolPosition {
  symbol: string
  address: string
  spot: SpotHolding[]
  perp: PerpPosition | null
  lend: LendPosition | null
  stake: StakePosition | null
  dca: DcaRow[]
  guardian: GuardianRow[]
  spotGuard: SpotGuardRow[]
  exits: ExitChip[]
  /** Spot + perp value + supplied + staked (borrows not netted — the panel
   *  shows them as their own line). */
  totalUsd: number
  /** Readers that didn't answer — never rendered as zero. */
  failed: string[]
  updatedAt: string
}

/** Symbols that ARE this symbol on some chain (the wallet reads name the
 *  wrapped form; the chart pair collapses it). */
export function positionAliases(symbol: string): string[] {
  const s = symbol.toUpperCase()
  if (s === 'ETH') return ['ETH', 'WETH']
  if (s === 'BTC') return ['BTC', 'CBBTC', 'WBTC', 'TBTC']
  if (s === 'POL') return ['POL', 'MATIC']
  return [s]
}

const money = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`
const units = (n: number): string => (n >= 10_000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(3))

/** True when the wallet has nothing at all in the symbol. */
export function positionIsEmpty(p: SymbolPosition | null | undefined): boolean {
  if (!p) return true
  return p.spot.length === 0 && !p.perp && !p.lend && !p.stake && p.dca.length === 0 && p.guardian.length === 0 && p.spotGuard.length === 0
}

/**
 * The header pill: one line, receipt-grade. "0.594 ETH · $1,485 on 2 chains
 * · long 2x +$12.40 · Aave $200 · DCA weekly · guarded". Empty string for
 * an empty position (the pill hides), never "0".
 */
export function positionSummary(p: SymbolPosition | null | undefined): string {
  if (!p || positionIsEmpty(p)) return ''
  const parts: string[] = []
  const spotUnits = p.spot.reduce((a, h) => a + h.balance, 0)
  const spotUsd = p.spot.reduce((a, h) => a + (h.valueUsd ?? 0), 0)
  if (spotUnits > 0) {
    const chains = new Set(p.spot.map((h) => h.chainId)).size
    parts.push(`${units(spotUnits)} ${p.symbol}${spotUsd > 0 ? ` · ${money(spotUsd)}` : ''}${chains > 1 ? ` on ${chains} chains` : ''}`)
  }
  if (p.perp) {
    const pnl = p.perp.pnlUsd
    parts.push(`${p.perp.side} ${p.perp.leverage}x ${pnl >= 0 ? '+' : '−'}${money(Math.abs(pnl))}`)
  }
  if (p.lend) {
    if (p.lend.suppliedUsd) parts.push(`Aave ${money(p.lend.suppliedUsd)} supplied`)
    if (p.lend.borrowedUsd) parts.push(`${money(p.lend.borrowedUsd)} borrowed`)
  }
  if (p.stake?.stEth) parts.push(`${units(p.stake.stEth)} stETH`)
  if (p.dca.length) parts.push(`DCA ${p.dca[0].cadence}${p.dca[0].status === 'paused' ? ' (paused)' : ''}`)
  if (p.guardian.some((g) => g.status === 'active') || p.spotGuard.some((g) => g.status === 'active')) parts.push('guarded')
  return parts.join(' · ')
}

/**
 * Exit chips for a position — every string a parser's own phrasing:
 * "Sell all my ETH on Base" (swap layer, sized live), "Sell all my AAPL for
 * USDG on Robinhood Chain", "Close my ETH long on Hyperliquid",
 * "Withdraw all my ETH from Aave", "Repay all my USDC debt on Aave",
 * "pause my ETH dca", "cancel my ETH spot protection". Lido has no native
 * unstake grammar yet, so a stake gets no chip (named in the panel).
 */
export function exitChipsFor(p: Pick<SymbolPosition, 'symbol' | 'spot' | 'perp' | 'lend' | 'dca' | 'spotGuard'>, source: 'coinbase' | 'hyperliquid' | 'robinhood'): ExitChip[] {
  const sym = p.symbol.toUpperCase()
  const out: ExitChip[] = []
  for (const h of p.spot) {
    if (h.balance <= 0) continue
    if (h.chainId === 4663) out.push({ label: `Sell all on Robinhood Chain`, ask: `Sell all my ${sym} for USDG on Robinhood Chain`, kind: 'spot', tone: 'sell' })
    else out.push({ label: `Sell all on ${h.chainName}`, ask: `Sell all my ${sym} on ${h.chainName}`, kind: 'spot', tone: 'sell' })
  }
  if (p.perp) out.push({ label: `Close ${p.perp.side}`, ask: `Close my ${sym} ${p.perp.side} on Hyperliquid`, kind: 'perp', tone: 'sell' })
  if (p.lend?.suppliedUsd) out.push({ label: 'Withdraw from Aave', ask: `Withdraw all my ${sym} from Aave`, kind: 'lend' })
  if (p.lend?.borrowedUsd && p.lend.borrowedLabel) {
    const tok = p.lend.borrowedLabel.split(' ')[0]
    out.push({ label: `Repay ${tok} debt`, ask: `Repay all my ${tok} debt on Aave`, kind: 'lend' })
  }
  for (const d of p.dca) {
    out.push(d.status === 'paused' ? { label: 'Resume DCA', ask: `resume my ${sym} dca`, kind: 'dca' } : { label: 'Pause DCA', ask: `pause my ${sym} dca`, kind: 'dca' })
    break
  }
  if (p.spotGuard.some((g) => g.status === 'active' || g.status === 'paused')) out.push({ label: 'Cancel spot stop', ask: `cancel my ${sym} spot protection`, kind: 'protect' })
  void source
  return out
}
