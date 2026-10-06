'use client'

// The order ticket on a call's page. Side, Market or Limit, a dollar size,
// a limit price (opening on the call's own nearest level) — composed by
// lib/call-ticket into one sentence, shown verbatim, and sent through the
// ask door on a press (the chip-send contract: the press is the send, the
// wallet signature is the gate). A stranger gets the connect-only door first
// (lib/use-connect-to-act); the held ask runs when a wallet lands.
// Sells show only while the wallet holds the symbol (lib/sell-gate); every
// sentence is refused when no venue can fill it (lib/trade-venue-gate).

import { useEffect, useMemo, useState } from 'react'
import { useAskDoor } from '@/lib/ask-door'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import type { ChartPair } from '@/lib/charts'
import type { ChartLine } from '@/lib/chart-state'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import { TICKET_USD_PRESETS, composeTicket, defaultLimitPrice, ticketShape, type TicketMode, type TicketSide } from '@/lib/call-ticket'
import { fmtCallPrice } from '@/lib/chart-calls'

const promptHref = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`

export default function CallTicket({ symbol, pair, last, lines }: { symbol: string; pair: ChartPair; last: number | null; lines: ChartLine[] }) {
  const shape = useMemo(() => ticketShape(symbol, pair, last), [symbol, pair, last])
  const [side, setSide] = useState<TicketSide>('buy')
  const [mode, setMode] = useState<TicketMode>('market')
  const [usd, setUsd] = useState<number>(25)
  const [usdText, setUsdText] = useState('25')
  const [priceText, setPriceText] = useState('')
  const held = useHeld()
  const tradable = useTradable()

  // The limit price opens on the call's nearest level for the side picked.
  useEffect(() => {
    if (mode !== 'limit') return
    const p = defaultLimitPrice(lines, side, last)
    setPriceText(p === null ? '' : fmtCallPrice(p).replace(/,/g, ''))
    // Only when the side or mode changes: a typed price must survive a tick of the tape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, side])

  const price = priceText.trim() === '' ? null : Number(priceText)
  const verdict = useMemo(() => composeTicket({ symbol, pair, side, mode, usd, price: Number.isFinite(price as number) ? price : null, last }), [symbol, pair, side, mode, usd, price, last])
  // A sell the wallet cannot make, or an ask no venue fills, is refused by name.
  const gate = verdict.ok ? (!canSellAsk(verdict.ask, held) ? (held === null ? 'Connect a wallet to see what you hold.' : `Nothing to sell: this wallet holds no ${symbol}.`) : !canTradeAsk(verdict.ask, tradable) ? `No venue can fill ${symbol} on this side right now.` : null) : null

  const { act, door } = useConnectToAct({
    run: (ask) => useAskDoor.getState().openDoor(ask, { send: true }),
    redirectFor: promptHref,
    resumable: true,
  })

  const sideBtn = (s: TicketSide) => (
    <button type="button" className={`callticket__side${side === s ? ` is-${s}` : ''}`} aria-pressed={side === s} onClick={() => setSide(s)}>
      {shape.sides[s]}
    </button>
  )

  return (
    <section className="callticket" aria-label={`Trade ${symbol}`}>
      <div className="callticket__sides">
        {sideBtn('buy')}
        {sideBtn('sell')}
      </div>
      <div className="callticket__modes" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'market'} className={mode === 'market' ? 'is-active' : ''} onClick={() => setMode('market')}>
          Market
        </button>
        {shape.limit && (
          <button type="button" role="tab" aria-selected={mode === 'limit'} className={mode === 'limit' ? 'is-active' : ''} onClick={() => setMode('limit')}>
            Limit
          </button>
        )}
      </div>

      <label className="callticket__field">
        <span className="mono">Size (USD)</span>
        <input
          inputMode="decimal"
          value={usdText}
          onChange={(e) => {
            setUsdText(e.target.value)
            const n = Number(e.target.value)
            if (Number.isFinite(n)) setUsd(n)
          }}
          aria-label="Size in US dollars"
        />
      </label>
      <div className="callticket__presets">
        {TICKET_USD_PRESETS.map((p) => (
          <button key={p} type="button" className={usd === p ? 'is-active' : ''} onClick={() => { setUsd(p); setUsdText(String(p)) }}>
            ${p}
          </button>
        ))}
      </div>

      {mode === 'limit' && (
        <label className="callticket__field">
          <span className="mono">Limit price{last !== null ? ` · last $${fmtCallPrice(last)}` : ''}</span>
          <input inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} aria-label="Limit price in US dollars" />
        </label>
      )}

      {/* the sentence that will be sent — verbatim, so there is no surprise at the card */}
      <div className="callticket__ask mono" aria-live="polite">
        {verdict.ok ? verdict.ask : verdict.reason}
      </div>
      {verdict.ok && !gate && <p className="callticket__note">{verdict.words}</p>}
      {gate && <p className="callticket__note callticket__note--gate">{gate}</p>}

      <button type="button" className={`callticket__go is-${side}`} disabled={!verdict.ok || !!gate} onClick={() => verdict.ok && act(verdict.ask)}>
        {verdict.ok ? `${shape.sides[side]} ${symbol}` : shape.sides[side]} · your wallet signs
      </button>
      <p className="callticket__fine mono">sends the sentence above · the guarded card quotes the venue · nothing moves without your signature</p>
      {door}
    </section>
  )
}
