// THE TOUR · LINKS (lane SIDES-A owns this file). Rules: lib/home-tour/types.ts.
// The facts say what the miniature does not repeat (round 2): what a link can
// carry, which links pay (lib/fees NET_FEE_BPS_BY_BUILD_PATH: swaps and stock
// buys carry the link fee; staking and lending are fee-free paths, so they
// pay their creator nothing), and that minting needs a sign-in while opening
// one needs only a wallet (POST /api/intent-links answers 401 with no
// session; a link's reader connects and signs). The body already says whose
// wallet signs and whose half it is. The claim and the line promise a swap,
// never "every fill" (QA's honesty audit, round 2): a staking or lending
// link pays nothing, and a perp link pays nothing while Hyperliquid orders
// carry no builder fee.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'links',
  label: 'Links',
  claim: 'Any ask is a link. A swap through it pays you.',
  line: 'Share one sentence. Earn when a swap fills.',
  body: 'Mint a short link from one sentence. Whoever opens it connects their own wallet and signs; half of the {linkPct} link fee is yours for as long as the link lives.',
  facts: ['A link can carry a swap, a stock buy, a perp or a whole job', 'Swaps and stock buys pay the creator; staking and lending carry no fee', 'Minting needs a sign-in; opening a link needs only a wallet'],
  doors: [
    { label: 'Mint a link', href: '/chat?tab=links', kind: 'primary' },
    { label: 'See what people minted', href: '/links', kind: 'quiet' },
    { label: 'How creators get paid', href: '/docs/creator-earnings', kind: 'quiet' },
  ],
  asks: [],
}
