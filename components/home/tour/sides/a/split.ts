// THE TOUR · LINKS — who gets what (squad landing, 2026-11-10; lane SIDES-A).
// Pure arithmetic over the snapshot's fee line (lib/home-tour TourFees, which
// is lib/fees read on the server): a link's sentence carries a size, some
// number of readers sign it, the link fee is a share of what they signed and
// the creator's part is a share of that fee. No rate is typed here: the
// caller passes the snapshot's bps and split. Pinned against lib/fees
// creatorEarningsUsd by scripts/landing-sides-a-pins.ts.

export interface LinkSplit {
  /** Dollars the readers signed in all. */
  volumeUsd: number
  /** The link fee on that volume. */
  feeUsd: number
  /** The creator's part of the fee. */
  creatorUsd: number
  /** What Pantessa keeps after the creator's part. */
  houseUsd: number
  /** The creator's share of the fee, 0..1 (the bar's first part). */
  creatorShare: number
}

/** How many readers the calculator can be set to. A hypothetical the visitor
 *  picks, never a claim about traffic. */
export const LINK_READER_CHOICES: readonly number[] = [1, 10, 100, 1000]
export const LINK_DEFAULT_READERS = 100

/** Hundredths of a cent, so three multiplications never print a float's tail. */
const UNIT = 10_000
const snap = (n: number) => Math.round(n * UNIT) / UNIT

export function linkSplit({ usd, readers, linkBps, creatorSplit }: { usd: number; readers: number; linkBps: number; creatorSplit: number }): LinkSplit | null {
  if (![usd, readers, linkBps, creatorSplit].every((n) => Number.isFinite(n))) return null
  if (!(usd > 0) || !(readers >= 1) || !Number.isInteger(readers) || linkBps < 0 || linkBps > 10_000 || creatorSplit < 0 || creatorSplit > 1) return null
  const volumeUsd = snap(usd * readers)
  const feeUsd = snap((volumeUsd * linkBps) / 10_000)
  const creatorUsd = snap(feeUsd * creatorSplit)
  return { volumeUsd, feeUsd, creatorUsd, houseUsd: snap(feeUsd - creatorUsd), creatorShare: creatorSplit }
}

/** A dollar amount in the split: whole cents from a dollar up ("$12.50",
 *  "$1,250.00"); under a dollar the real fraction, to a hundredth of a cent,
 *  with at least two places ("$0.0625"; $0.125 is never rounded to "$0.13"). */
export function fmtSplitUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00'
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `$${n.toFixed(4).replace(/0{1,2}$/, '')}`
}

/** A round dollar figure: "$5,000". Cents only when there are some. */
export function fmtRoundUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`
}

/** "half" when the split is a half; otherwise the share as a percent. */
export function shareWords(share: number): string {
  return share === 0.5 ? 'half' : `${Math.round(share * 100)}%`
}
