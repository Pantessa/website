'use client'

// One card door's state (moved out of components/markets/watchlist/FundWallet
// when the Apps page's first-run screen became the second door, 2026-11-18).
// The door buys through the signed Stripe session, then watches the chain, so
// a buyer back from the Stripe tab sees the wait and not the button again: a
// second tap is a second charge. Each door draws this its own way.
//
// The wait this hook writes has an EMPTY resume. There is no ask to continue,
// and no chat chip carries an empty resume, so a chip never adopts it. A
// chip's own wait shows here while the wallet is still empty, since it's the
// same money on its way, but only the chat clears it.

import { useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { startOnrampSession } from '@/lib/onramp-client'
import type { OnrampAsset } from '@/lib/onramp'
import { clearFundWait, fundCheckoutHref, loadFundWait, saveFundWait, type Arrival, type FundWait } from '@/lib/funding-arrival'
import { useFundingArrival } from '@/lib/use-funding-arrival'
import { useOnrampOffer } from '@/lib/use-onramp-offer'
import { RAIL_FUND_PRESET_USD, railFundPhase, type RailFundOption } from '@/lib/watchlists'

export interface CardFundInput {
  /** The wallet the holdings read covers (null: no wallet behind the door). */
  holder: string | null
  /** That read settled and found nothing in the wallet. */
  empty: boolean
  /** This deployment can mint a Stripe session. */
  cardFunding: boolean
  /** Money landed: read the wallet again now. */
  onLanded: () => void
}

export interface CardFundLanding {
  arrival: Arrival
  stableSymbol: string
  chain: string
}

export function useCardFund({ holder, empty, cardFunding, onLanded }: CardFundInput) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  // The consent is signed by the CONNECTED wallet, so the door opens only
  // when that's the wallet the read covered (an account switch reads first).
  const wallet = !!address && !!holder && address.toLowerCase() === holder.toLowerCase()
  const [busy, setBusy] = useState<OnrampAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState<FundWait | null>(null)
  const [landed, setLanded] = useState<CardFundLanding | null>(null)

  // A purchase already on its way to this wallet: this door's own (after a
  // reload, or back an hour later) or a chat chip's.
  useEffect(() => {
    setWait(wallet && address ? loadFundWait(address) : null)
    setLanded(null)
    setError(null)
  }, [wallet, address])

  const own = wait?.resume === ''
  const watching = !!wait && !landed && (own || empty)
  const watch = useFundingArrival(wait, wallet && watching)

  useEffect(() => {
    if (watch.status !== 'arrived' || !watch.arrival || !wait) return
    setLanded({ arrival: watch.arrival, stableSymbol: watch.stableSymbol, chain: watch.chainName })
    if (wait.resume === '') clearFundWait(wait.address)
    setWait(null)
    onLanded()
  }, [watch.status, watch.arrival, watch.stableSymbol, watch.chainName, wait, onLanded])

  // A fresh read can still be the server's copy from up to 8s ago. If the
  // wallet reads empty after a landing, look once more.
  useEffect(() => {
    if (!landed || !empty) return
    const t = setTimeout(onLanded, 10_000)
    return () => clearTimeout(t)
  }, [landed, empty, onLanded])

  const buy = async (o: RailFundOption) => {
    if (!address || busy) return
    setError(null)
    setBusy(o.asset)
    // Called synchronously off the click: startOnrampSession opens the tab as
    // its first statement (a popup after an await is not a user gesture).
    const res = await startOnrampSession({
      address,
      fund: { presetFiatUsd: RAIL_FUND_PRESET_USD, asset: o.asset, network: o.network },
      signMessage: signMessageAsync,
    })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const w: FundWait = {
      address: address.toLowerCase(),
      network: o.network,
      asset: o.asset,
      resume: '',
      label: `${o.label} with a card`,
      baselineEth: null,
      baselineStable: null,
      openedAt: Date.now(),
      checkoutUrl: res.url,
    }
    saveFundWait(w)
    setWait(w)
  }

  // Closed the Stripe tab without buying: back to the buttons. A chat chip's
  // wait stays stored for the chat. (A buyer who lost the tab mid-purchase has
  // `checkoutHref` instead: the same checkout, so not a second charge.)
  const startOver = () => {
    if (wait?.resume === '') clearFundWait(wait.address)
    setWait(null)
  }

  const phase = railFundPhase({ wallet, empty, cardFunding, waiting: watching, landed: !!landed })
  // Which buttons this visitor's checkout can actually sell, read only when the
  // door would offer them (lib/onramp WHAT A CHECKOUT CAN SELL).
  const offer = useOnrampOffer(phase === 'offer')

  return { phase, offer, busy, error, wait, watch, landed, buy, startOver, checkoutHref: fundCheckoutHref(wait), dismissLanded: () => setLanded(null) }
}

export type CardFund = ReturnType<typeof useCardFund>
