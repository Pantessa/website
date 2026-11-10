// THE TOUR · CHARTS (lane SIDES-A owns this file). Rules: lib/home-tour/types.ts.
// The two sentences are ones the panel's own ticket composes at its default
// size (components/home/tour/sides/a/mini-market.ts over lib/order-ticket):
// the stock buy and the leveraged perp long. The panel draws the ticket, not
// these chips; they stay here so the served sentence audit covers them.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'charts',
  label: 'Charts',
  claim: 'Every chart is the order form.',
  line: 'Stocks 24/7, crypto, perps and macro, live.',
  body: 'Pick a size and the sentence under the chart is the order. Pantessa builds the guarded transaction and your own wallet signs it.',
  facts: ['{stocks} tokenized stocks that trade around the clock', '{crypto} coins, plus Hyperliquid perps and {macro} macro markets', 'Free to look: no account, unlimited watchlists and alerts'],
  doors: [
    { label: 'Open the AAPL chart', href: '/t/AAPL', kind: 'primary' },
    { label: 'Watch the live tape', href: '/live', kind: 'quiet' },
  ],
  asks: [
    { ask: 'Buy $25 of AAPL', label: 'Buy $25 of AAPL', via: 'Robinhood Chain' },
    { ask: '2x Long $25 of HYPE on Hyperliquid', label: 'Long HYPE 2x', via: 'Hyperliquid' },
  ],
}
