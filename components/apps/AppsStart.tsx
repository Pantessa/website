'use client'

// The Apps page's first run (lib/apps-start): a way to put money in, then what
// each app can do. An ask goes to the chat like every other button on the page;
// nothing here builds or signs a trade.
//
// Two numbered blocks. 01 is the money: a card buy or the address, and while a
// card purchase is on its way, the wait WITH its two ways out (the same Stripe
// checkout again, or back to the choices). 02 is the board: every app with its
// mark, a line on what it does, a live price where it has a market, and its
// asks. Asks that move money are marked and still go to the chat, whose
// funding step holds the ask until the money lands.

import { useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowUpRight, Check, Copy, CreditCard, ExternalLink, Loader2, QrCode } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import { Eyebrow } from '@/components/apps/parts'
import type { AppsStartState } from '@/components/apps/useAppsStart'
import type { StartCell } from '@/lib/apps-start'
import { fmtPct, fmtQuotePrice, useQuotes, type Quote } from '@/lib/markets-quotes'
import { ONRAMP_NETWORK_LABEL } from '@/lib/onramp'
import type { McpServer } from '@/lib/store'
import { cleanServerName } from '@/lib/utils'
import { RAIL_FUND_PRESET_USD, railFundOptionsFor } from '@/lib/watchlists'

export default function AppsStart({ address, start, onAsk }: { address: string; start: AppsStartState; onAsk: (prompt: string, slug: string) => void }) {
  const { fund, cells } = start
  const symbols = useMemo(() => cells.flatMap((c) => (c.quote ? [c.quote] : [])), [cells])
  const { quotes } = useQuotes(symbols)
  return (
    <div className="apg-start" data-apps-start={fund.phase ?? 'open'}>
      <p className="apg-start__lead apg-muted">Your apps do the work. Your wallet signs every move.</p>
      <div className="apg-start__step">
        <Eyebrow>
          <span className="apg-start__n">01</span>Add funds
        </Eyebrow>
        <FundBlock address={address} start={start} />
      </div>
      {cells.length > 0 && (
        <section className="apg-start__step" data-apps-start-list="apps">
          <Eyebrow>
            <span className="apg-start__n">02</span>Ask your apps
          </Eyebrow>
          <p className="apg-start__note">Questions are free and work right now. Anything that moves money waits for funds, then for your signature.</p>
          <div className="apg-start__grid">
            {cells.map((c) => (
              <AppCell key={c.family} cell={c} quote={c.quote ? quotes[c.quote] : undefined} onAsk={onAsk} />
            ))}
          </div>
        </section>
      )}
      {start.canHide && (
        <button type="button" className="apg-start__hide" onClick={start.hide} data-apps-start-hide="">
          Hide this guide
        </button>
      )}
    </div>
  )
}

function FundBlock({ address, start }: { address: string; start: AppsStartState }) {
  const { fund } = start
  const [showAddress, setShowAddress] = useState(false)

  if (fund.phase === 'landed' && fund.landed) {
    return (
      <section className="apg-start__fund" role="status" data-apps-start-fund="landed">
        <p className="apg-start__status">
          <Check width={16} height={16} aria-hidden /> It’s in your wallet on {fund.landed.chain}.
        </p>
        <div className="apg-start__acts">
          <button type="button" className="apg-btn apg-btn--strong" onClick={fund.dismissLanded}>
            Show my apps
          </button>
        </div>
      </section>
    )
  }

  if (fund.phase === 'watching' && fund.wait) {
    const chain = ONRAMP_NETWORK_LABEL[fund.wait.network] ?? fund.wait.network
    const stopped = fund.watch.status === 'timeout'
    // A wait can outlive its Stripe tab (closed, lost, never finished). The
    // way back is a button, not a line of small print: the SAME checkout
    // again when this wait kept it, and always the choices again.
    const checkout = stopped ? null : fund.checkoutHref
    return (
      <section className="apg-start__fund" role="status" data-apps-start-fund="watching">
        <p className="apg-start__status">
          {!stopped && <Loader2 width={16} height={16} className="animate-spin" aria-hidden />}
          {stopped ? `Stopped watching ${chain}` : `Watching ${chain} for your ${fund.wait.asset ?? 'card purchase'}`}
        </p>
        <p className="apg-start__note">
          {stopped
            ? 'If the purchase went through, it still lands in this wallet.'
            : fund.watch.failures >= 3
              ? `${chain} isn’t answering right now. Still watching.`
              : 'Finish the purchase in the Stripe tab. This page updates when it lands.'}
        </p>
        <div className="apg-start__acts">
          {checkout && (
            <a className="apg-btn apg-btn--strong" href={checkout} target="_blank" rel="noopener noreferrer" data-apps-start-reopen="">
              <ExternalLink width={14} height={14} aria-hidden />
              Open Stripe again
            </a>
          )}
          <button type="button" className={`apg-btn${checkout ? '' : ' apg-btn--strong'}`} onClick={fund.startOver} data-apps-start-over="">
            Start over
          </button>
        </div>
        <p className="apg-start__note">
          {checkout
            ? 'Lost the Stripe tab? Open Stripe again picks up the same checkout. Start over brings back the card and address choices.'
            : 'Didn’t finish at Stripe? Start over brings back the card and address choices.'}
        </p>
      </section>
    )
  }

  // ETH only: it pays its own gas, so it can trade the moment it lands. Nothing
  // shows until the offer is read, and a checkout that can't sell ETH keeps the
  // address.
  const eth = fund.phase === 'offer' && fund.offer !== undefined ? railFundOptionsFor(fund.offer).find((o) => o.asset === 'ETH') : undefined
  return (
    <section className="apg-start__fund" data-apps-start-fund="offer">
      <div className="apg-start__acts">
        {eth && (
          <button type="button" className="apg-btn apg-btn--strong" disabled={!!fund.busy} onClick={() => void fund.buy(eth)} data-apps-start-buy="ETH">
            {fund.busy ? <Loader2 width={14} height={14} className="animate-spin" aria-hidden /> : <CreditCard width={14} height={14} aria-hidden />}
            Buy ${RAIL_FUND_PRESET_USD} of ETH with card
          </button>
        )}
        <button type="button" className="apg-btn" aria-expanded={showAddress} onClick={() => setShowAddress((v) => !v)} data-apps-start-receive="">
          <QrCode width={14} height={14} aria-hidden />I have crypto: show my address
        </button>
      </div>
      {eth && (
        <p className="apg-start__note">
          Your wallet confirms the address, then Stripe opens. Change the amount at checkout. ETH on {ONRAMP_NETWORK_LABEL[eth.network]} also pays its network fees.
        </p>
      )}
      {fund.error && <p className="apg-start__err">{fund.error}</p>}
      {showAddress && <Receive address={address} />}
    </section>
  )
}

function Receive({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setCopied(false))
  }
  return (
    <div className="apg-start__receive" data-apps-start-address="">
      <span className="apg-start__qr">
        <QRCodeSVG value={address} size={96} bgColor="#ffffff" fgColor="#000000" level="M" />
      </span>
      <div className="apg-start__receiveText">
        <p className="apg-start__note">Send ETH or USDC to this address on Base, Ethereum, Arbitrum or Optimism. Send a little ETH too if you want it to be able to move on that chain.</p>
        <button type="button" className="apg-start__addr" onClick={copy} title="Copy address">
          <code>{address}</code>
          {copied ? <Check width={14} height={14} aria-hidden /> : <Copy width={14} height={14} aria-hidden />}
          <span className="sr-only">{copied ? 'Copied' : 'Copy address'}</span>
        </button>
      </div>
    </div>
  )
}

function AppCell({ cell, quote, onAsk }: { cell: StartCell<McpServer>; quote: Quote | undefined; onAsk: (prompt: string, slug: string) => void }) {
  const live = quote && Number.isFinite(quote.last) ? quote : null
  return (
    <div className="apg-start__cell" data-apps-start-app={cell.family}>
      <div className="apg-start__cellHead">
        <span className="apg-start__icon">
          <BrandIcon server={cell.server} size={28} />
        </span>
        <span className="apg-start__name">{cleanServerName(cell.server.name)}</span>
        {live && cell.quote && (
          <span className="apg-start__quote" data-apps-start-quote={cell.quote}>
            <span className="apg-start__sym">{cell.quote}</span>
            <span>${fmtQuotePrice(live.last)}</span>
            {Number.isFinite(live.chgPct) && <span className={live.chgPct > 0 ? 'is-up' : live.chgPct < 0 ? 'is-down' : undefined}>{fmtPct(live.chgPct)}</span>}
          </span>
        )}
        <span className="apg-start__does">{cell.does}</span>
      </div>
      <div className="apg-start__rows">
        {cell.asks.map((a) => (
          <button key={a.prompt} type="button" className="apg-start__row" data-funded={a.funded ? '' : undefined} onClick={() => onAsk(a.prompt, cell.server.slug)}>
            <span className="apg-start__ask">{a.label}</span>
            {a.funded ? <span className="apg-start__tag">Needs funds</span> : <ArrowUpRight width={14} height={14} className="apg-start__go" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  )
}
