'use client'

// The Apps page's first run (lib/apps-start): a way to put money in, then what
// each app can do. An ask goes to the chat like every other button on the page;
// nothing here builds or signs a trade.

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, CreditCard, Loader2, QrCode } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import { Eyebrow } from '@/components/apps/parts'
import type { AppsStartState } from '@/components/apps/useAppsStart'
import type { StartRow } from '@/lib/apps-start'
import { ONRAMP_NETWORK_LABEL } from '@/lib/onramp'
import type { McpServer } from '@/lib/store'
import { cleanServerName } from '@/lib/utils'
import { RAIL_FUND_PRESET_USD, railFundOptionsFor } from '@/lib/watchlists'

export default function AppsStart({ address, start, onAsk }: { address: string; start: AppsStartState; onAsk: (prompt: string, slug: string) => void }) {
  const { fund, rows } = start
  return (
    <div className="apg-start" data-apps-start={fund.phase ?? 'open'}>
      <p className="apg-start__lead apg-muted">Your apps do the work. Your wallet signs every move.</p>
      <FundBlock address={address} start={start} />
      <AskList title="Try now, no funds needed" rows={rows.free} onAsk={onAsk} list="free" />
      <AskList title="Ready when you’ve added funds" rows={rows.funded} onAsk={onAsk} list="funded" />
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
        <p className="apg-start__note">
          Closed it without buying?{' '}
          <button type="button" className="apg-start__link" onClick={fund.startOver}>
            Start over
          </button>
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

function AskList({ title, rows, onAsk, list }: { title: string; rows: StartRow<McpServer>[]; onAsk: (prompt: string, slug: string) => void; list: string }) {
  if (rows.length === 0) return null
  return (
    <section className="apg-start__list" data-apps-start-list={list}>
      <Eyebrow>{title}</Eyebrow>
      <div className="apg-start__rows">
        {rows.map((r) => (
          <button key={r.prompt} type="button" className="apg-start__row" onClick={() => onAsk(r.prompt, r.server.slug)}>
            <BrandIcon server={r.server} size={20} />
            <span className="apg-start__ask">{r.label}</span>
            <span className="apg-start__app">{cleanServerName(r.server.name)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
