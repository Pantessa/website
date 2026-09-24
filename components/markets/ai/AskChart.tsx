'use client'

// Ask the chart — the symbol page's conversation (2026-09-24).
//
// Docked under the chart: what is on screen is the context. Every message
// goes to the chart lane (`POST /api/markets/ask`, never a turn on
// /api/chat) with the panel's last exchanges and the order ticket's state as
// DATA, and comes back as ONE typed answer, decided server-side:
//   chart  → applied through `onChartState` ("draw a line at 180")
//   act    → BUILDS in the order ticket beside the conversation — the /i
//            runtime (ChatInterface `simple`, docked: this panel's composer
//            is the one place to type). The wallet signature is the gate
//            (standing rule 5: the confirmation IS the signature). A typed
//            complete ask builds as typed; a model's reading of a looser
//            question is printed above the build ("Reading that as …").
//   alert  → a preview card; "Set alert" posts the rule to /api/alerts
//            (SIWE-gated there — the unified door when signed out)
//   answer → prose
//   relay  → the message answers the TICKET (a detail it asked for, a pick
//            between its options): the user's own words go to it unchanged
// Nate on /t/TSLA: "be able to make transactions as they talk… they might
// want to stay in here vs firing up the app". So a trade stays on the chart
// it was asked about, and a signed fill lands on that chart (`onSigned`).
// Connect to act (lib/use-connect-to-act): no wallet → the connect-only door,
// and the held ask builds the moment one lands. "Open in the app" carries
// the ticket's thread to /chat for anyone who wants the full workspace.
// The mic is the existing VoiceButton; a spoken message is normalized and
// submitted like a typed one. The page's ⌘K door docks here (lib/ask-door).

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from 'wagmi'
import { ArrowUp, ArrowUpRight, Bell, CornerDownRight, LineChart, MessageSquare, RotateCcw, Send } from 'lucide-react'
import VoiceButton from '@/components/VoiceButton'
import CreateAccountButton from '@/components/CreateAccountButton'
import SpineLink from '@/components/SpineLink'
import { useSession } from '@/lib/session'
import { useYeetfulStore } from '@/lib/store'
import { normalizeSpokenAsk } from '@/lib/voice-ask'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { hoverBarLabel, useChartHover, type HoverBar } from '@/lib/markets-ai-hover'
// The suggestion row's grammar is pure (no React, no CSS) so the harness
// pins every act entry through the ladder replica without rendering.
import { askChartSuggestions } from '@/lib/markets-ai-suggestions'
import {
  ORDER_STATUS_LABEL,
  advanceStatus,
  capTurns,
  historyFor,
  latestRunIndex,
  orderContextFor,
  orderStatusOf,
  type ChartTurn,
  type SignedEvent,
  type TurnVia,
} from '@/lib/ask-chart-thread'
import type { ChartPair } from '@/lib/charts'
import type { ChartState } from '@/lib/chart-state'
import type { AskAnswer } from '@/lib/markets-ai'
import '../ai.css'

// The ticket's runtime is heavy (wagmi, the store, every card); it loads the
// first time a trade builds here.
const ChatInterface = dynamic(() => import('@/components/ChatInterface'), { ssr: false })

/** A door handoff (lib/ask-door `dock`): a draft to put in the composer, or
 *  a complete ask to build. `at` makes a repeat a fresh handoff. */
export type AskChartIncoming = { text: string; send: boolean; mcps?: string[]; at: number }

export type AskChartProps = {
  symbol: string
  pair: ChartPair
  chartState?: ChartState
  visible?: { from: number; to: number }
  /** Hand an ask to the full app (kept for the slot contract; the panel's
   *  own trades build in its ticket). */
  onAsk?: (ask: string) => void
  onChartState?: (s: ChartState) => void
  /** The page's ⌘K door, docked here. */
  incoming?: AskChartIncoming | null
  /** A trade in the ticket was signed — the page paints the fill. */
  onSigned?: (ev: SignedEvent) => void
}

type Reply = AskAnswer & { deterministic: boolean; model: string }
type TicketPrompt = { text: string; send: true; at: number; mcps?: string[] }
type RunMeta = { turnId: string; reading: boolean; mcps?: string[] }

/** The no-JS fallback behind an act chip: a prefill, never a fired turn. */
const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const smooth = (): ScrollBehavior => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

export default function AskChart({ symbol, pair, chartState, visible, onChartState, incoming, onSigned }: AskChartProps) {
  const { walletAddress, address: signedIn } = useSession()
  // wagmi reads 'connecting' for seconds after a load while the address is
  // already known; the ticket's runtime only sends an address once wagmi says
  // 'connected', so a send in that window came back "connect your wallet".
  const { status: wagmiStatus } = useAccount()
  const pathname = usePathname()
  const setCurrentChatId = useYeetfulStore((s) => s.setCurrentChatId)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<ChartTurn[]>([])
  const [alerts, setAlerts] = useState<Record<string, { state: 'saving' | 'saved' | 'error'; err?: string }>>({})
  // The order ticket: mounted on the first build, remounted by "New order".
  const [ticket, setTicket] = useState<{ key: number; prompt: TicketPrompt | null } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const ticketRef = useRef<HTMLElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const turnsRef = useRef<ChartTurn[]>([])
  const ticketNowRef = useRef<typeof ticket>(null)
  useEffect(() => {
    turnsRef.current = turns
    ticketNowRef.current = ticket
  }, [turns, ticket])

  const patchTurn = useCallback((id: string, patch: (t: ChartTurn) => ChartTurn) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? patch(t) : t)))
  }, [])
  const pushTurn = useCallback((t: ChartTurn) => setTurns((ts) => capTurns([...ts, t])), [])

  // The ticket's newest prose (its cards are not text) — what the chart lane
  // is told the ticket last said, so "yes" or "use my USDC" can relay.
  const ticketText = useYeetfulStore((s) => {
    if (!ticket) return null
    const chat = s.chats.find((c) => c.id === s.currentChatId)
    const last = chat ? [...chat.messages].reverse().find((m) => m.role === 'assistant') : undefined
    return last?.content ?? null
  })

  // The ticket's own chat: "Open in the app" lands on /chat/<id>, which
  // selects it (a guest's in-memory chat and a signed-in owner's saved one
  // alike) — a bare /chat would start a fresh thread.
  const ticketChatId = useYeetfulStore((s) => (ticket ? s.currentChatId : null))

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

  // ── The order ticket ────────────────────────────────────────────────────
  const showTicket = useCallback(() => {
    // Beside the conversation on a wide panel (already in view); under it
    // on a narrow one — bring it up without yanking a reader who is there.
    requestAnimationFrame(() => ticketRef.current?.scrollIntoView({ behavior: smooth(), block: 'nearest' }))
  }, [])

  // Put an ask in the ticket. The first build (or the first after "New
  // order") starts its own thread: never append an order into whatever chat
  // the visitor last had open (the ask door's and the /i runtime's rule).
  const mountsRef = useRef(0)
  const [heldSend, setHeldSend] = useState<{ text: string; mcps?: string[]; at: number } | null>(null)
  const [holdTick, setHoldTick] = useState(0)
  const sendToTicketNow = useCallback(
    (text: string, mcps?: string[]) => {
      const current = ticketNowRef.current
      if (!current) {
        setCurrentChatId(null)
        mountsRef.current += 1
      }
      const next = { key: current?.key ?? mountsRef.current, prompt: { text, send: true as const, at: Date.now(), ...(mcps?.length ? { mcps } : {}) } }
      ticketNowRef.current = next
      setTicket(next)
      showTicket()
    },
    [setCurrentChatId, showTicket],
  )
  // A wallet KNOWN but still settling holds the send, up to 10s (the ask
  // door's rule), so the ticket builds for the address instead of asking
  // the visitor to connect a wallet they already connected.
  const sendToTicket = useCallback(
    (text: string, mcps?: string[]) => {
      if (walletAddress && wagmiStatus !== 'connected') {
        setHeldSend({ text, ...(mcps?.length ? { mcps } : {}), at: Date.now() })
        return
      }
      sendToTicketNow(text, mcps)
    },
    [walletAddress, wagmiStatus, sendToTicketNow],
  )
  useEffect(() => {
    if (!heldSend) return
    const elapsed = Date.now() - heldSend.at
    if (wagmiStatus === 'connected' || elapsed >= 10_000) {
      setHeldSend(null)
      sendToTicketNow(heldSend.text, heldSend.mcps)
      return
    }
    const t = setTimeout(() => setHoldTick((n) => n + 1), 10_000 - elapsed)
    return () => clearTimeout(t)
  }, [heldSend, wagmiStatus, holdTick, sendToTicketNow])

  // Build an ask for a connected wallet: the turn it came from gets a run
  // row. A held ask coming back from the Google lane's redirect has no turn
  // any more — it gets a fresh one.
  const runMetaRef = useRef<Map<string, RunMeta>>(new Map())
  const runHere = useCallback(
    (ask: string) => {
      const meta = runMetaRef.current.get(ask)
      runMetaRef.current.delete(ask)
      if (meta && turnsRef.current.some((t) => t.id === meta.turnId)) {
        patchTurn(meta.turnId, (t) => ({ ...t, held: undefined, run: { ask, status: 'building', reading: meta.reading } }))
      } else {
        pushTurn({ id: newId(), said: ask, via: 'door', run: { ask, status: 'building', reading: false } })
      }
      sendToTicket(ask, meta?.mcps)
    },
    [patchTurn, pushTurn, sendToTicket],
  )
  // Looking needs no wallet; building does. The page carries the action on
  // (the lanes that navigate come back here, and a held ask resumes here).
  const { act, door } = useConnectToAct({ run: runHere, redirectFor: () => pathname ?? `/t/${symbol}`, resumable: true })
  const build = useCallback(
    (turnId: string, ask: string, reading: boolean, mcps?: string[]) => {
      runMetaRef.current.set(ask, { turnId, reading, ...(mcps?.length ? { mcps } : {}) })
      // Until a wallet lands the turn says what it waits on (never "Building…").
      if (!walletAddress) patchTurn(turnId, (t) => ({ ...t, held: ask }))
      act(ask)
    },
    [act, walletAddress, patchTurn],
  )

  // The ticket's own events: every turn it answers, and every signature.
  const onTicketEvent = useCallback(
    (name: string, data?: Record<string, unknown>) => {
      if (name !== 'turn' || !data) return
      const status = orderStatusOf(data.outcome)
      if (status) {
        setTurns((ts) => {
          const i = latestRunIndex(ts)
          if (i < 0) return ts
          const run = ts[i].run!
          const next = { ...ts[i], run: { ...run, status: advanceStatus(run.status, status), ...(status === 'signed' && typeof data.txUrl === 'string' ? { txUrl: data.txUrl } : {}) } }
          return ts.map((t, k) => (k === i ? next : t))
        })
      }
      if (data.outcome === 'signed') onSigned?.(data as SignedEvent)
    },
    [onSigned],
  )

  const newOrder = useCallback(() => {
    setTurns((ts) => ts.map((t) => (t.run && !t.run.closed ? { ...t, run: { ...t.run, closed: true } } : t)))
    ticketNowRef.current = null
    setTicket(null)
    setCurrentChatId(null)
    inputRef.current?.focus()
  }, [setCurrentChatId])

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
            order: orderContextFor(before, ticket ? ticketText : null),
          }),
          signal: ctrl.signal,
        })
        const j = (await res.json().catch(() => ({}))) as Reply | { error?: string }
        if (!res.ok || !('kind' in j)) {
          patchTurn(id, (t) => ({ ...t, error: (j as { error?: string }).error ?? `HTTP ${res.status}` }))
          return
        }
        const reply = j
        if (reply.kind === 'relay') {
          // The user's OWN words go to the ticket — never text of the model's.
          patchTurn(id, (t) => ({ ...t, reply, relayed: true }))
          setTurns((ts) => {
            const i = latestRunIndex(ts)
            if (i < 0) return ts
            return ts.map((t, k) => (k === i ? { ...t, run: { ...t.run!, status: advanceStatus(t.run!.status, 'building') } } : t))
          })
          sendToTicket(said)
          return
        }
        patchTurn(id, (t) => ({ ...t, reply }))
        if (reply.kind === 'chart') onChartState?.(reply.state)
        if (reply.kind === 'act') build(id, reply.chip.ask, !reply.typed)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        patchTurn(id, (t) => ({ ...t, error: (e as Error).message }))
      } finally {
        if (abortRef.current === ctrl) setBusy(false)
      }
    },
    [busy, pair.symbol, chartState, visible, walletAddress, ticket, ticketText, pushTurn, patchTurn, onChartState, build, sendToTicket],
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
      else patchTurn(id, (t) => ({ ...t, error: (j as { error?: string }).error ?? `HTTP ${res.status}` }))
    } catch (e) {
      patchTurn(id, (t) => ({ ...t, error: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }, [explainBar, busy, explainMode, pair.symbol, chartState?.tf, pushTurn, patchTurn])

  // An act suggestion builds here on one tap; a modified click keeps the
  // link's own meaning (a new tab on the app's `?prompt=` prefill).
  const buildOnClick = useCallback(
    (label: string, ask: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      const id = newId()
      pushTurn({ id, said: label, via: 'chip' })
      build(id, ask, false)
    },
    [pushTurn, build],
  )
  const hasAct = useMemo(() => suggestions.some((s) => s.kind === 'act'), [suggestions])

  // The page's door, docked here: a complete ask builds, a draft waits in
  // the composer, a bare open focuses it.
  const lastIncoming = useRef(0)
  useEffect(() => {
    if (!incoming || incoming.at === lastIncoming.current) return
    lastIncoming.current = incoming.at
    const text = incoming.text.trim()
    if (incoming.send && text) {
      const id = newId()
      pushTurn({ id, said: text, via: 'door' })
      build(id, text, false, incoming.mcps)
      return
    }
    if (text) setQ(text)
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60)
  }, [incoming, pushTurn, build])

  // The conversation pins to its newest turn (its own scroll, never the page's).
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  useEffect(() => () => abortRef.current?.abort(), [])
  // A new symbol is a new conversation — and a new ticket.
  useEffect(() => {
    setTurns([])
    setAlerts({})
    setQ('')
    ticketNowRef.current = null
    setTicket(null)
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
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setAlerts((a) => ({ ...a, [turnId]: { state: 'saved' } }))
    } catch (e) {
      setAlerts((a) => ({ ...a, [turnId]: { state: 'error', err: (e as Error).message } }))
    }
  }

  const live = turns[latestRunIndex(turns)]?.run ?? null
  const talking = turns.length > 0 || busy

  return (
    <section className="mk-ai mk-ai--ask" data-slot="AskChart" data-lane="AI" data-busy={busy ? '1' : '0'} data-ticket={ticket ? 'live' : 'off'}>
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
                <li key={t.id} className="mk-ask__turn" data-via={t.via} data-kind={t.reply?.kind ?? (t.run ? 'run' : 'wait')}>
                  <p className="mk-ask__you">{t.said}</p>
                  <TurnBody
                    turn={t}
                    alert={alerts[t.id]}
                    signedIn={!!signedIn}
                    onSetAlert={(r) => void setAlert(t.id, r)}
                    onShowTicket={showTicket}
                    onRetryHeld={(held) => build(t.id, held, t.reply?.kind === 'act' ? !t.reply.typed : false)}
                  />
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
              placeholder={talking ? `Ask a follow-up, or say the trade…` : `Draw a line at…, alert me at…, or “buy $25 of ${symbol}” — it builds right here`}
              aria-label={`Ask about the ${symbol} chart, or say a trade`}
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
                  // click BUILDS it in this panel's order ticket.
                  <Link key={s.ask} href={promptHref(s.ask)} className="mk-ai__sugg-chip mk-ai__sugg-chip--act" title={s.ask} data-ask={s.ask} data-sugg="act" onClick={buildOnClick(s.label, s.ask)}>
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
              {hasAct ? <span className="mk-ai__sugg-foot mk-ai__eyebrow mono">A TRADE BUILDS RIGHT HERE · YOUR WALLET SIGNS · THE REST ANSWER HERE</span> : null}
            </div>
          ) : null}
        </div>

        {ticket ? (
          <aside ref={ticketRef} className="mk-ask__ticket" aria-label="Your order" data-status={live?.status ?? 'idle'}>
            <header className="mk-ask__ticket-head">
              <span className="mk-ask__ticket-k mono">YOUR ORDER</span>
              {live ? (
                <span className="mk-ask__pill mono" data-status={live.status}>
                  {ORDER_STATUS_LABEL[live.status]}
                </span>
              ) : null}
              <span className="mk-ask__ticket-acts">
                <button type="button" className="mk-ask__ghost" onClick={newOrder} title="Clear the ticket and start a new order" aria-label="New order">
                  <RotateCcw className="mk-ai__ico" aria-hidden />
                  <span>New</span>
                </button>
                <SpineLink href={ticketChatId ? `/chat/${encodeURIComponent(ticketChatId)}` : '/chat'} className="mk-ask__ghost" title="Carry this order to the full app" aria-label="Open this order in the app">
                  <span>Open in the app</span>
                  <ArrowUpRight className="mk-ai__ico" aria-hidden />
                </SpineLink>
              </span>
            </header>
            <div className="mk-ask__runtime">
              <ChatInterface key={ticket.key} simple docked injectedPrompt={ticket.prompt} onEmbedEvent={onTicketEvent} />
            </div>
            <p className="mk-ask__ticket-foot mono">GUARDED BUILD · NOTHING MOVES UNTIL YOUR WALLET SIGNS</p>
          </aside>
        ) : null}
      </div>
      {door}
    </section>
  )
}

function TurnBody({
  turn,
  alert,
  signedIn,
  onSetAlert,
  onShowTicket,
  onRetryHeld,
}: {
  turn: ChartTurn
  alert?: { state: 'saving' | 'saved' | 'error'; err?: string }
  signedIn: boolean
  onSetAlert: (r: Extract<Reply, { kind: 'alert' }>) => void
  onShowTicket: () => void
  onRetryHeld: (ask: string) => void
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
      {turn.held && !turn.run ? (
        <button type="button" className="mk-ask__run" data-status="held" onClick={() => onRetryHeld(turn.held!)}>
          <span className="mk-ask__dot" aria-hidden />
          <span className="mk-ask__run-ask">{turn.held}</span>
          <span className="mk-ask__run-status mono">Waiting on a wallet · tap to connect</span>
        </button>
      ) : null}
      {turn.run ? (
        <div className="mk-ask__runrow">
          <button type="button" className="mk-ask__run" data-status={turn.run.closed ? 'closed' : turn.run.status} onClick={onShowTicket} disabled={turn.run.closed} title={turn.run.closed ? 'Cleared from the ticket' : 'Show it in your order'}>
            <span className="mk-ask__dot" aria-hidden />
            <span className="mk-ask__run-ask">{turn.run.ask}</span>
            <span className="mk-ask__run-status mono">{turn.run.closed ? 'Cleared' : ORDER_STATUS_LABEL[turn.run.status]}</span>
          </button>
          {turn.run.txUrl ? (
            <a className="mk-ask__tx mono" href={turn.run.txUrl} target="_blank" rel="noopener noreferrer">
              VIEW TX <ArrowUpRight className="mk-ai__ico" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
      {turn.relayed ? (
        <p className="mk-ask__relay mono">
          <CornerDownRight className="mk-ai__ico" aria-hidden /> PASSED TO YOUR ORDER
        </p>
      ) : null}
      {turn.error ? <p className="mk-ai__err">{turn.error}</p> : null}
      {reply && reply.kind !== 'relay' && !turn.run && !turn.held ? (
        <footer className="mk-ai__foot mono">
          <span>{reply.deterministic ? 'Answered by the page, no model' : `Written by ${reply.model}`}</span>
          <span>·</span>
          <span>not advice</span>
        </footer>
      ) : null}
    </div>
  )
}
