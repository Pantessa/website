import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, polygon, optimism, arbitrum, base } from 'wagmi/chains'

// WalletConnect Cloud project ID — create one at https://cloud.reown.com
// and add it to .env.local as NEXT_PUBLIC_WC_PROJECT_ID.
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'YOUR_WALLETCONNECT_PROJECT_ID'

export const wagmiConfig = getDefaultConfig({
  appName: 'Yeetful',
  projectId,
  chains: [mainnet, polygon, optimism, arbitrum, base],
  ssr: true,
})
