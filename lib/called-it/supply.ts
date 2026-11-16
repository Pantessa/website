// Circulating supply, for a call whose target is a market cap ("$5B is a
// clear magnet"). Read from CoinGecko's keyless markets list by the symbol,
// cached a day. TODAY's supply, not the supply on the post's day: the record
// says so (spec METHOD_LINE). A symbol several coins share takes the biggest,
// and is used only when that coin's price agrees with the chart's own last
// close within SUPPLY_PRICE_TOLERANCE: a stock that shares a ticker with a
// coin, or a coin that is not the one charted, gets no supply, and its
// market-cap targets fall back to the 30-day close.
import { unstable_cache } from 'next/cache'

export const SUPPLY_PRICE_TOLERANCE = 0.05
const URL_BASE = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=20&symbols='

export interface CoinRow {
  symbol?: unknown
  current_price?: unknown
  market_cap?: unknown
  circulating_supply?: unknown
}

/** The supply to use for `symbol` at chart price `lastClose`, from CoinGecko's rows. Null when no row is safe. Pure; pinned. */
export function pickSupply(rows: readonly CoinRow[], lastClose: number): number | null {
  const ok = rows
    .map((r) => ({ price: Number(r.current_price), cap: Number(r.market_cap), supply: Number(r.circulating_supply) }))
    .filter((r) => r.price > 0 && r.cap > 0)
    .sort((a, b) => b.cap - a.cap)
  const top = ok[0]
  if (!top || !(lastClose > 0)) return null
  if (Math.abs(top.price / lastClose - 1) > SUPPLY_PRICE_TOLERANCE) return null
  const supply = top.supply > 0 ? top.supply : top.cap / top.price
  return Number.isFinite(supply) && supply > 0 ? supply : null
}

const readRows = unstable_cache(
  async (symbol: string): Promise<CoinRow[]> => {
    const res = await fetch(URL_BASE + encodeURIComponent(symbol.toLowerCase()), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`coingecko ${res.status}`)
    const body = (await res.json()) as unknown
    return Array.isArray(body) ? (body as CoinRow[]).slice(0, 20) : []
  },
  ['called-it-supply-v1'],
  { revalidate: 86_400 },
)

/** Circulating supply for a coin on this chart, or null (a stock, no answer, or a price that does not agree). Never throws. */
export async function circulatingSupply(symbol: string, lastClose: number): Promise<number | null> {
  if (!/^[A-Za-z0-9]{1,15}$/.test(symbol)) return null
  try {
    return pickSupply(await readRows(symbol), lastClose)
  } catch {
    return null
  }
}
