// THE TOUR · ASK (lane SIDES-A owns this file). Rules: lib/home-tour/types.ts.
// The four sentences are the composer's example rows (components/home/tour/
// sides/Ask.tsx draws them beside the app that catches each); every one is a
// native layer's own phrasing and passes lane DATA's served sentence audit
// ("Stake 0.05 ETH" alone only reached the intent net: the venue word stays).
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'ask',
  label: 'Ask',
  claim: 'Say it. It builds.',
  line: 'Every dapp in one chat, in plain English.',
  body: 'Type what you want done. A deterministic builder for that venue writes the transaction, guards check it, and your wallet signs. The model never writes calldata.',
  facts: ['{apps} apps ready from the first message', 'A wallet is asked for when you act, never to look', 'Every build names its venue and its fee before you sign'],
  doors: [
    { label: 'Open the chat', href: '/chat', kind: 'primary' },
    { label: 'Browse the apps', href: '/chat?tab=mcps', kind: 'quiet' },
  ],
  asks: [
    { ask: 'Swap $20 of ETH to USDC on Base', label: 'Swap $20 of ETH to USDC', via: 'Uniswap' },
    { ask: 'Buy $25 of AAPL', label: 'Buy $25 of AAPL', via: 'Robinhood Chain' },
    { ask: 'Stake 0.05 ETH on Lido', label: 'Stake 0.05 ETH', via: 'Lido' },
    { ask: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 10% stop', label: 'Long UNI 2x with a stop', via: 'a two-step job' },
  ],
}
