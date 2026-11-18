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

import { Check, CreditCard, Loader2, X } from 'lucide-react'
import { PantessaMark } from '@/components/Logo'
import { ONRAMP_NETWORK_LABEL } from '@/lib/onramp'
import { arrivalPhrase } from '@/lib/funding-arrival'
import { useCardFund } from '@/lib/use-card-fund'
import { railFundOptionsFor } from '@/lib/watchlists'

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
  // The door's state and the buy itself live in lib/use-card-fund (the Apps
  // page's first-run screen is the other door on it).
  const { phase, offer, busy, error, wait, watch, landed, buy, startOver, checkoutHref, dismissLanded } = useCardFund({ holder, empty, cardFunding, onLanded })
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
          <button type="button" className="wl__icon wl__fundClose" aria-label="Dismiss" onClick={dismissLanded}>
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
          {!stopped && checkoutHref && (
            <>
              Lost the tab?{' '}
              <a className="wl__link" href={checkoutHref} target="_blank" rel="noopener noreferrer" data-rail-fund-reopen="">
                Open Stripe again
              </a>
              {'. '}
            </>
          )}
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
