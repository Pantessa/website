'use client'

// Fires the wallet_connected analytics event (address is recorded by
// design — pseudonymous public chain data, used as the funnel id).

import { useAccountEffect } from 'wagmi'
import { analytics } from '@/lib/analytics'
import { setJourneyWallet } from '@/lib/journey'

export default function TrackWallet() {
  useAccountEffect({
    onConnect({ address, connector }) {
      // Before the event, so the batch that carries it names the wallet.
      setJourneyWallet(address)
      analytics.walletConnected(address, connector?.name)
    },
    onDisconnect() {
      setJourneyWallet(null)
    },
  })
  return null
}
