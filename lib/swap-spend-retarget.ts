// lib/swap-spend-retarget.ts — before a market buy asks the funding layer to
// move money, ask whether the wallet can already PAY for the same buy from
// where its money sits.
//
// Born 2026-09-24. "I want to buy $2 worth of uni" from a wallet holding
// 0.00257 ETH (~$6.95) and 1.83 USDC on Ethereum, nothing on Base. The ask
// named no chain, so the swap defaulted to Base and its spend to USDC on Base;
// the wallet held 0 there; the funding layer priced a bridge ("the smallest
// plan moves ~$5") against $3.38 of movable money and offered a card. Nobody
// asked the obvious question: UNI lives on Ethereum, the ETH is on Ethereum,
// a single swap there costs under a dollar of gas. The wallet could pay for
// what it asked for ten times over.
//
// THE RULE. When the ask pinned no chain (nothing in the sentence, nothing in
// the picker), a buy whose spend side the wallet can't cover on the default
// chain is re-aimed at a (chain, spend token) the wallet CAN pay from, and
// BUILT there in the same turn, with a line saying so. Two lanes per chain:
//
//   • STABLE — a dollar stable the scan read (USDC, or a FUNDING_STABLES
//     row) holding at least the buy's dollars, with enough native ETH beside
//     it to pay the swap's gas (the chain's live floor). USDC re-uses the
//     route's own fill-in ("buy $2 of UNI on Ethereum"); another stable names
//     itself ("swap 2 DAI for UNI on Base").
//   • ETH — native ETH worth the buy's dollars plus the gas floor. Never for
//     a buy OF ETH or WETH (that is the round trip #803 forbids).
//
// Ranked: the chain the ask already sat on first (a spend-token change is the
// smaller surprise), then stables before ETH (no price exposure on the spend
// side), USDC before other stables, then the larger balance. A chain the scan didn't read is never a
// candidate; a chain where the buy token isn't listed is never a candidate.
//
// PURE. The route hands it the funding scan it already ran, and the harness
// pins every candidate's resume through parseSwapIntent + chainNamedIn — a
// retarget is a sentence the parser accepts, or it isn't offered.

import type { FundingScan, FundingSource } from '@/lib/funding-plan'

export interface SpendRetargetAsk {
  buyToken: string
  /** The buy's dollars (the spend side is dollars: a dollar ask or a stable
   *  amount — lib/swap-shortfall buyDollarsOf). */
  dollars: number
  /** The chain the swap was aimed at by default. */
  chainId: number
}

export interface SpendRetargetChain {
  chainId: number
  /** As resume strings spell it (FUNDING_CHAIN_WORD). */
  chainWord: string
  /** Registry name, for copy. */
  chainName: string
  /** The buy token resolves on this chain. */
  buyListed: boolean
  /** Native ETH a swap must leave behind here (lib/gas-floor). */
  gasFloorEth: number
}

export interface SpendRetargetCandidate {
  chainId: number
  chainWord: string
  chainName: string
  lane: 'stable' | 'eth'
  /** The spend token the retargeted swap sells. */
  token: string
  /** Dollars available to spend on that lane. */
  usd: number
  /** A sentence the swap parser accepts, naming the chain. */
  resume: string
  /** Why this one is offered, for the reply. */
  reason: string
}

const dollarsWord = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))
/** Dollars as the funding copy prints them ("1,073.64", "6.95", "5"). */
const usdWord = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })

/** Every (chain, spend token) the wallet can pay this buy from, best first. */
export function planSpendRetarget(
  ask: SpendRetargetAsk,
  scan: Pick<FundingScan, 'sources' | 'stranded' | 'nativeEth' | 'ethUsd'>,
  chains: SpendRetargetChain[],
): SpendRetargetCandidate[] {
  const buy = ask.buyToken.toUpperCase()
  if (!(ask.dollars > 0)) return []
  const out: SpendRetargetCandidate[] = []
  for (const c of chains) {
    if (!c.buyListed) continue
    const native = scan.nativeEth?.[c.chainId]
    if (typeof native !== 'number') continue // unread chain: unknown, never assumed
    const gasOk = native >= c.gasFloorEth
    const rows: FundingSource[] = [...scan.sources, ...scan.stranded].filter((s) => s.chainId === c.chainId)
    // Stable lane — the row's own chain, so cross-chain capability is moot;
    // stranded USDC (no gas to LEAVE the chain) can still pay a swap on it
    // when the gas floor is met, which the check above decides.
    for (const s of rows) {
      const sym = s.token.toUpperCase()
      if (sym === 'ETH' || sym === buy) continue
      if (!gasOk || s.usd < ask.dollars) continue
      const resume =
        sym === 'USDC'
          ? `buy $${dollarsWord(ask.dollars)} of ${buy} on ${c.chainWord}`
          : `swap ${dollarsWord(ask.dollars)} ${sym} for ${buy} on ${c.chainWord}`
      out.push({
        chainId: c.chainId,
        chainWord: c.chainWord,
        chainName: c.chainName,
        lane: 'stable',
        token: sym,
        usd: Number(s.usd.toFixed(2)),
        resume,
        reason: `you hold ~$${usdWord(Number(s.usd.toFixed(2)))} of ${sym} on ${c.chainName}`,
      })
    }
    // ETH lane — the whole balance minus the swap's own gas, priced.
    if (buy !== 'ETH' && buy !== 'WETH' && typeof scan.ethUsd === 'number' && scan.ethUsd > 0) {
      const spendableUsd = (native - c.gasFloorEth) * scan.ethUsd
      // 2% headroom: the swap's fee and a tick of price movement between the
      // read and the signature.
      if (spendableUsd >= ask.dollars * 1.02) {
        out.push({
          chainId: c.chainId,
          chainWord: c.chainWord,
          chainName: c.chainName,
          lane: 'eth',
          token: 'ETH',
          usd: Number(spendableUsd.toFixed(2)),
          resume: `swap $${dollarsWord(ask.dollars)} worth of ETH for ${buy} on ${c.chainWord}`,
          reason: `you hold ~$${usdWord(Number((native * scan.ethUsd).toFixed(2)))} of ETH on ${c.chainName}`,
        })
      }
    }
  }
  return out.sort((a, b) => {
    const sameA = a.chainId === ask.chainId ? 0 : 1
    const sameB = b.chainId === ask.chainId ? 0 : 1
    if (sameA !== sameB) return sameA - sameB
    if (a.lane !== b.lane) return a.lane === 'stable' ? -1 : 1
    // USDC before any other stable: it is the route's own fill-in, it has a
    // book on every venue, and Ethereum USDT's approve needs the reset dance
    // (#843) — two signatures where USDC takes one.
    const usdcA = a.token === 'USDC' ? 0 : 1
    const usdcB = b.token === 'USDC' ? 0 : 1
    if (usdcA !== usdcB) return usdcA - usdcB
    return b.usd - a.usd
  })
}

/** The line that opens a retargeted build (or its honest refusal). */
export function spendRetargetNote(params: { buyToken: string; dollars: number; fromChainName: string; fromToken: string; pick: SpendRetargetCandidate; built: boolean }): string {
  const { buyToken, dollars, fromChainName, fromToken, pick, built } = params
  const spend = pick.lane === 'eth' ? 'ETH' : pick.token
  const change = pick.chainName === fromChainName ? `paid with ${spend} instead of ${fromToken.toUpperCase()}` : `on ${pick.chainName}, paid with ${spend}`
  const verb = built ? 'so I built the buy there' : 'so I tried the buy there instead'
  return `🧭 You asked for $${dollarsWord(dollars)} of ${buyToken.toUpperCase()} and named no chain — the wallet holds no ${fromToken.toUpperCase()} on ${fromChainName}, but ${pick.reason}, ${verb}: ${change}. Say the chain if you'd rather have it elsewhere.`
}
