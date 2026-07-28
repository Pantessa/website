// ─────────────────────────────────────────────────────────────────────────
//  Wallet briefing — "what Yeetful noticed" (2026-07-28).
//
//  The cohort data (#482) says the funnel bleeds BEFORE the first ask: the
//  product only shows its depth after someone types a good prompt. The
//  briefing flips that — the system opens with what it NOTICED about the
//  wallet, and every line carries a chip whose prompt is a COMPLETE ask
//  that round-trips a real parser (the audit:asks contract — a chip we
//  surface must never dead-end).
//
//  Split on the #550 seam pattern: composeBriefingItems() is PURE (the
//  harness fabricates inputs, no RPC), readBriefingInputs() is the I/O
//  shell (job-context conventions: per-provider timeout + allSettled — a
//  dead provider drops its rows, never the card). Absence is never claimed
//  from a partial read: a failed provider means its signals simply don't
//  appear (`failed` names it), and zero items means NO tile (the splash
//  affinity contract), never an empty "all good".
//
//  Privacy: the tile exposes only what public chain data shows (positions,
//  balances) plus the EXISTENCE of a guardian policy per coin — never
//  trigger levels (those are the owner's strategy; /api/splash is
//  address-in-body with no auth, same posture as the DCA tile).
// ─────────────────────────────────────────────────────────────────────────

import type { RowsTile, StatRow } from './splash/types'
import type { FundingScan, FundingSource } from './funding-plan'

/** Public-shape read of one HL perp position (lib/hl-guardian-store's
 *  LivePosition, narrowed to what the briefing needs). */
export interface BriefingPosition {
  coin: string
  side: 'long' | 'short'
  positionValueUsd: number
  unrealizedPnl: number
  leverage: number
}

export interface BriefingInputs {
  /** Open HL perp positions (empty = none OR the read failed — see failed). */
  positions: BriefingPosition[]
  /** Coins with an active/triggered guardian policy — existence only. */
  protectedCoins: string[]
  /** Idle + stranded stables per chain, or null when the scan failed. */
  funding: Pick<FundingScan, 'sources' | 'stranded' | 'readChains' | 'failedChains'> | null
  /** Aave read: health factor + whether debt exists, or null on failure. */
  aave: { healthFactor: number | null; hasBorrows: boolean } | null
  /** Provider names that failed — their signals are absent, not "fine". */
  failed: string[]
}

// Floors: a $3 position doesn't need a guardian; dust USDC isn't "idle".
const POSITION_FLOOR_USD = 10
const IDLE_STABLE_FLOOR_USD = 25
const AAVE_HF_WARN = 1.5
// L2 gas donors only — moving mainnet dust costs more than it's worth
// (the #551 lesson); 0.001 ETH covers an L2 send + destination floor.
const DONOR_MIN_USD = 3
const DONOR_CHAINS = new Set([8453, 42161])
// Stranded ETH is only worth NAMING above this (it's unactionable); a
// mainnet unstick (~$8 round trip) only pays for a meaningful balance.
const STRANDED_ETH_NAME_FLOOR_USD = 2
const MAINNET_UNSTICK_FLOOR_USD = 25

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const signedUsd = (n: number) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}`

/**
 * Pure composer: reads in → StatRows out, every value pre-formatted (the
 * client never does money math). Returns [] when nothing needs the user.
 */
export function composeBriefingItems(inputs: BriefingInputs): StatRow[] {
  const rows: StatRow[] = []
  const protectedSet = new Set(inputs.protectedCoins.map((c) => c.toUpperCase()))

  // 1. Perp positions — the unprotected ones lead (the guardian doctrine:
  //    an ACTIVE protection is healthy standing state and never nags; a
  //    position with NO protection is the briefing's loudest signal).
  for (const p of inputs.positions) {
    if (p.positionValueUsd < POSITION_FLOOR_USD) continue
    const coin = p.coin.toUpperCase()
    if (protectedSet.has(coin)) {
      rows.push({
        label: `${coin} ${p.side} · protected`,
        value: usd(p.positionValueUsd),
        sub: `${p.leverage}x · PnL ${signedUsd(p.unrealizedPnl)} · guardian armed`,
        tone: 'pos',
        chartSymbol: coin,
      })
    } else {
      rows.push({
        label: `${coin} ${p.side} · no downside protection`,
        value: usd(p.positionValueUsd),
        sub: `${p.leverage}x · PnL ${signedUsd(p.unrealizedPnl)} · a 10% stop watches it for you`,
        tone: 'neg',
        chartSymbol: coin,
        actions: [
          // Round-trips parseGuardianArm — the splash's proven chip string.
          { label: `Protect ${coin}`, prompt: `Protect my ${coin} ${p.side} with a 10% stop loss` },
        ],
      })
    }
  }

  // 2. Stranded stables — money that exists but can't move (no gas there).
  //    Named per the funding doctrine ("money the user owns is never
  //    invisible"), with a donor top-up chip only when an L2 holds enough
  //    ETH to send some over (the chip round-trips parseCrossChainSwap).
  if (inputs.funding) {
    const donors = inputs.funding.sources.filter(
      (s) => s.token === 'ETH' && DONOR_CHAINS.has(s.chainId) && s.usd >= DONOR_MIN_USD,
    )
    for (const s of inputs.funding.stranded) {
      // Stranded ETH IS the gas that's missing — there's no honest chip for
      // it. Sub-floor mainnet ETH especially: moving it costs more than
      // it's worth (the #551 lesson, said out loud, tone neutral — a nag
      // with no action is just noise).
      if (s.token === 'ETH') {
        if (s.usd < STRANDED_ETH_NAME_FLOOR_USD) continue
        rows.push({
          label: `${usd(s.usd)} ETH on ${s.chainWord} · under the gas floor`,
          value: 'not worth moving',
          sub:
            s.chainId === 1
              ? 'moving it off mainnet would cost more than it is — it can sit'
              : 'too small to send anywhere useful — it can sit as gas headroom',
        })
        continue
      }
      // Stranded stables: a donor chip only when the round-trip is
      // economical — L2 destinations take a $2 top-up; mainnet's gas floor
      // (~0.004 ETH) is only worth paying for a meaningful balance.
      const donor = donors.find((d) => d.chainId !== s.chainId)
      const toMainnet = s.chainId === 1
      const donorAmount = toMainnet ? '0.004' : '0.001'
      const chipWorthIt = !!donor && (!toMainnet || s.usd >= MAINNET_UNSTICK_FLOOR_USD)
      rows.push({
        label: `${usd(s.usd)} ${s.token} stuck on ${s.chainWord}`,
        value: 'no gas',
        sub: chipWorthIt
          ? `a little ETH from ${donor!.chainWord} unsticks it`
          : toMainnet
            ? `mainnet gas costs real money — worth topping up only for a bigger balance`
            : `send a little ETH to ${s.chainWord} to move it`,
        tone: 'neg',
        ...(chipWorthIt
          ? {
              actions: [
                {
                  label: `Unstick via ${donor!.chainWord}`,
                  prompt: `Swap ${donorAmount} ETH from ${donor!.chainWord.toLowerCase()} to ${s.chainWord.toLowerCase()}`,
                },
              ],
            }
          : {}),
      })
    }

    // 3. Idle stables — not a problem, an opportunity; soft chips only
    //    (DCA round-trips parseDcaCreate; the swap round-trips
    //    parseSwapIntent). Scoped to chains that actually READ.
    for (const s of inputs.funding.sources) {
      if (s.token !== 'USDC' || s.usd < IDLE_STABLE_FLOOR_USD) continue
      const swapUsd = Math.min(50, Math.max(10, Math.floor(s.usd / 2)))
      rows.push({
        label: `${usd(s.usd)} USDC idle on ${s.chainWord}`,
        value: 'earning nothing',
        sub: 'put a slice to work — you sign everything',
        chartSymbol: 'ETH',
        actions: [
          { label: 'DCA $10 → ETH weekly', prompt: 'DCA $10 into ETH weekly' },
          { label: `Swap $${swapUsd} → ETH`, prompt: `Swap $${swapUsd} of USDC for ETH on ${s.chainWord}` },
        ],
      })
    }
  }

  // 4. Aave health-factor drift — only when debt exists (job-context's
  //    threshold). No chip yet: the repay grammar isn't briefing-proven,
  //    and a wrong ask on a liquidation-adjacent position is worse than
  //    none.
  if (inputs.aave && inputs.aave.hasBorrows && inputs.aave.healthFactor !== null && inputs.aave.healthFactor < AAVE_HF_WARN) {
    rows.push({
      label: `Aave health factor ${inputs.aave.healthFactor.toFixed(2)}`,
      value: 'borrow at risk',
      sub: 'repay a little or add collateral before the market does it for you',
      tone: 'neg',
    })
  }

  return rows
}

/** How many rows need the user (drives the headline + any badge). */
export function briefingNeedsCount(rows: StatRow[]): number {
  return rows.filter((r) => r.tone === 'neg').length
}

/**
 * Wrap composed rows as the splash RowsTile (id 'briefing', prepended ahead
 * of every MCP tile). Null when nothing was noticed — no tile, never an
 * empty one.
 */
export function briefingTile(rows: StatRow[]): RowsTile | null {
  if (rows.length === 0) return null
  const needs = briefingNeedsCount(rows)
  return {
    id: 'briefing',
    mcpSlug: 'yeetful',
    mcpName: 'Yeetful',
    title: 'What Yeetful noticed',
    subtitle: 'live read of this wallet — tap a chip to act, your wallet signs',
    render: 'rows',
    headline:
      needs > 0
        ? { value: `${needs} need${needs === 1 ? 's' : ''} you`, caption: 'wallet briefing' }
        : { value: 'all quiet', caption: 'wallet briefing' },
    rows,
    prompts: [],
  }
}
