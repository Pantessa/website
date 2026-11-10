// THE TOUR · CHARTS (lane SIDES-A owns this file). First-draft words from the
// contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'charts',
  label: 'Charts',
  claim: 'Every chart is the order form.',
  line: 'Stocks 24/7, crypto, perps and macro, live.',
  body: 'Pick a size on the chart and the sentence under it is the order. Pantessa builds the guarded transaction and your own wallet signs it.',
  facts: ['{stocks} tokenized stocks that trade around the clock', '{crypto} coins, plus Hyperliquid perps and {macro} macro markets', 'Free to look: no account, unlimited watchlists and alerts'],
  doors: [
    { label: 'Open the AAPL chart', href: '/t/AAPL', kind: 'primary' },
    { label: 'Watch the live tape', href: '/live', kind: 'quiet' },
  ],
  asks: [
    { ask: 'Buy $25 of AAPL', label: 'Buy $25 of AAPL', via: 'Robinhood Chain' },
    { ask: '2x Long $25 of BTC on Hyperliquid', label: 'Long BTC 2x', via: 'Hyperliquid' },
  ],
}
