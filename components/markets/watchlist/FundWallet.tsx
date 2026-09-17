'use client'

// The watchlist rail's card door (2026-09-16, Nate: "when signed in with an
// account with no tokens can we add a buy ETH or USDC using stripe call out
// and linkage here"). A wallet the holdings read finds empty gets Buy ETH /
// Buy USDC in the rail, or only the ones this visitor's checkout can sell: a
// euro checkout gets Buy ETH alone, because Stripe can't price USDC in euros
// (2026-09-17, lib/watchlists railFundOptionsFor). The buy goes through the
// same signed Stripe door as the chat's fund chip and the Wallet panel
// (lib/onramp-client). Then the door
// watches the chain for the purchase (lib/funding-arrival): a buyer back from
// the Stripe tab sees the wait, not the button again, because a second tap is
// a second charge. When the money lands it says so and has the rail read the
// wallet again, which puts the ETH on the list.
//
// The wait this door writes has an EMPTY resume. There is no ask to continue,
// and no chat chip carries an empty resume, so a chip never adopts it. A
// chip's own wait (a purchase started in chat) shows here while the wallet is
// still empty, since it's the same money on its way, but only the chat clears
// it: the chat continues that ask when the money lands.

import { useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { Check, CreditCard, Loader2, X } from 'lucide-react'
import { PantessaMark } from '@/components/Logo'
import { startOnrampSession } from '@/lib/onramp-client'
import { ONRAMP_NETWORK_LABEL, type OnrampAsset } from '@/lib/onramp'
import { arrivalPhrase, clearFundWait, loadFundWait, saveFundWait, type Arrival, type FundWait } from '@/lib/funding-arrival'
import { useFundingArrival } from '@/lib/use-funding-arrival'
import { useOnrampOffer } from '@/lib/use-onramp-offer'
import { RAIL_FUND_PRESET_USD, railFundOptionsFor, railFundPhase, type RailFundOption } from '@/lib/watchlists'

export interface FundWalletProps {
  /** The wallet the rail's holdings read (null: no wallet behind the rail). */
  holder: string | null
  /** That read settled and found nothing in the wallet. */
  empty: boolean
  /** This deployment can mint a Stripe session. */
  cardFunding: boolean
  /** Money landed: read the wallet again now. */
  onLanded: () => void
}

export default function FundWallet({ holder, empty, cardFunding, onLanded }: FundWalletProps) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  // The consent is signed by the CONNECTED wallet, so the door opens only
  // when that's the wallet the rail read (an account switch reads first).
  const wallet = !!address && !!holder && address.toLowerCase() === holder.toLowerCase()
  const [busy, setBusy] = useState<OnrampAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState<FundWait | null>(null)
  const [landed, setLanded] = useState<{ arrival: Arrival; stableSymbol: string; chain: string } | null>(null)

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
    }
    saveFundWait(w)
    setWait(w)
  }

  // Closed the Stripe tab without buying: back to the buttons. A chat chip's
  // wait stays stored for the chat.
  const startOver = () => {
    if (wait?.resume === '') clearFundWait(wait.address)
    setWait(null)
  }

  const phase = railFundPhase({ wallet, empty, cardFunding, waiting: watching, landed: !!landed })
  // Which buttons this visitor's checkout can actually sell, read only when the
  // door would offer them (lib/onramp WHAT A CHECKOUT CAN SELL).
  const offer = useOnrampOffer(phase === 'offer')
  if (!phase) return null

  if (phase === 'landed' && landed) {
    const ethIn = landed.arrival.deltaEth > 0
    return (
      <div className="wl__fund" role="status" data-rail-fund="landed">
        <div className="wl__fundHead">
          <Check className="wl__fundIcon" strokeWidth={3} aria-hidden />
          <span className="wl__fundTitle">
            {arrivalPhrase(landed.arrival, landed.stableSymbol)} landed on {landed.chain}
          </span>
          <button type="button" className="wl__icon wl__fundClose" aria-label="Dismiss" onClick={() => setLanded(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="wl__fundText">
          {ethIn ? 'It’s in your wallet, and it pays its own gas.' : `It’s in your wallet. Moving it takes a little ETH on ${landed.chain} for gas.`}
        </p>
      </div>
    )
  }

  if (phase === 'watching' && wait) {
    const chain = ONRAMP_NETWORK_LABEL[wait.network] ?? wait.network
    const stopped = watch.status === 'timeout'
    return (
      <div className="wl__fund" role="status" data-rail-fund="watching">
        <div className="wl__fundHead">
          <span className="wl__fundMark" aria-hidden>
            <PantessaMark size={22} weight="icon" bandClassName="wl__brewBand" />
          </span>
          <span className="wl__fundTitle">{stopped ? `Stopped watching ${chain}` : `Watching ${chain} for your ${wait.asset ?? 'card purchase'}`}</span>
        </div>
        <p className="wl__fundText">
          {stopped
            ? 'If the purchase went through, it still lands in this wallet.'
            : watch.failures >= 3
              ? `${chain} isn’t answering right now. Still watching.`
              : 'Finish the purchase in the Stripe tab. This updates the moment it lands.'}
        </p>
        <p className="wl__fundNote">
          Closed it without buying?{' '}
          <button type="button" className="wl__link" onClick={startOver}>
            Start over
          </button>
        </p>
      </div>
    )
  }

  // Nothing until the offer is read: a button that shows and then vanishes is
  // worse than a door that appears a moment later.
  if (offer === undefined) return null
  const options = railFundOptionsFor(offer)
  if (!options.length) return null
  const chain = ONRAMP_NETWORK_LABEL[options[0].network]
  const stable = options.some((o) => o.asset !== 'ETH')
  return (
    <div className="wl__fund" data-rail-fund="offer">
      <div className="wl__fundHead">
        <CreditCard className="wl__fundIcon" aria-hidden />
        <span className="wl__fundTitle">Fund your wallet</span>
      </div>
      <p className="wl__fundText">
        Buy {options.map((o) => o.asset).join(' or ')} with a card or bank. It lands in this wallet on {chain}.
      </p>
      <div className="wl__fundActs">
        {options.map((o, i) => (
          <button
            key={o.asset}
            type="button"
            className={`wl__chip${i === 0 ? ' wl__chip--accent' : ''}`}
            disabled={!!busy}
            data-fund-asset={o.asset}
            onClick={() => void buy(o)}
          >
            {busy === o.asset && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>
      <p className="wl__fundNote">Via Stripe. ETH covers its own gas{stable ? '; USDC needs a little ETH to move' : ''}.</p>
      {error && <p className="wl__err">{error}</p>}
    </div>
  )
}
