// lib/ecb-fx.ts — USD per EUR, from the European Central Bank's own daily
// reference feed.
//
// EXISTS BECAUSE STRIPE'S ONRAMP SPEAKS TWO CURRENCIES. `source_amount` has
// no currency of its own, so the moment lib/onramp decides a customer in
// Europe should see a euro checkout, the plan's dollar figure has to become a
// euro figure. There is no third option: leaving the number alone charges the
// EUR/USD spread on top of the plan (about 16% at today's rate), silently.
//
// WHY THE ECB AND NOT AN FX API: it is first-party (the ECB publishes the
// rates every European bank quotes against), keyless, has served the same URL
// for two decades, and is a plain read that moves no money. The rate is
// published once per business day around 16:00 CET and the feed keeps serving
// the last one over weekends, so a six-hour cache costs nothing in accuracy.
//
// FAILS SOFT, ALWAYS. Every failure — unreachable, slow, malformed, absurd —
// returns EUR_USD_FALLBACK rather than throwing, because the caller is the
// funding path: a down FX feed must degrade the PRECISION of a preset the
// user can edit at checkout, never take the funding door offline. The
// fallback sits below the trading range so that degraded day over-provisions.

//
// SINCE 2026-11-03 THE RATE ALSO SIZES TRADES. Every native grammar reads a
// euro or pound ask through lib/chain-lexicon's money slot, which rewrites
// "€20" to the dollar form at the rate PUBLISHED here (publishFiatRates)
// after every fetch — earned or fallen back, and the chat route says which
// to the user. GBP falls out of the same cube (`<Cube currency='GBP'>` is
// EUR-per-GBP, so USD-per-GBP = USD-per-EUR ÷ it); it has no fallback
// constant of its own, so a feed outage with nothing cached leaves a pound
// ask unread, which is honest, never a face-value dollar.

import { publishFiatRates } from '@/lib/chain-lexicon'
import { EUR_USD_FALLBACK, EUR_USD_MAX, EUR_USD_MIN } from '@/lib/onramp'

const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/** Six hours. The feed itself only moves once a business day; this is short
 *  enough that a rate never goes more than a day stale in a long-lived
 *  serverless instance, and long enough that the funding path almost never
 *  pays for the fetch. */
const TTL_MS = 6 * 60 * 60_000

/** Module-scope, so it is per-instance and dies with it. Deliberately not the
 *  DB: a reference rate is not state we need to agree on across instances,
 *  and a DB round trip would cost more than the fetch it saves. */
let cached: { rate: number; gbpPerEur: number | null; via: 'ecb' | 'fallback'; at: number } | null = null

/** Pull the USD line out of the ECB's daily cube. The document is a handful of
 *  `<Cube currency='USD' rate='1.1622'/>` elements inside two wrappers —
 *  small, flat, and stable enough that a targeted match beats an XML parser
 *  dependency. Exported so the harness pins the parse against a real sample
 *  without a network call. */
export function parseEcbUsdRate(xml: string): number | null {
  return parseEcbCube(xml, 'USD')
}

/** One `<Cube currency='X' rate='…'/>` — EUR per one X for every currency the
 *  ECB lists. The same bounds for every code we read: USD and GBP both sit
 *  near 1 EUR, so a parse outside 0.5–2 is a changed feed, not a market. */
export function parseEcbCube(xml: string, currency: 'USD' | 'GBP'): number | null {
  const m = new RegExp(`currency=['"]${currency}['"]\\s+rate=['"]([0-9]*\\.?[0-9]+)['"]`, 'i').exec(xml)
  if (!m) return null
  const rate = Number(m[1])
  // Bounds, not a sanity check for show: a feed that changed shape and parsed
  // to 0.01 would preset thousands of euros against a $25 plan.
  if (!Number.isFinite(rate) || rate < EUR_USD_MIN || rate > EUR_USD_MAX) return null
  return rate
}

/** USD per one GBP, from the two cubes: the ECB quotes both against the euro. */
export function usdPerGbpFrom(usdPerEurRate: number, gbpPerEur: number | null): number | null {
  if (gbpPerEur === null || !(gbpPerEur > 0)) return null
  return Math.round((usdPerEurRate / gbpPerEur) * 10_000) / 10_000
}

/** Hand the rates to the money slot every grammar reads. */
function publish(c: NonNullable<typeof cached>): void {
  const gbp = usdPerGbpFrom(c.rate, c.gbpPerEur)
  publishFiatRates({ EUR: { rate: c.rate, via: c.via, at: c.at }, ...(gbp !== null ? { GBP: { rate: gbp, via: c.via, at: c.at } } : {}) })
}

/** USD per 1 EUR. Never throws; `via` says whether the number was earned or
 *  fallen back to, so the caller can log the difference. */
export async function usdPerEur(): Promise<{ rate: number; via: 'ecb' | 'fallback' }> {
  if (cached && Date.now() - cached.at < TTL_MS) return { rate: cached.rate, via: cached.via }
  try {
    const res = await fetch(ECB_DAILY, {
      headers: { accept: 'application/xml,text/xml' },
      signal: AbortSignal.timeout(4_000),
    })
    if (res.ok) {
      const xml = await res.text()
      const rate = parseEcbCube(xml, 'USD')
      if (rate !== null) {
        cached = { rate, gbpPerEur: parseEcbCube(xml, 'GBP'), via: 'ecb', at: Date.now() }
        publish(cached)
        return { rate, via: 'ecb' }
      }
    }
    console.error(`[ecb-fx] no usable USD rate (status ${res.status}) — using the fallback`)
  } catch (e) {
    console.error(`[ecb-fx] rate fetch failed: ${e instanceof Error ? e.message : 'unknown'} — using the fallback`)
  }
  // Cache the fallback too, briefly enough that the next fetch is soon and
  // long enough that a hard-down feed is not re-dialled on every fund click.
  // The last earned GBP cross survives the outage (a stale pound rate beats
  // an unread pound ask); with none, GBP simply stays unpublished.
  cached = { rate: EUR_USD_FALLBACK, gbpPerEur: cached?.gbpPerEur ?? null, via: 'fallback', at: Date.now() - TTL_MS + 10 * 60_000 }
  publish(cached)
  return { rate: EUR_USD_FALLBACK, via: 'fallback' }
}

/** Warm the money slot before a parse: the chat route calls this when the ask
 *  carries a euro or pound amount, so the FIRST euro ask in a cold instance
 *  prices like the hundredth. Never throws (usdPerEur never does). */
export async function warmFiatRates(): Promise<void> {
  await usdPerEur()
}
