import { claimCardImage, CLAIM_CARD_SIZE } from '@/lib/og-claim-card'

// Social card for /community (og:image + twitter:image via ./twitter-image.tsx):
// what the feed holds, in the house claim card (lib/og-claim-card, the mark
// from lib/og-marks). Static words only: a card is not the place for a count
// that could be stale or small.

export const runtime = 'nodejs'
export const alt = 'The Pantessa community: chart ideas stamped with the time and the price, videos, and trades the chain confirmed.'
export const size = CLAIM_CARD_SIZE
export const contentType = 'image/png'

export default function Image() {
  return claimCardImage({
    tag: 'COMMUNITY',
    eyebrow: ['PUBLIC TO READ'],
    line1: 'Post the call.',
    line2: 'Show the trade.',
    under: ['VOTED BY TRADERS', 'YOUR WALLET SIGNS'],
    tableTitle: 'WHAT A POST CAN BE',
    tableNote: 'FOUR KINDS',
    rows: [
      { label: 'A chart idea', value: 'time + price stamped', strong: true },
      { label: 'A trade', value: 'verified on-chain', strong: true },
      { label: 'A video', value: 'YouTube, Vimeo, Loom' },
      { label: 'A link', value: 'any https page' },
      { label: 'Joining a room', value: 'one tap' },
      { label: 'Acting on a card', value: 'from your wallet' },
    ],
    foot: 'RANKED HOT, NEW, TOP',
    path: '/community',
  })
}
