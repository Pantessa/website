// THE TOUR · WALLET (lane SIDES-B owns this file). Rules: lib/home-tour/types.ts.
//
// Where each claim is implemented (checked 2026-11-10):
//   • "your balances on {chains} chains in one view … priced, with gas and
//     recent transfers" — app/wallet/page.tsx DESCRIPTION: "Every chain your
//     wallet holds money on, priced: gas per chain, recent transfers, and the
//     ways in and out. Your wallet stays the only signer."
//   • "funded from another chain in the same flow" — lib/funding-plan.ts
//     header: "'insufficient funds' is an offer, never a wall … an unfunded
//     buy scans the wallet, offers chips, and the pick compiles into a job
//     (fund → wait → act)"; the origins are lib/funding-plan
//     FUNDING_SCAN_CHAINS and lib/funding-origins FUNDING_ORIGIN_CHAINS
//     (Base, Arbitrum, Optimism, Ethereum), so the line says "another chain",
//     never "any chain".
//   • "sign in with a wallet, Google or email" — components/CreateAccountButton
//     (the unified door; standing rule 6).
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'wallet',
  label: 'Wallet',
  claim: 'Every chain, one window.',
  line: 'See what you hold. Fund a buy from another chain.',
  body: 'Your balances on {chains} chains in one view. Short on the chain a buy needs? It can be funded from another chain in the same flow.',
  facts: ['Your own wallet: Pantessa never holds your money', 'Each chain priced, with its gas and recent transfers', 'Sign in with a wallet, Google or email'],
  doors: [
    { label: 'Open your wallet', href: '/wallet', kind: 'primary' },
    { label: 'How a transaction is built', href: '/docs/transactions', kind: 'quiet' },
  ],
  asks: [],
}
