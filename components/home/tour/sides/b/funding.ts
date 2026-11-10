// THE TOUR · WALLET — how a short buy is funded from another chain, in the
// funding layer's own terms (lane SIDES-B). Three steps, no number of
// signatures (it depends on the source and the venue; the layer decides).
//
// Source: lib/funding-plan.ts header.
//   1. "'insufficient funds' is an offer, never a wall."
//   2. "scans the wallet's ETH + USDC across the … first-class chains and
//      answers with chips" (FUNDING_SCAN_CHAINS; FUNDING_STABLES adds USDT
//      and DAI: "Money the user owns is not allowed to be invisible").
//   3. "one … leg (sign → … wait) per source, then the original action
//      rebuilt fresh by its own native layer"; "overshoot lands in the
//      user's own wallet on the destination chain — never stranded, never a fee".
// Pure and client-safe.

export interface FundingStep {
  id: 'ask' | 'pick' | 'build'
  title: string
  /** `{chains}` is filled with the origin chains' names from the registry. */
  what: string
}

export const FUNDING_STEPS: readonly FundingStep[] = [
  { id: 'ask', title: 'You ask for the buy', what: 'If the chain it runs on is short, that is an offer, not a refusal.' },
  { id: 'pick', title: 'You pick where it comes from', what: 'Your ETH and stablecoins on {chains} are read. Each source that can cover the buy becomes a choice.' },
  { id: 'build', title: 'The buy is built again', what: 'Once the money lands, at a live quote, for your signature. Anything left over stays in your own wallet.' },
]

/** "Base, Arbitrum, Optimism and Ethereum" */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "0x12ab…cdef" */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** A holding's size: up to four decimals under 100 units, two above. */
export function fmtUnits(amount: number): string {
  if (!Number.isFinite(amount)) return ''
  return amount.toLocaleString('en-US', { maximumFractionDigits: Math.abs(amount) >= 100 ? 2 : 4 })
}

/** "$1,234.56" */
export function fmtUsd(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The biggest priced holdings first; unpriced ones after, in the order read. */
export function topHoldings<T extends { valueUsd: number | null }>(held: readonly T[], max: number): T[] {
  const priced = held.filter((h) => h.valueUsd != null && h.valueUsd > 0).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
  const rest = held.filter((h) => !(h.valueUsd != null && h.valueUsd > 0))
  return [...priced, ...rest].slice(0, max)
}

/** The priced total, or null when nothing could be priced. */
export function totalUsd(held: readonly { valueUsd: number | null }[]): number | null {
  const priced = held.filter((h) => h.valueUsd != null && h.valueUsd > 0)
  return priced.length ? priced.reduce((n, h) => n + (h.valueUsd ?? 0), 0) : null
}
