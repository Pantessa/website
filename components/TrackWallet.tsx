'use client'

// Fires the wallet_connected analytics event (address is recorded by
// design — pseudonymous public chain data, used as the funnel id).

import { useAccountEffect } from 'wagmi'
import { analytics } from '@/lib/analytics'

export default function TrackWallet() {
  useAccountEffect({
    onConnect({ address, connector }) {
      analytics.walletConnected(address, connector?.name)
    },
  })
  return null
}
