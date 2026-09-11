// LOCAL STUB of the CHART lane's `lib/chart-state.ts` — the annotation schema
// from squad-markets README §"Chart annotations", implemented as a strict,
// fail-closed validator so COMM's posts can be built and gated before CHART
// lands. QA swaps `@/lib/chart-state-stub` → `@/lib/chart-state` at
// integration and deletes this file; the exported names and shapes are the
// README contract verbatim.

export type ChartAction = { kind: 'buy' | 'sell' | 'stop' | 'limit' | 'dca' | 'protect'; ask: string }

export type ChartLine =
  | { id: string; kind: 'h'; price: number; label?: string; action?: ChartAction }
  | { id: string; kind: 'trend'; t1: number; p1: number; t2: number; p2: number; label?: string }
  | { id: string; kind: 'zone'; p1: number; p2: number; label?: string; action?: ChartAction }
  | { id: string; kind: 'note'; t: number; price: number; text: string }

export type ChartTfKey = '5m' | '1h' | '4h' | '1d'

export type ChartState = { v: 1; symbol: string; tf: ChartTfKey; lines: ChartLine[] }

const ACTION_KINDS = new Set(['buy', 'sell', 'stop', 'limit', 'dca', 'protect'])
const TFS = new Set(['5m', '1h', '4h', '1d'])
const MAX_LINES = 64
const MAX_TEXT = 200
const MAX_ASK = 400
// Control characters (except tab/newline/CR) never belong in a label or ask.
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const price = (x: unknown): x is number => fin(x) && x > 0 && x < 1e12
const time = (x: unknown): x is number => fin(x) && Number.isInteger(x) && x > 946_684_800 && x < 4_102_444_800
const short = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !CONTROL_RE.test(x)
const id = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(x)

function parseAction(x: unknown): ChartAction | null {
  if (!isObj(x)) return null
  if (typeof x.kind !== 'string' || !ACTION_KINDS.has(x.kind)) return null
  if (!short(x.ask, MAX_ASK)) return null
  return { kind: x.kind as ChartAction['kind'], ask: x.ask.trim() }
}

function parseLine(x: unknown): ChartLine | null {
  if (!isObj(x) || !id(x.id)) return null
  const label = x.label === undefined ? undefined : short(x.label, MAX_TEXT) ? x.label : null
  if (label === null) return null
  switch (x.kind) {
    case 'h': {
      if (!price(x.price)) return null
      const action = x.action === undefined ? undefined : parseAction(x.action)
      if (action === null) return null
      return { id: x.id, kind: 'h', price: x.price, ...(label ? { label } : {}), ...(action ? { action } : {}) }
    }
    case 'trend': {
      if (!time(x.t1) || !time(x.t2) || !price(x.p1) || !price(x.p2)) return null
      return { id: x.id, kind: 'trend', t1: x.t1, p1: x.p1, t2: x.t2, p2: x.p2, ...(label ? { label } : {}) }
    }
    case 'zone': {
      if (!price(x.p1) || !price(x.p2)) return null
      const action = x.action === undefined ? undefined : parseAction(x.action)
      if (action === null) return null
      return { id: x.id, kind: 'zone', p1: x.p1, p2: x.p2, ...(label ? { label } : {}), ...(action ? { action } : {}) }
    }
    case 'note': {
      if (!time(x.t) || !price(x.price) || !short(x.text, MAX_TEXT)) return null
      return { id: x.id, kind: 'note', t: x.t, price: x.price, text: x.text }
    }
    default:
      return null
  }
}

/** Strict, fail-closed: unknown kinds, non-finite numbers, oversize text,
 *  duplicate ids, >64 lines, or a bad action → null (never a partial). */
export function parseChartState(x: unknown): ChartState | null {
  if (!isObj(x) || x.v !== 1) return null
  if (typeof x.symbol !== 'string' || !/^[A-Z0-9]{1,12}$/.test(x.symbol)) return null
  if (typeof x.tf !== 'string' || !TFS.has(x.tf)) return null
  if (!Array.isArray(x.lines) || x.lines.length > MAX_LINES) return null
  const seen = new Set<string>()
  const lines: ChartLine[] = []
  for (const raw of x.lines) {
    const l = parseLine(raw)
    if (!l || seen.has(l.id)) return null
    seen.add(l.id)
    lines.push(l)
  }
  return { v: 1, symbol: x.symbol, tf: x.tf as ChartTfKey, lines }
}

/** Every action's ask, in line order (the first is the post's PRIMARY action). */
export function chartStateToAsks(s: ChartState): string[] {
  const asks: string[] = []
  for (const l of s.lines) {
    if ((l.kind === 'h' || l.kind === 'zone') && l.action) asks.push(l.action.ask)
  }
  return asks
}
