import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ASK_MAX_TOKENS,
  ASK_SYSTEM,
  EXPLAIN_MAX_TOKENS,
  EXPLAIN_SYSTEM,
  EXPLAIN_TTL_MS,
  QUESTION_MAX,
  alertPreview,
  askUserPrompt,
  buildChartMutation,
  cleanLine,
  cleanProse,
  describeDrawings,
  explainCacheKey,
  explainUserPrompt,
  parseAlertAsk,
  parseDrawAsk,
  parseModelAnswer,
  parseOverlayAsk,
  positionFallback,
  venueWordsFor,
  type AskAnswer,
  type AskContext,
  type ProposedLine,
} from '@/lib/markets-ai'
import { modelAvailable, modelLabel, modelMocked, modelText } from '@/lib/markets-ai-model'
import { bumpAndCheckMarketsAi, MARKETS_AI_WALL } from '@/lib/markets-ai-fence'
import { readPosition, readTape, techSummary } from '@/lib/markets-ai-context'
import { validateProposedAsk } from '@/lib/markets-ai-ladder'
import { parseChartState } from '@/lib/chart-state'
import { alertRuleProblem, type AlertRule } from '@/lib/watchlists'
import { symbolName } from '@/lib/markets'
import { RATING_LABELS } from '@/lib/technicals'
import { CANDLE_TFS } from '@/lib/candles-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// MK2/AI — POST /api/markets/ask — the chart-aware ask box. One isolated
// call (never a turn on /api/chat): the question, the chart's state, what
// is on screen, and the wallet's position in the symbol go in; ONE typed
// answer comes out, decided SERVER-SIDE:
//   chart  — a ChartState the client applies through onChartState
//   act    — a chip the user clicks to SEND (never auto-sent); the sentence
//            passed fenceAsk + the ladder replica
//   alert  — the rule the existing /api/alerts stores, previewed for a
//            confirm click (SIWE-gated there, as today)
//   answer — prose (and, for "show me the 200 SMA", the overlay ids)
// Plain-English alerts, drawings, overlay toggles and complete asks are
// decided WITHOUT a model (deterministic grammars in lib/markets-ai); the
// model only gets the rest, and its JSON is re-validated on every kind.
// `kind: 'explain'` is the one-sentence candle / verdict explainer, cached
// by (symbol, tf, bar time).

const Visible = z.object({ from: z.number(), to: z.number() })
const Bar = z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number().default(0) })
const Body = z.object({
  symbol: z.string().min(1).max(16),
  question: z.string().max(QUESTION_MAX).default(''),
  tf: z.enum(CANDLE_TFS as [string, ...string[]]).optional(),
  chartState: z.unknown().optional(),
  visible: Visible.optional(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  kind: z.enum(['ask', 'explain']).default('ask'),
  bar: Bar.optional(),
  /** The gauge verdict "explain this" is about — an enum, never free text:
   *  the explain cache is shared per (symbol, tf, bar, verdict), so one
   *  visitor's words must never reach the sentence everyone reads (QA-2). */
  verdict: z.enum(['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy']).optional(),
  /** Harness-only: the mock's scenario. Ignored unless MK2_AI_MOCK=1. */
  mockScenario: z.string().max(32).optional(),
})

const explainCache = new Map<string, { at: number; text: string }>()

function answer(a: AskAnswer, extra: { deterministic: boolean; model: string }) {
  return NextResponse.json({ ...a, ...extra }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Name a symbol and a question.' }, { status: 400 })
  const body = parsed.data
  const scenario = modelMocked() ? (body.mockScenario ?? req.headers.get('x-mk2-mock-scenario')) : null
  const model = modelLabel()

  let tape: Awaited<ReturnType<typeof readTape>>
  try {
    tape = await readTape(body.symbol, body.tf)
  } catch {
    return NextResponse.json({ error: 'The tape is unavailable right now — try again in a minute.' }, { status: 503 })
  }
  if (!tape) return NextResponse.json({ error: `${body.symbol.toUpperCase()} has no chart here.` }, { status: 404 })
  const { pair, tf, last } = tape
  const symbol = pair.symbol
  const tech = techSummary(tape.tech)

  // ── Explain this (one sentence, cached per bar) ──────────────────────────
  if (body.kind === 'explain') {
    if (!body.bar) return NextResponse.json({ error: 'Name the bar to explain.' }, { status: 400 })
    const key = `${explainCacheKey(symbol, tf, body.bar.t)}:${body.verdict ?? '-'}`
    const hit = explainCache.get(key)
    if (hit && Date.now() - hit.at < EXPLAIN_TTL_MS) return answer({ kind: 'answer', text: hit.text }, { deterministic: false, model: `${model} (cached)` })
    if (!modelAvailable()) return answer({ kind: 'answer', text: explainFallback(body.bar) }, { deterministic: true, model: 'none' })
    if (await bumpAndCheckMarketsAi(req.headers, body)) return answer({ kind: 'answer', text: MARKETS_AI_WALL }, { deterministic: true, model: 'wall' })
    const candles = tape.loaded.series.candles
    const i = candles.findIndex((c) => c.t === body.bar!.t)
    const prev = i > 0 ? { c: candles[i - 1].c } : null
    const text = await modelText({ system: EXPLAIN_SYSTEM, user: explainUserPrompt({ symbol, tf, bar: body.bar, prev, tech, verdict: body.verdict ? RATING_LABELS[body.verdict] : null }), maxTokens: EXPLAIN_MAX_TOKENS, mock: { scenario } })
    const out = cleanProse(text ?? explainFallback(body.bar), 400)
    explainCache.set(key, { at: Date.now(), text: out })
    return answer({ kind: 'answer', text: out }, { deterministic: !text, model })
  }

  const question = cleanLine(body.question, QUESTION_MAX)
  if (!question) return NextResponse.json({ error: 'Ask something about the chart.' }, { status: 400 })
  const base = body.chartState !== undefined ? parseChartState(body.chartState) : null

  // ── Deterministic doors first (no model, no fence) ───────────────────────
  const alert = parseAlertAsk(question, symbol, last)
  if (alert) return answer(alertAnswer(alert), { deterministic: true, model: 'none' })

  const draw = parseDrawAsk(question)
  if (draw) {
    const lines: ProposedLine[] = draw === 'pivots' ? pivotLines(tech) : draw
    const built = buildChartMutation({ base, symbol, tf, last, lines })
    if (built) return answer({ kind: 'chart', say: drawSay(lines, symbol), state: built.state, added: built.added }, { deterministic: true, model: 'none' })
    if (draw === 'pivots') return answer({ kind: 'answer', text: `The ${symbol} tape is too short for pivot levels right now, so there is nothing to draw yet.` }, { deterministic: true, model: 'none' })
    return answer({ kind: 'answer', text: `That level is too far from ${symbol}'s last price (${last ?? 'unknown'}) to draw — name a price within the chart.` }, { deterministic: true, model: 'none' })
  }

  const overlays = parseOverlayAsk(question)
  if (overlays.length) {
    return answer({ kind: 'answer', text: `${overlayWords(overlays)} — toggle it in the chart's indicator row above the candles (the AI lane will flip it for you once the chart takes overlay state).`, overlays }, { deterministic: true, model: 'none' })
  }

  // The user typed a complete ask ("buy $37 of ETH") — it IS the chip.
  const direct = validateProposedAsk(question, symbol)
  if (direct.ok) return answer({ kind: 'act', say: `Ready to send — your wallet signs.`, chip: { label: direct.ask, ask: direct.ask } }, { deterministic: true, model: 'none' })

  // ── The model ────────────────────────────────────────────────────────────
  if (!modelAvailable()) return answer({ kind: 'answer', text: 'The model is not available right now. Drawings ("draw a line at 180"), alerts ("tell me when it crosses 4k") and complete asks still work.' }, { deterministic: true, model: 'none' })
  if (await bumpAndCheckMarketsAi(req.headers, body)) return answer({ kind: 'answer', text: MARKETS_AI_WALL }, { deterministic: true, model: 'wall' })

  let position: string | null = null
  if (body.address) {
    const pos = await readPosition(body.address as `0x${string}`, pair, last, tape.change24hPct).catch(() => null)
    if (pos) position = positionFallback(pos)
  }
  const candles = tape.loaded.series.candles
  const visible = body.visible ? visibleStats(candles, body.visible) : null
  const ctx: AskContext = {
    symbol,
    name: symbolName(symbol),
    tf,
    last,
    change24hPct: tape.change24hPct,
    tech,
    drawings: describeDrawings(base),
    visible,
    position,
    venues: venueWordsFor(pair),
    question,
  }
  const text = await modelText({ system: ASK_SYSTEM, user: askUserPrompt(ctx), maxTokens: ASK_MAX_TOKENS, mock: { scenario } })
  if (!text) return answer({ kind: 'answer', text: 'The model did not answer — try again in a moment.' }, { deterministic: true, model })
  const m = parseModelAnswer(text)
  if (!m) return answer({ kind: 'answer', text: cleanProse(text) }, { deterministic: false, model })

  switch (m.kind) {
    case 'act': {
      const v = validateProposedAsk(m.ask, symbol)
      if (!v.ok) {
        console.warn('[markets/ask] model act dropped by the fence', { why: v.why })
        return answer({ kind: 'answer', text: `${m.say ? `${cleanProse(m.say, 300)} ` : ''}I can't turn that into a chip here (${v.why}). Try the buy or protect chips above, or say the amount and the ticker.` }, { deterministic: false, model })
      }
      return answer({ kind: 'act', say: cleanProse(m.say || 'Ready to send — your wallet signs.', 300), chip: { label: v.ask, ask: v.ask } }, { deterministic: false, model })
    }
    case 'chart': {
      const built = buildChartMutation({ base, symbol, tf, last, lines: m.lines })
      if (!built) return answer({ kind: 'answer', text: `${cleanProse(m.say, 300) || 'Nothing drawable there.'} (No level within range of the last price was proposed.)` }, { deterministic: false, model })
      return answer({ kind: 'chart', say: cleanProse(m.say || 'Drawn on the chart.', 300), state: built.state, added: built.added }, { deterministic: false, model })
    }
    case 'alert': {
      const rule: AlertRule = { symbol, condition: m.condition, value: m.value, ...(m.condition === 'pct_move' ? { basePrice: last } : {}) }
      if (alertRuleProblem(rule)) return answer({ kind: 'answer', text: `${cleanProse(m.say, 300) || 'That alert is malformed.'} Name a price ("tell me when it crosses 4k") or a move ("when it moves 5%").` }, { deterministic: false, model })
      const carried = m.ask ? validateProposedAsk(m.ask, symbol) : null
      if (carried && !carried.ok) console.warn('[markets/ask] alert action dropped by the fence', { why: carried.why })
      return answer({ ...alertAnswer(rule), say: cleanProse(m.say || alertAnswer(rule).say, 300), ...(carried?.ok ? { actionAsk: carried.ask } : {}) }, { deterministic: false, model })
    }
    default:
      return answer({ kind: 'answer', text: m.text }, { deterministic: false, model })
  }
}

function alertAnswer(rule: AlertRule): Extract<AskAnswer, { kind: 'alert' }> {
  return { kind: 'alert', say: `Alert ready: ${alertPreview(rule)}. Confirm to save it — nothing is sent for you when it fires.`, rule, label: alertPreview(rule) }
}

function pivotLines(tech: ReturnType<typeof techSummary>): ProposedLine[] {
  const out: ProposedLine[] = []
  if (tech?.s1) out.push({ kind: 'h', price: tech.s1, label: 'Support S1' })
  if (tech?.r1) out.push({ kind: 'h', price: tech.r1, label: 'Resistance R1' })
  return out
}

function drawSay(lines: ProposedLine[], symbol: string): string {
  const parts = lines.map((l) => (l.kind === 'h' ? `a line at ${l.price}${l.label ? ` (${l.label})` : ''}` : l.kind === 'zone' ? `a zone ${l.p1}–${l.p2}` : `a note at ${l.price}`))
  return `Drawn on the ${symbol} chart: ${parts.join(', ')}. Click the line for its chips.`
}

function overlayWords(ids: string[]): string {
  const names: Record<string, string> = { sma20: 'the 20 SMA', sma50: 'the 50 SMA (blue)', sma200: 'the 200 SMA (yellow)', ema: 'the EMA', bb: 'Bollinger Bands', vwap: 'VWAP', volume: 'volume' }
  return ids.map((i) => names[i] ?? i).join(' and ')
}

function visibleStats(candles: { t: number; h: number; l: number }[], v: { from: number; to: number }) {
  const inRange = candles.filter((c) => c.t >= v.from && c.t <= v.to)
  return { from: v.from, to: v.to, bars: inRange.length, high: inRange.length ? Math.max(...inRange.map((c) => c.h)) : null, low: inRange.length ? Math.min(...inRange.map((c) => c.l)) : null }
}

function explainFallback(bar: { o: number; h: number; l: number; c: number }): string {
  const dir = bar.c >= bar.o ? 'closed up' : 'closed down'
  const range = bar.h - bar.l
  return `This bar ${dir} from ${bar.o} to ${bar.c} with a ${range.toFixed(2)} range (high ${bar.h}, low ${bar.l}).`
}
