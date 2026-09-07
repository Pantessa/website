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
let cached: { rate: number; via: 'ecb' | 'fallback'; at: number } | null = null

/** Pull the USD line out of the ECB's daily cube. The document is a handful of
 *  `<Cube currency='USD' rate='1.1622'/>` elements inside two wrappers —
 *  small, flat, and stable enough that a targeted match beats an XML parser
 *  dependency. Exported so the harness pins the parse against a real sample
 *  without a network call. */
export function parseEcbUsdRate(xml: string): number | null {
  const m = /currency=['"]USD['"]\s+rate=['"]([0-9]*\.?[0-9]+)['"]/i.exec(xml)
  if (!m) return null
  const rate = Number(m[1])
  // Bounds, not a sanity check for show: a feed that changed shape and parsed
  // to 0.01 would preset thousands of euros against a $25 plan.
  if (!Number.isFinite(rate) || rate < EUR_USD_MIN || rate > EUR_USD_MAX) return null
  return rate
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
      const rate = parseEcbUsdRate(await res.text())
      if (rate !== null) {
        cached = { rate, via: 'ecb', at: Date.now() }
        return { rate, via: 'ecb' }
      }
    }
    console.error(`[ecb-fx] no usable USD rate (status ${res.status}) — using the fallback`)
  } catch (e) {
    console.error(`[ecb-fx] rate fetch failed: ${e instanceof Error ? e.message : 'unknown'} — using the fallback`)
  }
  // Cache the fallback too, briefly enough that the next fetch is soon and
  // long enough that a hard-down feed is not re-dialled on every fund click.
  cached = { rate: EUR_USD_FALLBACK, via: 'fallback', at: Date.now() - TTL_MS + 10 * 60_000 }
  return { rate: EUR_USD_FALLBACK, via: 'fallback' }
}
