'use client'

// RouteTable (MK2/EXEC) — every venue a wallet can act on this symbol
// through, side by side, with LIVE numbers: Uniswap spot per chain, CoW
// limit, Hyperliquid perp (+ leverage), Aave supply/borrow, Lido stake, DCA,
// the Guardian stops, NEAR / LiFi funding, Robinhood Chain stocks. One chip
// per row; every chip is a sentence a native parser reads and SENDS on click
// (memory chip-send-contract — the wallet signature is the gate; on a public
// page the page's own connect-to-act door opens for a stranger). The rows
// come from lib/symbol-venues (pure); the numbers from
// GET /api/markets/routes (30s cache, fail-soft per row — "—" still sends).
//
// The Fund group is per wallet (2026-09-16, Nate: "it shows 'Fund from Base'
// but the user does not have any tokens on base"): the connected wallet's
// rows come from GET /api/markets/routes/funding, one per chain that can
// actually fund the order, with a line for the money that can't. The card
// row (when the on-ramp is open) needs no wallet and closes the group. A
// visitor with no wallet sees the card and what connecting would show.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { getProtocolMark } from '@/components/protocol-marks'
import { PantessaMark } from '@/components/Logo'
import type { ChartPair } from '@/lib/charts'
import { parseChartState } from '@/lib/chart-state'
import { useSession } from '@/lib/session'
import {
  BEST_OUT_RULE,
  CHART_DRAW_KEY_PREFIX,
  DEFAULT_ROUTE_USD,
  FUND_CONNECT_NOTE,
  SPOT_CHAINS,
  limitAtLevel,
  VENUE_KIND_LABEL,
  VENUE_KIND_ORDER,
  VENUE_NAME,
  venueChainLabel,
  type FundRoutesResponse,
  type RouteQuote,
  type RoutesResponse,
  type VenueKind,
} from '@/lib/symbol-venues'
import './trade.css'

export const ROUTE_AMOUNTS = [10, 25, 50, 100, 250] as const
export const ROUTE_LEVERAGES = [1, 2, 3, 5] as const
export const LEVERAGE_MAX = 10
const DRAW_POLL_MS = 2_000

/** The last horizontal line the trader drew on this symbol's chart (ChartMount
 *  persists drawings per symbol in localStorage) — null when none. */
function lastDrawnLevel(symbol: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${CHART_DRAW_KEY_PREFIX}${symbol}`)
    const s = raw ? parseChartState(raw) : null
    if (!s) return null
    for (let i = s.lines.length - 1; i >= 0; i--) {
      const l = s.lines[i]
      if (l.kind === 'h') return l.price
    }
    return null
  } catch {
    return null
  }
}
const POLL_MS = 30_000

const fmtLevel = (p: number) => (p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toPrecision(3))
const feeLabel = (bps: number) => (bps > 0 ? `${(bps / 100).toFixed(2)}%` : 'no fee')

function VenueMark({ venue }: { venue: string }) {
  if (venue === 'pantessa') return <PantessaMark size={18} />
  if (venue === 'card') return <CreditCard size={18} strokeWidth={1.75} aria-hidden="true" />
  const Mark = getProtocolMark(venue === 'near' ? 'near-intents' : venue)
  if (!Mark) return <span className="mkt-route__lettermark mono">{venue.slice(0, 2).toUpperCase()}</span>
  return <Mark size={18} />
}

export default function RouteTable({
  symbol,
  pair,
  onAsk,
  last,
  amount: amountProp,
}: {
  symbol: string
  pair: ChartPair
  onAsk: (ask: string) => void
  /** The chart's last close — sizes the limit + stake rows honestly
   *  (optional; the route derives one from its own quotes otherwise). */
  last?: number | null
  amount?: number
}) {
  const [amount, setAmount] = useState<number>(amountProp ?? DEFAULT_ROUTE_USD)
  const [custom, setCustom] = useState('')
  const [leverage, setLeverage] = useState<number>(1)
  const [data, setData] = useState<RoutesResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [filter, setFilter] = useState<VenueKind | 'all'>('all')
  const [drawn, setDrawn] = useState<number | null>(null)
  const [why, setWhy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const usd = custom.trim() ? Math.max(1, Math.floor(Number(custom) || 0)) : amount
  const seq = useRef(0)
  // The connected wallet's own funding rows (lib/fund-routes), keyed by the
  // wallet + symbol they were read for, so a switched wallet never shows
  // another wallet's rows. A size change keeps the rows on screen until the
  // re-read lands, the way the quotes above do.
  const { walletAddress } = useSession()
  const [funding, setFunding] = useState<{ key: string; body: FundRoutesResponse | null } | null>(null)
  const fundSeq = useRef(0)
  const fundBase = walletAddress ? `${walletAddress.toLowerCase()}|${pair.symbol}|` : null
  const fundKey = fundBase ? `${fundBase}${usd}` : null

  // The trader's own price: the chart's last drawn horizontal line, re-read
  // every 2s (same-tab writes fire no storage event) and on tab return.
  useEffect(() => {
    const read = () => setDrawn(lastDrawnLevel(pair.symbol))
    read()
    const id = setInterval(read, DRAW_POLL_MS)
    window.addEventListener('focus', read)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', read)
    }
  }, [pair.symbol])

  const loadFunding = useCallback(async () => {
    const id = ++fundSeq.current
    if (!walletAddress || !fundKey || !fundBase) return
    const qs = new URLSearchParams({ symbol: pair.symbol, amount: String(usd), address: walletAddress })
    try {
      const res = await fetch(`/api/markets/routes/funding?${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as FundRoutesResponse
      if (id === fundSeq.current) setFunding({ key: fundKey, body })
    } catch {
      // Keep the last good read for this wallet; say nothing new on a blip.
      if (id === fundSeq.current) setFunding((f) => (f?.key.startsWith(fundBase) && f.body ? f : { key: fundKey, body: null }))
    }
  }, [pair.symbol, usd, walletAddress, fundKey, fundBase])

  const load = useCallback(async () => {
    void loadFunding()
    const id = ++seq.current
    setState((s) => (s === 'ready' ? s : 'loading'))
    const qs = new URLSearchParams({ symbol: pair.symbol, amount: String(usd) })
    if (last && Number.isFinite(last) && last > 0) qs.set('last', String(last))
    if (leverage > 1) qs.set('leverage', String(leverage))
    try {
      const res = await fetch(`/api/markets/routes?${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as RoutesResponse
      if (id !== seq.current) return
      setData(body)
      setState('ready')
    } catch {
      if (id !== seq.current) return
      setState((s) => (s === 'ready' ? s : 'error'))
    }
  }, [pair.symbol, usd, last, leverage, loadFunding])

  // Load on mount + every 30s while the tab is visible; re-load on size/leverage.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    const tick = async () => {
      if (!alive) return
      if (document.visibilityState === 'visible') await load()
      timer = setTimeout(tick, POLL_MS)
    }
    const debounce = setTimeout(tick, custom.trim() ? 450 : 0)
    return () => {
      alive = false
      clearTimeout(debounce)
      if (timer) clearTimeout(timer)
    }
  }, [load, custom])

  // Does this page fund a buy at all? (A perp chart or a non-EVM home has no
  // spot buy for money to land on — the map lists no funding there.)
  const fundApplies = !!data && (data.source === 'robinhood' || data.routes.some((r) => r.kind === 'spot'))
  const walletFunding = fundBase && funding?.key.startsWith(fundBase) ? funding.body : null
  const fundPending = !!fundBase && !funding?.key.startsWith(fundBase)
  const fundNotes = useMemo<string[]>(() => {
    if (!fundApplies) return []
    if (!walletAddress) return [FUND_CONNECT_NOTE]
    if (fundPending) return ['Checking which chains your money is on…']
    if (!walletFunding) return ["Couldn't read your balances just now. Buy still plans the funding when you send it."]
    return walletFunding.notes
  }, [fundApplies, walletAddress, fundPending, walletFunding])

  const rows = useMemo(() => {
    // The wallet's own funding rows first, then the card (the public map's
    // only funding row).
    const routes = data?.routes ?? []
    const list = [...routes.filter((r) => r.venue !== 'card'), ...(walletFunding?.routes ?? []), ...routes.filter((r) => r.venue === 'card')]
    const filtered = filter === 'all' ? list : list.filter((r) => r.kind === filter)
    const groups = new Map<VenueKind, RouteQuote[]>()
    for (const k of VENUE_KIND_ORDER) {
      const g = filtered.filter((r) => r.kind === k)
      if (g.length) groups.set(k, g)
    }
    // The Fund group stands even with no row in it, to say why.
    if ((filter === 'all' || filter === 'fund') && !groups.has('fund') && fundNotes.length > 0) groups.set('fund', [])
    return groups
  }, [data, filter, walletFunding, fundNotes])

  const kindsPresent = useMemo(
    () => VENUE_KIND_ORDER.filter((k) => data?.routes.some((r) => r.kind === k) || (k === 'fund' && ((walletFunding?.routes.length ?? 0) > 0 || fundNotes.length > 0))),
    [data, walletFunding, fundNotes],
  )
  const hasPerp = data?.routes.some((r) => r.kind === 'perp') ?? false
  // A card checkout isn't a dapp; the wallet's funding venues are.
  const venues = useMemo(
    () => new Set([...(data?.routes ?? []), ...(walletFunding?.routes ?? [])].filter((r) => r.venue !== 'card').map((r) => r.venue)).size,
    [data, walletFunding],
  )

  return (
    <section className="mkt-card mkt-routes" aria-label={`Every way to act on ${symbol}`} data-state={state} data-rows={data?.routes.length ?? 0}>
      <header className="mkt-card__head mkt-routes__head">
        <div>
          <h2 className="mkt-card__title">Every way to act on {pair.symbol}</h2>
          <span className="mkt-card__eyebrow mono">
            {venues > 0 ? `${venues} DAPPS · ` : ''}LIVE QUOTES · ONE CHIP EACH · YOUR WALLET SIGNS
          </span>
        </div>
        <div className="mkt-routes__controls">
          <div className="mkt-routes__presets" role="group" aria-label="Order size">
            {ROUTE_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                className={`mkt-order__preset ${!custom.trim() && amount === a ? 'is-on' : ''}`}
                onClick={() => {
                  setCustom('')
                  setAmount(a)
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
                aria-label="Custom order size in dollars"
              />
            </label>
          </div>
          {hasPerp && (
            <div className="mkt-routes__presets mkt-routes__lev" role="group" aria-label="Perp leverage">
              <span className="mkt-order__k mono">LEV</span>
              {ROUTE_LEVERAGES.map((l) => (
                <button key={l} type="button" className={`mkt-order__preset ${leverage === l ? 'is-on' : ''}`} onClick={() => setLeverage(l)}>
                  {l}x
                </button>
              ))}
              <label className="mkt-routes__slider" title="Sets cross leverage venue-side before the order (signed 1/2), then the order (2/2) — never decorative.">
                <input type="range" min={1} max={LEVERAGE_MAX} step={1} value={leverage} aria-label="Leverage" onChange={(e) => setLeverage(Number(e.target.value))} />
                <span className="mono">{leverage}x</span>
              </label>
            </div>
          )}
        </div>
      </header>

      {kindsPresent.length > 1 && (
        <div className="mkt-routes__filters" role="tablist" aria-label="Venue kind">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={`mkt-routes__filter ${filter === 'all' ? 'is-on' : ''}`} onClick={() => setFilter('all')}>
            All
          </button>
          {kindsPresent.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`mkt-routes__filter ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>
              {VENUE_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {state === 'error' && !data && <p className="mkt-card__note">The venue quotes didn’t answer — the map still sends; every build re-quotes before you sign.</p>}
      {state === 'loading' && !data && (
        <ul className="mkt-routes__list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="mkt-route mkt-route--ghost" aria-hidden="true">
              <span className="mkt-route__mark" />
              <span className="mkt-route__venue" />
              <span className="mkt-route__num" />
              <span className="mkt-route__chip" />
            </li>
          ))}
        </ul>
      )}

      {data && (
        <div className="mkt-routes__groups">
          {[...rows.entries()].map(([kind, list]) => (
            <div key={kind} className="mkt-routes__group" data-kind={kind}>
              <div className="mkt-routes__kind mono">
                <span>{VENUE_KIND_LABEL[kind].toUpperCase()}</span>
                <span className="mkt-routes__kind-sub">{kindHint(kind)}</span>
                {kind === 'spot' && list.some((r) => r.best) && (
                  <button type="button" className="mkt-routes__why" title={BEST_OUT_RULE} aria-label="Why this is best" data-rule={BEST_OUT_RULE} onClick={() => setWhy((w) => !w)}>
                    why best?
                  </button>
                )}
              </div>
              {kind === 'spot' && why && <p className="mkt-routes__rule">{BEST_OUT_RULE}</p>}
              {kind === 'limit' && drawn != null && data?.last != null && (
                <ul className="mkt-routes__list mkt-routes__list--level" aria-label="At your drawn line">
                  {SPOT_CHAINS.filter((c) => c.cow && list.some((r) => r.chainId === c.id))
                    .map((c) => ({ c, lvl: limitAtLevel(pair.symbol, c.word, usd, drawn, data.last!) }))
                    .filter((x): x is { c: (typeof SPOT_CHAINS)[number]; lvl: NonNullable<ReturnType<typeof limitAtLevel>> } => !!x.lvl)
                    .map(({ c, lvl }) => (
                      <li key={`level:${c.id}`} className={`mkt-route mkt-route--level ${lvl.side === 'sell' ? 'mkt-route--sell' : ''}`} data-route={`limit:cow:${c.id}:level`}>
                        <span className="mkt-route__mark" aria-hidden="true"><VenueMark venue="cow" /></span>
                        <span className="mkt-route__venue">
                          <span className="mkt-route__name">Your line · CoW Swap</span>
                          <span className="mkt-route__chain mono">{c.name}</span>
                        </span>
                        <span className="mkt-route__num">
                          <span className="mkt-route__val mono">${fmtLevel(lvl.price)}</span>
                          <span className="mkt-route__sub mono">{lvl.hint}</span>
                        </span>
                        <span className="mkt-route__meta">
                          <span className="mkt-route__fee mono">{feeLabel(list[0]?.feeBps ?? 0)}</span>
                          <span className="mkt-route__tags"><span className="mkt-route__tag mono">FROM YOUR CHART</span></span>
                        </span>
                        <button type="button" className={`mkt-route__chip ${lvl.side === 'sell' ? 'mkt-route__chip--sell' : ''}`} title={lvl.ask} data-ask={lvl.ask} onClick={() => onAsk(lvl.ask)}>
                          {lvl.label}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              <ul className="mkt-routes__list">
                {list.map((r) => (
                  <li key={r.id} className={`mkt-route ${r.best ? 'is-best' : ''} ${r.side === 'sell' ? 'mkt-route--sell' : ''} ${open === r.id ? 'is-open' : ''}`} data-route={r.id}>
                    <span className="mkt-route__mark" aria-hidden="true">
                      <VenueMark venue={r.venue} />
                    </span>
                    <span className="mkt-route__venue">
                      <span className="mkt-route__name">{VENUE_NAME[r.venue] ?? r.venue}</span>
                      <span className="mkt-route__chain mono">{venueChainLabel(r.chainId)}</span>
                    </span>
                    <span className="mkt-route__num">
                      {r.quote ? (
                        <>
                          <span className={`mkt-route__val mono ${r.quote.kind === 'none' ? 'mkt-route__val--soft' : ''}`}>{r.quote.label}</span>
                          {r.quote.sub && <span className="mkt-route__sub mono">{r.quote.sub}</span>}
                        </>
                      ) : (
                        <span className="mkt-route__val mono mkt-route__val--soft" title="No live quote right now — the build re-quotes before you sign">
                          —
                        </span>
                      )}
                    </span>
                    {/* fee + tags: one wrapping line on a phone, their own
                        columns wider up (the meta box is display: contents) */}
                    <span className="mkt-route__meta">
                      <span className="mkt-route__fee mono" title="Pantessa's fee on this route (lib/fees)">
                        {feeLabel(r.feeBps)}
                        {r.ticket && (
                          <>
                            {' '}
                            <button type="button" className="mkt-route__toggle mono" aria-expanded={open === r.id} aria-controls={`ticket-${r.id}`} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                              {open === r.id ? 'hide' : "what you'll sign"}
                            </button>
                          </>
                        )}
                      </span>
                      <span className="mkt-route__tags">
                        {r.best && <span className="mkt-route__tag mkt-route__tag--best mono" title={BEST_OUT_RULE}>BEST OUT</span>}
                        {r.needs === 'position' && <span className="mkt-route__tag mono">NEEDS A POSITION</span>}
                      </span>
                    </span>
                    <button type="button" className={`mkt-route__chip ${r.side === 'sell' ? 'mkt-route__chip--sell' : ''}`} title={r.ask} data-ask={r.ask} onClick={() => onAsk(r.ask)}>
                      {r.label}
                    </button>
                    {r.ticket && open === r.id && (
                      <dl className="mkt-route__more" id={`ticket-${r.id}`} data-ticket="1">
                        <div><dt className="mono">YOU SEND</dt><dd>“{r.ask}”</dd></div>
                        <div><dt className="mono">EST. OUT</dt><dd>{r.ticket.out ?? '— (no live quote; the card quotes it)'}</dd></div>
                        <div><dt className="mono">PANTESSA FEE</dt><dd>{r.ticket.feeBps > 0 ? `${(r.ticket.feeBps / 100).toFixed(2)}% · $${r.ticket.feeUsd.toFixed(2)} on $${data.amountUsd}` : 'none'}</dd></div>
                        <div><dt className="mono">{r.ticket.slippageBps != null ? 'MIN RECEIVED' : 'FILL RULE'}</dt><dd>{r.ticket.minOut ?? (r.ticket.slippageBps != null ? `${(r.ticket.slippageBps / 100).toFixed(2)}% bound pinned by the builder` : 'at-or-better')}{r.ticket.slippageBps != null && r.ticket.minOut ? ` · ${(r.ticket.slippageBps / 100).toFixed(2)}% bound` : ''}</dd></div>
                        <div><dt className="mono">GAS</dt><dd>{r.ticket.gas ?? 'none — no transaction'}</dd></div>
                        <div><dt className="mono">SETTLES AT</dt><dd>{r.ticket.settles}</dd></div>
                        <div><dt className="mono">YOU SIGN</dt><dd>{r.ticket.signs}</dd></div>
                        <span className="mkt-route__ticket-note mono">{r.ticket.note.toUpperCase()}</span>
                      </dl>
                    )}
                  </li>
                ))}
              </ul>
              {kind === 'fund' && fundNotes.length > 0 && (
                <ul className="mkt-routes__fundnotes" aria-live="polite" data-fund-state={walletAddress ? (fundPending ? 'pending' : (walletFunding?.state ?? 'unread')) : 'no-wallet'}>
                  {fundNotes.map((n) => (
                    <li key={n} className="mkt-routes__fundnote">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {data.notes.length > 0 && (
            <ul className="mkt-routes__notes">
              {data.notes.map((n) => (
                <li key={n} className="mkt-card__note">
                  {n}
                </li>
              ))}
            </ul>
          )}
          <p className="mkt-routes__foot mono">
            {data.failed.length > 0 ? `${data.failed.length} quote${data.failed.length > 1 ? 's' : ''} didn’t answer · ` : ''}
            sized at ${data.amountUsd} · quotes {data.cached ? 'cached ≤30s' : 'live'} · a chip sends the sentence; the guarded build appears below for your wallet
          </p>
        </div>
      )}
    </section>
  )
}

function kindHint(kind: VenueKind): string {
  switch (kind) {
    case 'spot':
      return 'fills now · best out marked'
    case 'limit':
      return 'rests on CoW · gasless · fills at-or-better'
    case 'stock':
      return 'Robinhood Chain · 24/7 · USDG'
    case 'perp':
      return 'Hyperliquid · IOC at market'
    case 'lend':
      return 'Aave v4 · Ethereum'
    case 'stake':
      return 'Lido · stETH'
    case 'dca':
      return 'standing · you sign each buy'
    case 'protect':
      return 'standing · signed once'
    case 'fund':
      return 'bring money to where it trades'
  }
}
