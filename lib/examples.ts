// Curated example asks for the chat — shown on the empty state (and reusable
// on the landing). These are ONE-TAP RUN chips: clicking one sends the ask as
// a real turn (asking is free; anything transactional still ends at the
// user's own wallet signature, so an auto-sent ask can never move money).
// `slug` is the MCP the ask leans on — when it's already in the working set
// the chip runs; when it would need a toggle first, the UI falls back to
// prefilling so the set change lands before the send.
//
// Keep these mapped to what actually converts (the pivot surfaces): the $1
// guarded swap, the DCA schedule, the Guardian stop-loss, the portfolio card.

export interface ExamplePrompt {
  /** Short chip label. */
  label: string
  /** The full message the chip sends. */
  prompt: string
  /** MCP slug the ask leans on, when it isn't a native layer. */
  slug?: string
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    // The guarded-build aha: a real artifact in one tap. Native swap layer —
    // no MCP toggle needed; signed-out visitors get the connect-wallet moment.
    label: 'Swap $1 of ETH to USDC',
    prompt: 'Swap $1 of ETH to USDC',
  },
  {
    // The portfolio card — the "it can see my wallet" moment.
    label: 'Show my portfolio',
    prompt: "What's in my wallet?",
    slug: 'yeetful-tool-wallet',
  },
  {
    // Standing intent in one sentence (lib/dca) — native layer; teaches that
    // "every week" is a thing you can SAY here.
    label: 'DCA $10 into AAPL weekly',
    prompt: 'Buy $10 of AAPL every week on Robinhood Chain',
  },
  {
    // The Guardian: autonomous protection via a revocable delegated key.
    label: 'Protect my Hyperliquid position',
    prompt: 'Set a stop-loss on my ETH position at -8%',
    slug: 'hyperliquid-free',
  },
  {
    // Zero-friction data ask — works signed-out, no wallet involved.
    label: 'ETH price right now',
    prompt: 'What is the current price and 24h change for ETH?',
    slug: 'uniswap-free',
  },
]

/** Per-MCP "try it" asks for /chat?try=<slug> deep links (the /servers rows
 *  and detail pages). Every free-fleet MCP lands with a concrete, runnable
 *  ask prefilled instead of a "Try X: " stub. */
export const TRY_PROMPTS: Record<string, string> = {
  'uniswap-free': 'Quote 100 USDC to WETH on Base — which fee tier is best?',
  'snapshot-free': 'List the recent active proposals in the aave.eth Snapshot space.',
  'cow-free': 'Quote 100 USDC to WETH on CoW — and how does MEV protection work here?',
  'hyperliquid-free': 'How is the ETH perp doing — price, funding, open interest?',
  'opensea-free': 'Show the NFTs in my wallet.',
  'yeetful-tool-wallet': "What's in my wallet?",
  'robinhood-free': 'Buy $2 of AAPL',
  'near-intents-mcp-yeetful': 'Swap 1 USDC from Base to Arbitrum.',
  aave: 'What are the current supply APYs on Aave?',
  'lido-free': "What is Lido's current staking APR — and what would staking 0.1 ETH earn?",
}
