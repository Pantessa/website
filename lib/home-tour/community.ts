// THE TOUR · COMMUNITY (lane SIDES-B owns this file). Rules: lib/home-tour/types.ts.
//
// Where each claim is implemented (checked 2026-11-10):
//   • "one tap and needs no wallet" — app/docs/community "Joining": "Joining
//     is one tap and never needs a wallet. A member is a proven identity: a
//     sign-in (wallet, Google or email)…"; lib/community/spec.ts header.
//   • "read from the chain, never typed" — lib/community/proof.ts header:
//     "Everything a stranger reads as a fact is then READ FROM THE CHAIN at
//     post time: the dollars this wallet moved, net, in that transaction."
//   • "reading needs no wallet and no account" — app/docs/community lead;
//     lib/app-entry.ts isPublicAppPath (/community, /g, /g/<slug>).
// No Telegram, no Discord here: no bot exists on prod.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'community',
  label: 'Community',
  claim: 'Calls with receipts.',
  line: 'Rooms, ideas, and trades proved on-chain.',
  body: 'Join a room and post a chart idea, a link, a video or a trade. A trade post carries a line read from the chain: this wallet moved this much, in this transaction.',
  facts: ['Joining a room is one tap and needs no wallet', 'A trade’s dollars are read from the chain, never typed', 'Reading needs no wallet and no account'],
  doors: [
    { label: 'Open the community', href: '/community', kind: 'primary' },
    { label: 'Start a room', href: '/g/new', kind: 'quiet' },
    { label: 'Post a trade with proof', href: '/community?compose=trade', kind: 'quiet' },
  ],
  asks: [],
}
