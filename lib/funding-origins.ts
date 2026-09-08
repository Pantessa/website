// ─────────────────────────────────────────────────────────────────────────
//  The funding ORIGIN set — the chains a wallet's USDC/ETH can be bridged
//  from — and the words every refusal uses to name it. Pure and client-safe
//  on purpose: lib/lifi-bridge.ts (the server-side bridge module) re-exports
//  these, but client components (the on-ramp copy in lib/onramp.ts reaches
//  ClarifyChips/WalletPanel) must never pull the bridge module's DB + LiFi
//  imports into the bundle just to say "Base, Ethereum, Arbitrum, or
//  Optimism". Adding a chain here is what makes the copy follow (#707 lit
//  Optimism in the scan but three hardcoded "Base, Ethereum, or Arbitrum"
//  sentences kept contradicting it — squad QA P-3, 2026-09-08).
// ─────────────────────────────────────────────────────────────────────────

/** Origin chains the funding plan scans and bridges from, in scan order.
 *  Each is a first-class lib/chains member holding USDC with a live-probed
 *  LiFi route onto Robinhood Chain. */
export const FUNDING_ORIGIN_CHAINS = [8453, 1, 42161, 10] as const

/** The chain word each chip resume uses — the parse contract with
 *  lib/jobs.ts parseRobinhoodFunding (lower-cased in the resume string). */
export const FUNDING_ORIGIN_WORD: Record<number, string> = {
  8453: 'Base',
  1: 'Ethereum',
  42161: 'Arbitrum',
  10: 'Optimism',
}

/** "Base, Ethereum, or Arbitrum" — an Oxford-comma list for refusal copy that
 *  must name the real scan set. One word passes through untouched. */
export function listWords(words: string[], conj: 'or' | 'and' = 'or'): string {
  const w = words.filter(Boolean)
  if (w.length <= 1) return w[0] ?? ''
  if (w.length === 2) return `${w[0]} ${conj} ${w[1]}`
  return `${w.slice(0, -1).join(', ')}, ${conj} ${w[w.length - 1]}`
}

/** "Base, Ethereum, Arbitrum, or Optimism" — THE phrase for "top up on…"
 *  copy. Derived, so no sentence can lag the origin set again. */
export function fundingOriginWords(conj: 'or' | 'and' = 'or'): string {
  return listWords(FUNDING_ORIGIN_CHAINS.map((id) => FUNDING_ORIGIN_WORD[id]), conj)
}
