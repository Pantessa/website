// THE TOUR · COMMUNITY (lane SIDES-B owns this file). First-draft words from
// the contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'community',
  label: 'Community',
  claim: 'Calls with receipts.',
  line: 'Rooms, ideas, and trades proved on-chain.',
  body: 'Join a room in one tap and post an idea, a chart or a trade. A trade post carries proof read from the chain: this wallet moved this much in this transaction.',
  facts: ['Joining a room takes one tap', 'A trade’s proof is read from the chain, never typed', 'Free to read: no account needed'],
  doors: [
    { label: 'Open the community', href: '/community', kind: 'primary' },
    { label: 'Start a room', href: '/g/new', kind: 'quiet' },
    { label: 'Post a trade with proof', href: '/community?compose=trade', kind: 'quiet' },
  ],
  asks: [],
}
