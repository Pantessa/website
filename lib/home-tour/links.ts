// THE TOUR · LINKS (lane SIDES-A owns this file). First-draft words from the
// contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'links',
  label: 'Links',
  claim: 'Any ask is a link that pays you.',
  line: 'Share one sentence. Earn on every fill.',
  body: 'Mint a short link from one sentence. Whoever opens it connects their own wallet and signs; half of the {linkPct} link fee is yours for as long as the link lives.',
  facts: ['Half of every link fee goes to the creator', 'Readers keep custody: their wallet, their signature', 'A link can carry a swap, a stock buy, a perp or a whole job'],
  doors: [
    { label: 'Mint a link', href: '/chat?tab=links', kind: 'primary' },
    { label: 'See what people minted', href: '/links', kind: 'quiet' },
    { label: 'How creators get paid', href: '/docs/creator-earnings', kind: 'quiet' },
  ],
  asks: [],
}
