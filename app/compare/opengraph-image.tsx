import { claimCardImage, CLAIM_CARD_SIZE } from '@/lib/og-claim-card'
import { SWAP_FEE_PCT } from '@/lib/fees'

// Social card for /compare (og:image + twitter:image via ./twitter-image.tsx).
// The page had no picture at all. The card states OUR column and names no
// one: a competitor is named in the page's body copy only, never in a mark
// or a headline that travels without its context (rule 7).

export const runtime = 'nodejs'
export const alt = `Every meter on a charting subscription, free on Pantessa. We earn ${SWAP_FEE_PCT} when a chart becomes a trade.`
export const size = CLAIM_CARD_SIZE
export const contentType = 'image/png'

export default function Image() {
  return claimCardImage({
    tag: 'COMPARE',
    eyebrow: ['CHARTING', 'WITHOUT THE METERS'],
    line1: 'Every chart meter.',
    line2: 'Free.',
    under: [`PAID BY TRADES: ${SWAP_FEE_PCT} EACH`, 'YOUR WALLET SIGNS'],
    tableTitle: 'WHAT A SUBSCRIPTION METERS',
    tableNote: 'HERE',
    rows: [
      { label: 'Watchlists and tickers', value: 'Unlimited' },
      { label: 'Price alerts', value: 'Unlimited' },
      { label: 'Indicators and timeframes', value: 'All of them' },
      { label: 'Ads', value: 'None' },
      { label: 'Trade from the chart', value: 'Built in', strong: true },
      { label: 'Price to look', value: '€0', strong: true },
    ],
    foot: 'THEIR TABLE, OUR COLUMN',
    path: '/compare',
  })
}
