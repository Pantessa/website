'use client'

// Trade — the overlay chips promoted to a proper order panel. Real (SHELL).
//
// The panel composes ONE sentence an existing parser accepts (buy/sell →
// the swap layer with 4663 inference for stocks; DCA → lib/dca; protect →
// the Spot Guardian on Base or the HL Guardian for perps) and SENDS it: the
// same ChatInterface the /i runtime mounts in `simple` mode takes the ask as
// an injected prompt, so the guarded build and the sign card render right
// here under the chart. Connect to act, sign in to keep (rule 6 — every
// sign-in CTA inside ChatInterface is already the unified door). The wallet
// signature is the only gate; the panel itself never touches funds.

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { ChartPair } from '@/lib/charts'
import { symbolName } from '@/lib/markets'
import { useYeetfulStore } from '@/lib/store'
import { AMOUNTS, CADENCES, SIDE_LABEL, STOPS, composeAsk, sideOf, sidesFor, type Cadence, type InjectedPrompt, type TradeAsk, type TradeSide } from '@/lib/trade-asks'

// The grammar (sides a pair can offer, the sentence per side, the default
// chip row) lives in lib/trade-asks — pure, shared with the header strip,
// the ask door and the harness.
export { composeAsk, sideOf, sidesFor, tradeAsks } from '@/lib/trade-asks'
export type { InjectedPrompt, TradeAsk, TradeSide } from '@/lib/trade-asks'

// ChatInterface is heavy (wagmi, the store, every card); load it only when a
// visitor actually sends an order from this page.
const ChatInterface = dynamic(() => import('@/components/ChatInterface'), { ssr: false })

export default function TradeTab({
  symbol,
  pair,
  prompt,
  onAsk,
}: {
  symbol: string
  pair: ChartPair
  /** The ask in flight (set by the frame when a chip or this panel fires). */
  prompt?: InjectedPrompt | null
  onAsk?: (ask: TradeAsk) => void
}) {
  const sides = useMemo(() => sidesFor(pair), [pair])
  const [side, setSide] = useState<TradeSide>(() => {
    const s = prompt ? sideOf(prompt.text) : 'buy'
    return sides.includes(s) ? s : sides[0]
  })
  // A chip fired from Overview lands the panel on its own amount ($50 →
  // the custom slot; a preset value lights its chip).
  const firedUsd = prompt ? Number(prompt.text.match(/\$(\d+)/)?.[1] ?? NaN) : NaN
  const [usd, setUsd] = useState<number>(AMOUNTS.includes(firedUsd as (typeof AMOUNTS)[number]) ? firedUsd : 10)
  const [custom, setCustom] = useState<string>(Number.isFinite(firedUsd) && !AMOUNTS.includes(firedUsd as (typeof AMOUNTS)[number]) ? String(firedUsd) : '')
  const [pct, setPct] = useState<number>(5)
  const [cadence, setCadence] = useState<Cadence>('weekly')

  const amount = custom.trim() ? Math.max(1, Math.floor(Number(custom) || 0)) : usd
  const ask = composeAsk(pair, side, { usd: amount, pct, cadence })

  // The symbol page is its own thread — never append an order into
  // whatever chat the visitor had open (the /i runtime's rule).
  const setCurrentChatId = useYeetfulStore((s) => s.setCurrentChatId)
  const armed = !!prompt
  const detachedRef = useRef(false)
  useEffect(() => {
    if (!armed || detachedRef.current) return
    detachedRef.current = true
    setCurrentChatId(null)
  }, [armed, setCurrentChatId])

  const send = () => {
    onAsk?.({ side, label: SIDE_LABEL[side](pair), ask })
  }

  const name = symbolName(symbol)
  const isPerp = pair.source === 'hyperliquid'

  return (
    <div className="mkt-trade">
      <section className="mkt-card mkt-order" aria-label={`Trade ${symbol}`}>
        <header className="mkt-card__head">
          <h2 className="mkt-card__title">Trade {name}</h2>
          <span className="mkt-card__eyebrow mono">ONE SENTENCE · GUARDED BUILD · YOU SIGN</span>
        </header>

        {/* Side */}
        <div className="mkt-order__sides" role="tablist" aria-label="Order type">
          {sides.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              className={`mkt-order__side ${side === s ? 'is-on' : ''} ${s === 'sell' ? 'mkt-order__side--sell' : ''}`}
              onClick={() => setSide(s)}
            >
              {s === 'buy' ? (isPerp ? 'Long' : 'Buy') : s === 'sell' ? (isPerp ? 'Short' : 'Sell') : s === 'dca' ? 'DCA' : 'Protect'}
            </button>
          ))}
        </div>

        {/* Amount / stop / cadence */}
        {side !== 'protect' ? (
          <div className="mkt-order__row">
            <span className="mkt-order__k mono">AMOUNT</span>
            <div className="mkt-order__presets">
              {AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`mkt-order__preset ${!custom.trim() && usd === a ? 'is-on' : ''}`}
                  onClick={() => {
                    setCustom('')
                    setUsd(a)
                  }}
                >
                  ${a}
                </button>
              ))}
              <label className="mkt-order__custom">
                <span className="mono">$</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="custom"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
                  aria-label="Custom amount in dollars"
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="mkt-order__row">
            <span className="mkt-order__k mono">STOP</span>
            <div className="mkt-order__presets">
              {STOPS.map((p) => (
                <button key={p} type="button" className={`mkt-order__preset ${pct === p ? 'is-on' : ''}`} onClick={() => setPct(p)}>
                  −{p}%
                </button>
              ))}
            </div>
          </div>
        )}
        {side === 'dca' && (
          <div className="mkt-order__row">
            <span className="mkt-order__k mono">EVERY</span>
            <div className="mkt-order__presets">
              {CADENCES.map((c) => (
                <button key={c} type="button" className={`mkt-order__preset ${cadence === c ? 'is-on' : ''}`} onClick={() => setCadence(c)}>
                  {c === 'daily' ? 'day' : c === 'weekly' ? 'week' : 'month'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* The sentence + send */}
        <div className="mkt-order__ask">
          <p className="mkt-order__sentence" data-ask={ask}>
            &ldquo;{ask}&rdquo;
          </p>
          <button type="button" className={`mkt-order__send ${side === 'sell' ? 'mkt-order__send--sell' : ''}`} onClick={send}>
            {side === 'protect' ? 'Arm it' : side === 'dca' ? 'Start it' : 'Send it'}
          </button>
        </div>
        <p className="mkt-card__note">
          {side === 'protect'
            ? isPerp
              ? 'The Guardian watches the venue every minute and closes the position at your stop — delegated, never custodial.'
              : 'A one-shot Spend Permission on Base: the Guardian sells only if your line breaks. Signed once.'
            : side === 'dca'
              ? 'Each period compiles a fresh guarded swap for you to sign — no double buys, cancel any time.'
              : pair.source === 'robinhood'
                ? 'Settles on Robinhood Chain in USDG. An empty wallet gets a funding path, not a wall.'
                : 'Quote → deterministic build → guardrails → your signature → receipt. The sentence is the whole order form.'}
        </p>
      </section>

      {/* The build lands here — the same runtime as an intent link */}
      <section className="mkt-card mkt-trade__chat" aria-label="Your order" data-armed={armed ? '1' : '0'}>
        {armed ? (
          <div className="mkt-trade__runtime">
            <ChatInterface simple injectedPrompt={prompt} />
          </div>
        ) : (
          <div className="mkt-trade__empty">
            <p className="mkt-card__title">Your order builds here.</p>
            <p className="mkt-card__note">Pick a side and an amount, send the sentence, and the guarded transaction appears in this panel for your wallet to sign.</p>
          </div>
        )}
      </section>
    </div>
  )
}
