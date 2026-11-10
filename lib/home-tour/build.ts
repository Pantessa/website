// THE TOUR · BUILD (lane SIDES-B owns this file). First-draft words from the
// contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'build',
  label: 'Build',
  claim: 'Put it on your site. Hand it to your agent.',
  line: 'Embed the chat, or give an agent the desk.',
  body: 'The chat embeds in a few lines and signs with your visitors’ own wallets. An agent gets the desk: it proposes guarded intents and a person signs them.',
  facts: ['{venues} venues and {pinnedAddresses} pinned contract addresses, published', 'The model never writes calldata or an address', 'Creators and hosts are paid from the same fee'],
  doors: [
    { label: 'Read the docs', href: '/docs', kind: 'primary' },
    { label: 'Embed the chat', href: '/docs/embed', kind: 'quiet' },
    { label: 'The agent desk', href: '/docs/desk', kind: 'quiet' },
  ],
  asks: [],
}
