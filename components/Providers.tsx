'use client'

import { useState, type ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import TrackWallet from '@/components/TrackWallet'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { CDPHooksProvider } from '@coinbase/cdp-hooks'
import { wagmiConfig } from '@/lib/wagmi'
import { cdpConfig, cdpEnabled } from '@/lib/cdp-embedded'
import { SessionProvider } from '@/lib/session'

export default function Providers({ children }: { children: ReactNode }) {
  // one QueryClient per mount; useState ensures it isn't recreated on re-renders
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  const tree = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#ffffff',
            accentColorForeground: '#09090b',
            borderRadius: 'large',
            overlayBlur: 'small',
          })}
          modalSize="compact"
        >
          <SessionProvider>
            <TrackWallet />
            {children}
          </SessionProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )

  // CDP embedded-wallet hooks must wrap WagmiProvider (per the CDP wagmi docs).
  // Only mount it when the project ID is configured; otherwise the app runs
  // exactly as before (extension/WalletConnect wallets only).
  return cdpEnabled ? (
    <CDPHooksProvider config={cdpConfig}>{tree}</CDPHooksProvider>
  ) : (
    tree
  )
}
