import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import { mainnet, base } from 'wagmi/chains'

// WalletConnect Cloud project ID — create one at https://cloud.reown.com and
// add it to .env.local as NEXT_PUBLIC_WC_PROJECT_ID (needed for the
// WalletConnect / mobile-QR option).
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'YOUR_WALLETCONNECT_PROJECT_ID'

// WalletConnect-based wallets (WalletConnect, Rainbow, most mobile wallets)
// init the WC SignClient, which touches browser-only `indexedDB` during SSR —
// a fatal unhandledRejection under Next 16. They also don't work without a real
// project ID. So only enable them when one is configured; extension wallets
// (Coinbase, MetaMask, injected) work without WalletConnect.
const wcEnabled = !!process.env.NEXT_PUBLIC_WC_PROJECT_ID && projectId !== 'YOUR_WALLETCONNECT_PROJECT_ID'

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

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [
        injectedWallet,
        metaMaskWallet,
        coinbaseWallet,
        ...(wcEnabled ? [rainbowWallet, walletConnectWallet] : []),
      ],
    },
  ],
  { appName: 'Yeetful', projectId },
)

export const wagmiConfig = createConfig({
  connectors,
  // Base is the only chain we transact on (x402 payments). Mainnet is included
  // solely so RainbowKit can resolve ENS names/avatars — but its default RPC
  // (eth.merkle.io) rejects browser CORS preflights, which spammed the console
  // with retried ENS lookups, so pin it to a CORS-friendly public endpoint.
  chains: [base, mainnet],
  transports: {
    [base.id]: http(),
    [mainnet.id]: http('https://ethereum-rpc.publicnode.com'),
  },
  ssr: true,
})
