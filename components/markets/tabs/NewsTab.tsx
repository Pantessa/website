// STUB — the COMM lane builds the real one at components/markets/news/NewsTab.tsx
// (GET /api/news?symbol=…, headlines pinned to bars). QA replaces this file
// with `export { default } from '@/components/markets/news/NewsTab'` at
// integration. Other lanes never edit components/markets/tabs/*.

import type { ChartPair } from '@/lib/charts'
import ComingCard from '@/components/markets/shell/ComingCard'

export default function NewsTab({ symbol }: { symbol: string; pair: ChartPair }) {
  return (
    <ComingCard
      lane="COMM"
      title={`${symbol} news`}
      body={`Headlines for ${symbol}, pinned to the bar they broke on, so "what happened here" is a hover. Server-fetched, cached per symbol.`}
    />
  )
}
