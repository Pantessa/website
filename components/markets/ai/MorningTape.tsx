'use client'

// MK2/AI — the morning tape: one brief across the watchlist, for the top of
// the /markets rail. `POST /api/markets/brief { part: 'tape', symbols }` —
// the model narrates OUR rows (last, 24h, verdict, S1/R1 per symbol) and
// ends with chips from the biggest movers' own menus. Shared cache keyed on
// the sorted symbol set only. With no `symbols` prop it reads the rail's
// active list (useWatchlists) so the rail mounts it with just `onAsk`; a
// `symbols` prop overrides that read (it never reads the wallet itself —
// the rail does that for the page). COMPACT in a rail: collapsed by
// default to a one-line header + the first sentence, open on click to a
// bounded body that scrolls inside; remembered per browser.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Newspaper, RefreshCw } from 'lucide-react'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'
import { TAPE_FOOTNOTE } from '@/lib/markets-copy'
import { firstSentenceOf, tapeSymbols, type AiChip, type BriefEvent } from '@/lib/markets-ai'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import '../ai.css'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'

export const TAPE_OPEN_KEY = 'pantessa.markets.tape'

export type MorningTapeProps = { symbols?: readonly string[]; onAsk: (ask: string) => void; title?: string }

export default function MorningTape({ symbols: symbolsProp, onAsk, title = 'Morning tape' }: MorningTapeProps) {
  // The rail beside it is the page's one holdings reader; this instance keeps
  // the lists (fills included, through the hook's announcement) without a
  // second wallet read or a second reconcile.
  const wl = useWatchlists({ holdings: false })
  const symbols = useMemo(() => tapeSymbols(symbolsProp ?? wl.active?.symbols ?? []), [symbolsProp, wl.active?.symbols])
  const key = symbols.join(',')
  const [phase, setPhase] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [text, setText] = useState('')
  const [chips, setChips] = useState<AiChip[]>([])
  // The tape's chips span symbols; each Sell shows only while the connected
  // wallet holds that symbol (lib/sell-gate reads it from the sentence).
  const held = useHeld()
  const tradable = useTradable()
  const shown = useMemo(() => chips.filter((c) => canSellAsk(c.ask, held) && canTradeAsk(c.ask, tradable)), [chips, held, tradable])
  const [meta, setMeta] = useState<{ cached: boolean; model: string; feed: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  // Collapsed by default (a rail is ~850px tall; the whole tape was ~500 of
  // it); the choice is remembered per browser.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TAPE_OPEN_KEY) === '1') setOpen(true)
    } catch {
      /* default closed */
    }
  }, [])
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(TAPE_OPEN_KEY, o ? '0' : '1')
      } catch {
        /* per-browser convenience only */
      }
      return !o
    })
  }

  useEffect(() => {
    if (!key) {
      setPhase('idle')
      setText('')
      setChips([])
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('streaming')
    setText('')
    setChips([])
    setMeta(null)
    setError(null)
    void (async () => {
      try {
        const res = await fetch('/api/markets/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ part: 'tape', symbols: key.split(',') }), signal: ctrl.signal })
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error ?? `HTTP ${res.status}`)
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const raw = buf.slice(0, nl)
            buf = buf.slice(nl + 1)
            if (!raw.trim()) continue
            let ev: BriefEvent
            try {
              ev = JSON.parse(raw) as BriefEvent
            } catch {
              continue
            }
            if (ev.type === 'meta') setMeta({ cached: ev.cached, model: ev.model, feed: ev.feed })
            else if (ev.type === 'text') setText((t) => t + ev.text)
            else if (ev.type === 'chips') setChips(ev.chips)
            else if (ev.type === 'error') setError(ev.reason)
          }
        }
        setPhase('done')
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).message)
        setPhase('error')
      }
    })()
    return () => ctrl.abort()
  }, [key, nonce])

  if (!key) return null
  const streaming = phase === 'streaming'
  const firstSentence = firstSentenceOf(text)
  return (
    <section className={`mk-ai mk-ai--tape${open ? ' is-open' : ''}`} data-slot="MorningTape" data-lane="AI" data-phase={phase} data-open={open ? '1' : '0'} aria-busy={streaming}>
      <button type="button" className="mk-ai__tape-bar" onClick={toggle} aria-expanded={open} aria-controls="mk-ai-tape-body">
        {open ? <ChevronDown className="mk-ai__ico" aria-hidden /> : <ChevronRight className="mk-ai__ico" aria-hidden />}
        <Newspaper className="mk-ai__ico mk-ai__ico--accent" aria-hidden />
        <span className="mk-ai__tape-title">{title}</span>
        <span className="mk-ai__eyebrow mono">
          {symbols.length} SYMBOL{symbols.length === 1 ? '' : 'S'}
          {streaming ? ' · WRITING' : meta?.cached ? ' · SHARED' : phase === 'error' ? ' · UNAVAILABLE' : ''}
        </span>
      </button>
      {!open ? (
        <p className="mk-ai__p mk-ai__tape-lead">
          {firstSentence || (streaming ? `Reading ${symbols.length} tapes` : error ? error : '')}
          {streaming && !firstSentence ? <span className="mk-ai__caret" aria-hidden /> : null}
        </p>
      ) : (
        <div id="mk-ai-tape-body" className="mk-ai__tape-body">
          <div className="mk-ai__tape-syms">
            {symbols.map((s) => (
              <b key={s}>{s}</b>
            ))}
            {meta?.feed?.startsWith('missing') ? <span>· no chart for {meta.feed.slice(9)}</span> : null}
            <button type="button" className="mk-ai__ghost mk-ai__ghost--sm" onClick={() => setNonce((n) => n + 1)} disabled={streaming} aria-label="Reread the tape" title="Reread">
              <RefreshCw className={`mk-ai__ico${streaming ? ' mk-ai__ico--spin' : ''}`} aria-hidden />
            </button>
          </div>
          <div className="mk-ai__body">
            {text ? (
              <p className="mk-ai__p">
                {text}
                {streaming ? <span className="mk-ai__caret" aria-hidden /> : null}
              </p>
            ) : streaming ? (
              <p className="mk-ai__p mk-ai__p--wait">
                Reading {symbols.length} tapes
                <span className="mk-ai__caret" aria-hidden />
              </p>
            ) : null}
            {error ? <p className="mk-ai__err">{error}</p> : null}
          </div>
          {shown.length ? (
            <div className="mk-ai__chips" role="group" aria-label="Act on the tape">
              {shown.map((c) => (
                <button key={c.id} type="button" className={`mk-ai__chip mk-ai__chip--${c.kind}`} onClick={() => onAsk(c.ask)} title={c.ask} data-ask={c.ask}>
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
          <footer className="mk-ai__foot mono">
            <span>{TAPE_FOOTNOTE}</span>
            <span>·</span>
            <span>Written by a model from our own tape</span>
          </footer>
        </div>
      )}
    </section>
  )
}
