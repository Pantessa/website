import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import { mainnet, base, baseSepolia, arbitrum, optimism } from 'wagmi/chains'
import { cdpEmbeddedConnector, cdpEnabled } from '@/lib/cdp-embedded'
import { hostWalletConnector } from '@/lib/host-wallet'
import { walletLineup, WC_APP_METADATA, type WalletLaneId } from '@/lib/wallet-lineup'

// WalletConnect Cloud project ID — create one at https://cloud.reown.com and
// add it to .env.local as NEXT_PUBLIC_WC_PROJECT_ID (needed for the
// WalletConnect / mobile-QR option). The lineup decision itself lives in
// lib/wallet-lineup.ts (pure) so the harness pins BOTH env states:
// absent = exactly today's connectors, present = the WC v2 lanes join.
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'YOUR_WALLETCONNECT_PROJECT_ID'

const lineup = walletLineup(process.env.NEXT_PUBLIC_WC_PROJECT_ID)

/**
 * Coinbase Wallet pinned to the **EOA** flow (no Smart Wallet).
 *
 * Smart Wallet (`preference: 'all'`) signs via a popup/redirect to
 * keys.coinbase.com, which broke the paid chat: the 2nd signature in a turn
 * runs after an `await` (no longer a user gesture), so the browser blocks the
 * popup; the redirect variant bounced users to "/" mid-payment. `eoaOnly`
 * keeps connect + every signature in-page through the extension.
 *
 * We use RainbowKit's OFFICIAL coinbaseWallet (static `preference` config)
 * rather than a hand-rolled Wallet. The previous custom connector hardcoded
 * `installed: true` and always forced the Coinbase SDK transport — when the SDK
 * couldn't reach the extension (multi-wallet injection conflicts, non-Chrome
 * browsers), connect hung forever on "Opening Coinbase Wallet…" with no prompt.
 * The official wallet detects the extension properly, carries the EIP-6963
 * rdns metadata (deduped against the auto-discovered "Installed" entry), and
 * shows a sane get-the-extension UX when it genuinely can't connect.
 * (coinbaseWallet is deprecated upstream in favor of `baseAccount` — that's the
 * Smart Wallet path we explicitly avoid, so stay on coinbaseWallet until the
 * popup-after-await problem has another answer.)
 */
coinbaseWallet.preference = 'eoaOnly'

// The CDP embedded-wallet connector ("create an account") is appended as a plain
// wagmi connector, not a RainbowKit modal entry — it's driven by a dedicated CTA
// (see lib/cdp-embedded.ts). Only included when NEXT_PUBLIC_CDP_PROJECT_ID is set.
// lane id → RainbowKit wallet factory. The ORDER comes from walletLineup —
// the pinned pure decision — so env-absent is byte-identical to before.
// (Factory param signatures differ per wallet; connectorsForWallets supplies
// them — the list type is what matters here.)
const WALLET_FACTORIES: Record<WalletLaneId, Parameters<typeof connectorsForWallets>[0][number]['wallets'][number]> = {
  injected: injectedWallet,
  metaMask: metaMaskWallet,
  coinbase: coinbaseWallet,
  rainbow: rainbowWallet,
  walletConnect: walletConnectWallet,
}

const connectors = [
  ...connectorsForWallets(
    [
      {
        groupName: 'Recommended',
        wallets: lineup.map((id) => WALLET_FACTORIES[id]),
      },
    ],
    // The site's own metadata rides the WC v2 pairing screen (a mobile
    // wallet shows appName/description/icon before the user approves).
    { projectId, ...WC_APP_METADATA },
  ),
  ...(cdpEnabled ? [cdpEmbeddedConnector] : []),
  // Host-wallet bridge connector for /embed (wallet contract v1.1) — registered
  // globally because there's one wagmi config for the whole app, but inert
  // outside a bridged iframe: no icon (so RainbowKit never lists it in the
  // Connect Wallet modal — same isEIP6963Connector bar the CDP connector ducks
  // under), isAuthorized() false without a host 'wallet' announce, and only
  // EmbedChat connects it programmatically.
  hostWalletConnector(),
]

// Robinhood Chain's definition moved to lib/chains.ts (the app chain
// registry) so server code can use it without pulling in wallet connectors;
// re-exported here for back-compat.
import { robinhoodChain } from '@/lib/chains'
export { robinhoodChain }

export const wagmiConfig = createConfig({
  connectors,
  // Base is the primary chain we transact on (x402 payments). Mainnet is included
  // solely so RainbowKit can resolve ENS names/avatars — but its default RPC
  // (eth.merkle.io) rejects browser CORS preflights, which spammed the console
  // with retried ENS lookups, so pin it to a CORS-friendly public endpoint.
  // base.sepolia is included for the launchpad (testnet) — launching a token +
  // staking happen there until mainnet. Arbitrum + Robinhood Chain are here so
  // tx cards can switch the wallet + watch receipts on them (SendTxButton needs
  // a configured transport per tx.chainId, and switchChainAsync only knows the
  // chains in this list — the Switch Networks modal mirrors it).
  // Optimism is here for the same reason as Arbitrum: it's a funding origin,
  // so the wallet must be able to switch there to sign the deposit leg. A
  // chain the funding scanner can SEE but the wallet can't switch to is a
  // chip that walls at signature time.
  chains: [base, baseSepolia, mainnet, arbitrum, optimism, robinhoodChain],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [mainnet.id]: http('https://ethereum-rpc.publicnode.com'),
    [arbitrum.id]: http(),
    [optimism.id]: http('https://optimism-rpc.publicnode.com'),
    [robinhoodChain.id]: http(),
  },
  ssr: true,
})
