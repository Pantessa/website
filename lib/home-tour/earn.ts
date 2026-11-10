// THE TOUR · EARN (lane SIDES-A owns this file). First-draft words from the
// contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'earn',
  label: 'Earn',
  claim: 'See the best live rate, then take it.',
  line: 'Lido, Aave and Morpho rates, side by side.',
  body: 'What an asset can earn today: each venue’s own live rate, the same for everyone. Pick an amount and tap a row; the sentence is the order and your wallet signs.',
  facts: ['{earnWays} ways to earn across Lido, Aave and Morpho', 'Rates are the venues’ own, read live'],
  doors: [{ label: 'See every rate', href: '#earn', kind: 'primary' }],
  asks: [{ ask: 'Stake 0.05 ETH', label: 'Stake 0.05 ETH', via: 'Lido' }],
}
