// Ask the chart — the panel's conversation, as pure rules (2026-09-24).
//
// Nate, on /t/TSLA: "The ask the chart should be more of an integration with
// our transaction system… be able to make transactions as they talk." The
// panel used to answer one question at a time and hand every trade to /chat.
// Now it is a conversation, and a trade it hears BUILDS beside it in an order
// ticket — the same runtime an intent link mounts (ChatInterface `simple`,
// docked: no composer of its own; this panel's composer feeds it). The
// visitor never leaves the chart, and a signed fill lands on the chart it
// was asked about.
//
// This module holds the parts the harness pins without rendering (the
// lib/trade-asks idiom): the turn shape, what the chart lane is told about
// the conversation and the ticket, how a ticket event reads on a turn's row,
// and the fill a signature paints before the server's 60s fills cache has it.
// No React, no DOM.

import { chainById } from './chains'
import { ASK_HISTORY_LINE_MAX, ASK_HISTORY_MAX, ASK_ORDER_ASKS_MAX, ASK_ORDER_TEXT_MAX, cleanContextLine, type AskAnswer, type AskHistoryLine, type AskOrderContext, type OrderStatus } from './markets-ai'
import { venueOfBuild } from './viz/venue-of-build'
import type { FillMarker } from './chart-fills'

/** How a turn entered the panel. */
export type TurnVia = 'typed' | 'voice' | 'chip' | 'door' | 'explain'

/** One run in the order ticket: the ask it builds and where it stands. */
export interface TicketRun {
  ask: string
  status: OrderStatus
  /** The model read a looser question as this ask (printed above the build). */
  reading: boolean
  txUrl?: string
  /** "New order" cleared the ticket: the run stays in the conversation as
   *  history but is no longer the ticket the chart lane is told about. */
  closed?: boolean
}

export interface ChartTurn {
  id: string
  /** What the visitor said (or the chip's label). */
  said: string
  via: TurnVia
  /** The chart lane's answer, once it lands. */
  reply?: (AskAnswer & { deterministic: boolean; model: string }) | null
  /** Set when this turn put something in the ticket (a build or a relay). */
  run?: TicketRun
  /** An ask waiting on a wallet (the connect door is open for it). */
  held?: string
  relayed?: boolean
  error?: string
}

/** Turns the panel keeps (older ones scroll out of the conversation). */
export const TURNS_MAX = 24

/** Words a status wears on a turn's row and in the ticket's head. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  building: 'Building…',
  ready: 'Ready to sign',
  asked: 'Needs your answer',
  refused: "Couldn't build",
  answered: 'Replied',
  signed: 'Signed',
  settled: 'Settled',
  error: 'Failed',
}

/** A ticket event (ChatInterface's `turn` event outcome) → the run's status.
 *  Unknown outcomes leave the run where it was (null). */
export function orderStatusOf(outcome: unknown): OrderStatus | null {
  switch (outcome) {
    case 'tx-built':
      return 'ready'
    case 'clarify':
      return 'asked'
    case 'refused':
    case 'credit-gate':
      return 'refused'
    case 'answered':
      return 'answered'
    case 'error':
      return 'error'
    case 'signed':
      return 'signed'
    case 'settled':
      return 'settled'
    default:
      return null
  }
}

/** A later status never walks a run backwards: a signed run stays signed when
 *  the ticket's next reply lands, and settled beats signed. */
export function advanceStatus(prev: OrderStatus, next: OrderStatus | null): OrderStatus {
  if (!next) return prev
  if (prev === 'settled') return prev
  if (prev === 'signed' && next !== 'settled') return prev
  return next
}

/** What the chart lane is told a page turn said — the page's OWN words, one
 *  line each. A build names its ask in quotes so a follow-up ("make it $50")
 *  can be read against it. */
export function pageSummaryOf(t: ChartTurn): string | null {
  if (t.run) return `${t.run.reading ? 'read that as' : 'built'} in the order ticket: "${t.run.ask}" (${ORDER_STATUS_LABEL[t.run.status].toLowerCase()}${t.run.closed ? ', then cleared' : ''})`
  if (t.held) return `waiting on a wallet to build: "${t.held}"`
  if (t.relayed) return 'passed that to the order ticket'
  if (t.error) return `could not answer (${t.error})`
  const r = t.reply
  if (!r) return null
  switch (r.kind) {
    case 'chart':
      return `drew on the chart: ${r.say}`
    case 'alert':
      return `alert ready: ${r.label}`
    case 'act':
      return `offered: "${r.chip.ask}"`
    case 'answer':
      return r.text
    case 'relay':
      return 'passed that to the order ticket'
  }
}

/** The conversation as the chart lane gets it: the last ASK_HISTORY_MAX
 *  lines, oldest first, each capped and address-free. */
export function historyFor(turns: readonly ChartTurn[]): AskHistoryLine[] {
  const lines: AskHistoryLine[] = []
  for (const t of turns) {
    const said = cleanContextLine(t.said, ASK_HISTORY_LINE_MAX)
    if (said) lines.push({ role: 'user', text: said })
    const page = pageSummaryOf(t)
    const clean = page ? cleanContextLine(page, ASK_HISTORY_LINE_MAX) : ''
    if (clean) lines.push({ role: 'page', text: clean })
  }
  return lines.slice(-ASK_HISTORY_MAX)
}

/** The ticket as the chart lane gets it. `last` is the ticket's newest
 *  assistant prose (its cards are not text). */
export function orderContextFor(turns: readonly ChartTurn[], last: string | null): AskOrderContext {
  const runs = turns.filter((t) => t.run && !t.run.closed).map((t) => t.run!)
  const asks = runs.map((r) => r.ask).slice(-ASK_ORDER_ASKS_MAX)
  const latest = runs[runs.length - 1]
  return {
    live: runs.length > 0,
    asks,
    last: last ? cleanContextLine(last, ASK_ORDER_TEXT_MAX) || null : null,
    status: latest?.status ?? null,
  }
}

/** The run a ticket event belongs to: the newest turn that put something in
 *  the ticket (the runtime answers one send at a time, in order). */
export function latestRunIndex(turns: readonly ChartTurn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].run && !turns[i].run!.closed) return i
  return -1
}

/** The ticket's signed-turn event, as ChatInterface fires it on a
 *  first-party surface (`buildPath` + `symbols` ride along there). */
export interface SignedEvent {
  artifact?: unknown
  valueUsd?: unknown
  txUrl?: unknown
  chainId?: unknown
  buildPath?: unknown
  symbols?: unknown
}

/** The fill a signature paints on THIS symbol's chart right away — the
 *  server's fills read is cached 60s per wallet, so without this the glyph
 *  would land a minute or two after the signature. null when the signed turn
 *  did not trade this symbol (its side tag is the evidence, never the ask's
 *  wording: a "sell ETH to buy TSLA" job tags both). */
export function fillFromSigned(symbol: string, ev: SignedEvent, nowMs: number): FillMarker | null {
  const sym = symbol.toUpperCase()
  const tags = Array.isArray(ev.symbols) ? ev.symbols.filter((s): s is string => typeof s === 'string') : []
  const tag = tags.find((t) => t === `buy:${sym}` || t === `sell:${sym}`)
  if (!tag) return null
  const { venue, venueId } = venueOfBuild(typeof ev.buildPath === 'string' ? ev.buildPath : null)
  const chainId = typeof ev.chainId === 'number' && Number.isFinite(ev.chainId) ? ev.chainId : null
  const txUrl = typeof ev.txUrl === 'string' && /^https:\/\//.test(ev.txUrl) ? ev.txUrl : null
  const usd = typeof ev.valueUsd === 'number' && Number.isFinite(ev.valueUsd) ? ev.valueUsd : null
  return {
    id: `local:${txUrl ?? nowMs}`,
    t: Math.floor(nowMs / 1000),
    side: tag.startsWith('sell:') ? 'sell' : 'buy',
    usd,
    venue,
    venueId,
    chainId,
    chain: chainId != null ? (chainById(chainId)?.name ?? null) : null,
    txUrl,
    source: 'turn',
  }
}

/** The chart's fills: the server's, plus the panel's just-signed ones the
 *  server doesn't list yet (matched by explorer link). Oldest first. */
export function mergeFills(server: readonly FillMarker[], local: readonly FillMarker[]): FillMarker[] {
  const seen = new Set(server.map((f) => f.txUrl).filter((u): u is string => !!u))
  const extra = local.filter((f) => !f.txUrl || !seen.has(f.txUrl))
  if (!extra.length) return server as FillMarker[]
  return [...server, ...extra].sort((a, b) => a.t - b.t)
}

/** Keep the conversation bounded: the newest TURNS_MAX turns. (A run older
 *  than that has scrolled out; its ticket events simply find no row.) */
export function capTurns(turns: readonly ChartTurn[]): ChartTurn[] {
  if (turns.length <= TURNS_MAX) return turns as ChartTurn[]
  return turns.slice(-TURNS_MAX)
}

