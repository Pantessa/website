import {
  connectorsForWallets,
  type Wallet,
  type WalletDetailsParams,
} from '@rainbow-me/rainbowkit'
import {
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http, createConnector } from 'wagmi'
import { mainnet, polygon, optimism, arbitrum, base } from 'wagmi/chains'
import { coinbaseWallet as coinbaseConnector } from 'wagmi/connectors'

// WalletConnect Cloud project ID — create one at https://cloud.reown.com and
// add it to .env.local as NEXT_PUBLIC_WC_PROJECT_ID (needed for the
// WalletConnect / mobile-QR option).
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'YOUR_WALLETCONNECT_PROJECT_ID'

const COINBASE_ICON =
  'data:image/svg+xml,%3Csvg%20width%3D%2228%22%20height%3D%2228%22%20viewBox%3D%220%200%2028%2028%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%2228%22%20height%3D%2228%22%20fill%3D%22%232C5FF6%22%2F%3E%3Cpath%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%20d%3D%22M14%2023.8C19.4124%2023.8%2023.8%2019.4124%2023.8%2014C23.8%208.58761%2019.4124%204.2%2014%204.2C8.58761%204.2%204.2%208.58761%204.2%2014C4.2%2019.4124%208.58761%2023.8%2014%2023.8ZM11.55%2010.8C11.1358%2010.8%2010.8%2011.1358%2010.8%2011.55V16.45C10.8%2016.8642%2011.1358%2017.2%2011.55%2017.2H16.45C16.8642%2017.2%2017.2%2016.8642%2017.2%2016.45V11.55C17.2%2011.1358%2016.8642%2010.8%2016.45%2010.8H11.55Z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E'

/**
 * Coinbase Wallet pinned to the in-page **extension (EOA)** flow.
 *
 * RainbowKit's default Coinbase connector uses Smart Wallet (`preference: 'all'`),
 * which signs via a popup/redirect to keys.coinbase.com. That broke the paid
 * chat: the 2nd signature in a turn runs after an `await` (no longer a user
 * gesture), so the browser blocks the popup and the SDK reports "User rejected";
 * the redirect variant also bounced users to "/" mid-payment. Forcing
 * `preference: 'eoaOnly'` keeps connect + every signature in-page through the
 * installed extension, which queues sequential signs reliably.
 */
const coinbaseExtensionWallet = (): Wallet => ({
  id: 'coinbaseExtension',
  name: 'Coinbase Wallet',
  iconUrl: COINBASE_ICON,
  iconBackground: '#2C5FF6',
  installed: true,
  downloadUrls: { browserExtension: 'https://www.coinbase.com/wallet/downloads' },
  createConnector: (walletDetails: WalletDetailsParams) => {
    const connector = coinbaseConnector({ appName: 'Yeetful', preference: 'eoaOnly' })
    return createConnector((config) => ({
      ...connector(config),
      ...walletDetails,
    }))
  },
})

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [
        injectedWallet,
        metaMaskWallet,
        coinbaseExtensionWallet,
        rainbowWallet,
        walletConnectWallet,
      ],
    },
  ],
  { appName: 'Yeetful', projectId },
)

export const wagmiConfig = createConfig({
  connectors,
  chains: [mainnet, polygon, optimism, arbitrum, base],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
  },
  ssr: true,
})
