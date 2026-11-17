// SCENARIOS — a bull or a bear setup drawn from the chart's own structure.
// Pure, pinned (scripts/scenario-pins).
//
// A trader who is bullish draws the same few lines every time: where the
// idea is wrong (under the last swing low), where it first meets sellers
// (the last swing high), where it goes if that breaks. This file draws those
// lines by FIXED RULES from the candles, so the same chart always gives the
// same lines, and every line can say why it is where it is.
//
//   the structure   swing highs and lows (a bar that is the extreme of
//                   PIVOT_SPAN bars each side) that the price has not broken
//                   since: floors under the price, ceilings over it
//   a bull setup    in at the price now; wrong under the nearest floor, with
//                   half an ATR of room; the target is the nearest ceiling
//                   that pays at least the risk, then the next one up (or
//                   the range's height added on top)
//   a bear setup    the mirror image
//   both            the two levels that decide between them: over the
//                   ceiling the bull case is in play, under the floor the
//                   bear case is
//
// What this is NOT: a forecast. No model reads the chart and nothing here
// predicts a price. The viewer picks the side; the rules only draw that
// side's textbook setup. And the same rules are run over the bars before
// today (scenarioRecord) so the card can say how often the target came
// before the stop on this market. That number is printed whatever it is.

import { isHip3Pair, type Candle, type ChartPair, type ChartTf } from '@/lib/charts'

export type ScenarioBias = 'bull' | 'bear'
export type ScenarioMode = ScenarioBias | 'both'

/** A swing high / low is the extreme of this many bars on each side. */
export const PIVOT_SPAN = 5
export const ATR_BARS = 14
/** The structure is read from this many bars back (today's and every past setup alike). */
export const LOOKBACK_BARS = 300
/** A floor or a ceiling closer to the price than this many ATRs is not a level, it is the price. */
export const MIN_ROOM_ATR = 1
/** Room between the swing level and the stop. */
export const STOP_BUFFER_ATR = 0.5
/** The stop when the window holds no swing level on that side. */
export const FALLBACK_STOP_ATR = 2
/** The box's target is the first level that pays at least this many times the risk. */
export const MIN_REWARD_RISK = 1
/** A past setup has this many bars to reach its target or its stop. */
export const HORIZON_BARS = 60
/** Fewer bars than this and nothing is drawn. */
export const MIN_BARS = 60
/** Fewer judged setups than this and the record says it is too thin to read. */
export const THIN_RECORD = 8

/** The frames a scenario is drawn on: a swing on a ten-second or a minute bar is noise. */
export const SCENARIO_TFS: readonly ChartTf[] = ['15m', '1h', '4h', '1d']

/**
 * The markets the button is offered on. A tokenized stock, a stock or index
 * perp on a builder market, and an index are left out on purpose: a drawn
 * setup next to a fee-bearing order on a security is the case to put to a
 * lawyer first (2026-11-17). Coins and their perps only.
 */
export function scenarioOffered(pair: ChartPair | null | undefined): boolean {
  if (!pair) return false
  if (pair.source === 'coinbase') return true
  // A builder-market perp (xyz:AAPL, xyz:SP500) is a stock or an index by another door.
  return pair.source === 'hyperliquid' && !isHip3Pair(pair)
}

export function scenarioTfOk(tf: ChartTf): boolean {
  return SCENARIO_TFS.includes(tf)
}

export interface ScenarioLevel {
  /** `passing` is a level between the entry and the box's target: it pays
   *  less than MIN_REWARD_RISK times the risk, so the box aims past it. */
  role: 'entry' | 'stop' | 'passing' | 'target' | 'beyond'
  price: number
  /** Why the line is where it is. */
  why: string
}

export interface Scenario {
  bias: ScenarioBias
  entry: number
  stop: number
  target: number
  /** The level past the box's target, when the structure names one. */
  beyond: number | null
  /** Reward to risk of entry → target against entry → stop. */
  rr: number
  levels: ScenarioLevel[]
  /** The case for someone who is NOT in it yet: the level whose break puts
   *  it in play (the nearest ceiling for a bull, the nearest floor for a
   *  bear) and where a break aims (the range's height projected past it). */
  breakout: { trigger: number; triggerWhy: string; target: number | null; targetWhy: string } | null
  /** Same floor and ceiling = the same setup (the record counts each once). */
  key: string
  /** Unix seconds: the bar the setup was read on. */
  asOf: number
  atr: number
}

interface Flags {
  high: boolean[]
  low: boolean[]
}

/** Which bars are swing highs / lows. A bar's flag depends only on its
 *  PIVOT_SPAN neighbours, so it is valid for any read that ends at least
 *  PIVOT_SPAN bars after it. Ties go to the earlier bar. */
export function pivotFlags(candles: readonly Candle[], span = PIVOT_SPAN): Flags {
  const n = candles.length
  const high = new Array<boolean>(n).fill(false)
  const low = new Array<boolean>(n).fill(false)
  for (let i = span; i < n - span; i++) {
    let hi = true
    let lo = true
    for (let k = 1; k <= span && (hi || lo); k++) {
      if (!(candles[i].h > candles[i - k].h) || !(candles[i].h >= candles[i + k].h)) hi = false
      if (!(candles[i].l < candles[i - k].l) || !(candles[i].l <= candles[i + k].l)) lo = false
    }
    high[i] = hi
    low[i] = lo
  }
  return { high, low }
}

/** Average true range of the ATR_BARS bars ending at `end`. */
export function atrAt(candles: readonly Candle[], end: number, bars = ATR_BARS): number | null {
  const from = end - bars + 1
  if (from < 1 || end >= candles.length) return null
  let sum = 0
  for (let i = from; i <= end; i++) {
    const c = candles[i]
    const prev = candles[i - 1].c
    sum += Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev))
  }
  const atr = sum / bars
  return atr > 0 && Number.isFinite(atr) ? atr : null
}

interface Level {
  i: number
  t: number
  price: number
}

interface Structure {
  price: number
  atr: number
  /** Unbroken swing lows under the price, nearest first. */
  floors: Level[]
  /** Unbroken swing highs over the price, nearest first. */
  ceilings: Level[]
  start: number
}

/** The floors and ceilings standing at bar `end`, read from nothing after it. */
function structureAt(candles: readonly Candle[], end: number, flags: Flags): Structure | null {
  if (end < MIN_BARS - 1 || end >= candles.length) return null
  const atr = atrAt(candles, end)
  const price = candles[end].c
  if (atr === null || !(price > 0)) return null
  const start = Math.max(0, end - LOOKBACK_BARS + 1)
  const room = atr * MIN_ROOM_ATR
  const floors: Level[] = []
  const ceilings: Level[] = []
  let minAfter = candles[end].l
  let maxAfter = candles[end].h
  for (let i = end - 1; i >= start; i--) {
    const c = candles[i]
    // A swing is known only once PIVOT_SPAN bars have printed after it.
    if (i <= end - PIVOT_SPAN) {
      // Unbroken: no later bar went past it (a later bar that only touches it has not broken it).
      if (flags.low[i] && c.l <= minAfter && c.l <= price - room) floors.push({ i, t: c.t, price: c.l })
      if (flags.high[i] && c.h >= maxAfter && c.h >= price + room) ceilings.push({ i, t: c.t, price: c.h })
    }
    if (c.l < minAfter) minAfter = c.l
    if (c.h > maxAfter) maxAfter = c.h
  }
  // Walking backwards, each unbroken floor found is lower than the last: nearest first already.
  return { price, atr, floors, ceilings, start }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2 Nov`, or `2 Nov 14:00` on an intraday frame (UTC, the chart's bars).
 *  The year is added when it is not the year of `refSec` (the bar read on). */
export function fmtSwingDay(tSec: number, barSec: number, refSec = tSec): string {
  const d = new Date(tSec * 1000)
  const year = d.getUTCFullYear() === new Date(refSec * 1000).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`
  if (barSec >= 86_400) return day
  return `${day} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * One side's setup at bar `end`, or null when the bars are too few to read.
 * `barSec` only words the dates.
 */
export function scenarioAt(candles: readonly Candle[], end: number, bias: ScenarioBias, flags: Flags = pivotFlags(candles), barSec = 86_400): Scenario | null {
  const st = structureAt(candles, end, flags)
  if (!st) return null
  const bull = bias === 'bull'
  const dir: 1 | -1 = bull ? 1 : -1
  const { price: entry, atr } = st
  const withSide = bull ? st.ceilings : st.floors
  const against = bull ? st.floors : st.ceilings
  const withWord = bull ? 'swing high' : 'swing low'
  const againstWord = bull ? 'swing low' : 'swing high'
  const day = (l: Level) => fmtSwingDay(l.t, barSec, candles[end].t)

  const stop = against[0] ? against[0].price - dir * atr * STOP_BUFFER_ATR : entry - dir * atr * FALLBACK_STOP_ATR
  if (!(stop > 0) || !((entry - stop) * dir > 0)) return null
  const risk = Math.abs(entry - stop)
  const stopWhy = against[0] ? `${bull ? 'under' : 'over'} the ${day(against[0])} ${againstWord}, with half an ATR of room` : `no ${againstWord} ${bull ? 'under' : 'over'} the price in this window: two ATRs of room`

  // The levels in the setup's direction, nearest first.
  const cands: { price: number; why: string }[] = []
  const far = (p: number) => p > 0 && (p - entry) * dir >= atr * MIN_ROOM_ATR && (cands.length === 0 || (p - cands[cands.length - 1].price) * dir > 0)
  if (withSide[0]) {
    cands.push({ price: withSide[0].price, why: `the ${day(withSide[0])} ${withWord}` })
    // Two swings an ATR apart are one level, not two targets.
    const next = withSide.slice(1).find((l) => (l.price - withSide[0].price) * dir >= atr * MIN_ROOM_ATR)
    if (next) {
      cands.push({ price: next.price, why: `the ${day(next)} ${withWord}, the next one ${bull ? 'up' : 'down'}` })
    } else if (against[0]) {
      const moved = withSide[0].price + dir * Math.abs(withSide[0].price - against[0].price)
      if (far(moved)) cands.push({ price: moved, why: `the range's height added ${bull ? 'over that high' : 'under that low'}` })
    }
  } else {
    // Nothing standing in the way: project the last leg (its 1.272 and 1.618).
    let legStart = against[0]?.price ?? null
    let legFrom = against[0]?.i ?? -1
    if (legStart === null) {
      for (let i = st.start; i <= end; i++) {
        const p = bull ? candles[i].l : candles[i].h
        if (legStart === null || (p - legStart) * dir < 0) {
          legStart = p
          legFrom = i
        }
      }
    }
    let legEnd = legStart as number
    for (let i = Math.max(legFrom, st.start); i <= end; i++) {
      const p = bull ? candles[i].h : candles[i].l
      if ((p - legEnd) * dir > 0) legEnd = p
    }
    const leg = Math.abs(legEnd - (legStart as number))
    for (const ratio of [1.272, 1.618]) {
      const p = (legStart as number) + dir * ratio * leg
      if (far(p)) cands.push({ price: p, why: `${ratio} of the last leg ${bull ? 'up' : 'down'}${against[0] ? ` from the ${day(against[0])} ${againstWord}` : ''}` })
    }
    if (cands.length === 0) {
      for (const mult of [3, 6]) {
        const p = entry + dir * mult * atr
        if (far(p)) cands.push({ price: p, why: `no ${withWord} ${bull ? 'over' : 'under'} the price in this window: ${mult} ATRs` })
      }
    }
  }
  if (cands.length === 0) return null

  const rrOf = (p: number) => Math.abs(p - entry) / risk
  let pick = cands.findIndex((c) => rrOf(c.price) >= MIN_REWARD_RISK)
  if (pick < 0) pick = cands.length - 1
  const target = cands[pick]
  const beyond = cands[pick + 1] ?? null
  const levels: ScenarioLevel[] = [
    { role: 'entry', price: entry, why: 'the price now' },
    { role: 'stop', price: stop, why: stopWhy },
    ...cands.slice(0, pick).map((c) => ({ role: 'passing' as const, price: c.price, why: `${c.why}: it pays ${rrOf(c.price).toFixed(1)} times the risk, less than the stop costs, so the box aims past it` })),
    { role: 'target', price: target.price, why: target.why },
    ...(beyond ? [{ role: 'beyond' as const, price: beyond.price, why: beyond.why }] : []),
  ]
  return {
    bias,
    entry,
    stop,
    target: target.price,
    beyond: beyond?.price ?? null,
    rr: rrOf(target.price),
    levels,
    breakout: withSide[0] ? breakoutOf(withSide[0].price, against[0]?.price ?? null, atr, dir, `the ${day(withSide[0])} ${withWord}`) : null,
    key: `${st.floors[0]?.i ?? -1}:${st.ceilings[0]?.i ?? -1}`,
    asOf: candles[end].t,
    atr,
  }
}

/** A break of `level`: it aims the range's height past the level (three ATRs
 *  when the window holds no other side to measure a range from). */
function breakoutOf(level: number, other: number | null, atr: number, dir: 1 | -1, levelWords: string): Scenario['breakout'] {
  const target = level + dir * (other !== null ? Math.abs(level - other) : 3 * atr)
  return {
    trigger: level,
    triggerWhy: levelWords,
    target: target > 0 ? target : null,
    targetWhy: other !== null ? `the range's height projected ${dir > 0 ? 'over' : 'under'} the break` : `three ATRs ${dir > 0 ? 'over' : 'under'} the break (no range to measure in this window)`,
  }
}

/** Today's setup: read on the newest bar. */
export function scenarioFor(candles: readonly Candle[], bias: ScenarioBias, barSec = 86_400): Scenario | null {
  return candles.length ? scenarioAt(candles, candles.length - 1, bias, pivotFlags(candles), barSec) : null
}

export interface ScenarioRecord {
  bias: ScenarioBias
  /** Past setups that had their full HORIZON_BARS (or resolved inside it). */
  judged: number
  /** The target came first. */
  hit: number
  /** The stop came first (a bar that reached both counts here: nothing is assumed in the setup's favour). */
  stopped: number
  /** Neither within HORIZON_BARS. */
  neither: number
  /** Setups too recent to judge; not counted above. */
  open: number
  /** The mean result in R (1 R = the distance to the stop): +rr on a hit, -1 on a stop, the move at the horizon otherwise. Before fees. */
  avgR: number | null
  /** Unix seconds of the first bar a setup could be read on. */
  since: number | null
}

export type SetupOutcome = 'hit' | 'stopped' | 'neither' | 'open'

/**
 * How a setup read on bar `end` went, on the bars after it. The first bar to
 * reach the stop: stopped. The first to reach the target: hit. A bar that
 * reaches BOTH is stopped (a bar does not say which came first, and nothing
 * is assumed in the setup's favour). Neither within HORIZON_BARS: neither.
 * Fewer bars than that printed since, and still unresolved: open.
 */
export function judgeSetup(candles: readonly Candle[], end: number, s: Pick<Scenario, 'bias' | 'stop' | 'target'>): SetupOutcome {
  const bull = s.bias === 'bull'
  const last = Math.min(end + HORIZON_BARS, candles.length - 1)
  for (let j = end + 1; j <= last; j++) {
    const b = candles[j]
    if (bull ? b.l <= s.stop : b.h >= s.stop) return 'stopped'
    if (bull ? b.h >= s.target : b.l <= s.target) return 'hit'
  }
  return last - end >= HORIZON_BARS ? 'neither' : 'open'
}

/**
 * The same rules run over the bars before today. One setup per structure:
 * the first bar a floor / ceiling pair stands, entered at that bar's close,
 * judged on the bars after it. Nothing after a setup's bar is read to draw it.
 */
export function scenarioRecord(candles: readonly Candle[], bias: ScenarioBias): ScenarioRecord {
  const rec: ScenarioRecord = { bias, judged: 0, hit: 0, stopped: 0, neither: 0, open: 0, avgR: null, since: null }
  const n = candles.length
  if (n < MIN_BARS + 2) return rec
  const flags = pivotFlags(candles)
  const dir = bias === 'bull' ? 1 : -1
  let lastKey = ''
  let sumR = 0
  rec.since = candles[MIN_BARS - 1].t
  // Today's bar is the live setup, not a past one.
  for (let end = MIN_BARS - 1; end < n - 1; end++) {
    const s = scenarioAt(candles, end, bias, flags)
    if (!s || s.key === lastKey) continue
    lastKey = s.key
    const outcome = judgeSetup(candles, end, s)
    if (outcome === 'open') {
      rec.open++
      continue
    }
    if (outcome === 'hit') {
      rec.hit++
      sumR += s.rr
    } else if (outcome === 'stopped') {
      rec.stopped++
      sumR -= 1
    } else {
      rec.neither++
      sumR += ((candles[end + HORIZON_BARS].c - s.entry) * dir) / Math.abs(s.entry - s.stop)
    }
    rec.judged++
  }
  rec.avgR = rec.judged ? sumR / rec.judged : null
  return rec
}

const fmtR = (r: number) => `${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(Math.abs(r) >= 10 ? 0 : 1)} R`

/** `Jun 2022`. */
export function fmtSince(tSec: number): string {
  const d = new Date(tSec * 1000)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * The record as one sentence. The counts are printed whatever they are, and
 * a thin record says so instead of sounding like a rate.
 */
export function recordLine(rec: ScenarioRecord, symbol: string, tfLabel: string): string {
  const what = `${rec.bias} setup`
  if (rec.judged === 0) return `No earlier ${what} to judge on ${symbol} ${tfLabel} in the bars loaded.`
  const since = rec.since !== null ? ` since ${fmtSince(rec.since)}` : ''
  const parts = [`target first ${rec.hit}`, `stop first ${rec.stopped}`]
  if (rec.neither) parts.push(`neither within ${HORIZON_BARS} bars ${rec.neither}`)
  const avg = rec.avgR !== null ? ` Average result ${fmtR(rec.avgR)} a setup, before fees (1 R is the distance to the stop).` : ''
  const thin = rec.judged < THIN_RECORD ? ' Too few to read as a rate.' : ''
  return `The same rules on ${symbol} ${tfLabel}${since}: ${rec.judged} ${what}${rec.judged === 1 ? '' : 's'}, ${parts.join(', ')}.${avg}${thin}`
}

/** The one line every scenario card carries. */
export const SCENARIO_DISCLAIMER = 'Drawn by fixed rules from this chart\'s swing highs and lows. You pick the side. It is a setup to look at, not a forecast and not advice.'

export interface ScenarioView {
  mode: ScenarioMode
  bull: Scenario | null
  bear: Scenario | null
  bullRecord: ScenarioRecord | null
  bearRecord: ScenarioRecord | null
}

/** Everything a press of the button needs, from one read of the candles. */
export function scenarioView(candles: readonly Candle[], mode: ScenarioMode, barSec = 86_400): ScenarioView {
  const wantBull = mode !== 'bear'
  const wantBear = mode !== 'bull'
  const bull = wantBull ? scenarioFor(candles, 'bull', barSec) : null
  const bear = wantBear ? scenarioFor(candles, 'bear', barSec) : null
  return { mode, bull, bear, bullRecord: bull ? scenarioRecord(candles, 'bull') : null, bearRecord: bear ? scenarioRecord(candles, 'bear') : null }
}

/** What to put on the chart for a view. Prices are snapped to the chart's tick. */
export interface ScenarioDrawing {
  /** A Long / Short Position box: entry, with the stop and the target as ticks from it. */
  box: { side: 'long' | 'short'; time: number; entry: number; stopTicks: number; profitTicks: number } | null
  /** Labelled levels. */
  levels: { price: number; label: string }[]
}

const snap = (p: number, pricescale: number) => Math.round(p * pricescale) / pricescale

export function scenarioDrawing(view: ScenarioView, pricescale: number): ScenarioDrawing {
  const out: ScenarioDrawing = { box: null, levels: [] }
  if (!(pricescale > 0)) return out
  if (view.mode === 'both') {
    // Two boxes at one price would sit on top of each other: the pair is
    // drawn as the two levels that decide between them and where a break aims.
    for (const s of [view.bull, view.bear]) {
      if (!s?.breakout) continue
      const name = s.bias === 'bull' ? 'Bull' : 'Bear'
      out.levels.push({ price: snap(s.breakout.trigger, pricescale), label: `${name} case ${s.bias === 'bull' ? 'over' : 'under'} this` })
      if (s.breakout.target !== null) out.levels.push({ price: snap(s.breakout.target, pricescale), label: `${name} target` })
    }
    return out
  }
  const s = view.mode === 'bull' ? view.bull : view.bear
  if (!s) return out
  const entry = snap(s.entry, pricescale)
  const stopTicks = Math.round(Math.abs(entry - s.stop) * pricescale)
  const profitTicks = Math.round(Math.abs(s.target - entry) * pricescale)
  if (stopTicks > 0 && profitTicks > 0) out.box = { side: s.bias === 'bull' ? 'long' : 'short', time: s.asOf, entry, stopTicks, profitTicks }
  const name = s.bias === 'bull' ? 'Bull' : 'Bear'
  for (const l of s.levels) {
    if (l.role === 'passing') out.levels.push({ price: snap(l.price, pricescale), label: `${name}: ${s.bias === 'bull' ? 'resistance' : 'support'} on the way` })
    if (l.role === 'beyond') out.levels.push({ price: snap(l.price, pricescale), label: `${name} target 2` })
  }
  return out
}
