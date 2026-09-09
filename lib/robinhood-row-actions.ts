// ─────────────────────────────────────────────────────────────────────────
//  Robinhood Chain holding → "act on THIS" chips. Pure, shared by the splash
//  card (lib/splash/sources.ts) and the wallet drawer (lib/wallet-view.ts) so
//  a held stock reveals the SAME sell / buy-more asks wherever it appears —
//  each phrasing lands on a native Robinhood-Chain builder.
// ─────────────────────────────────────────────────────────────────────────
import type { SuggestedPrompt } from '@/lib/splash/types'

export interface RobinhoodHolding {
  symbol?: string
  kind?: string
  balance?: string
  usd?: number | null
  priceUsd?: number | null
}

/** One Robinhood holding → the "act on THIS" prompts revealed when its row is
 *  tapped: sell/buy-more a held stock, put idle USDG into AAPL, turn loose ETH
 *  into USDG. Mirrors robinhoodPrompts' phrasing so each lands on a native
 *  Robinhood-Chain builder. */
export function robinhoodRowActions(h: RobinhoodHolding): SuggestedPrompt[] {
  const sym = h.symbol
  if (!sym) return []
  const bal = Number(h.balance)
  if (h.kind === 'stock' || h.kind === 'etf') {
    // Sell = the whole position by GRAMMAR, not by a pasted number: the
    // route sizes `sellAll` from the live balance at build (lib/swap-intent),
    // so a 0.037599192776714446-share holding never lands in the composer as
    // an 18-decimal string, and a chip minted a block before a fill can't
    // quote a stale amount.
    return [
      { label: `Buy more ${sym}`, prompt: `Buy $10 of ${sym} on Robinhood Chain` },
      { label: `DCA $10 weekly`, prompt: `Buy $10 of ${sym} every week on Robinhood Chain` },
      ...(bal > 0 ? [{ label: `Sell ${sym}`, prompt: `Sell all my ${sym} for USDG on Robinhood Chain` }] : []),
    ]
  }
  // Any whole dollar of USDG is buyable stock — the $5 tile-chip threshold
  // left small balances (the common case after a first bridge-in) with a
  // dead row. Floor keeps the amount inside the live balance, never above.
  if (sym === 'USDG' && Number.isFinite(bal) && bal >= 1) {
    const amt = Math.min(Math.floor(bal), 50)
    return [{ label: 'Buy AAPL', prompt: `Swap ${amt} USDG for AAPL on Robinhood Chain` }]
  }
  if (sym === 'ETH' && bal > 0 && h.priceUsd) {
    const amt = Math.min(10 / h.priceUsd, bal * 0.25)
    if (amt > 0.0001) return [{ label: 'Swap ETH → USDG', prompt: `Swap ${amt.toFixed(4)} ETH for USDG on Robinhood Chain` }]
  }
  return []
}
