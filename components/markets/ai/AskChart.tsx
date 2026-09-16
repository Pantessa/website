'use client'

// MK2/AI — the chart-aware ask box (README "Slots": AskChart). Docked under
// the chart: what is on screen is the context. One isolated call to
// `POST /api/markets/ask` (never a turn on /api/chat) comes back as ONE of
// four typed answers, decided server-side:
//   chart  → applied through `onChartState` ("draw a line at 180")
//   act    → a chip the user CLICKS to send through `onAsk` (never auto)
//   alert  → a preview card; "Set alert" posts the rule to /api/alerts
//            (SIWE-gated there — the unified door when signed out)
//   answer → prose
// The mic is the existing VoiceButton; a spoken question is normalized
// and submitted like a typed one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bell, LineChart, MessageSquare, Send } from 'lucide-react'
import VoiceButton from '@/components/VoiceButton'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import { normalizeSpokenAsk } from '@/lib/voice-ask'
import { hoverBarLabel, useChartHover, type HoverBar } from '@/lib/markets-ai-hover'
import type { ChartPair } from '@/lib/charts'
import type { ChartState } from '@/lib/chart-state'
import type { AskAnswer } from '@/lib/markets-ai'
import '../ai.css'

export type AskChartProps = {
  symbol: string
  pair: ChartPair
  chartState?: ChartState
  visible?: { from: number; to: number }
  onAsk: (ask: string) => void
  onChartState?: (s: ChartState) => void
}

type Reply = (AskAnswer & { deterministic: boolean; model: string }) | null

/** The suggestion row — every entry is a deterministic door on the server
 *  (a draw, an alert, a complete ask) or a question the model answers. */
export function askChartSuggestions(symbol: string, pair: ChartPair): { label: string; q: string }[] {
  const perp = pair.source === 'hyperliquid'
  return [
    { label: 'Draw support and resistance', q: 'Draw the support and resistance levels' },
    { label: "What's the trend on screen?", q: `What is the trend in the ${symbol} candles on screen?` },
    { label: 'Alert me on a 5% move', q: `Tell me when ${symbol} moves 5%` },
    { label: perp ? `Long $25 of ${symbol}` : `Buy $25 of ${symbol}`, q: perp ? `Long $25 of ${symbol} on Hyperliquid` : `Buy $25 of ${symbol}` },
  ]
}

export default function AskChart({ symbol, pair, chartState, visible, onAsk, onChartState }: AskChartProps) {
  const { walletAddress, address: signedIn } = useSession()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [alertErr, setAlertErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const here = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`

  const suggestions = useMemo(() => askChartSuggestions(symbol, pair), [symbol, pair])
  // "Explain this": the bar under the chart's crosshair (lib/markets-ai-hover,
  // reported by the chart) or, until the chart reports, the window's last bar.
  const hover = useChartHover((st) => (st.symbol === pair.symbol ? st.bar : null))
  // Crosshair fallback through the ChartState: the newest drawing that
  // carries a TIME (a note, a trend line's end) names the bar the user was
  // looking at; else the window's last bar.
  const markedT = useMemo(() => {
    const times = (chartState?.lines ?? []).map((l) => (l.kind === 'note' ? l.t : l.kind === 'trend' ? l.t2 : null)).filter((t): t is number => typeof t === 'number' && t > 0)
    return times.length ? times[times.length - 1] : null
  }, [chartState])
  const [lastBar, setLastBar] = useState<{ bar: HoverBar; marked: boolean } | null>(null)
  useEffect(() => {
    if (hover) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(pair.symbol)}&tf=${chartState?.tf ?? '1h'}`, { signal: ctrl.signal })
        const j = (await res.json()) as { candles?: HoverBar[] }
        const candles = j.candles ?? []
        const marked = markedT ? [...candles].reverse().find((c) => c.t <= markedT) : undefined
        const pick = marked ?? candles[candles.length - 1]
        if (pick) setLastBar({ bar: pick, marked: !!marked })
      } catch {
        /* no chip */
      }
    })()
    return () => ctrl.abort()
  }, [pair.symbol, chartState?.tf, hover, markedT])
  const explainBar = hover ?? lastBar?.bar ?? null
  const explainMode: 'hover' | 'marked' | 'last' = hover ? 'hover' : lastBar?.marked ? 'marked' : 'last'
  const explain = useCallback(async () => {
    if (!explainBar || busy) return
    setBusy(true)
    setAsked(explainMode === 'last' ? 'Explain the last bar' : hoverBarLabel(explainBar, chartState?.tf))
    setReply(null)
    try {
      const res = await fetch('/api/markets/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: pair.symbol, tf: chartState?.tf, kind: 'explain', bar: explainBar }) })
      const j = (await res.json().catch(() => ({}))) as (AskAnswer & { deterministic: boolean; model: string }) | { error?: string }
      setReply('kind' in j ? j : { kind: 'answer', text: (j as { error?: string }).error ?? `HTTP ${res.status}`, deterministic: true, model: 'none' })
    } catch (e) {
      setReply({ kind: 'answer', text: (e as Error).message, deterministic: true, model: 'none' })
    } finally {
      setBusy(false)
    }
  }, [explainBar, busy, explainMode, pair.symbol, chartState?.tf])

  const submit = useCallback(
    async (question: string) => {
      const text = question.trim()
      if (!text || busy) return
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setBusy(true)
      setAsked(text)
      setReply(null)
      setAlertState('idle')
      setAlertErr(null)
      try {
        const res = await fetch('/api/markets/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            symbol: pair.symbol,
            question: text,
            tf: chartState?.tf,
            ...(chartState ? { chartState } : {}),
            ...(visible ? { visible } : {}),
            ...(walletAddress ? { address: walletAddress } : {}),
          }),
          signal: ctrl.signal,
        })
        const j = (await res.json().catch(() => ({}))) as (AskAnswer & { deterministic: boolean; model: string }) | { error?: string }
        if (!res.ok || !('kind' in j)) {
          setReply({ kind: 'answer', text: (j as { error?: string }).error ?? `HTTP ${res.status}`, deterministic: true, model: 'none' })
        } else {
          setReply(j)
          if (j.kind === 'chart') onChartState?.(j.state)
        }
        setQ('')
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setReply({ kind: 'answer', text: (e as Error).message, deterministic: true, model: 'none' })
      } finally {
        if (abortRef.current === ctrl) setBusy(false)
      }
    },
    [busy, pair.symbol, chartState, visible, walletAddress, onChartState],
  )

  useEffect(() => () => abortRef.current?.abort(), [])
  // A new symbol is a new conversation.
  useEffect(() => {
    setReply(null)
    setAsked(null)
    setQ('')
  }, [pair.symbol])

  const setAlert = async () => {
    if (!reply || reply.kind !== 'alert') return
    setAlertState('saving')
    setAlertErr(null)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: reply.rule.symbol, condition: reply.rule.condition, value: reply.rule.value, basePrice: reply.rule.basePrice ?? null, actionAsk: reply.actionAsk ?? null }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setAlertState('saved')
    } catch (e) {
      setAlertErr((e as Error).message)
      setAlertState('error')
    }
  }

  return (
    <section className="mk-ai mk-ai--ask" data-slot="AskChart" data-lane="AI" data-busy={busy ? '1' : '0'}>
      <header className="mk-ai__head">
        <span className="mk-ai__title">
          <MessageSquare className="mk-ai__ico" aria-hidden />
          Ask the chart
        </span>
        <span className="mk-ai__eyebrow mono">
          {chartState?.lines.length ? `${chartState.lines.length} DRAWING${chartState.lines.length === 1 ? '' : 'S'} · ` : ''}
          {visible ? 'WHAT’S ON SCREEN IS THE CONTEXT' : 'THE LIVE WINDOW IS THE CONTEXT'}
        </span>
      </header>

      <form
        className="mk-ai__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(q)
        }}
      >
        <input
          ref={inputRef}
          className="mk-ai__input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Draw a line at…, tell me when ${symbol} crosses…, what's the trend?`}
          aria-label={`Ask about the ${symbol} chart`}
          maxLength={400}
          disabled={busy}
        />
        <VoiceButton className="mk-ai__mic" onInterim={(t) => setQ(t)} onFinal={(t) => void submit(normalizeSpokenAsk(t))} onCancel={() => setQ('')} disabled={busy} />
        <button type="submit" className="mk-ai__send" disabled={busy || !q.trim()} aria-label="Ask">
          <ArrowUp className="mk-ai__ico" aria-hidden />
        </button>
      </form>

      {!reply && !busy ? (
        <div className="mk-ai__sugg" role="group" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button key={s.q} type="button" className="mk-ai__sugg-chip" onClick={() => void submit(s.q)}>
              {s.label}
            </button>
          ))}
          {explainBar ? (
            <button type="button" className={`mk-ai__sugg-chip${explainMode !== 'last' ? ' mk-ai__sugg-chip--hover' : ''}`} onClick={() => void explain()} data-explain={explainMode} title={`${explainBar.o} → ${explainBar.c}`}>
              {explainMode === 'last' ? 'Explain the last bar' : hoverBarLabel(explainBar, chartState?.tf)}
            </button>
          ) : null}
        </div>
      ) : null}

      {busy ? (
        <p className="mk-ai__p mk-ai__p--wait">
          {asked ? <span className="mk-ai__asked">{asked}</span> : null}
          <span className="mk-ai__caret" aria-hidden />
        </p>
      ) : null}

      {reply ? (
        <div className={`mk-ai__reply mk-ai__reply--${reply.kind}`} data-kind={reply.kind} data-deterministic={reply.deterministic ? '1' : '0'}>
          {asked ? <span className="mk-ai__asked">{asked}</span> : null}
          {reply.kind === 'chart' ? (
            <>
              <p className="mk-ai__p">
                <LineChart className="mk-ai__ico mk-ai__ico--inline" aria-hidden />
                {reply.say}
              </p>
              <span className="mk-ai__eyebrow mono">
                {reply.added} LINE{reply.added === 1 ? '' : 'S'} ADDED TO THE CHART
              </span>
            </>
          ) : null}
          {reply.kind === 'act' ? (
            <>
              <p className="mk-ai__p">{reply.say}</p>
              <div className="mk-ai__chips">
                <button type="button" className="mk-ai__chip mk-ai__chip--buy" onClick={() => onAsk(reply.chip.ask)} title={reply.chip.ask} data-ask={reply.chip.ask}>
                  <Send className="mk-ai__ico mk-ai__ico--inline" aria-hidden />
                  {reply.chip.label}
                </button>
              </div>
              <span className="mk-ai__eyebrow mono">A CHIP SENDS · YOUR WALLET SIGNS</span>
            </>
          ) : null}
          {reply.kind === 'alert' ? (
            <>
              <p className="mk-ai__p">
                <Bell className="mk-ai__ico mk-ai__ico--inline" aria-hidden />
                {reply.say}
              </p>
              <div className="mk-ai__alert" data-condition={reply.rule.condition} data-value={reply.rule.value}>
                <span className="mk-ai__alert-label">
                  {reply.label}
                  {reply.actionAsk ? <span className="mk-ai__alert-then"> · then a chip: {reply.actionAsk}</span> : null}
                </span>
                {alertState === 'saved' ? (
                  <span className="mk-ai__eyebrow mono">SAVED · WATCHING</span>
                ) : signedIn ? (
                  <button type="button" className="mk-ai__cta" onClick={() => void setAlert()} disabled={alertState === 'saving'}>
                    {alertState === 'saving' ? 'Saving…' : 'Set alert'}
                  </button>
                ) : (
                  <CreateAccountButton className="mk-ai__cta" label="Sign in to set alerts" redirectTo={here} />
                )}
              </div>
              {alertErr ? <p className="mk-ai__err">{alertErr}</p> : null}
            </>
          ) : null}
          {reply.kind === 'answer' ? (
            <>
              {reply.text.split(/\n\n+/).map((p, i) => (
                <p key={i} className="mk-ai__p">
                  {p}
                </p>
              ))}
              {reply.overlays?.length ? <span className="mk-ai__eyebrow mono">OVERLAYS · {reply.overlays.join(' ').toUpperCase()}</span> : null}
            </>
          ) : null}
          <footer className="mk-ai__foot mono">
            <span>{reply.deterministic ? 'Answered by the page, no model' : `Written by ${reply.model}`}</span>
            <span>·</span>
            <span>not advice</span>
          </footer>
        </div>
      ) : null}
    </section>
  )
}
