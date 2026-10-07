'use client'

// The order ticket (2026-10-06, Nate: "allow users to enter the number they
// want to buy, something similar to Coinbase's buy / sell section… the
// amount can then trigger the app to build the transaction").
//
// The Coinbase-shaped form in front of the ask grammar (lib/order-ticket,
// pure — every sentence it composes is pinned through the ladder). Two
// seats, one component:
//   · `strip` — under the header's act chips (ExecStrip). The chips pick
//     the side; the ticket sizes it. Right under the price on every posture,
//     so a phone never has to find the rail.
//   · `card`  — the Trade tab's order card, with its own side tabs.
// The form never builds, prices or signs. Its one button hands the printed
// sentence to the page's build door (SymbolPage: the chart's own order
// ticket in Ask the chart), exactly like a chip — connect to act, and the
// wallet signature is the gate. What it adds is the SIZE: dollars or units
// (converted at the live price), presets, a slider over what the wallet
// holds (a sell) or the stable it can spend (a buy; lib/use-stable-balances),
// a limit price for a resting CoW order, leverage and a stop for a perp. The
// live routes quote (the same read the Trade tab's venue map makes) prints
// the estimate under the sentence; the guarded card re-quotes at signature.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { ChartPair } from '@/lib/charts'
import { fmtPrice } from '@/components/CandleChart'
import { useHeld } from '@/lib/use-held'
import { useStableBalances } from '@/lib/use-stable-balances'
import { followOrderSize, orderSizeOf, useOrderSize } from '@/lib/order-size'
import { useTradable } from '@/lib/use-tradable'
import { canSellAsk } from '@/lib/sell-gate'
import { canTradeAsk, tradeRefusal } from '@/lib/trade-venue-gate'
import { VENUE_NAME, venueChainLabel, type RouteQuote, type RoutesResponse } from '@/lib/symbol-venues'
import { fmtAskPrice } from '@/lib/chart-actions'
import {
  availableFor,
  composeTicketAsk,
  defaultLimitPrice,
  freshTicket,
  fmtTicketUnits,
  isPerpSide,
  limitChainsFor,
  limitDistancePct,
  parseTicketAmount,
  sideTone,
  sizeFromPct,
  ticketAmountKind,
  ticketSideLabel,
  ticketSizes,
  ticketTypesFor,
  TICKET_DEFAULT_USD,
  TICKET_LEVERAGE_PRESETS,
  TICKET_LIMIT_PRESETS,
  TICKET_PCT_PRESETS,
  TICKET_SENT_NOTE,
  TICKET_STOP_PRESETS,
  TICKET_USD_KEY,
  TICKET_USD_PRESETS,
  type TicketSide,
  type TicketState,
  type TicketType,
  type TicketUnit,
} from '@/lib/order-ticket'

export type OrderTicketProps = {
  symbol: string
  pair: ChartPair
  /** The honest side set, already gated (nothing to sell → no Sell; a shut venue → no Buy). */
  sides: readonly TicketSide[]
  side: TicketSide
  onSide: (side: TicketSide) => void
  /** The chart's last close (the header's stats) — sizes units ↔ dollars. */
  last: number | null
  /** Sends the composed sentence to the page's build door. */
  onSend: (ask: string) => void
  onClose?: () => void
  seat: 'strip' | 'card'
}

const QUOTE_DEBOUNCE_MS = 450
const SENT_SHOWN_MS = 5_000

function rememberUsd(usd: number) {
  try {
    window.localStorage.setItem(TICKET_USD_KEY, String(usd))
  } catch {
    /* not remembered */
  }
}
function recallUsd(): number {
  try {
    const n = Number(window.localStorage.getItem(TICKET_USD_KEY))
    return Number.isFinite(n) && n > 0 ? n : TICKET_DEFAULT_USD
  } catch {
    return TICKET_DEFAULT_USD
  }
}
const fmtAmt = (n: number) => fmtTicketUnits(n) ?? '0'
const fmtUsd2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** One line from the venue map's best row for this size: what comes out,
 *  where, and the fee — never a build. */
function quoteLine(row: RouteQuote, side: 'buy' | 'sell', usd: number, sym: string): string {
  const q = row.quote!
  const head = side === 'buy' ? (q.sub && q.sub.includes(sym) ? q.sub : `${fmtUsd2(usd)} at ${q.label}`) : `≈ ${fmtUsd2(usd)} at ${q.label}`
  const parts = [head, VENUE_NAME[row.venue] ?? row.venue, venueChainLabel(row.chainId)]
  parts.push(row.feeBps > 0 ? `fee ${(row.feeBps / 100).toFixed(2)}%` : 'no Pantessa fee')
  if (row.best) parts.push('best out')
  return parts.join(' · ')
}

export default function OrderTicket({ symbol, pair, sides, side, onSide, last, onSend, onClose, seat }: OrderTicketProps) {
  const sym = pair.symbol
  const held = useHeld()
  const stables = useStableBalances()
  const tradable = useTradable()
  // ── One size for the page (lib/order-size, 2026-10-07) ──
  // The venue map and the other seat follow this ticket's dollars, and this
  // ticket follows theirs. A size already set on this symbol SEEDS a fresh
  // mount (the Trade tab's card opens on the header's number, never on a
  // default that would overwrite it); the server renders the default (the
  // store is empty there), and so does the hydration.
  const sizeId = useId()
  const setSize = useOrderSize((s) => s.setSize)
  const sharedSize = useOrderSize((s) => s.size)
  const seededRef = useRef<boolean>(false)
  // Starts on the page's size, else the default (the server renders the
  // card seat); the remembered size lands in an effect so the hydration
  // matches.
  const [st, setSt] = useState<TicketState>(() => {
    const seed = followOrderSize(useOrderSize.getState().size, pair.symbol, sizeId)
    seededRef.current = seed != null
    const fresh = freshTicket(pair, side, { usd: seed?.usd ?? TICKET_DEFAULT_USD, last })
    // A perp seat opens on the page's leverage too (the header's 3x is the card's 3x).
    return seed?.leverage != null && isPerpSide(side) ? { ...fresh, leverage: seed.leverage } : fresh
  })
  const [text, setText] = useState<string>(() => (st.amount != null ? String(st.amount) : ''))
  const [pxText, setPxText] = useState<string>(() => (st.limitPrice != null ? fmtAskPrice(st.limitPrice) : ''))
  const [sent, setSent] = useState<number | null>(null)
  const usdRef = useRef(TICKET_DEFAULT_USD)
  const lastRef = useRef(last)
  lastRef.current = last
  const inputRef = useRef<HTMLInputElement>(null)

  const stRef = useRef(st)
  stRef.current = st
  const reset = useCallback(
    (s: TicketSide, opts: { type?: TicketType } = {}) => {
      // The dollar box carries across sides ($12.50 typed on Buy is $12.50 on
      // Long); a sell or a stake opens in units, so only dollars carry.
      const typed = stRef.current.unit === 'usd' && stRef.current.amount != null && stRef.current.amount > 0 ? stRef.current.amount : usdRef.current
      const next = freshTicket(pair, s, { usd: typed, last: lastRef.current, type: opts.type })
      setSt(next)
      setText(next.amount != null ? String(next.amount) : '')
      setPxText(next.limitPrice != null ? fmtAskPrice(next.limitPrice) : '')
      setSent(null)
    },
    [pair],
  )
  useEffect(() => {
    usdRef.current = recallUsd()
    if (seededRef.current) return
    if (usdRef.current !== TICKET_DEFAULT_USD) {
      setSt((s) => (s.unit === 'usd' && s.amount === TICKET_DEFAULT_USD ? { ...s, amount: usdRef.current } : s))
      setText((t) => (t === String(TICKET_DEFAULT_USD) ? String(usdRef.current) : t))
    }
  }, [])
  // The side changed under us (a chip, a tab): a fresh ticket for it.
  const prevSide = useRef(side)
  useEffect(() => {
    if (prevSide.current === side) return
    prevSide.current = side
    reset(side)
  }, [side, reset])

  const patch = useCallback((p: Partial<TicketState>) => setSt((s) => ({ ...s, ...p })), [])
  const types = useMemo(() => ticketTypesFor(pair, side), [pair, side])
  const amountKind = ticketAmountKind(side)
  const tone = sideTone(side)
  const isPerp = isPerpSide(side)
  const isSell = side === 'sell'

  // Published when the AMOUNT or the UNIT changes by a hand here (a units
  // sell converts at the price it was typed at — never on a price tick,
  // which would re-quote the table every second); a perp's leverage rides
  // along. A change that came from FOLLOWING is never published back: two
  // tickets that each re-published what they followed chased each other
  // 25 ↔ 100 until React gave up (the first drive of this). And a follow
  // reads the store LIVE, not the snapshot this render captured — in the
  // commit that mounts a second ticket, that snapshot predates the publish
  // the same commit just made. A SEEDED mount skips its first publish the
  // same way: what it would publish is what it was seeded from, minus a
  // leverage the seed may carry and this side may not — a fresh card seat
  // once wrote leverage null over the header's 3x before it could follow it.
  const followingRef = useRef(seededRef.current)
  useEffect(() => {
    if (amountKind === 'none') return
    if (followingRef.current) {
      followingRef.current = false
      return
    }
    const { usd } = ticketSizes({ unit: st.unit, amount: st.amount }, lastRef.current)
    const next = orderSizeOf(sym, usd, isPerp ? st.leverage : null, sizeId)
    if (next) setSize(next)
  }, [st.amount, st.unit, st.leverage, amountKind, isPerp, sym, sizeId, setSize])
  const followed = followOrderSize(sharedSize, sym, sizeId)
  useEffect(() => {
    if (!followed || amountKind === 'none') return
    const live = followOrderSize(useOrderSize.getState().size, sym, sizeId)
    if (!live) return
    const { usd } = ticketSizes({ unit: stRef.current.unit, amount: stRef.current.amount }, lastRef.current)
    const sameUsd = usd != null && Math.abs(usd - live.usd) < 0.005
    // A perp ticket takes the other perp ticket's leverage too (the header's
    // 3x is the card's 3x); a size that states none leaves it alone.
    const lev = isPerp && live.leverage != null && live.leverage !== stRef.current.leverage ? live.leverage : null
    if (sameUsd && lev == null) return
    followingRef.current = true
    setSt((s) => ({ ...s, unit: 'usd', amount: live.usd, sellAll: false, ...(lev != null ? { leverage: lev } : {}) }))
    setText(String(live.usd))
    usdRef.current = live.usd
  }, [followed, amountKind, isPerp, sym, sizeId])

  // What the order can draw on: the holding (a sell, a stake) or the stable
  // the wallet holds where the buy settles.
  const heldRow = useMemo(() => held?.find((h) => h.symbol === sym) ?? null, [held, sym])
  const available = useMemo(() => (side === 'buy' ? availableFor(pair, stables?.chains ?? null) : null), [side, pair, stables])
  const basis: { amount: number; unit: TicketUnit } | null =
    (side === 'sell' || side === 'stake') && heldRow && heldRow.amount > 0
      ? { amount: heldRow.amount, unit: 'token' }
      : side === 'buy' && available?.usd != null && available.usd > 0
        ? { amount: available.usd, unit: 'usd' }
        : null

  const onText = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!/^[\d.,$\s]*$/.test(v)) return
    setText(v)
    patch({ amount: parseTicketAmount(v), sellAll: false })
  }
  const setType = (t: TicketType) => {
    if (t === st.type) return
    const px = t === 'limit' && lastRef.current != null && (side === 'buy' || side === 'sell') ? (st.limitPrice ?? defaultLimitPrice(side, lastRef.current)) : st.limitPrice
    patch({ type: t, limitPrice: px })
    setPxText(px != null ? fmtAskPrice(px) : '')
  }
  const setUnit = (u: TicketUnit) => {
    if (u === st.unit) return
    const { usd, units } = ticketSizes(st, lastRef.current)
    const amount = u === 'usd' ? usd : units
    patch({ unit: u, amount, sellAll: false })
    setText(amount != null ? fmtAmt(amount) : '')
  }
  const setUsdPreset = (usd: number) => {
    patch({ unit: 'usd', amount: usd, sellAll: false })
    setText(String(usd))
    usdRef.current = usd
    rememberUsd(usd)
  }
  const setPct = (pct: number) => {
    if (!basis) return
    const { amount, sellAll } = sizeFromPct(pct, basis.amount, side)
    patch({ unit: basis.unit, amount, sellAll })
    setText(basis.unit === 'usd' ? amount.toFixed(2) : fmtAmt(amount))
  }
  const setLimitText = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!/^[\d.,$\s]*$/.test(v)) return
    setPxText(v)
    patch({ limitPrice: parseTicketAmount(v) })
  }
  const setLimitPct = (pct: number) => {
    if (lastRef.current == null || (side !== 'buy' && side !== 'sell')) return
    const px = defaultLimitPrice(side, lastRef.current, pct)
    patch({ limitPrice: px })
    setPxText(fmtAskPrice(px))
  }

  // The sentence, and the two gates every chip answers to.
  const out = useMemo(() => composeTicketAsk(pair, st, last), [pair, st, last])
  const allowed = out.ok && canSellAsk(out.ask, held) && canTradeAsk(out.ask, tradable)
  const refusal = out.ok && !allowed ? (tradeRefusal(out.ask, tradable) ?? (isSell ? `Nothing to sell: this wallet doesn't hold ${sym}${st.type === 'limit' ? ` on ${st.limitChain}` : ''}.` : 'This order can’t run right now.')) : null

  // Where the slider sits, from the typed amount.
  const pctNow = useMemo(() => {
    if (!basis) return null
    if (st.sellAll) return 100
    const { usd, units } = ticketSizes(st, last)
    const v = basis.unit === 'usd' ? usd : units
    if (v == null) return 0
    return Math.max(0, Math.min(100, Math.round((v / basis.amount) * 100)))
  }, [basis, st, last])

  // The venue map's quote for THIS size (debounced; the same public read the
  // Trade tab makes, cached 30s server-side). Market buys and sells only.
  const wantsQuote = out.ok && (side === 'buy' || side === 'sell') && st.type === 'market' && out.usd != null && out.usd >= 1
  const quoteKey = wantsQuote ? `${sym}|${side}|${out.usd}` : null
  const [quote, setQuote] = useState<{ key: string; line: string } | null>(null)
  useEffect(() => {
    if (!quoteKey || !out.ok || out.usd == null) return
    const usd = out.usd
    const qSide = side as 'buy' | 'sell'
    const ctrl = new AbortController()
    let alive = true
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ symbol: sym, amount: String(Math.max(1, Math.round(usd))) })
        if (lastRef.current != null && lastRef.current > 0) qs.set('last', String(lastRef.current))
        const res = await fetch(`/api/markets/routes?${qs}`, { cache: 'no-store', signal: ctrl.signal })
        if (!res.ok) return
        const body = (await res.json()) as RoutesResponse
        const rows = body.routes.filter((r) => (r.kind === 'spot' || r.kind === 'stock') && r.side === qSide && r.quote && r.quote.kind !== 'none' && r.quote.value != null)
        const row = rows.find((r) => r.best) ?? rows[0]
        if (!row || !alive) return
        setQuote({ key: quoteKey, line: quoteLine(row, qSide, usd, sym) })
      } catch {
        /* the estimate line stands */
      }
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(t)
      ctrl.abort()
    }
  }, [quoteKey, out, side, sym])
  const quoteShown = quote && quote.key === quoteKey ? quote.line : null

  // The estimate from the chart's own price, always.
  const estimate = useMemo(() => {
    if (!out.ok) return null
    const { usd, units } = ticketSizes(st, last)
    const px = last != null && last > 0 ? `$${fmtPrice(last)}` : null
    if (side === 'buy' || side === 'sell') {
      if (st.type === 'limit' && st.limitPrice != null && out.usd != null && out.units != null) return `${fmtAmt(out.units)} ${sym} for ${fmtUsd2(out.usd)} USDC at $${fmtAskPrice(st.limitPrice)}`
      if (st.sellAll) return heldRow ? `all ${fmtAmt(heldRow.amount)} ${sym}${heldRow.valueUsd != null ? ` ≈ ${fmtUsd2(heldRow.valueUsd)}` : ''}` : `the whole ${sym} balance`
      if (st.unit === 'usd') return units != null && px ? `≈ ${fmtAmt(units)} ${sym} at ${px}` : null
      return usd != null && px ? `≈ ${fmtUsd2(usd)} at ${px}` : null
    }
    if (isPerp && usd != null) return st.leverage > 1 ? `${fmtUsd2(usd)} notional at ${st.leverage}x ≈ ${fmtUsd2(usd / st.leverage)} collateral` : `${fmtUsd2(usd)} notional at the venue's leverage`
    if (side === 'stake') return units != null ? `${fmtAmt(units)} ETH${usd != null ? ` ≈ ${fmtUsd2(usd)}` : ''}` : null
    if (side === 'supply' && usd != null && units != null) return `≈ ${fmtAmt(units)} ${sym}${px ? ` at ${px}` : ''}`
    return null
  }, [out, st, last, side, sym, isPerp, heldRow])

  const send = () => {
    if (!out.ok || !allowed) return
    if (out.usd != null && out.usd > 0 && st.unit === 'usd') rememberUsd(out.usd)
    onSend(out.ask)
    setSent(Date.now())
  }
  useEffect(() => {
    if (sent == null) return
    const t = setTimeout(() => setSent(null), SENT_SHOWN_MS)
    return () => clearTimeout(t)
  }, [sent])
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  const note =
    side === 'protect'
      ? pair.source === 'hyperliquid'
        ? 'The Guardian watches the venue every minute and closes the position at your stop — delegated, never custodial.'
        : 'A one-shot Spend Permission on Base: the Guardian sells only if your line breaks. Signed once.'
      : isPerp
        ? 'Market (IOC) on Hyperliquid. A stop arms the Guardian, which watches every minute and closes at your line.'
        : st.type === 'limit'
          ? 'A CoW limit order: rests gasless, fills at-or-better when the market gets there, cancel any time.'
          : side === 'sell'
            ? 'Sells into the chain’s stable at today’s price. “All” is sized from the live balance when it builds.'
            : side === 'stake'
              ? 'Lido stETH — rebases daily. Sized in ETH; the dollar box converts at the chart’s price.'
              : side === 'supply'
                ? 'Aave v4 at the best supply rate. Quote → guarded build → your signature.'
                : pair.source === 'robinhood'
                  ? 'Settles on Robinhood Chain in USDG. An empty wallet gets a funding path, not a wall.'
                  : 'Quote → guarded build → your signature. A buy is sized in what you spend; the units are the estimate.'

  const sideTab = (s: TicketSide) => (
    <button key={s} type="button" role="tab" aria-selected={side === s} className={`mkt-ticket__tab ${sideTone(s) === 'sell' ? 'mkt-ticket__tab--sell' : ''}`} onClick={() => onSide(s)} data-side={s}>
      {ticketSideLabel(pair, s)}
    </button>
  )

  return (
    <div className={`mkt-ticket mkt-ticket--${seat} mkt-ticket--${tone}`} data-ticket={side} data-type={st.type} role="group" aria-label={`${ticketSideLabel(pair, side)} order`}>
      <div className="mkt-ticket__top">
        {seat === 'card' && (
          <div className="mkt-ticket__sides" role="tablist" aria-label="Side">
            {sides.map(sideTab)}
          </div>
        )}
        {types.length > 1 ? (
          <div className="mkt-ticket__types" role="tablist" aria-label="Order type">
            {types.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={st.type === t} className="mkt-ticket__tab" onClick={() => setType(t)} data-type={t}>
                {t === 'market' ? 'Market' : 'Limit'}
              </button>
            ))}
          </div>
        ) : (
          <span className="mkt-ticket__k mono">{isPerp ? 'MARKET · HYPERLIQUID PERP' : side === 'protect' ? 'STOP · GUARDIAN' : side === 'stake' ? 'STAKE · LIDO' : side === 'supply' ? 'SUPPLY · AAVE' : pair.source === 'robinhood' ? 'MARKET · ROBINHOOD CHAIN' : 'MARKET'}</span>
        )}
        {available ? (
          <span className="mkt-ticket__avail mono" title={available.text} data-available={available.usd ?? ''}>
            {available.text}
          </span>
        ) : (side === 'sell' || side === 'stake') && heldRow ? (
          <span className="mkt-ticket__avail mono" data-held={heldRow.amount}>
            You hold · {fmtAmt(heldRow.amount)} {sym}
            {heldRow.valueUsd != null ? ` ≈ ${fmtUsd2(heldRow.valueUsd)}` : ''}
          </span>
        ) : null}
        {onClose && (
          <button type="button" className="mkt-ticket__x" onClick={onClose} aria-label="Close the order ticket" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {amountKind !== 'none' && (
        <div className="mkt-ticket__size">
          <label className="mkt-ticket__amt">
            <span className="mkt-ticket__cur mono">{st.unit === 'usd' ? '$' : sym}</span>
            <input
              ref={inputRef}
              className="mkt-ticket__in mono"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={onText}
              onKeyDown={onKey}
              placeholder={st.unit === 'usd' ? '0' : '0.00'}
              aria-label={st.unit === 'usd' ? 'Amount in dollars' : `Amount in ${sym}`}
            />
            {amountKind === 'either' && (
              <button type="button" className="mkt-ticket__unit mono" onClick={() => setUnit(st.unit === 'usd' ? 'token' : 'usd')} title="Switch between dollars and units" aria-label="Switch between dollars and units">
                {st.unit === 'usd' ? `USD ⇄ ${sym}` : `${sym} ⇄ USD`}
              </button>
            )}
          </label>
          <span className="mkt-ticket__eq mono" aria-live="polite">
            {estimate ?? ''}
          </span>
          <div className="mkt-ticket__presets" role="group" aria-label="Size presets">
            {basis && st.unit === basis.unit
              ? TICKET_PCT_PRESETS.map((p) => (
                  <button key={p} type="button" className={`mkt-ticket__preset ${pctNow === p ? 'is-on' : ''}`} onClick={() => setPct(p)}>
                    {p === 100 ? (isSell ? 'All' : 'Max') : `${p}%`}
                  </button>
                ))
              : TICKET_USD_PRESETS.map((a) => (
                  <button key={a} type="button" className={`mkt-ticket__preset ${st.unit === 'usd' && st.amount === a ? 'is-on' : ''}`} onClick={() => setUsdPreset(a)}>
                    ${a}
                  </button>
                ))}
          </div>
          {basis && st.unit === basis.unit && (
            <input
              type="range"
              className="mkt-ticket__range"
              min={0}
              max={100}
              step={1}
              value={pctNow ?? 0}
              onChange={(e) => setPct(Number(e.target.value))}
              aria-label={isSell ? `Share of your ${sym} to sell` : 'Share of your balance to spend'}
            />
          )}
        </div>
      )}

      {st.type === 'limit' && (side === 'buy' || side === 'sell') && (
        <div className="mkt-ticket__row" data-limit="">
          <span className="mkt-ticket__rk mono">LIMIT PRICE</span>
          <label className="mkt-ticket__px">
            <span className="mono">$</span>
            <input className="mono" inputMode="decimal" value={pxText} onChange={setLimitText} onKeyDown={onKey} aria-label="Limit price in dollars" />
          </label>
          {last != null && st.limitPrice != null && limitDistancePct(st.limitPrice, last) != null && (
            <span className="mkt-ticket__dist mono">
              {(() => {
                const d = limitDistancePct(st.limitPrice, last)!
                return `${d > 0 ? '+' : ''}${d.toFixed(2)}% vs $${fmtPrice(last)}`
              })()}
            </span>
          )}
          <div className="mkt-ticket__presets" role="group" aria-label="Limit distance">
            {TICKET_LIMIT_PRESETS.map((p) => (
              <button key={p} type="button" className="mkt-ticket__preset" onClick={() => setLimitPct(p)} disabled={last == null}>
                {side === 'buy' ? `−${p}%` : `+${p}%`}
              </button>
            ))}
          </div>
          <span className="mkt-ticket__rk mono">RESTS ON</span>
          <div className="mkt-ticket__presets" role="group" aria-label="Chain">
            {limitChainsFor(sym).map((c) => (
              <button key={c.id} type="button" className={`mkt-ticket__preset ${st.limitChain === c.word ? 'is-on' : ''}`} onClick={() => patch({ limitChain: c.word })}>
                {c.word}
              </button>
            ))}
          </div>
        </div>
      )}

      {isPerp && (
        <div className="mkt-ticket__row" data-perp="">
          <span className="mkt-ticket__rk mono">LEVERAGE</span>
          <div className="mkt-ticket__presets" role="group" aria-label="Leverage">
            {TICKET_LEVERAGE_PRESETS.map((x) => (
              <button key={x} type="button" className={`mkt-ticket__preset ${st.leverage === x ? 'is-on' : ''}`} onClick={() => patch({ leverage: x })}>
                {x === 1 ? 'venue' : `${x}x`}
              </button>
            ))}
          </div>
          <label className="mkt-ticket__check">
            <input type="checkbox" checked={st.withStop} onChange={(e) => patch({ withStop: e.target.checked })} />
            protect it with a stop
          </label>
          {st.withStop && (
            <div className="mkt-ticket__presets" role="group" aria-label="Stop distance">
              {TICKET_STOP_PRESETS.map((p) => (
                <button key={p} type="button" className={`mkt-ticket__preset ${st.stopPct === p ? 'is-on' : ''}`} onClick={() => patch({ stopPct: p })}>
                  −{p}%
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {side === 'protect' && (
        <div className="mkt-ticket__row" data-stop="">
          <span className="mkt-ticket__rk mono">STOP</span>
          <div className="mkt-ticket__presets" role="group" aria-label="Stop distance">
            {TICKET_STOP_PRESETS.map((p) => (
              <button key={p} type="button" className={`mkt-ticket__preset ${st.stopPct === p ? 'is-on' : ''}`} onClick={() => patch({ stopPct: p })}>
                −{p}%
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mkt-ticket__go">
        <div className="mkt-ticket__say">
          {out.ok ? (
            <p className="mkt-ticket__sentence" data-ask={out.ask}>
              &ldquo;{out.ask}&rdquo;
            </p>
          ) : (
            <p className="mkt-ticket__problem" role="status">
              {out.problem}
            </p>
          )}
          {refusal && (
            <p className="mkt-ticket__problem" role="status">
              {refusal}
            </p>
          )}
          {out.ok && quoteShown && <p className="mkt-ticket__quote mono">{quoteShown}</p>}
          {sent != null && (
            <p className="mkt-ticket__sent" role="status">
              {TICKET_SENT_NOTE[seat]}
            </p>
          )}
        </div>
        <button type="button" className={`mkt-ticket__send mkt-ticket__send--${tone}`} disabled={!out.ok || !allowed} onClick={send} data-ask={out.ok ? out.ask : undefined} data-side={side}>
          {out.ok ? out.label : ticketSideLabel(pair, side)}
        </button>
      </div>
      <p className="mkt-ticket__note">{note}</p>
    </div>
  )
}
