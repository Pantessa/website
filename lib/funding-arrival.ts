// lib/funding-arrival.ts — "your money landed, keep going."
//
// The on-ramp hands the user to a Stripe tab and the chat waits. Until
// 2026-09-08 waiting meant a chip that said "Funded it — pick up where I
// left off" and hoped the user would come back and press it — after a card
// form, a Link login and a KYC pass, on another tab, with no signal from us
// that anything had happened. Nate's own purchase sat for a day.
//
// This module is the signal. A FundWait is written the moment the on-ramp
// tab opens (address, network, the resume that continues the ask, and the
// balances at that moment as a baseline); a watcher polls the chain the
// purchase was sent to and, when the balance rises past dust, reports the
// arrival so the surface can say so and continue the ask. Persisted in
// localStorage so a reload — or coming back to the tab an hour later —
// picks the wait back up instead of forgetting it.
//
// Pure parts (detection, schedule, key/TTL) live here for the harness; the
// React hook that drives them is lib/use-funding-arrival.ts.

import type { OnrampNetwork } from '@/lib/onramp'

export interface FundWait {
  /** Lowercased destination wallet. */
  address: string
  network: OnrampNetwork
  /** The ask restated — what fires when the money is here. */
  resume: string
  /** What the chip said ("Add $25 with card or bank → buy $10 of AAPL"). */
  label: string
  /** Balances when the on-ramp opened; null until the first read lands. */
  baselineEth: number | null
  baselineStable: number | null
  openedAt: number
}

/** A card purchase can take a while (bank rails, a KYC review) — but a wait
 *  older than this is a different session, and firing an hours-old resume
 *  under the user would be a surprise, not a continuation. */
export const FUND_WAIT_TTL_MS = 2 * 60 * 60_000

/** Polling stops here; the chip stays and the wallet panel still shows the
 *  balance, so a slow purchase is never lost — it just isn't auto-continued. */
export const FUND_WATCH_MAX_MS = 45 * 60_000

/** Below these the change is dust or rounding, not a delivery. */
export const ARRIVAL_MIN_ETH = 0.0001
export const ARRIVAL_MIN_STABLE = 0.5

export function fundWaitKey(address: string): string {
  return `yf-fund-wait:${address.toLowerCase()}`
}

export function fundWaitExpired(w: FundWait, now = Date.now()): boolean {
  return now - w.openedAt > FUND_WAIT_TTL_MS
}

/** How long until the next read, given how long we've been watching. Tight
 *  at first (a card purchase that goes through lands in a minute or two),
 *  looser later, off after FUND_WATCH_MAX_MS. */
export function pollDelayMs(elapsedMs: number): number | null {
  if (elapsedMs >= FUND_WATCH_MAX_MS) return null
  if (elapsedMs < 10 * 60_000) return 10_000
  return 20_000
}

export interface ArrivalRead {
  eth: number
  stable: number
}

export interface Arrival {
  deltaEth: number
  deltaStable: number
  /** Dollar figure when an ETH price was known, else null. */
  usd: number | null
}

/** Did money land? Compares a fresh read against the baseline. A missing
 *  baseline (the first read never happened) is treated as zero for the
 *  purpose of a NEW balance — a wallet that was empty when the chip was
 *  offered is the whole reason the chip exists. */
export function detectArrival(
  baseline: { eth: number | null; stable: number | null },
  now: ArrivalRead,
  ethUsd: number | null,
): Arrival | null {
  const deltaEth = Math.max(0, now.eth - (baseline.eth ?? 0))
  const deltaStable = Math.max(0, now.stable - (baseline.stable ?? 0))
  const ethIn = deltaEth >= ARRIVAL_MIN_ETH
  const stableIn = deltaStable >= ARRIVAL_MIN_STABLE
  if (!ethIn && !stableIn) return null
  const usdEth = ethUsd !== null ? deltaEth * ethUsd : null
  const usd = usdEth === null && !stableIn ? null : Math.round(((usdEth ?? 0) + deltaStable) * 100) / 100
  return { deltaEth: ethIn ? deltaEth : 0, deltaStable: stableIn ? deltaStable : 0, usd }
}

/** "0.0112 ETH" / "$27.69 of ETH" / "25 USDC" — one phrase for banners. */
export function arrivalPhrase(a: Arrival, stableSymbol = 'USDC'): string {
  const parts: string[] = []
  if (a.deltaEth > 0) {
    const eth = a.deltaEth >= 0.01 ? a.deltaEth.toFixed(4) : a.deltaEth.toFixed(6)
    parts.push(a.usd !== null && a.deltaStable === 0 ? `$${a.usd.toFixed(2)} of ETH (${eth} ETH)` : `${eth} ETH`)
  }
  if (a.deltaStable > 0) parts.push(`${a.deltaStable.toFixed(2)} ${stableSymbol}`)
  return parts.join(' + ')
}

// ── localStorage shell (browser only; every call guarded) ───────────────

export function loadFundWait(address: string | null | undefined): FundWait | null {
  if (!address || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(fundWaitKey(address))
    if (!raw) return null
    const w = JSON.parse(raw) as FundWait
    if (!w || typeof w.resume !== 'string' || typeof w.openedAt !== 'number') return null
    if (fundWaitExpired(w)) {
      window.localStorage.removeItem(fundWaitKey(address))
      return null
    }
    return w
  } catch {
    return null
  }
}

export function saveFundWait(w: FundWait): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(fundWaitKey(w.address), JSON.stringify(w))
  } catch {
    /* storage blocked — the wait lives in component state only */
  }
}

export function clearFundWait(address: string | null | undefined): void {
  if (!address || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(fundWaitKey(address))
  } catch {
    /* nothing to clear */
  }
}
