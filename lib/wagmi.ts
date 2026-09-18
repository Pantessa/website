import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  metaMaskWallet,
  phantomWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig } from 'wagmi'
import { WALLET_CHAINS, walletTransports } from '@/lib/wallet-chains'
import { cdpEmbeddedConnector, cdpEnabled } from '@/lib/cdp-embedded'
import { hostWalletConnector } from '@/lib/host-wallet'
import { walletLineup, WC_APP_METADATA, type WalletLaneId } from '@/lib/wallet-lineup'
import { requestWalletAppOpen } from '@/lib/wallet-handoff'

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

/**
 * MetaMask on a PHONE: we own the jump to the app.
 *
 * `metaMaskWallet` switches to the wagmi `metaMask()` connector — the MetaMask
 * SDK — whenever RainbowKit's `isMobile()` is true, and the SDK brings the app
 * forward by navigating the page to a `metamask://…` link on every method that
 * needs approval. Both mobile browsers only honour an app launch while the
 * page holds a user activation, so the launch landed for the CONNECT tap and
 * was dropped for the signature that lib/session fires from its post-connect
 * effect: connected, then a page that says "waiting for your signature" beside
 * a wallet that was never brought up (Nate, 2026-09-18).
 *
 * `openDeeplink` is the SDK's own hook for this (`preferredOpenLink`): with it
 * set the SDK hands us the link and never navigates itself. lib/wallet-handoff
 * tries the launch, and when the browser refuses, puts a button on screen —
 * a tap carries the activation the effect didn't have.
 *
 * Set as a property on the wallet FACTORY because that is RainbowKit's own
 * escape hatch for SDK options (it spreads its own enumerable properties into
 * `metaMask({…})`, last, so ours win) — the same door `coinbaseWallet
 * .preference` goes through above. It must be assigned before
 * `connectorsForWallets` runs, which is why it lives here and not in a
 * component. Inert off mobile: the desktop lanes are the injected provider or
 * WalletConnect, and neither ever asks to open an app.
 */
;(metaMaskWallet as unknown as { openDeeplink: (link: string) => void }).openDeeplink =
  requestWalletAppOpen

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
  // Injected-only (namespace `phantom.ethereum`); RainbowKit dedupes it
  // against the EIP-6963 announce by rdns, so an installed Phantom lists once.
  phantom: phantomWallet,
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
  // The chain list + transports live in lib/wallet-chains.ts, shared with the
  // CDP embedded-wallet connector so the two can never drift (the drift is
  // exactly what walled account-holders off Ethereum — see that file).
  chains: WALLET_CHAINS,
  transports: walletTransports(),
  ssr: true,
})
