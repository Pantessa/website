// First-party "house" intent links — the canonical demo set, minted with
// deterministic slugs so landing CTAs and docs can reference them forever.
// Single source: the seed script (scripts/seed-house-links.ts), the landing
// lane (components/LinkLane.tsx), and the /links start-here strip all read
// THIS list. House links have creator=null: they earn nothing and never
// appear in any creator's dashboard — they exist so the leaderboard and the
// landing never demo an empty product.

export const HOUSE_LINKS: Array<{ slug: string; ask: string; label: string }> = [
  { slug: 'buy-aapl', ask: 'Buy $10 of AAPL', label: 'Buy a stock' },
  { slug: 'dca-eth', ask: 'DCA $25 into ETH weekly', label: 'Set a recurring buy' },
  { slug: 'stake-eth', ask: 'Stake 0.05 ETH with Lido', label: 'Stake ETH' },
  // The Guardian/jobs aha as a PURE intent — the visitor asks for the
  // position; the system discovers the empty HL account and offers the whole
  // funding path itself (deposit prepended, bridge legs from wherever the
  // USDC lives) as one job chip. The plumbing is the demo, not the ask.
  // Retired predecessors stay live in the DB, just unsurfaced: /i/stop-loss
  // (assumed an open position) and the verbose four-clause phrasing.
  {
    slug: 'protected-long',
    ask: 'Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop',
    label: 'Open & protect a position — funding handled for you',
  },
  { slug: 'bridge-usdc', ask: 'Swap 5 USDC from Base to Arbitrum', label: 'Move stables across chains' },
  { slug: 'my-nfts', ask: 'Show my NFTs', label: 'Browse your NFTs' },
]
