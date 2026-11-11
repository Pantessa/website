// THE TOUR · EARN (lane SIDES-A owns this file). Rules: lib/home-tour/types.ts.
// The panel's own sentences are the ladder's rows (each row carries the Earn
// board's own ask for the amount picked). The one static sentence here is the
// stake in the layer's full phrasing, venue word included (lane DATA's audit:
// "Stake 0.05 ETH" alone only reached the intent net).
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'earn',
  label: 'Earn',
  claim: 'See the best live rate, then take it.',
  line: 'Lido, Aave and Morpho rates, side by side.',
  body: 'What an asset can earn today: each venue’s own live rate, the same for everyone. Pick an amount and tap a row; the sentence is the order and your wallet signs.',
  facts: ['{earnWays} ways to earn across Lido, Aave and Morpho', 'Rates are the venues’ own, read live', 'Staking and lending carry no Pantessa fee'],
  doors: [{ label: 'See every rate', href: '/#earn', kind: 'primary' }],
  asks: [{ ask: 'Stake 0.05 ETH on Lido', label: 'Stake 0.05 ETH', via: 'Lido' }],
}
