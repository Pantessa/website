// ─────────────────────────────────────────────────────────────────────────
//  Chart annotations — THE shared contract between the chart engine
//  (components/markets/chart/MarketChart), community posts (COMM stores a
//  ChartState on every post and "fork this chart" replays it) and the
//  intent-link minter (a post's action asks become executable links).
//
//  Pure + client-safe. Strict, fail-closed parse: anything the schema does
//  not name (an extra kind, a NaN price, an ask longer than a chat turn, a
//  control character in a label) rejects the WHOLE state — a post that
//  carries one bad line is a bad post, never a partially-drawn chart. UGC
//  flows through here before it reaches a canvas, so every string field is
//  length-capped and control-character-fenced.
//
//  Times are unix SECONDS. Prices are the chart's quote currency (USD).
//  `tf` is the candles endpoint's own timeframe union (lib/charts ChartTf:
//  15m · 1h · 4h · 1d). The squad README drafted the contract with '5m'
//  before the endpoint was checked — the finest frame it serves is 15m —
//  so '5m' is accepted on the way IN as an alias of '15m' (a post written
//  against the draft still parses) and never emitted.
// ─────────────────────────────────────────────────────────────────────────

import { CHART_TFS, normalizeChartSymbol, type ChartTf } from './charts'

export type ChartActionKind = 'buy' | 'sell' | 'stop' | 'limit' | 'dca' | 'protect'

/** An executable annotation: `ask` round-trips an existing native parser
 *  (limit → lib/swap-intent's LIMIT grammar, protect → lib/spot-guard or
 *  lib/hl-guardian, dca → lib/dca, buy/sell → the swap / HL grammars).
 *  lib/chart-actions composes them; the harness pins every shape through
 *  the ask-ladder replica. */
export interface ChartAction {
  kind: ChartActionKind
  ask: string
}

export type ChartLine =
  | { id: string; kind: 'h'; price: number; label?: string; action?: ChartAction }
  | { id: string; kind: 'trend'; t1: number; p1: number; t2: number; p2: number; label?: string }
  | { id: string; kind: 'zone'; p1: number; p2: number; label?: string; action?: ChartAction }
  | { id: string; kind: 'note'; t: number; price: number; text: string }

export interface ChartState {
  v: 1
  symbol: string
  tf: ChartTf
  lines: ChartLine[]
}

export const CHART_STATE_VERSION = 1 as const

/** Caps — a chart is a drawing, not a document. */
export const CHART_STATE_MAX_LINES = 64
export const CHART_LABEL_MAX = 80
export const CHART_NOTE_MAX = 280
export const CHART_ASK_MAX = 200
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const SYMBOL_RE = /^[A-Z0-9]{1,12}$/
const ACTION_KINDS = new Set<ChartActionKind>(['buy', 'sell', 'stop', 'limit', 'dca', 'protect'])
const TF_SET = new Set<string>(CHART_TFS.map((t) => t.key))
/** No control characters (a label is rendered as TEXT, but a newline in a
 *  chip or a NUL in an ask is never a drawing). */
const CONTROL_RE = /[\x00-\x1f\x7f]/

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const finitePos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0
/** Unix seconds: a non-negative integer no later than the year ~2100. */
const unixSec = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 4_102_444_800
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max && !CONTROL_RE.test(x)
const optText = (x: unknown, max: number): boolean => x === undefined || text(x, max)

function parseAction(x: unknown): ChartAction | null {
  if (!isObj(x)) return null
  const { kind, ask } = x
  if (typeof kind !== 'string' || !ACTION_KINDS.has(kind as ChartActionKind)) return null
  if (!text(ask, CHART_ASK_MAX)) return null
  // An ask is one chat turn: trimmed, single-line (CONTROL_RE above already
  // refuses newlines), and it starts with a letter or a "$" — never a
  // slash command, a URL or a leading dash that a composer could misread.
  if (ask !== ask.trim() || !/^[A-Za-z$]/.test(ask)) return null
  return { kind: kind as ChartActionKind, ask }
}

function parseLine(x: unknown): ChartLine | null {
  if (!isObj(x)) return null
  const id = x.id
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  switch (x.kind) {
    case 'h': {
      if (!finitePos(x.price) || !optText(x.label, CHART_LABEL_MAX)) return null
      let action: ChartAction | undefined
      if (x.action !== undefined) {
        const a = parseAction(x.action)
        if (!a) return null
        action = a
      }
      return { id, kind: 'h', price: x.price, ...(x.label !== undefined ? { label: x.label as string } : {}), ...(action ? { action } : {}) }
    }
    case 'trend': {
      if (!unixSec(x.t1) || !unixSec(x.t2) || !finitePos(x.p1) || !finitePos(x.p2) || !optText(x.label, CHART_LABEL_MAX)) return null
      if (x.t1 === x.t2 && x.p1 === x.p2) return null // a point is not a line
      return { id, kind: 'trend', t1: x.t1, p1: x.p1, t2: x.t2, p2: x.p2, ...(x.label !== undefined ? { label: x.label as string } : {}) }
    }
    case 'zone': {
      if (!finitePos(x.p1) || !finitePos(x.p2) || !optText(x.label, CHART_LABEL_MAX)) return null
      if (x.p1 === x.p2) return null // a zone has height
      let action: ChartAction | undefined
      if (x.action !== undefined) {
        const a = parseAction(x.action)
        if (!a) return null
        action = a
      }
      return { id, kind: 'zone', p1: x.p1, p2: x.p2, ...(x.label !== undefined ? { label: x.label as string } : {}), ...(action ? { action } : {}) }
    }
    case 'note': {
      if (!unixSec(x.t) || !finitePos(x.price) || !text(x.text, CHART_NOTE_MAX)) return null
      return { id, kind: 'note', t: x.t, price: x.price, text: x.text }
    }
    default:
      return null
  }
}

/**
 * Strict parse. Accepts the object form or a JSON string. Returns null for
 * anything that is not EXACTLY a v1 chart state — unknown version, bad
 * symbol, unknown timeframe, too many lines, duplicate ids, or any line
 * that fails its own shape. Never throws.
 */
export function parseChartState(x: unknown): ChartState | null {
  let v: unknown = x
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!isObj(v)) return null
  if (v.v !== CHART_STATE_VERSION) return null
  if (typeof v.symbol !== 'string') return null
  const symbol = normalizeChartSymbol(v.symbol)
  if (!SYMBOL_RE.test(symbol) || symbol !== v.symbol) return null
  const tfIn = v.tf === '5m' ? '15m' : v.tf
  if (typeof tfIn !== 'string' || !TF_SET.has(tfIn)) return null
  if (!Array.isArray(v.lines) || v.lines.length > CHART_STATE_MAX_LINES) return null
  const lines: ChartLine[] = []
  const ids = new Set<string>()
  for (const raw of v.lines) {
    const line = parseLine(raw)
    if (!line || ids.has(line.id)) return null
    ids.add(line.id)
    lines.push(line)
  }
  return { v: 1, symbol, tf: tfIn as ChartTf, lines }
}

/** Every action's ask, in drawing order — what a post mints as intent
 *  links and what the harness replays through the ladder. Duplicates are
 *  kept: two lines that say the same thing are two links. */
export function chartStateToAsks(s: ChartState): string[] {
  const out: string[] = []
  for (const l of s.lines) {
    if ((l.kind === 'h' || l.kind === 'zone') && l.action) out.push(l.action.ask)
  }
  return out
}

/** Canonical JSON — stable key order so equal states serialize equal
 *  (a fork's `chartState` diff is a real diff). */
export function serializeChartState(s: ChartState): string {
  return JSON.stringify({
    v: 1,
    symbol: s.symbol,
    tf: s.tf,
    lines: s.lines.map((l) => {
      switch (l.kind) {
        case 'h':
          return { id: l.id, kind: 'h', price: l.price, ...(l.label !== undefined ? { label: l.label } : {}), ...(l.action ? { action: { kind: l.action.kind, ask: l.action.ask } } : {}) }
        case 'trend':
          return { id: l.id, kind: 'trend', t1: l.t1, p1: l.p1, t2: l.t2, p2: l.p2, ...(l.label !== undefined ? { label: l.label } : {}) }
        case 'zone':
          return { id: l.id, kind: 'zone', p1: l.p1, p2: l.p2, ...(l.label !== undefined ? { label: l.label } : {}), ...(l.action ? { action: { kind: l.action.kind, ask: l.action.ask } } : {}) }
        case 'note':
          return { id: l.id, kind: 'note', t: l.t, price: l.price, text: l.text }
      }
    }),
  })
}

export function emptyChartState(symbol: string, tf: ChartTf = '1h'): ChartState {
  return { v: 1, symbol: normalizeChartSymbol(symbol), tf, lines: [] }
}

/** Short random id for a new drawing (client-side; no crypto needed — ids
 *  only have to be unique within one state). */
export function newLineId(prefix = 'l'): string {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36)}${rnd}`.slice(0, 64)
}

/** Deep equality on the canonical form. */
export function chartStatesEqual(a: ChartState, b: ChartState): boolean {
  return serializeChartState(a) === serializeChartState(b)
}
