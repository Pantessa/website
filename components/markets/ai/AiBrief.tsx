'use client'

// MK2/AI — the symbol brief (README "Slots": AiBrief). TradingView's page
// has no one in it who has read the tape; this one has. Four to six
// sentences streamed from `POST /api/markets/brief` — our candles, our
// 26-indicator table, our news ladder, the session — ending in two to
// four chips that EXECUTE (the chip-send contract: a click sends through
// `onAsk`; the wallet signature is the gate). The brief is shared and
// cached per symbol+tf; when a wallet is connected a second, uncached,
// address-keyed call adds "your position" underneath. Footer: the tape
// footnote + who wrote it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useSession } from '@/lib/session'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import { useAskDoor } from '@/lib/ask-door'
import { TAPE_FOOTNOTE } from '@/lib/markets-copy'
import type { ChartPair, ChartTf } from '@/lib/charts'
import type { AiChip, BriefEvent } from '@/lib/markets-ai'
import '../ai.css'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'

export type AiBriefProps = { symbol: string; pair: ChartPair; tf?: ChartTf; onAsk: (ask: string) => void }

type Phase = 'idle' | 'streaming' | 'done' | 'error'

export const BRIEF_BYLINE = 'Written by a model from our own tape'

export default function AiBrief({ symbol, pair, tf = '1h', onAsk }: AiBriefProps) {
  const { walletAddress } = useSession()
  const [phase, setPhase] = useState<Phase>('idle')
  const [text, setText] = useState('')
  const [chips, setChips] = useState<AiChip[]>([])
  const [meta, setMeta] = useState<{ cached: boolean; asOf: number; model: string; feed: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<{ text: string; held: boolean } | null>(null)
  const [nonce, setNonce] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (signal: AbortSignal) => {
      setPhase('streaming')
      setText('')
      setChips([])
      setMeta(null)
      setError(null)
      try {
        const res = await fetch('/api/markets/brief', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: pair.symbol, tf }),
          signal,
        })
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
            if (ev.type === 'meta') setMeta({ cached: ev.cached, asOf: ev.asOf, model: ev.model, feed: ev.feed })
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
    },
    [pair.symbol, tf],
  )

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load, nonce])

  // The position paragraph: only with a wallet, only after the shared brief
  // has landed (one call, uncached, address-keyed on the server).
  useEffect(() => {
    if (!walletAddress || phase !== 'done') {
      setPosition(null)
      return
    }
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/api/markets/brief', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: pair.symbol, tf, part: 'position', address: walletAddress }),
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const j = (await res.json()) as { text: string; held: boolean }
        setPosition(j)
      } catch {
        /* fail-soft */
      }
    })()
    return () => ctrl.abort()
  }, [walletAddress, phase, pair.symbol, tf])

  // The brief is shared across viewers, so its Sell chips are this viewer's
  // call: shown only while the connected wallet holds the token (lib/sell-gate).
  const held = useHeld()
  const tradable = useTradable()
  const shown = useMemo(() => chips.filter((c) => canSellAsk(c.ask, held) && canTradeAsk(c.ask, tradable)), [chips, held, tradable])

  // The ⌘K door's suggestion row shows this brief's chips while the page is
  // up (lib/ask-door askDoorChips merges them on /t/<sym>).
  const setBriefChips = useAskDoor((s) => s.setBriefChips)
  useEffect(() => {
    setBriefChips(shown.length ? { symbol: pair.symbol, chips: shown.map((c) => ({ label: c.label, ask: c.ask })) } : null)
    return () => setBriefChips(null)
  }, [shown, pair.symbol, setBriefChips])

  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim())
  const streaming = phase === 'streaming'
  const age = meta ? ageWords(meta.asOf) : null

  return (
    <section className="mk-ai mk-ai--brief" data-slot="AiBrief" data-lane="AI" data-phase={phase} aria-busy={streaming}>
      <header className="mk-ai__head">
        <span className="mk-ai__title">
          <Sparkles className="mk-ai__ico" aria-hidden />
          {symbol} brief
        </span>
        <span className="mk-ai__eyebrow mono">
          {streaming ? 'WRITING' : meta?.cached ? `WRITTEN ${age}` : phase === 'done' ? 'JUST WRITTEN' : phase === 'error' ? 'UNAVAILABLE' : 'READING THE TAPE'}
          {' · '}
          {tf.toUpperCase()}
        </span>
        <button type="button" className="mk-ai__ghost" onClick={() => setNonce((n) => n + 1)} disabled={streaming} aria-label="Reread the brief" title="Reread">
          <RefreshCw className={`mk-ai__ico${streaming ? ' mk-ai__ico--spin' : ''}`} aria-hidden />
        </button>
      </header>

      <div className="mk-ai__body">
        {paragraphs.length ? (
          paragraphs.map((p, i) => (
            <p key={i} className="mk-ai__p">
              {p}
              {streaming && i === paragraphs.length - 1 ? <span className="mk-ai__caret" aria-hidden /> : null}
            </p>
          ))
        ) : streaming ? (
          <p className="mk-ai__p mk-ai__p--wait">
            Reading {symbol}&rsquo;s tape, technicals and headlines
            <span className="mk-ai__caret" aria-hidden />
          </p>
        ) : null}
        {error ? <p className="mk-ai__err">{error}</p> : null}
      </div>

      {shown.length ? (
        <div className="mk-ai__chips" role="group" aria-label={`Act on ${symbol}`}>
          {shown.map((c) => (
            <button key={c.id} type="button" className={`mk-ai__chip mk-ai__chip--${c.kind}`} onClick={() => onAsk(c.ask)} title={c.ask} data-ask={c.ask}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {position ? (
        <div className={`mk-ai__pos${position.held ? ' mk-ai__pos--held' : ''}`} data-held={position.held ? '1' : '0'}>
          <span className="mk-ai__eyebrow mono">YOUR POSITION</span>
          <p className="mk-ai__p">{position.text}</p>
        </div>
      ) : null}

      <footer className="mk-ai__foot mono">
        <span>{TAPE_FOOTNOTE}</span>
        <span>·</span>
        <span>{BRIEF_BYLINE}</span>
        {meta?.model ? (
          <>
            <span>·</span>
            <span>{meta.model}</span>
          </>
        ) : null}
      </footer>
    </section>
  )
}

function ageWords(asOfSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - asOfSec)
  if (s < 60) return 'JUST NOW'
  const m = Math.floor(s / 60)
  return `${m} MIN AGO`
}
