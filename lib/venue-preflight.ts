// ─────────────────────────────────────────────────────────────────────────
//  Can the destination buy actually be FILLED? — the pre-flight that keeps
//  a funding plan from moving money onto a chain that can't complete it.
//
//  The Robinhood Chain funding offer (and the `robinhood-fund-buy` job
//  segment it compiles into) runs BEFORE the venue cascade: bridge legs
//  sign and settle, and only then does the buy step call buildGuardedSwap.
//  For a listing no venue can fill, that refusal arrives after the money is
//  already on 4663 — stranded USDG, nothing bought. Measured 2026-09-21,
//  read-only: **105 of the 201 curated Robinhood Chain listings refuse**
//  (102 no pool, PATH + PWR off their tape, CASHCAT no feed). Every one of
//  them strands money today.
//
//  The segment's own lead comment already states the rule for TICKERS —
//  "Pair the ticker BEFORE the job exists — 'AAPLE' must ask here, not fail
//  at step 3 after the funding legs already moved money". This is the same
//  rule for VENUES.
//
//  Why this runs the real cascade instead of its own quote ladder: a
//  bespoke ladder would drift from lib/swap-exec the first time the venue
//  order changes (the no-pool → LiFi fall-through is a live proposal), and
//  a pre-flight that disagrees with the builder is worse than none. The
//  cascade is deterministic and read-only — it quotes, it never signs or
//  sends — so calling it IS the check.
//
//  Two properties make that safe and cheap, both measured over all 201
//  listings on 2026-09-21:
//    · The verdict does not depend on the balance. An empty address and a
//      USDG whale answered identically, 201/201 — venue misses are decided
//      at the QUOTE, before any balance is read. So the pre-flight can run
//      against the real wallet while it is still empty, which is exactly
//      when the funding plan is being offered.
//    · It is fast. Refusals came back in ~130ms; p50 471ms / p95 1.26s
//      across the whole list, and the callers start it ALONGSIDE their
//      balance scan, so it adds no wall-clock.
//
//  It fails OPEN, always. Only a definite venue miss refuses; a transport
//  error, a timeout, a policy block or anything unrecognised proceeds to
//  the offer exactly as before. Never refuse a fundable buy because a
//  quote timed out.
// ─────────────────────────────────────────────────────────────────────────

import { chainById, primaryStable } from '@/lib/chains'
import type { CompiledJob } from '@/lib/jobs'
import { buildGuardedSwap, type GuardedSwapResult, type SwapVenues } from '@/lib/swap-exec'

/** How long a pre-flight may take before the caller stops waiting on it and
 *  proceeds. Comfortably past the measured p95 (1.26s) so a slow-but-real
 *  answer still lands, short enough that a hung RPC can't stall the turn. */
export const VENUE_PREFLIGHT_TIMEOUT_MS = 6_000

export type VenueFillVerdict =
  /** A venue quoted it. Nothing was built. */
  | { kind: 'fillable' }
  /** No venue on the chain can fill it — the cascade's own words. */
  | { kind: 'no-venue'; reason: string }
  /** Couldn't tell (transport, timeout, a policy block). Proceed. */
  | { kind: 'unknown'; why: string }

/** The buy a funding plan exists for. */
export interface FundedBuy {
  chainId: number
  sellToken: string
  buyToken: string
  /** The stable the buy spends, in human units — dollars on a stable leg. */
  amountHuman: string
}

/**
 * Pure: what a cascade answer means for the pre-flight.
 *
 * `blockKind: 'execution'` is the cascade's venue/tape family and nothing
 * else — no pool, off tape at every venue, no LiFi route, no price feed,
 * not a first-class chain (lib/swap-exec `cascade`). A `'policy'` block is
 * the caller's own spend policy, which says nothing about the venue, so it
 * fails open like any other unknown.
 */
export function verdictOfSwapResult(r: GuardedSwapResult): VenueFillVerdict {
  if (r.ok) return { kind: 'fillable' }
  if (r.blockKind === 'execution') return { kind: 'no-venue', reason: r.reasons }
  return { kind: 'unknown', why: `policy block: ${r.reasons}` }
}

/**
 * Read-only: does any venue fill this buy? Never throws and never rejects —
 * every failure becomes `unknown`, which every caller treats as "proceed".
 *
 * `venues` is the same injection seam buildGuardedSwap already offers, so
 * the harness can pin the decision without a live chain.
 */
export async function preflightFundedBuy(buy: FundedBuy, venues: Partial<SwapVenues> = {}, timeoutMs = VENUE_PREFLIGHT_TIMEOUT_MS): Promise<VenueFillVerdict> {
  const first = await onePass(buy, venues, timeoutMs)
  // A refusal is confirmed twice. The v3 builder treats "every fee tier's
  // quote threw" as "no pool", and on Robinhood Chain that is also what a
  // rate-limited RPC looks like (memory robinhood-rpc-rate-limit: the public
  // 4663 endpoint limits per IP and Vercel's egress is shared). One transient
  // burst must not tell someone a stock they can buy is untradeable, so the
  // only verdict that stops a funding plan is one that survived a re-read.
  // Costs a second quote in the refusing path only (~130ms measured).
  if (first.kind !== 'no-venue') return first
  const second = await onePass(buy, venues, timeoutMs)
  return second.kind === 'no-venue' ? second : { kind: 'unknown', why: `first read said "${first.reason}", the re-read did not` }
}

async function onePass(buy: FundedBuy, venues: Partial<SwapVenues>, timeoutMs: number): Promise<VenueFillVerdict> {
  // A throwaway `from`: the verdict is the venue's, not the wallet's (201/201
  // identical between an empty address and a whale), and quoting against a
  // fixed address keeps the pre-flight out of the caller's allowance reads.
  const from = '0x000000000000000000000000000000000000dEaD'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      buildGuardedSwap({ ...buy, from }, venues).then(verdictOfSwapResult),
      new Promise<VenueFillVerdict>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'unknown', why: `no answer in ${timeoutMs}ms` }), timeoutMs)
      }),
    ])
  } catch (err) {
    return { kind: 'unknown', why: (err as Error).message || 'the venue read failed' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Pure: the funded buys inside a compiled job, if any.
 *
 * `native-lifi-swap` is the buy the `robinhood-fund-buy` segment emits, and
 * that segment is context-gated on a funding segment having compiled
 * earlier in the same ask — so every such step in a compiled job is a buy
 * some bridge leg is about to pay for.
 */
export function fundedBuysOf(compiled: CompiledJob): FundedBuy[] {
  const out: FundedBuy[] = []
  for (const s of compiled.steps) {
    if (s.builder !== 'native-lifi-swap') continue
    const p = s.params as { buyUsd?: number; buyToken?: string; sellToken?: string; chainId?: number }
    // The segment always writes chainId; the default is for legacy rows.
    const chainId = Number(p.chainId ?? 4663)
    const sellToken = p.sellToken ?? primaryStable(chainId)?.symbol
    const buyUsd = Number(p.buyUsd)
    if (!p.buyToken || !sellToken || !Number.isFinite(buyUsd) || buyUsd <= 0) continue
    out.push({ chainId, sellToken, buyToken: p.buyToken, amountHuman: buyUsd.toFixed(2) })
  }
  return out
}

/**
 * The one line every job door runs before `createJob`: the refusal a
 * compiled ask has earned, or null when its funded buy can be filled — or
 * when we couldn't tell. Fail-open lives inside preflightFundedBuy, so a
 * null here means "carry on exactly as before", which is also what every
 * unreadable venue produces.
 */
export async function unfillableFundedBuyReason(compiled: CompiledJob): Promise<string | null> {
  for (const buy of fundedBuysOf(compiled)) {
    const fill = await preflightFundedBuy(buy)
    if (fill.kind === 'no-venue') return unfillableBuyCopy(buy, fill.reason)
  }
  return null
}

/**
 * Pure: what the user is told instead of an offer to move money. Leads with
 * the consequence (there is nothing to fund), then the cascade's own reason
 * verbatim — it already names the venue and, for an off-tape or feedless
 * listing, the number behind the refusal.
 */
export function unfillableBuyCopy(buy: FundedBuy, reason: string): string {
  const chainName = chainById(buy.chainId)?.name ?? `chain ${buy.chainId}`
  // Some cascade refusals already close with "Nothing was built." — say it
  // once, and say the part that is new here: nothing MOVED either.
  const why = reason.replace(/\s*Nothing was built\.\s*$/, '').trim()
  return (
    `${chainName} has no venue that can fill ${buy.sellToken.toUpperCase()} → ${buy.buyToken.toUpperCase()} right now, so there's nothing to fund — ` +
    `moving money there wouldn't get you the ${buy.buyToken.toUpperCase()}, it would just leave it sitting on ${chainName}. ` +
    `${why} Nothing was built and nothing moved.`
  )
}
