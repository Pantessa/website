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
  // The Guardian/jobs aha in one sentence — works for anyone with a little
  // Base USDC (no pre-existing position required, unlike the retired
  // /i/stop-loss chip, which assumed an open ETH perp; that link stays live
  // in the DB for anyone holding it, it's just no longer surfaced).
  {
    slug: 'protected-long',
    ask: 'Bridge 5 USDC from Base to Arbitrum, then deposit 4 USDC to Hyperliquid, then long $12 of ETH on Hyperliquid, then protect my ETH long with a 5% stop.',
    label: 'Fund, open & protect a position — one job',
  },
  { slug: 'bridge-usdc', ask: 'Swap 5 USDC from Base to Arbitrum', label: 'Move stables across chains' },
  { slug: 'my-nfts', ask: 'Show my NFTs', label: 'Browse your NFTs' },
]
