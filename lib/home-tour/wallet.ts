// THE TOUR · WALLET (lane SIDES-B owns this file). First-draft words from the
// contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'wallet',
  label: 'Wallet',
  claim: 'Every chain, one window.',
  line: 'See what you hold. Fund a buy from any chain.',
  body: 'Your balances on {chains} chains in one view. Short on the chain a buy needs? It can be funded from another chain in the same flow.',
  facts: ['Your own wallet: Pantessa never holds your money', 'Stocks, coins, perps and yield positions in one list', 'Sign in with a wallet, Google or email'],
  doors: [
    { label: 'Open your wallet', href: '/wallet', kind: 'primary' },
    { label: 'How a transaction is built', href: '/docs/transactions', kind: 'quiet' },
  ],
  asks: [],
}
