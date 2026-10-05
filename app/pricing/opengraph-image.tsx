import { claimCardImage, CLAIM_CARD_SIZE } from '@/lib/og-claim-card'
import { CREATOR_FEE_SPLIT, SWAP_FEE_PCT } from '@/lib/fees'
import { PLAN_BY_ID, TASTE } from '@/lib/plans'

// Social card for /pricing (og:image + twitter:image via ./twitter-image.tsx).
// Before this file the page unfurled as a bare headline: its own openGraph
// block replaced the root's, and no picture rode along. The card is the
// pricing page in five rows, every figure read from lib/fees + lib/plans.

export const runtime = 'nodejs'
export const alt = `Pantessa pricing — looking is free, a trade costs ${SWAP_FEE_PCT}, taken inside the trade you sign.`
export const size = CLAIM_CARD_SIZE
export const contentType = 'image/png'

export default function Image() {
  return claimCardImage({
    tag: 'PRICING',
    eyebrow: ['NO SUBSCRIPTION TO LOOK'],
    line1: 'Looking is free.',
    line2: `Trading is ${SWAP_FEE_PCT}.`,
    under: ['TAKEN INSIDE THE TRADE YOU SIGN', 'YOUR WALLET SIGNS'],
    tableTitle: 'THE WHOLE PRICE LIST',
    tableNote: 'NO METERS',
    rows: [
      { label: 'Charts, watchlists, alerts', value: '$0', strong: true },
      { label: 'A trade you sign', value: SWAP_FEE_PCT },
      { label: 'Chat answers, every day', value: `${TASTE.wallet} free` },
      { label: 'Plus, for heavy askers', value: `$${PLAN_BY_ID.plus.priceUsd} / mo` },
      { label: 'Your own AI key', value: 'free' },
      { label: 'Share a link, earn', value: `${Math.round(CREATOR_FEE_SPLIT * 100)}% of the fee`, strong: true },
    ],
    foot: 'ONE SPLIT, EVERY ACCOUNT',
    path: '/pricing',
  })
}
