// Server reads for lib/derivs: the long/short account share, open interest
// history and funding for a symbol's USDT perpetual, from the first exchange
// that answers (Bybit, then Binance, then OKX — the public feeds the
// aggregators read), plus Hyperliquid's own book, where the board's orders
// execute. Keyless. Every reader is fail-soft and NAMED in `missing`; a
// reader that did not answer is never rendered as zero.
//
// Measured 2026-10-05 (UNI, from an EU address): all four answer. Bybit and
// Binance refuse requests from US addresses, so a US-hosted function falls
// through to OKX, whose daily open-interest series carries zero rows for
// recent days (dropped below) — the ladder's order is by data quality.
import type { ChartTf } from './charts'
import type { DerivsBody, OiPoint, RatioPoint } from './derivs'

const TTL_MS = 60_000
const TIMEOUT_MS = 7_000
const HL_TTL_MS = 30_000

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store', headers: { accept: 'application/json', ...(init?.headers ?? {}) } })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
const num = (x: unknown): number => (typeof x === 'string' || typeof x === 'number' ? Number(x) : NaN)
const asc = <T extends { t: number }>(rows: T[]): T[] => rows.filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t)

interface Series {
  source: string
  oiUnit: 'coin' | 'usd'
  oi: OiPoint[]
  ratio: RatioPoint[]
  funding8h: number | null
}

const BYBIT_TF: Record<ChartTf, string> = { '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1d' }
async function bybit(symbol: string, tf: ChartTf): Promise<Series> {
  const base = 'https://api.bybit.com/v5/market'
  const q = `category=linear&symbol=${symbol}USDT`
  type Page = { result?: { list?: Record<string, string>[]; nextPageCursor?: string } }
  const oiPage = async (cursor?: string) => (await getJson(`${base}/open-interest?${q}&intervalTime=${BYBIT_TF[tf]}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)) as Page
  const [first, ratioRaw, tick] = await Promise.all([
    oiPage(),
    getJson(`${base}/account-ratio?${q}&period=${BYBIT_TF[tf]}&limit=500`) as Promise<Page>,
    getJson(`${base}/tickers?${q}`) as Promise<Page>,
  ])
  const rows = [...(first.result?.list ?? [])]
  // A second page reaches the 400 bars the field can hold.
  if (first.result?.nextPageCursor && rows.length === 200) {
    try {
      rows.push(...((await oiPage(first.result.nextPageCursor)).result?.list ?? []))
    } catch {
      /* one page is still a map */
    }
  }
  const oi = asc(rows.map((r) => ({ t: num(r.timestamp) / 1000, oi: num(r.openInterest) }))).filter((r) => r.oi > 0)
  if (oi.length < 2) throw new Error('no open interest')
  const ratio = asc((ratioRaw.result?.list ?? []).map((r) => ({ t: num(r.timestamp) / 1000, long: num(r.buyRatio) }))).filter((r) => r.long > 0 && r.long < 1)
  const f = num(tick.result?.list?.[0]?.fundingRate)
  return { source: 'Bybit', oiUnit: 'coin', oi, ratio, funding8h: Number.isFinite(f) ? f : null }
}

async function binance(symbol: string, tf: ChartTf): Promise<Series> {
  const base = 'https://fapi.binance.com'
  const q = `symbol=${symbol}USDT&period=${tf}&limit=500`
  const [oiRaw, ratioRaw, prem] = await Promise.all([
    getJson(`${base}/futures/data/openInterestHist?${q}`) as Promise<Record<string, string>[]>,
    getJson(`${base}/futures/data/globalLongShortAccountRatio?${q}`) as Promise<Record<string, string>[]>,
    getJson(`${base}/fapi/v1/premiumIndex?symbol=${symbol}USDT`) as Promise<Record<string, string>>,
  ])
  const oi = asc((Array.isArray(oiRaw) ? oiRaw : []).map((r) => ({ t: num(r.timestamp) / 1000, oi: num(r.sumOpenInterest) }))).filter((r) => r.oi > 0)
  if (oi.length < 2) throw new Error('no open interest')
  const ratio = asc((Array.isArray(ratioRaw) ? ratioRaw : []).map((r) => ({ t: num(r.timestamp) / 1000, long: num(r.longAccount) }))).filter((r) => r.long > 0 && r.long < 1)
  const f = num(prem?.lastFundingRate)
  return { source: 'Binance', oiUnit: 'coin', oi, ratio, funding8h: Number.isFinite(f) ? f : null }
}

const OKX_TF: Record<ChartTf, string> = { '15m': '5m', '1h': '1H', '4h': '1H', '1d': '1D' }
async function okx(symbol: string, tf: ChartTf): Promise<Series> {
  const base = 'https://www.okx.com/api/v5'
  type Rows = { data?: string[][] }
  const [oiRaw, ratioRaw, fund] = await Promise.all([
    getJson(`${base}/rubik/stat/contracts/open-interest-volume?ccy=${symbol}&period=${OKX_TF[tf]}`) as Promise<Rows>,
    getJson(`${base}/rubik/stat/contracts/long-short-account-ratio?ccy=${symbol}&period=${OKX_TF[tf]}`) as Promise<Rows>,
    getJson(`${base}/public/funding-rate?instId=${symbol}-USDT-SWAP`) as Promise<{ data?: Record<string, string>[] }>,
  ])
  // OKX publishes zero for days it has not settled: a zero is a missing reading.
  const oi = asc((oiRaw.data ?? []).map((r) => ({ t: num(r[0]) / 1000, oi: num(r[1]) }))).filter((r) => r.oi > 0)
  const ratio = asc((ratioRaw.data ?? []).map((r) => ({ t: num(r[0]) / 1000, long: num(r[1]) / (1 + num(r[1])) }))).filter((r) => r.long > 0 && r.long < 1)
  if (oi.length < 2 && ratio.length === 0) throw new Error('no series')
  const f = num(fund.data?.[0]?.fundingRate)
  return { source: 'OKX', oiUnit: 'usd', oi, ratio, funding8h: Number.isFinite(f) ? f : null }
}

let hlCache: { at: number; rows: Map<string, NonNullable<DerivsBody['hl']>> } | null = null
async function hyperliquid(symbol: string): Promise<DerivsBody['hl']> {
  if (!hlCache || Date.now() - hlCache.at > HL_TTL_MS) {
    const body = (await getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) })) as [
      { universe: { name: string; maxLeverage: number }[] },
      Record<string, string>[],
    ]
    const rows = new Map<string, NonNullable<DerivsBody['hl']>>()
    body[0].universe.forEach((u, i) => {
      const c = body[1][i]
      const mark = num(c?.markPx)
      if (!(mark > 0)) return
      rows.set(u.name.toUpperCase(), { mark, fundingHr: num(c.funding) || 0, oiUsd: (num(c.openInterest) || 0) * mark, maxLeverage: u.maxLeverage })
    })
    hlCache = { at: Date.now(), rows }
  }
  return hlCache.rows.get(symbol) ?? null
}

const cache = new Map<string, { at: number; body: DerivsBody }>()
const inflight = new Map<string, Promise<DerivsBody>>()

export async function readDerivs(symbol: string, tf: ChartTf): Promise<DerivsBody> {
  const key = `${symbol}:${tf}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body
  const running = inflight.get(key)
  if (running) return running
  const run = (async (): Promise<DerivsBody> => {
    const missing: string[] = []
    const hlP = hyperliquid(symbol).catch(() => {
      missing.push('Hyperliquid')
      return null
    })
    let series: Series | null = null
    for (const [name, read] of [['Bybit', bybit], ['Binance', binance], ['OKX', okx]] as const) {
      try {
        series = await read(symbol, tf)
        break
      } catch {
        missing.push(name)
      }
    }
    const hl = await hlP
    const body: DerivsBody = {
      symbol,
      tf,
      source: series?.source ?? null,
      oiUnit: series?.oiUnit ?? 'coin',
      oi: series?.oi ?? [],
      ratio: series?.ratio ?? [],
      funding8h: series?.funding8h ?? (hl ? hl.fundingHr * 8 : null),
      hl,
      missing,
    }
    // An answer with nothing in it is retried sooner than a good one is refreshed.
    cache.set(key, { at: series || hl ? Date.now() : Date.now() - TTL_MS + 10_000, body })
    if (cache.size > 400) cache.delete(cache.keys().next().value as string)
    return body
  })().finally(() => inflight.delete(key))
  inflight.set(key, run)
  return run
}
