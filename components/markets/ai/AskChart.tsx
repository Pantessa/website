'use client'

// Ask the chart — the symbol page's chart conversation (2026-09-24; trades
// leave for the app since 2026-11-16).
//
// Docked under the chart: what is on screen is the context. Every message
// goes to the chart lane (`POST /api/markets/ask`, never a turn on
// /api/chat) with the panel's last exchanges as DATA, and comes back as ONE
// typed answer, decided server-side:
//   chart  → applied through `onChartState` ("draw a line at 180")
//   alert  → a preview card; "Set alert" posts the rule to /api/alerts
//            (SIWE-gated there — the unified door when signed out)
//   answer → prose about what is on screen
//   act    → a trade. It OPENS IN THE APP: the panel hands the sentence to
//            the page (`onAsk`), which carries it to /chat with the apps it
//            needs (lib/symbol-ask, lib/arrival-intent) through the
//            connect-to-act door. A typed complete ask goes as typed; a
//            model's reading of a looser question is printed first
//            ("Reading that as …").
// From 09-24 to 11-16 an act BUILT here, in an order ticket beside the
// conversation (the /i runtime, docked). Nate on /t/AAPL, 2026-11-16: "let's
// not direct AI chat buys or questions to an embed, let's send them to the
// app page". So this panel mounts no chat runtime: it reads the chart, draws
// on it and watches it; anything a wallet signs happens in the app.
// The mic is the existing VoiceButton; a spoken message is normalized and
// submitted like a typed one.

import { notAnswering, shownError } from '@/lib/fetch-words'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { ArrowUp, ArrowUpRight, Bell, LineChart, MessageSquare, Send } from 'lucide-react'
import VoiceButton from '@/components/VoiceButton'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import { normalizeSpokenAsk } from '@/lib/voice-ask'
import { hoverBarLabel, useChartHover, type HoverBar } from '@/lib/markets-ai-hover'
// The suggestion row's grammar is pure (no React, no CSS) so the harness
// pins every act entry through the ladder replica without rendering.
import { askChartSuggestions } from '@/lib/markets-ai-suggestions'
import { capTurns, historyFor, type ChartTurn, type TurnVia } from '@/lib/ask-chart-thread'
import type { ChartPair } from '@/lib/charts'
import type { ChartState } from '@/lib/chart-state'
import type { AskAnswer } from '@/lib/markets-ai'
import '../ai.css'

export type AskChartProps = {
  symbol: string
  pair: ChartPair
  chartState?: ChartState
  visible?: { from: number; to: number }
  /** Hand a trade to the app: the page's act door (connect to act, then the
   *  arrival handoff to /chat with the apps the ask needs). */
  onAsk?: (ask: string) => void
  onChartState?: (s: ChartState) => void
}

type Reply = AskAnswer & { deterministic: boolean; model: string }

/** The no-JS fallback behind an act chip: a prefill, never a fired turn. */
const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export default function AskChart({ symbol, pair, chartState, visible, onAsk, onChartState }: AskChartProps) {
  const { walletAddress, address: signedIn } = useSession()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<ChartTurn[]>([])
  const [alerts, setAlerts] = useState<Record<string, { state: 'saving' | 'saved' | 'error'; err?: string }>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const turnsRef = useRef<ChartTurn[]>([])
  useEffect(() => {
    turnsRef.current = turns
  }, [turns])

  const patchTurn = useCallback((id: string, patch: (t: ChartTurn) => ChartTurn) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? patch(t) : t)))
  }, [])
  const pushTurn = useCallback((t: ChartTurn) => setTurns((ts) => capTurns([...ts, t])), [])

  const suggestions = useMemo(() => askChartSuggestions(symbol, pair), [symbol, pair])
  // "Explain this": the bar under the chart's crosshair (lib/markets-ai-hover,
  // reported by the chart) or, until the chart reports, the window's last bar.
  const hover = useChartHover((st) => (st.symbol === pair.symbol ? st.bar : null))
  // Crosshair fallback through the ChartState: the newest drawing that
  // carries a TIME (a note, a trend line's end) names the bar the user was
  // looking at; else the window's last bar.
  const markedT = useMemo(() => {
    const times = (chartState?.lines ?? []).map((l) => (l.kind === 'note' || l.kind === 'vline' ? l.t : l.kind === 'trend' || l.kind === 'fib' ? l.t2 : null)).filter((t): t is number => typeof t === 'number' && t > 0)
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

  // ── A trade opens in the app ────────────────────────────────────────────
  // The turn keeps the sentence (`sent`) so a visitor who closed the connect
  // door, or came back, can send it again; the page's door does the rest.
  const toApp = useCallback(
    (turnId: string, ask: string) => {
      patchTurn(turnId, (t) => ({ ...t, sent: ask }))
      onAsk?.(ask)
    },
    [patchTurn, onAsk],
  )

  // ── The chart lane ──────────────────────────────────────────────────────
  const ask = useCallback(
    async (text: string, via: TurnVia) => {
      const said = text.trim()
      if (!said || busy) return
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const id = newId()
      const before = turnsRef.current
      pushTurn({ id, said, via })
      setBusy(true)
      setQ('')
      try {
        const res = await fetch('/api/markets/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            symbol: pair.symbol,
            question: said,
            tf: chartState?.tf,
            ...(chartState ? { chartState } : {}),
            ...(visible ? { visible } : {}),
            ...(walletAddress ? { address: walletAddress } : {}),
            history: historyFor(before),
          }),
          signal: ctrl.signal,
        })
        const j = (await res.json().catch(() => ({}))) as Reply | { error?: string }
        if (!res.ok || !('kind' in j)) {
          patchTurn(id, (t) => ({ ...t, error: (j as { error?: string }).error ?? notAnswering('The chart assistant', 'Ask again in a moment; the order ticket still trades.') }))
          return
        }
        const reply = j
        patchTurn(id, (t) => ({ ...t, reply }))
        if (reply.kind === 'chart') onChartState?.(reply.state)
        if (reply.kind === 'act') toApp(id, reply.chip.ask)
        // No order lives on this page, so the lane is never told of one and
        // never relays; a stray relay is the visitor's own words, for the app.
        if (reply.kind === 'relay') toApp(id, said)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        patchTurn(id, (t) => ({ ...t, error: shownError(e, 'The chart assistant') }))
      } finally {
        if (abortRef.current === ctrl) setBusy(false)
      }
    },
    [busy, pair.symbol, chartState, visible, walletAddress, pushTurn, patchTurn, onChartState, toApp],
  )

  const explain = useCallback(async () => {
    if (!explainBar || busy) return
    const id = newId()
    pushTurn({ id, said: explainMode === 'last' ? 'Explain the last bar' : hoverBarLabel(explainBar, chartState?.tf), via: 'explain' })
    setBusy(true)
    try {
      const res = await fetch('/api/markets/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: pair.symbol, tf: chartState?.tf, kind: 'explain', bar: explainBar }) })
      const j = (await res.json().catch(() => ({}))) as Reply | { error?: string }
      if ('kind' in j) patchTurn(id, (t) => ({ ...t, reply: j }))
      else patchTurn(id, (t) => ({ ...t, error: (j as { error?: string }).error ?? notAnswering('The chart assistant') }))
    } catch (e) {
      patchTurn(id, (t) => ({ ...t, error: shownError(e, 'The chart assistant') }))
    } finally {
      setBusy(false)
    }
  }, [explainBar, busy, explainMode, pair.symbol, chartState?.tf, pushTurn, patchTurn])

  // An act suggestion opens in the app on one tap (the tap is the send); a
  // modified click keeps the link's own meaning (a new tab on the `?prompt=`
  // prefill).
  const appOnClick = useCallback(
    (ask: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      onAsk?.(ask)
    },
    [onAsk],
  )
  const hasAct = useMemo(() => suggestions.some((s) => s.kind === 'act'), [suggestions])

  // The conversation pins to its newest turn (its own scroll, never the page's).
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  useEffect(() => () => abortRef.current?.abort(), [])
  // A new symbol is a new conversation.
  useEffect(() => {
    setTurns([])
    setAlerts({})
    setQ('')
  }, [pair.symbol])

  const setAlert = async (turnId: string, reply: Extract<Reply, { kind: 'alert' }>) => {
    setAlerts((a) => ({ ...a, [turnId]: { state: 'saving' } }))
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: reply.rule.symbol, condition: reply.rule.condition, value: reply.rule.value, basePrice: reply.rule.basePrice ?? null, actionAsk: reply.actionAsk ?? null }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? notAnswering('Alerts', 'Nothing was saved; try again in a moment.'))
      setAlerts((a) => ({ ...a, [turnId]: { state: 'saved' } }))
    } catch (e) {
      setAlerts((a) => ({ ...a, [turnId]: { state: 'error', err: shownError(e, 'Alerts', 'Nothing was saved; try again in a moment.') } }))
    }
  }

  const talking = turns.length > 0 || busy

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

      <div className="mk-ask">
        <div className="mk-ask__talk">
          {talking ? (
            <ol ref={logRef} className="mk-ask__log" aria-live="polite">
              {turns.map((t) => (
                <li key={t.id} className="mk-ask__turn" data-via={t.via} data-kind={t.reply?.kind ?? 'wait'}>
                  <p className="mk-ask__you">{t.said}</p>
                  <TurnBody turn={t} alert={alerts[t.id]} signedIn={!!signedIn} onSetAlert={(r) => void setAlert(t.id, r)} onSendAgain={(sent) => onAsk?.(sent)} />
                </li>
              ))}
              {busy ? (
                <li className="mk-ask__turn mk-ask__turn--wait" aria-label="Answering">
                  <span className="mk-ai__caret" aria-hidden />
                </li>
              ) : null}
            </ol>
          ) : null}

          <form
            className="mk-ai__form"
            onSubmit={(e) => {
              e.preventDefault()
              void ask(q, 'typed')
            }}
          >
            <input
              ref={inputRef}
              className="mk-ai__input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              // A chart with no order of its own (a look-only index, a builder market — `hasAct` is the
              // page's own grammar, lib/markets-ai-suggestions) is never handed an order to type.
              placeholder={
                hasAct
                  ? talking ? `Ask a follow-up about the chart…` : `Draw a line at…, alert me at…, or ask what the chart shows`
                  : talking ? `Ask a follow-up…` : `Draw a line at…, alert me at…, or ask why ${symbol} is moving`
              }
              aria-label={`Ask about the ${symbol} chart`}
              maxLength={400}
              disabled={busy}
            />
            <VoiceButton className="mk-ai__mic" onInterim={(t) => setQ(t)} onFinal={(t) => void ask(normalizeSpokenAsk(t), 'voice')} onCancel={() => setQ('')} disabled={busy} />
            <button type="submit" className="mk-ai__send" disabled={busy || !q.trim()} aria-label="Ask">
              <ArrowUp className="mk-ai__ico" aria-hidden />
            </button>
          </form>

          {!talking ? (
            <div className="mk-ai__sugg" role="group" aria-label="Suggestions">
              {suggestions.map((s) =>
                s.kind === 'act' ? (
                  // A real link (the /chat prefill: no-JS, a new tab); a plain
                  // click SENDS it to the app through the page's act door.
                  <Link key={s.ask} href={promptHref(s.ask)} className="mk-ai__sugg-chip mk-ai__sugg-chip--act" title={s.ask} data-ask={s.ask} data-sugg="act" onClick={appOnClick(s.ask)}>
                    <Send className="mk-ai__ico mk-ai__ico--inline" aria-hidden />
                    {s.label}
                  </Link>
                ) : (
                  <button key={s.q} type="button" className="mk-ai__sugg-chip" data-sugg="question" onClick={() => void ask(s.q, 'chip')}>
                    {s.label}
                  </button>
                ),
              )}
              {explainBar ? (
                <button type="button" className={`mk-ai__sugg-chip${explainMode !== 'last' ? ' mk-ai__sugg-chip--hover' : ''}`} onClick={() => void explain()} data-explain={explainMode} title={`${explainBar.o} → ${explainBar.c}`}>
                  {explainMode === 'last' ? 'Explain the last bar' : hoverBarLabel(explainBar, chartState?.tf)}
                </button>
              ) : null}
              {hasAct ? <span className="mk-ai__sugg-foot mk-ai__eyebrow mono">A TRADE OPENS IN THE APP · YOUR WALLET SIGNS · THE REST ANSWER HERE</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function TurnBody({
  turn,
  alert,
  signedIn,
  onSetAlert,
  onSendAgain,
}: {
  turn: ChartTurn
  alert?: { state: 'saving' | 'saved' | 'error'; err?: string }
  signedIn: boolean
  onSetAlert: (r: Extract<Reply, { kind: 'alert' }>) => void
  onSendAgain: (ask: string) => void
}) {
  const reply = turn.reply as Reply | null | undefined
  return (
    <div className={`mk-ai__reply${reply ? ` mk-ai__reply--${reply.kind}` : ''}`} data-kind={reply?.kind ?? 'none'} data-deterministic={reply?.deterministic ? '1' : '0'}>
      {reply?.kind === 'chart' ? (
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
      {reply?.kind === 'act' && !reply.typed ? (
        <p className="mk-ai__p mk-ask__reading">
          Reading that as <b>{reply.chip.ask}</b>
        </p>
      ) : null}
      {reply?.kind === 'alert' ? (
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
            {alert?.state === 'saved' ? (
              <span className="mk-ai__eyebrow mono">SAVED · WATCHING</span>
            ) : signedIn ? (
              <button type="button" className="mk-ai__cta" onClick={() => onSetAlert(reply)} disabled={alert?.state === 'saving'}>
                {alert?.state === 'saving' ? 'Saving…' : 'Set alert'}
              </button>
            ) : (
              <CreateAccountButton className="mk-ai__cta" label="Sign in to set alerts" />
            )}
          </div>
          {alert?.err ? <p className="mk-ai__err">{alert.err}</p> : null}
        </>
      ) : null}
      {reply?.kind === 'answer' ? (
        <>
          {reply.text.split(/\n\n+/).map((p, i) => (
            <p key={i} className="mk-ai__p">
              {p}
            </p>
          ))}
          {reply.overlays?.length ? <span className="mk-ai__eyebrow mono">OVERLAYS · {reply.overlays.join(' ').toUpperCase()}</span> : null}
        </>
      ) : null}
      {turn.sent ? (
        <button type="button" className="mk-ask__run" data-status="sent" onClick={() => onSendAgain(turn.sent!)} title="Send it to the app again">
          <span className="mk-ask__dot" aria-hidden />
          <span className="mk-ask__run-ask">{turn.sent}</span>
          <span className="mk-ask__run-status mono">
            Opens in the app <ArrowUpRight className="mk-ai__ico mk-ai__ico--inline" aria-hidden />
          </span>
        </button>
      ) : null}
      {turn.error ? <p className="mk-ai__err">{turn.error}</p> : null}
      {reply && reply.kind !== 'relay' && !turn.sent ? (
        <footer className="mk-ai__foot mono">
          <span>{reply.deterministic ? 'Answered by the page, no model' : `Written by ${reply.model}`}</span>
          <span>·</span>
          <span>not advice</span>
        </footer>
      ) : null}
    </div>
  )
}
