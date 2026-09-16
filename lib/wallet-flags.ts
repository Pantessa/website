// lib/wallet-flags.ts — what the wallet window flags, and what to DO about it.
//
// The Wallet panel used to name a gas stall and point at the chat ("Ask the
// chat to fund it and it plans the gas leg for you"). Nate, 2026-09-14: "we
// could 'Fix my gas issue' that swaps and pops in some ETH on arb or solves
// whatever issue we flagged." So every flag now carries its own actions,
// and the primary one is a COMPLETE ASK the button sends (the chip-send
// contract: the click is the send, the wallet signature is the gate).
//
// The asks are never invented here. A gas fix is the funding layer's own
// top-up leg — planGasTopup (lib/funding-plan) writes the exact sentence the
// stranded rescue already emits, sized by the same rule — so the click lands
// on the cross-chain gate and the guard binds the transfer to the quote like
// every other bridge. Robinhood Chain isn't a NEAR Intents destination, so
// its fix is the LiFi funding sentence ("Fund robinhood chain with $9 from
// base including gas"): the smallest clean move, gas leg included.
//
// Pure: WalletChainView rows in (already priced, gas verdict per chain),
// flags out. Composed server-side into the view (lib/wallet-view), so the
// panel renders and the harness fabricates wallet states by hand.

import {
  classifyFundingBalances,
  FUNDING_CHAIN_WORD,
  FUNDING_SCAN_CHAINS,
  planGasTopup,
  type FundingBalanceRead,
  type FundingSource,
} from '@/lib/funding-plan'
import { MIN_VALUE_LEG_USD } from '@/lib/lifi-bridge'
import { fundSegment, lifiDestination, type LifiDestination } from '@/lib/lifi-destinations'
import { GAS_RESERVE_ETH, STOCK_CHAIN_ID, type WalletChainView } from '@/lib/wallet-view'

export type WalletFlagKind = 'no-gas' | 'low-gas' | 'unread'

/** The NEAR Intents MCP — the cross-chain gate's venue. A bare cross-chain
 *  sentence without it in the working set answers the add-the-dapp door
 *  (#570) instead of building, so a gas-fix action CARRIES the slug and the
 *  send path turns it on first (the same slug the route's door names —
 *  harness-pinned against app/api/chat/route.ts). */
export const NEAR_INTENTS_SLUG = 'near-intents-mcp-yeetful'

export interface WalletFlagAction {
  label: string
  /** A complete ask that round-trips the native ladder. The button SENDS it. */
  ask?: string
  /** MCP slugs the ask's gate needs in the working set — turned on before
   *  the send (a bridge leg needs NEAR Intents; a Robinhood funding
   *  sentence and a tile ask are native and need none). */
  mcps?: string[]
  /** A door inside the wallet window instead of an ask. */
  door?: 'receive' | 'card' | 'refresh'
  /** What the click does, in words — the wire, shown beside the button. */
  note?: string
  /** The one the row leads with. */
  primary?: boolean
}

export interface WalletFlag {
  id: string
  kind: WalletFlagKind
  chainId: number
  chainName: string
  tone: 'warn' | 'info'
  title: string
  detail: string
  actions: WalletFlagAction[]
}

/** Gas headroom on top of the value leg a Robinhood Chain funding move
 *  carries (the gas leg ladders 2→5 on a thin route, #688). */
const ROBINHOOD_GAS_HEADROOM_USD = 3

const fmtEth = (n: number) => n.toFixed(n >= 0.01 ? 4 : 5).replace(/0+$/, '').replace(/\.$/, '')
const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const fmtBal = (s: string) => {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toPrecision(3).replace(/\.?0+$/, '')
}

/** The funding layer's view of this wallet, from the rows the panel already
 *  priced: native ETH + the USDC balance per NEAR-reachable chain. A chain
 *  that didn't answer is left out (an unknown balance is never a donor). */
export function fundingSourcesFromChains(chains: WalletChainView[], ethUsd: number | null): FundingSource[] {
  const reads: FundingBalanceRead[] = []
  for (const c of chains) {
    if (c.unread) continue
    if (!(FUNDING_SCAN_CHAINS as readonly number[]).includes(c.id)) continue
    const usdc = c.holdings.find((h) => !h.native && h.symbol.toUpperCase() === 'USDC')
    reads.push({ chainId: c.id, chainWord: FUNDING_CHAIN_WORD[c.id], nativeEth: c.nativeEth, usdcBal: usdc ? Number(usdc.balance) || 0 : 0 })
  }
  return classifyFundingBalances(reads, ethUsd).sources
}

/** The LiFi-destination fix (Robinhood Chain, Arc): no NEAR route lands
 *  there, so the smallest clean LiFi move from the cheapest origin that can
 *  carry it — value floor plus a gas leg where the destination's gas is ETH
 *  (Robinhood Chain); on Arc the landed USDC IS the gas, so the value leg
 *  alone is the fix. Null when no origin can. */
function planLifiDestFix(sources: FundingSource[], dest: LifiDestination): { ask: string; origin: FundingSource; usd: number } | null {
  const usd = MIN_VALUE_LEG_USD
  const headroom = dest.gasLeg ? ROBINHOOD_GAS_HEADROOM_USD : 0
  const rank = (s: FundingSource) => (s.chainId === 1 ? 2 : 0) + (s.token === 'ETH' ? 1 : 0)
  const origin = sources
    .filter((s) => s.usd >= usd + headroom)
    .sort((a, b) => rank(a) - rank(b) || b.usd - a.usd)[0]
  if (!origin) return null
  return {
    ask: fundSegment(usd, origin.chainWord, true, origin.token === 'ETH' ? 'ETH' : 'USDC', dest),
    origin,
    usd,
  }
}

const outsideDoors = (chainName: string, gasSymbol: string): WalletFlagAction[] => [
  { door: 'receive', label: `Receive ${gasSymbol} on ${chainName}`, note: 'from another wallet or an exchange' },
  { door: 'card', label: 'Add funds with a card', note: 'via Stripe' },
]

/** Every flag the window shows, worst first: gas stalls (with a fix), low
 *  gas (with a top-up), chains that didn't answer (with a re-read). */
export function walletFlags(chains: WalletChainView[], ethUsd: number | null): WalletFlag[] {
  const sources = fundingSourcesFromChains(chains, ethUsd)
  const out: WalletFlag[] = []

  const gasFixFor = (c: WalletChainView): WalletFlagAction | null => {
    const dest = lifiDestination(c.id)
    if (dest) {
      const fix = planLifiDestFix(sources, dest)
      return fix
        ? {
            primary: true,
            label: dest.gasLeg ? `Fund ${c.name} (+ gas)` : `Fund ${c.name}`,
            ask: fix.ask,
            note: dest.gasLeg
              ? `the smallest clean move: ~${fmtUsd(fix.usd)} of USDG plus gas, from your ${fix.origin.chainWord} ${fix.origin.token} · you sign each leg`
              : `the smallest clean move: ~${fmtUsd(fix.usd)} of ${c.gasSymbol} (${c.name}'s gas token), from your ${fix.origin.chainWord} ${fix.origin.token} · you sign once`,
          }
        : null
    }
    const topup = planGasTopup({ targetChainId: c.id, sources, ethUsd })
    return topup
      ? {
          primary: true,
          label: `Fix gas on ${c.name}`,
          ask: topup.ask,
          mcps: [NEAR_INTENTS_SLUG],
          note: `~${fmtUsd(topup.gasLegUsd)} of ETH from your ${topup.donor.chainWord} ${topup.donor.token} · you sign once`,
        }
      : null
  }

  for (const c of chains) {
    if (c.gas !== 'none') continue
    const tokens = c.holdings.filter((h) => !h.native)
    const tokenUsd = tokens.reduce((s, h) => s + (h.valueUsd ?? 0), 0)
    const list = tokens.slice(0, 3).map((h) => `${fmtBal(h.balance)} ${h.symbol}`).join(' · ') + (tokens.length > 3 ? ` · +${tokens.length - 3}` : '')
    const fix = gasFixFor(c)
    out.push({
      id: `no-gas-${c.id}`,
      kind: 'no-gas',
      chainId: c.id,
      chainName: c.name,
      tone: 'warn',
      title: `${c.name} holds tokens but no ${c.gasSymbol} for gas`,
      detail: fix
        ? `${fmtUsd(tokenUsd)} (${list}) can't move until a little ${c.gasSymbol} lands there.`
        : `${fmtUsd(tokenUsd)} (${list}) can't move until a little ${c.gasSymbol} lands there — nothing else in this wallet can carry the top-up, so it has to come from outside.`,
      actions: fix ? [fix, ...outsideDoors(c.name, c.gasSymbol)] : outsideDoors(c.name, c.gasSymbol),
    })
  }

  for (const c of chains) {
    if (c.gas !== 'low') continue
    const topup = gasFixFor(c)
    const reserve = GAS_RESERVE_ETH[c.id] ?? 0.002
    out.push({
      id: `low-gas-${c.id}`,
      kind: 'low-gas',
      chainId: c.id,
      chainName: c.name,
      tone: 'info',
      title: `${c.name} is low on gas`,
      detail: `${fmtEth(c.gasUnits)} ${c.gasSymbol} signs a move, but a plan keeps ${fmtEth(reserve)} ${c.gasSymbol} back — a small top-up avoids a stall mid-job.`,
      actions: topup ? [{ ...topup, label: `Top up gas on ${c.name}` }] : [outsideDoors(c.name, c.gasSymbol)[0]],
    })
  }

  for (const c of chains) {
    if (!c.unread) continue
    out.push({
      id: `unread-${c.id}`,
      kind: 'unread',
      chainId: c.id,
      chainName: c.name,
      tone: 'info',
      title: `${c.name} didn't answer`,
      detail: 'Its balances above are the index’s last look, or absent — never shown as zero.',
      actions: [{ primary: true, door: 'refresh', label: 'Read again' }],
    })
  }

  return out
}
