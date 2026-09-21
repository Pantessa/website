// lib/wall-chips.ts — what to press when a native layer says no.
//
// NO-DEAD-ENDS squad, 2026-09-21. The swap layer refuses honestly and
// precisely, and until now it refused into a void: three of the funded rows
// in the prod `ask_failures` queue are a stranger reading one of these
// sentences with four figures in the wallet and no button anywhere.
//
//   "Sell $50 of AMAT"  → you don't hold any AMAT on Base — nothing to sell.
//   "Sell $50 of NVDA"  → I couldn't price NVDA to size a $50 swap.
//   "Buy $50 of TSLA"   → no Uniswap v3 or v4 pool can fill USDC → TSLA.
//
// Each of those has an obvious next move that the product already builds —
// buy the thing you tried to sell, size the sell off the live balance
// instead of a price, try a size the pool can actually fill. The refusal
// keeps its wording; it just stops being the end of the road.
//
// PURE. `verify` is injected (the route passes scripts/ask-ladder's
// `buildsNatively`), so a chip is never a second dead end — the same
// contract the intent net and the affordability gate use. Amounts are only
// ever the user's own; nothing here invents a size out of nothing.

export interface WallChip {
  label: string
  resume: string
}

interface Ctx {
  /** Uppercase ticker the wall is about. */
  symbol: string
  /** Display name of the chain the layer was working on ("Base"). */
  chainName: string
  /** Dollars the user asked for, when the ask said a number. */
  usd?: number
  verify: (ask: string) => boolean
}

const chainWord = (chainName: string) => chainName.toLowerCase().replace(/\s+chain$/, '')

function take(ctx: Ctx, candidates: [string, string][]): WallChip[] {
  const out: WallChip[] = []
  for (const [resume, label] of candidates) {
    if (out.some((c) => c.resume.toLowerCase() === resume.toLowerCase())) continue
    if (ctx.verify(resume)) out.push({ label, resume })
    if (out.length >= 3) break
  }
  return out
}

/** "You don't hold any X on <chain> — nothing to sell."
 *  You cannot sell what you do not have; you can buy it, or sell it where it
 *  actually lives. */
export function nothingToSellChips(ctx: Ctx, otherChains: string[]): WallChip[] {
  const c = chainWord(ctx.chainName)
  const sizes = ctx.usd ? [ctx.usd] : [25, 50]
  return take(ctx, [
    ...otherChains.map((o) => [`Sell all my ${ctx.symbol} on ${chainWord(o)}`, `Sell my ${ctx.symbol} on ${o} instead`] as [string, string]),
    ...sizes.map((s) => [`Buy $${s} of ${ctx.symbol} on ${c}`, `Buy $${s} of ${ctx.symbol} instead`] as [string, string]),
  ])
}

/** "I couldn't price X to size a $N swap."
 *  The dollar figure is the only thing that failed — a token amount, or the
 *  whole balance, needs no price at all. */
export function unpriceableSellChips(ctx: Ctx): WallChip[] {
  const c = chainWord(ctx.chainName)
  return take(ctx, [
    [`Sell all my ${ctx.symbol} on ${c}`, `Sell all my ${ctx.symbol}`],
    [`Show my wallet`, `Show me what I hold`],
  ])
}

/** "No Uniswap v3 or v4 pool can fill A → B for this amount."
 *  "for this amount" is the tell: the pool exists often enough that a smaller
 *  size is worth a tap, and the opposite side of the trade usually routes. */
export function noPoolChips(ctx: Ctx, counterSymbol: string, buying: boolean): WallChip[] {
  const c = chainWord(ctx.chainName)
  const smaller = ctx.usd && ctx.usd > 10 ? Math.max(5, Math.round(ctx.usd / 5)) : null
  return take(ctx, [
    ...(smaller ? [[`${buying ? 'Buy' : 'Sell'} $${smaller} of ${ctx.symbol} on ${c}`, `Try a smaller size ($${smaller})`] as [string, string]] : []),
    ...(counterSymbol && counterSymbol !== ctx.symbol
      ? [[`${buying ? 'Buy' : 'Sell'} $${ctx.usd ?? 25} of ${counterSymbol} on ${c}`, `${buying ? 'Buy' : 'Sell'} ${counterSymbol} instead`] as [string, string]]
      : []),
  ])
}
