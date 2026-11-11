'use client'

// The one door: type a handle, pick a side, plot it (squad called-it, lane
// CHART). Two seats, one form:
//
//   variant="chart"   on the symbol page, inside the popover that the chart
//                     bar's "Plot a handle" button opens (PlotHandleButton,
//                     below). It plots in place through `onPlot`.
//   variant="page"    on /x (lane RECORD mounts it). It goes to the record's
//                     own page, and asks for the market when none is given.
//
// The form is three things and nothing else: the handle (`@name`, `name` or a
// pasted profile link), All · Bull · Bear, and Plot. Under it, handles that
// are already plotted (one tap, no scan) and "Plot yourself" (Verify with X,
// lane AUTH's button, mounted as it is). Enter plots.
import { useEffect, useId, useRef, useState } from 'react'
import { AtSign, X } from 'lucide-react'
import VerifyWithX from '@/components/called/VerifyWithX'
import { chartHref, normalizeHandle, recordHref, type CalledSide } from '@/lib/called-it/spec'
import { plottedFrom, useCalled } from '@/lib/called-it/use-record'
import './called-chart.css'

export interface HandleDoorProps {
  /** The market to plot on. The page variant may leave it out and ask. */
  symbol?: string
  initialHandle?: string
  side?: CalledSide
  /** `chart` lives on the symbol page and plots in place; `page` lives on /x and navigates to the record. */
  variant: 'chart' | 'page'
  /** Chart variant: called with a valid handle and side instead of navigating. */
  onPlot?: (handle: string, side: CalledSide) => void
  className?: string
}

export const SIDES: readonly { side: CalledSide; label: string; title: string }[] = [
  { side: 'all', label: 'All', title: 'Every call, bullish or bearish' },
  { side: 'bull', label: 'Bull', title: 'Only the posts where the account was bullish' },
  { side: 'bear', label: 'Bear', title: 'Only the posts where the account was bearish' },
]

const MARKET_RE = /^[A-Za-z0-9.:^-]{1,24}$/

interface Suggestion {
  handle: string
  symbol: string | null
  name: string | null
}

export default function HandleDoor({ symbol, initialHandle = '', side: sideProp = 'all', variant, onPlot, className }: HandleDoorProps) {
  const [value, setValue] = useState(initialHandle ? `@${initialHandle}` : '')
  const [side, setSide] = useState<CalledSide>(sideProp)
  const [market, setMarket] = useState(symbol ?? 'BTC')
  const [plotted, setPlotted] = useState<Suggestion[]>([])
  const [me, setMe] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const id = useId()
  const handle = normalizeHandle(value)
  const sym = (symbol ?? market).trim().toUpperCase()
  const marketOk = MARKET_RE.test(sym)
  const typed = value.trim().length > 0

  useEffect(() => setSide(sideProp), [sideProp])
  useEffect(() => {
    let alive = true
    // Handles somebody already plotted: a tap draws them at once, no scan.
    fetch('/api/x/handles', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setPlotted(plottedFrom(body)))
      .catch(() => undefined)
    // The account this browser proved with X, if any: "Plot yourself" is then one tap.
    const readMe = () =>
      fetch('/api/x/me', { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { identity?: { handle?: unknown } | null } | null) => alive && setMe(normalizeHandle(body?.identity?.handle)))
        .catch(() => undefined)
    void readMe()
    const onIdentity = (e: Event) => alive && setMe(normalizeHandle((e as CustomEvent<{ identity?: { handle?: unknown } | null }>).detail?.identity?.handle))
    window.addEventListener('pantessa:x-identity', onIdentity)
    return () => {
      alive = false
      window.removeEventListener('pantessa:x-identity', onIdentity)
    }
  }, [])

  const go = (h: string, s: CalledSide, on: string) => {
    if (onPlot) onPlot(h, s)
    else window.location.href = variant === 'chart' ? chartHref(h, on, s) : recordHref(h, on, s)
  }

  return (
    <form
      className={['xcc-door', `xcc-door--${variant}`, className].filter(Boolean).join(' ')}
      data-variant={variant}
      onSubmit={(e) => {
        e.preventDefault()
        if (!handle || !marketOk) return
        go(handle, side, sym)
      }}
    >
      <div className="xcc-door__row">
        <label className="xcc-door__field" htmlFor={`${id}-h`}>
          <AtSign className="xcc-door__at" aria-hidden />
          <input
            id={`${id}-h`}
            ref={inputRef}
            className="xcc-door__input"
            value={value.replace(/^@/, '')}
            onChange={(e) => setValue(e.target.value)}
            placeholder="handle, or a profile link"
            aria-label="X handle"
            aria-invalid={typed && !handle ? true : undefined}
            aria-describedby={typed && !handle ? `${id}-e` : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            data-called-input=""
          />
        </label>
        {!symbol && (
          <label className="xcc-door__on">
            <span>on</span>
            <input className="xcc-door__market mono" value={market} onChange={(e) => setMarket(e.target.value.toUpperCase())} aria-label="Market" aria-invalid={!marketOk || undefined} autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} size={6} maxLength={24} />
          </label>
        )}
        <button type="submit" className="xcc-btn xcc-btn--go" disabled={!handle || !marketOk} data-journey="called_plot">
          Plot
        </button>
      </div>
      <div className="xcc-seg" role="group" aria-label="Which calls to plot">
        {SIDES.map((s) => (
          <button key={s.side} type="button" className="xcc-seg__btn mono" aria-pressed={side === s.side} title={s.title} onClick={() => setSide(s.side)}>
            {s.label}
          </button>
        ))}
      </div>
      {typed && !handle ? (
        <p className="xcc-door__err" id={`${id}-e`} role="status">
          A handle is 1 to 15 letters, numbers or underscores. A link must be an x.com profile.
        </p>
      ) : null}
      {plotted.length > 0 && (
        <div className="xcc-door__more">
          <span className="xcc-door__k mono">Already plotted</span>
          <span className="xcc-door__chips">
            {plotted.map((p) => (
              <button key={p.handle} type="button" className="xcc-chip" title={p.name ? `${p.name} (@${p.handle})` : `@${p.handle}`} onClick={() => go(p.handle, side, symbol ? sym : (p.symbol ?? sym))} data-journey="called_plot_suggested">
                @{p.handle}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="xcc-door__more">
        <span className="xcc-door__k mono">Plot yourself</span>
        <span className="xcc-door__you">
          {me && variant === 'chart' ? (
            <button type="button" className="xcc-chip xcc-chip--you" onClick={() => go(me, side, sym)} data-journey="called_plot_self">
              @{me} on {sym}
            </button>
          ) : null}
          <VerifyWithX variant="line" symbol={marketOk ? sym : undefined} className="xcc-door__verify" />
        </span>
      </div>
    </form>
  )
}

/**
 * The door's seat on the symbol page's chart: one button on the chart's own
 * bar, beside Compare. It opens the form in a small popover; with a handle
 * plotted it names the handle instead, so the bar says what is on the chart.
 */
export function PlotHandleButton({ symbol }: { symbol: string }) {
  const plot = useCalled((s) => (s.symbol === symbol ? s.plot : null))
  const [open, setOpen] = useState(false)
  const seatRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const input = seatRef.current?.querySelector<HTMLInputElement>('[data-called-input]')
    input?.focus()
    input?.select()
    const onDown = (e: PointerEvent) => {
      if (seatRef.current && !seatRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // The chart is an iframe: a press inside it never reaches this document, so losing focus to it closes the door too.
    const onBlur = () => setTimeout(() => document.activeElement?.tagName === 'IFRAME' && setOpen(false), 0)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  return (
    <span className="xcc-seat" ref={seatRef} data-called-door={plot ? 'plotted' : 'empty'}>
      <button
        type="button"
        className={`xcc-open mono${plot ? ' is-on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={plot ? `@${plot.handle}'s calls are on this chart. Plot another handle.` : "Plot an X handle's calls on this chart: every post where the account took a side, pinned on the day it was posted"}
        onClick={() => setOpen((o) => !o)}
        data-journey="called_door"
      >
        <AtSign className="xcc-open__icon" aria-hidden />
        <span className="xcc-open__label">{plot ? plot.handle : 'Plot a handle'}</span>
      </button>
      {open && (
        <div className="xcc-pop" role="dialog" aria-label="Plot a handle">
          <div className="xcc-pop__head">
            <p className="xcc-pop__title">Called it</p>
            <button type="button" className="xcc-pop__x" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <p className="xcc-pop__lede">
            Type an X handle. Every post where the account took a side on {symbol} is pinned to the day it was posted and judged by what the price did next.
          </p>
          <HandleDoor
            variant="chart"
            symbol={symbol}
            initialHandle={plot?.handle ?? ''}
            side={plot?.side ?? 'all'}
            onPlot={(h, s) => {
              useCalled.getState().plotHandle(h, s)
              setOpen(false)
            }}
          />
        </div>
      )}
    </span>
  )
}
