// Pins for squad called-it, lane CHART (2026-11-11). This lane owns this file:
// the pure half runs anywhere, the served half against a built server.
// Wired into test-api by the contract commit; the lane only adds checks here.
//   npx tsx scripts/called-chart-pins.ts                    (npm run pins:called-chart)
//   BASE=http://localhost:PORT npx tsx scripts/called-chart-pins.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle } from '../lib/charts'
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts } from '../lib/called-it/fixture'
import { ADDED_MARK, LABEL_CAVEAT, PICK_MAX, PIN_URL_MAX, STANDING_NOT_VERIFIED, VERDICT_WORDS, buildRecord, chartHref, recordHref, type CalledCall, type CalledRecord, type CallVerdict } from '../lib/called-it/spec'
import { applyPins, asRecordResponse, checkPostLink, classicMarkers, cleanPins, parsePlotParams, plotUrl, plottedFrom, recordApiUrl, safeNextHref, samePlot, sideCounts, togglePin, viewerFrom, viewerOwns } from '../lib/called-it/use-record'
import {
  CALLED_MARK_PREFIX,
  CALLOUT_FONT_PX,
  CARDS_MIN_PANE_W,
  PANE_KEEP,
  PIN_SHAPE_FLAGS,
  PIN_WORDS_MAX,
  VERDICT_GLYPH,
  boxSize,
  boxedIds,
  boxesOverlap,
  calledMarks,
  calloutPlan,
  calloutShape,
  clampPost,
  cleanLayout,
  cleanPostText,
  createCalledPins,
  estimateTextWidth,
  fitRange,
  keepTopFor,
  graphemes,
  layoutCallouts,
  markTooltip,
  pickStartSide,
  pinDate,
  pinText,
  postIdOfMark,
  railMargins,
  railOf,
  readMargins,
  spreadRail,
  tallyLabel,
  tallyShape,
  timeForX,
  verdictLook,
  withCalledMarks,
  withoutCalled,
  wrapWords,
  xForTime,
  type AxisSample,
  type BoxSize,
  type CalledInks,
  type PaneSize,
  type PinAnchor,
  type PlacedBox,
} from '../lib/tv/called-pins'
import { planFor } from '../lib/tv/plan'
import { linesFromShapes, type ShapeSnapshot } from '../lib/tv/shapes'
import type { TvChartApi, TvDatafeed, TvMark, TvPoint, TvShapeOptions, TvSymbolInfo, TvWidget } from '../lib/tv/types'

type Check = (name: string, ok: boolean, extra?: string) => void

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const DAY = 86_400
const NOW = Date.UTC(2026, 10, 11, 12)
const NOW_SEC = Math.floor(NOW / 1000)
const INKS: CalledInks = { up: '#22c55e', down: '#ef4444', fg: '#ffffff', bg: '#000000', surf: '#161616', muted: '#9a9a9a', line: '#3a3a3a' }
const measure = (s: string) => estimateTextWidth(s, CALLOUT_FONT_PX)
const ELL = '\u2026'
const DOT = '\u00b7'

/** 400 daily bars ending today on a wave, so the fixture has hits, misses and calls still open. */
function bars(n = 400): Candle[] {
  const end = Math.floor(NOW / 1000 / DAY) * DAY
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 40 * Math.sin(i / 23) + i * 0.05
    return { t: end - (n - 1 - i) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }
  })
}
const CANDLES = bars()
const record = (side: 'all' | 'bull' | 'bear' = 'all', pins?: string[]): CalledRecord =>
  buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side, profile: FIXTURE_PROFILE, verified: null, posts: fixturePosts(NOW), candles: CANDLES, nowMs: NOW, scannedAt: NOW, postsRead: 11, pins })

/** The same account with two posts pasted by a viewer on top of what the scan found, and with nothing scanned at all. */
const withAdded = (): CalledRecord => {
  const posts = fixturePosts(NOW).map((p, i) => (i === 1 || i === 5 ? { ...p, origin: 'added' as const } : p))
  return buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'all', profile: FIXTURE_PROFILE, verified: null, posts, candles: CANDLES, nowMs: NOW, scannedAt: NOW, postsRead: 9, pins: posts.filter((p) => p.label.stance !== 'none').slice(0, 5).map((p) => p.id) })
}
const pasteOnly = (): CalledRecord => {
  const posts = fixturePosts(NOW).slice(0, 4).map((p) => ({ ...p, origin: 'added' as const }))
  return buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'all', profile: FIXTURE_PROFILE, verified: null, posts, candles: CANDLES, nowMs: NOW, scannedAt: null, postsRead: 0 })
}

/** The view a plot opens on, as the chart would draw it: time and price both linear across the pane. */
function openingView(rec: CalledRecord, pane: PaneSize, ids: readonly string[]): PinAnchor[] {
  const range = fitRange(rec.calls, NOW_SEC)
  if (!range) return []
  const span = (range.to - range.from) * 1.05
  const prices = rec.calls.map((c) => c.priceAt)
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const byId = new Map(rec.calls.map((c) => [c.postId, c]))
  return ids.map((id) => {
    const c = byId.get(id) as CalledCall
    return { id, x: ((c.barTime - range.from) / span) * pane.width, y: pane.height * 0.3 + (1 - (c.priceAt - lo) / (hi - lo || 1)) * pane.height * 0.4 }
  })
}
function sizesFor(rec: CalledRecord, ids: readonly string[], pane: PaneSize): Record<string, BoxSize> {
  const plan = calloutPlan(pane)
  const byId = new Map(rec.calls.map((c) => [c.postId, c]))
  return Object.fromEntries(ids.map((id) => [id, boxSize(pinText(byId.get(id) as CalledCall, rec.handle, { textWidth: plan.textWidth, measure, wordLines: plan.wordLines }).lines, measure)]))
}
function laid(rec: CalledRecord, pane: PaneSize): { placed: PlacedBox[]; ids: string[]; keepBottom: number } {
  const plan = calloutPlan(pane)
  const ids = boxedIds(rec.calls, plan.total)
  const sizes = sizesFor(rec, ids, pane)
  const anchors = openingView(rec, pane, ids)
  const keepBottom = tallyLabel(rec, pane).keepBottom
  return { placed: layoutCallouts({ pane, anchors, sizes, keepBottom, startAbove: pickStartSide({ pane, anchors, sizes, keepBottom }) }), ids, keepBottom }
}
const noOverlap = (boxes: readonly PlacedBox[]) => boxes.every((a, i) => boxes.every((b, j) => i >= j || !boxesOverlap(a, b)))
const inside = (boxes: readonly PlacedBox[], pane: PaneSize, keepBottom: number) => boxes.every((b) => b.x >= PANE_KEEP.edge - 0.5 && b.x + b.w <= pane.width - PANE_KEEP.edge + 0.5 && b.y >= PANE_KEEP.top - 0.5 && b.y + b.h <= pane.height - keepBottom + 0.5)

const LAPTOP: PaneSize = { width: 825, height: 395 }
const PHONE: PaneSize = { width: 252, height: 372 }

export function calledChartPins(check: Check): void {
  const rec = record()
  const call = (v: CallVerdict) => rec.calls.find((c) => c.verdict === v)
  const anyCall = rec.calls[0]

  // ── the words on a pin ────────────────────────────────────────────────
  const plan = calloutPlan(LAPTOP)
  const t = pinText({ text: 'Top is in. I sold everything today.', quote: 'Top is in', postedAt: Date.UTC(2026, 0, 10, 15), verdict: 'wrong', judgedPct: -0.291 }, 'pantessa_test', { textWidth: plan.textWidth, measure, wordLines: 2 })
  const tOpen = pinText({ text: 'Buying this dip with size.', quote: 'Buying this dip', postedAt: Date.UTC(2026, 10, 2, 9), verdict: 'open', judgedPct: 0.04 }, 'pantessa_test', { textWidth: plan.textWidth, measure, wordLines: 2 })
  check(
    'called chart words: a card is three short lines: `@handle . 10 Jan 2026` (the UTC day), the post\'s own words, and the move with the verdict\'s word (`-29.1% in 30 days . missed`; an open call says `so far` and `too early to say`)',
    t.lines.length === 3 && t.head === `@pantessa_test ${DOT} 10 Jan 2026` && t.words.join(' ') === 'Top is in. I sold everything today.' && t.result === `-29.1% in 30 days ${DOT} missed` && t.text === t.lines.join('\n') && tOpen.result === `+4.0% so far ${DOT} too early to say` && pinDate(Date.UTC(2025, 11, 6, 23, 59)) === '6 Dec 2025',
    JSON.stringify(t.lines),
  )

  const long = 'Morning all. Markets look tired and I have been thinking about this for weeks now, so here it is: the top is in and I sold everything I own today. Good luck to everyone still holding.'
  const head = clampPost(long, 'Markets look tired')
  const around = clampPost(long, 'the top is in and I sold everything')
  const body = (s: string) => s.replace(new RegExp(`^${ELL}|${ELL}$`, 'g'), '')
  check(
    `called chart words: a long post is cut to ${PIN_WORDS_MAX} characters at most, the ellipses included, and marked with an ellipsis at each cut; what is left is ONE unbroken span of the post (nothing reworded); a short post is shown whole`,
    clampPost('Top is in.', 'Top is in') === 'Top is in.' && graphemes(head).length <= PIN_WORDS_MAX && head.endsWith(ELL) && !head.startsWith(ELL) && cleanPostText(long).startsWith(body(head)) && graphemes(around).length <= PIN_WORDS_MAX && cleanPostText(long).includes(body(around)) && body(around).length > 40,
    `${head} | ${around}`,
  )
  check(
    'called chart words: when the span that carries the call sits past the cut, the card shows the span around it (an ellipsis on each cut side) instead of an opening that says nothing',
    around.startsWith(ELL) && around.includes('the top is in and I sold everything') && head.includes('Markets look tired') && clampPost(long, null) === clampPost(long, 'not in the post at all'),
    around,
  )
  const hostile = 'Line one\n\nline two\ttabbed \u202egnp.exe\u202c and \u200bzero width \u0007 bell'
  const emoji = `${'rocket '.repeat(12)}\u{1F468}\u200d\u{1F469}\u200d\u{1F467} family ${'\u{1F680}'.repeat(40)}`
  check(
    'called chart words: a post is put on one line with its control and direction-override characters removed and its whitespace collapsed (no word changes), and a cut never splits an emoji',
    cleanPostText(hostile) === 'Line one line two tabbed gnp.exe and zero width bell' && !/[\u0000-\u001f\u200b-\u200f\u202a-\u202e]/.test(cleanPostText(hostile)) && graphemes(clampPost(emoji, null)).length <= PIN_WORDS_MAX && !/[\ud800-\udbff]$/.test(body(clampPost(emoji, null))) && !/^[\udc00-\udfff]/.test(body(clampPost(emoji, null))),
    cleanPostText(hostile),
  )
  const wrapped = wrapWords('This is a much longer post that should wrap across a couple of lines because it runs to ninety characters', 208, measure, 2)
  const longWord = wrapWords('https://example.com/a/very/long/link/that/never/breaks/on/its/own/because/it/has/no/spaces', 208, measure, 2)
  check(
    'called chart words: the wrap keeps every line inside the card, never more lines than the card holds, ends a cut with an ellipsis that still fits, and breaks a word wider than the card',
    wrapped.length === 2 && wrapped.every((l) => measure(l) <= 208) && wrapped[1].endsWith(ELL) && wrapWords('Top is in.', 208, measure, 2).join('|') === 'Top is in.' && longWord.length === 2 && longWord.every((l) => measure(l) <= 208),
    JSON.stringify(wrapped),
  )

  // ── color AND word ────────────────────────────────────────────────────
  const looks = (['right', 'wrong', 'flat', 'open'] as const).map((v) => verdictLook(v, INKS))
  check(
    'called chart verdict: a hit and a miss differ by color AND by word AND by glyph; the two that are not results (no real move, too early to say) wear the neutral ink and are told apart by word and glyph',
    looks[0].ink === INKS.up && looks[1].ink === INKS.down && looks[0].ink !== looks[1].ink && looks[0].word === VERDICT_WORDS.right && looks[1].word === VERDICT_WORDS.wrong && looks[0].word !== looks[1].word && new Set(looks.map((l) => l.glyph)).size === 4 && new Set(looks.map((l) => l.word)).size === 4 && looks[2].ink === INKS.muted && looks[3].ink === INKS.muted && looks[0].filled && looks[1].filled && !looks[2].filled && !looks[3].filled,
  )
  const hit = call('right') ?? anyCall
  const miss = call('wrong') ?? anyCall
  const hitShape = calloutShape(hit, pinText(hit, rec.handle, { textWidth: plan.textWidth, measure, wordLines: 2 }), { time: hit.barTime, price: hit.priceAt * 1.1 }, INKS)
  const missShape = calloutShape(miss, pinText(miss, rec.handle, { textWidth: plan.textWidth, measure, wordLines: 2 }), { time: miss.barTime, price: miss.priceAt * 0.9 }, INKS)
  check(
    'called chart verdict: on a card the verdict is the border (the leader too) and the last line\'s word: a hit and a miss never share either',
    hit !== miss && hitShape.options.overrides?.bordercolor === INKS.up && missShape.options.overrides?.bordercolor === INKS.down && String(hitShape.options.text).endsWith(`${DOT} ${VERDICT_WORDS.right}`) && String(missShape.options.text).endsWith(`${DOT} ${VERDICT_WORDS.wrong}`),
  )

  // ── the shapes ────────────────────────────────────────────────────────
  const label = tallyLabel(rec, LAPTOP)
  const tShape = tallyShape(label, INKS)
  const flagged = (o: TvShapeOptions) => o.lock === true && o.disableSelection === true && o.disableSave === true && o.disableUndo === true && o.zOrder === 'top'
  check(
    'called chart shapes: a card is the library\'s own `callout`, its tip on the bar and that day\'s close; every pin shape is made locked, unselectable (so nobody edits a post\'s words on the chart), never saved, never undoable, in front of the candles',
    hitShape.options.shape === 'callout' && hitShape.points[0].time === hit.barTime && hitShape.points[0].price === hit.priceAt && hitShape.points.length === 2 && flagged(hitShape.options) && flagged(tShape) && PIN_SHAPE_FLAGS.disableSave === true && PIN_SHAPE_FLAGS.lock === true && hitShape.options.overrides?.transparency === 0 && hitShape.options.overrides?.wordWrap === false && String(hitShape.options.text).split('\n').length >= 3,
  )
  check(
    'called chart tally: the pane itself carries the record\'s own headline and standing line, word for word, and where the record lives, so every picture of the pins holds the full count and "Not verified"',
    tShape.shape === 'anchored_text' && label.text.replace(/\n/g, ' ').includes(rec.words.headline) && label.text.replace(/\n/g, ' ').includes(STANDING_NOT_VERIFIED) && label.text.replace(/\n/g, ' ').includes(`pantessa.com${recordHref(rec.handle, 'BTC')}`) && tallyLabel(record('bear'), LAPTOP).text.includes('side=bear') && label.keepBottom > 20 && label.lines <= 3 && tallyLabel(rec, PHONE).lines > label.lines && tallyLabel(rec, PHONE).lines <= 8 && tallyLabel(rec, PHONE).fontPx < label.fontPx && tShape.overrides?.wordWrap === false,
    label.text,
  )

  // ── a pasted post is shown and marked, never counted (review R1) ─────────
  const mixed = withAdded()
  const pasted = mixed.calls.find((c) => c.origin === 'added' && c.picked) as CalledCall
  const scannedCall = mixed.calls.find((c) => c.origin === 'scan' && c.picked) as CalledCall
  const pastedText = pinText(pasted, mixed.handle, { textWidth: plan.textWidth, measure, wordLines: 2 })
  const scannedText = pinText(scannedCall, mixed.handle, { textWidth: plan.textWidth, measure, wordLines: 2 })
  const pastedShape = calloutShape(pasted, pastedText, { time: pasted.barTime, price: pasted.priceAt }, INKS)
  const scannedShape = calloutShape(scannedCall, scannedText, { time: scannedCall.barTime, price: scannedCall.priceAt }, INKS)
  check(
    `called chart added: a post a viewer pasted looks different from one the scan found: its card says "${ADDED_MARK}" on a line of its own (the contract's mark) and is set in italics; a scanned call's card has neither, and both are the same height at most`,
    !!pasted && !!scannedCall && pastedText.added && pastedText.lines[1] === ADDED_MARK && pastedShape.options.overrides?.italic === true && !scannedText.added && !scannedText.lines.includes(ADDED_MARK) && scannedShape.options.overrides?.italic === false && pastedText.lines.length <= 4 && scannedText.lines.length <= 4 && pastedText.words.length === 1,
    JSON.stringify(pastedText.lines),
  )
  const pastedHit = { ...pasted, verdict: 'right' as const }
  const mAdded = calledMarks({ handle: mixed.handle, calls: [pastedHit, { ...scannedCall, verdict: 'right' as const }] }, [], INKS)
  check(
    'called chart added: as a mark a pasted post is a ring where a scanned hit or miss is a filled disc, and its tooltip says it was added by a viewer',
    mAdded[0].color.background === INKS.surf && mAdded[0].color.border === INKS.up && mAdded[1].color.background === INKS.up && mAdded[0].text.includes(ADDED_MARK) && !mAdded[1].text.includes(ADDED_MARK),
  )
  const lMixed = tallyLabel(mixed, LAPTOP)
  const lPaste = tallyLabel(pasteOnly(), LAPTOP)
  check(
    'called chart added: the line on the pane counts only what the scan found, says pasted posts are shown and not counted, and for a record nobody has scanned says there is no tally (never a count of hand-picked posts)',
    mixed.added === 2 && mixed.tally.total === mixed.calls.length - 2 && !!mixed.words.added && lMixed.text.replace(/\n/g, ' ').includes(mixed.words.added as string) && lMixed.text.replace(/\n/g, ' ').includes(mixed.words.headline) && pasteOnly().scanned === false && /No scan yet, so no tally/.test(lPaste.text.replace(/\n/g, ' ')) && !/called it|missed/.test(lPaste.text),
    lPaste.text,
  )
  check(
    'called chart added: All . Bull . Bear show what the scan found on each side, and nothing at all for a record with no scan',
    sideCounts(mixed)?.all === mixed.bySide.bull.total + mixed.bySide.bear.total && sideCounts(mixed)?.all === mixed.calls.length - 2 && sideCounts(pasteOnly()) === null && sideCounts(null) === null && sideCounts(rec)?.bull === rec.bySide.bull.total,
  )
  check(
    'called chart coverage: on a pane with room for cards the line on the pane also says what the scan READ (the record\'s own words), never that the chart\'s window was read; a phone\'s pane leaves it to the strip',
    !!rec.words.coverage && label.text.replace(/\n/g, ' ').includes(rec.words.coverage as string) && !tallyLabel(rec, PHONE).text.replace(/\n/g, ' ').includes(rec.words.coverage as string) && /^Read /.test(rec.words.coverage as string),
    label.text,
  )
  // A handle of fifteen wide letters and a long result: no line is wider than the card.
  const wideText = pinText({ text: 'Top is in.', quote: 'Top is in', postedAt: Date.UTC(2026, 8, 30), verdict: 'open', judgedPct: 1.234, origin: 'added' }, 'WWWWWWWWWWWWWWW', { textWidth: 180, measure, wordLines: 2 })
  check(
    'called chart words: no line of a card is wider than the card, whatever the handle: a long handle puts the date on its own line, a long result puts the verdict on its own, and the planned box is never narrower than its widest line',
    wideText.lines.every((l) => measure(l) <= 180) && wideText.lines[0] === '@WWWWWWWWWWWWWWW' && wideText.lines.includes(ADDED_MARK) && boxSize(wideText.lines, measure).w >= Math.max(...wideText.lines.map(measure)) + 20 && boxSize(['a', 'b', 'c'], measure).h === 3 * CALLOUT_FONT_PX + 20,
    JSON.stringify(wideText.lines),
  )

  // ── how many cards a pane holds ───────────────────────────────────────
  const tall = calloutPlan({ width: 825, height: 520 })
  const narrow = calloutPlan({ width: 600, height: 395 })
  const wide = calloutPlan({ width: 1400, height: 600 })
  check(
    `called chart plan: a phone's pane (under ${CARDS_MIN_PANE_W}px) holds NO cards, every call is a mark; a laptop's holds ${PICK_MAX} (three a rail); a narrow one four; none ever holds more than a URL may pin; a tall pane gives the post a third line`,
    calloutPlan(PHONE).total === 0 && calloutPlan({ width: 519, height: 600 }).total === 0 && calloutPlan({ width: 900, height: 200 }).total === 0 && plan.perRail === 3 && plan.total === PICK_MAX && plan.wordLines === 2 && tall.wordLines === 3 && narrow.perRail === 2 && narrow.total === 4 && wide.total <= PIN_URL_MAX && wide.perRail === 4 && plan.textWidth >= 180 && plan.textWidth <= 236,
    JSON.stringify([plan, narrow, wide]),
  )
  const pickedIds = rec.calls.filter((c) => c.picked).map((c) => c.postId)
  const four = boxedIds(rec.calls, 4)
  const byImpact = [...rec.calls.filter((c) => c.picked)].sort((a, b) => b.impact - a.impact).slice(0, 4).map((c) => c.postId)
  check(
    'called chart plan: the cards are the PICKED calls in date order; a pane that holds fewer keeps the ones that mattered most; a call with no card is a mark, never dropped',
    boxedIds(rec.calls, 6).join() === pickedIds.join() && boxedIds(rec.calls, 0).length === 0 && four.length === Math.min(4, pickedIds.length) && four.every((id) => byImpact.includes(id)) && four.join() === pickedIds.filter((id) => four.includes(id)).join() && calledMarks(rec, four, INKS).length === rec.calls.length - four.length,
  )

  // ── where the cards go ────────────────────────────────────────────────
  const L = laid(rec, LAPTOP)
  const above = L.placed.filter((b) => b.side === 'above')
  const below = L.placed.filter((b) => b.side === 'below')
  const anchorsL = openingView(rec, LAPTOP, L.ids)
  const sidesAlternate = L.placed.every((b, i) => i === 0 || b.side !== L.placed[i - 1].side)
  check(
    'called chart layout: at the zoom a plot opens on, no two cards overlap and none leaves the pane (the legend above, the tally line below, the edges)',
    L.placed.length === pickedIds.length && L.placed.length >= 4 && noOverlap(L.placed) && inside(L.placed, LAPTOP, L.keepBottom) && L.placed.every((b) => b.inView),
    JSON.stringify(L.placed.map((b) => [b.side, b.x, b.y, b.w, b.h])),
  )
  check(
    'called chart layout: cards alternate above and below in date order (neighbors in time never share a rail), each rail keeps the date order left to right (two leaders never cross), and the upper rail stays clear of the legend\'s corner',
    sidesAlternate && above.every((b, i) => i === 0 || b.x > above[i - 1].x) && below.every((b, i) => i === 0 || b.x > below[i - 1].x) && above.every((b) => b.y === PANE_KEEP.top && b.x >= PANE_KEEP.topLeftWidth) && below.every((b) => b.y + b.h === LAPTOP.height - L.keepBottom) && L.placed.map((b) => b.id).join() === L.ids.join() && railOf(0, true) === 'above' && railOf(1, true) === 'below' && railOf(0, false) === 'below',
  )
  check(
    'called chart layout: a card sits over its own bar unless a neighbor or the pane\'s edge moves it, and then only as far as it must',
    L.placed.every((b) => {
      const a = anchorsL.find((x) => x.id === b.id)
      const want = (a?.x ?? 0) - b.w / 2
      const lo = b.side === 'above' ? PANE_KEEP.topLeftWidth : PANE_KEEP.edge
      const free = Math.abs(b.x - want) <= 1
      const rail = (b.side === 'above' ? above : below).filter((o) => o !== b)
      const pressed = b.x <= lo + 1 || b.x + b.w >= LAPTOP.width - PANE_KEEP.edge - 1 || rail.some((o) => Math.abs(o.x + o.w + 10 - b.x) <= 1 || Math.abs(b.x + b.w + 10 - o.x) <= 1)
      return free || pressed
    }),
  )
  // Every pane size a desktop chart takes, the three sides, and a viewer's own eight pins.
  const eight = record('all', record().calls.slice(0, PIN_URL_MAX).map((c) => c.postId))
  let sweep = true
  let sweepNote = ''
  for (const r of [rec, record('bull'), record('bear'), eight]) {
    for (let w = CARDS_MIN_PANE_W; w <= 1500 && sweep; w += 35) {
      for (const h of [300, 395, 470, 640]) {
        const pane = { width: w, height: h }
        const x = laid(r, pane)
        if (!noOverlap(x.placed) || !inside(x.placed, pane, x.keepBottom) || x.placed.length > calloutPlan(pane).total) {
          sweep = false
          sweepNote = `${r.side} ${w}x${h}`
        }
      }
    }
  }
  check('called chart layout: on every pane from the narrowest that holds cards to a wide monitor, for All, Bull, Bear and a viewer\'s own eight pins, no two cards overlap and none leaves the pane', sweep, sweepNote)
  // The worst case: every bar within a few pixels of the next.
  const crowd: PinAnchor[] = L.ids.map((id, i) => ({ id, x: 400 + i * 6, y: 200 }))
  const crowded = layoutCallouts({ pane: LAPTOP, anchors: crowd, sizes: sizesFor(rec, L.ids, LAPTOP), keepBottom: L.keepBottom })
  const edge: PinAnchor[] = L.ids.map((id, i) => ({ id, x: i < 3 ? 2 + i : LAPTOP.width - 3 + i, y: 200 }))
  const edged = layoutCallouts({ pane: LAPTOP, anchors: edge, sizes: sizesFor(rec, L.ids, LAPTOP), keepBottom: L.keepBottom })
  const partly: PinAnchor[] = L.ids.map((id, i) => ({ id, x: i === 0 ? null : i === 1 ? -40 : 300 + i * 90, y: 200 }))
  const parted = layoutCallouts({ pane: LAPTOP, anchors: partly, sizes: sizesFor(rec, L.ids, LAPTOP), keepBottom: L.keepBottom })
  check(
    'called chart layout: calls days apart (bars a few pixels from each other) and calls at the pane\'s edges still get cards that do not overlap and stay inside; a card whose bar is off screen is not placed on screen',
    noOverlap(crowded) && inside(crowded, LAPTOP, L.keepBottom) && noOverlap(edged.filter((b) => b.inView)) && inside(edged.filter((b) => b.inView), LAPTOP, L.keepBottom) && !parted[0].inView && !parted[1].inView && parted.slice(2).every((b) => b.inView) && noOverlap(parted.filter((b) => b.inView)),
  )
  // A narrow pane wraps the legend to two rows: the upper rail starts under it.
  const NARROW: PaneSize = { width: 617, height: 513 }
  const nIds = boxedIds(rec.calls, calloutPlan(NARROW).total)
  const nSizes = sizesFor(rec, nIds, NARROW)
  const nKeep = tallyLabel(rec, NARROW).keepBottom
  const wrapped2 = layoutCallouts({ pane: NARROW, anchors: openingView(rec, NARROW, nIds), sizes: nSizes, keepBottom: nKeep, keepTop: keepTopFor(47) })
  check(
    'called chart layout: the upper rail stands under the legend as the library draws it: one row on a wide pane, two when a narrow pane wraps it (measured, with a floor of one row and a ceiling), and the margins follow',
    keepTopFor(null) === PANE_KEEP.top && keepTopFor(28) === PANE_KEEP.top && keepTopFor(47) === 53 && keepTopFor(400) === 96 && keepTopFor(NaN) === PANE_KEEP.top && wrapped2.filter((b) => b.side === 'above').every((b) => b.y === 53) && noOverlap(wrapped2) && wrapped2.length === 4 && railMargins(NARROW, calloutPlan(NARROW), 68, nKeep, { top: 10, bottom: 8 }, 53).top > railMargins(NARROW, calloutPlan(NARROW), 68, nKeep, { top: 10, bottom: 8 }).top,
  )
  check(
    'called chart layout: one rail spreads its cards with nothing before its start, nothing past its end and a gap between neighbors',
    spreadRail([{ cx: 0, w: 100 }, { cx: 10, w: 100 }, { cx: 20, w: 100 }], 8, 500, 10).join() === '8,118,228' && spreadRail([{ cx: 490, w: 100 }, { cx: 495, w: 100 }], 8, 500, 10).join() === '290,400' && spreadRail([{ cx: 250, w: 100 }], 8, 500, 10).join() === '200' && spreadRail([], 8, 500, 10).length === 0,
  )
  const m = railMargins(LAPTOP, plan, 68, label.keepBottom, { top: 10, bottom: 8 })
  const mPhone = railMargins(PHONE, calloutPlan(PHONE), 0, tallyLabel(rec, PHONE).keepBottom, { top: 10, bottom: 8 })
  check(
    'called chart layout: while a plot is up the pane\'s margins make room for the two rails (the candles stay between them); marks only, they make room for the tally line and nothing else; never tighter than the viewer\'s own, never more than 38%',
    m.top >= Math.ceil(((PANE_KEEP.top + 68) / LAPTOP.height) * 100) && m.bottom >= Math.ceil(((label.keepBottom + 68) / LAPTOP.height) * 100) && m.top <= 38 && m.bottom <= 38 && mPhone.top === 10 && mPhone.bottom >= 8 && railMargins(LAPTOP, plan, 68, label.keepBottom, { top: 37, bottom: 37 }).top === 37 && railMargins({ width: 825, height: 0 }, plan, 68, 30, { top: 10, bottom: 8 }).top === 10,
    JSON.stringify([m, mPhone]),
  )

  // ── the marks ─────────────────────────────────────────────────────────
  const marks = calledMarks(rec, L.ids, INKS)
  const markOf = (v: CallVerdict) => calledMarks({ handle: rec.handle, calls: [{ ...anyCall, verdict: v }] }, [], INKS)[0]
  check(
    'called chart marks: every call without a card is a bar mark on its own bar, in its verdict\'s color with its verdict\'s glyph; a hit and a miss are filled, the other two hollow; on a phone that is every call',
    marks.length === rec.calls.length - L.ids.length && marks.every((mk) => mk.id.startsWith(CALLED_MARK_PREFIX) && rec.calls.some((c) => c.barTime === mk.time && `${CALLED_MARK_PREFIX}${c.postId}` === mk.id)) && markOf('right').color.background === INKS.up && markOf('wrong').color.background === INKS.down && markOf('flat').color.background === INKS.surf && markOf('right').label === VERDICT_GLYPH.right && markOf('wrong').label === VERDICT_GLYPH.wrong && markOf('open').label === VERDICT_GLYPH.open && calledMarks(rec, [], INKS).length === rec.calls.length && [...new Set(Object.values(VERDICT_GLYPH))].every((g) => graphemes(g).length === 1),
  )
  check(
    'called chart marks: a mark\'s tooltip says who, when, the move and the verdict\'s word, then the post\'s own words; a clicked mark names its post and nobody else\'s mark does',
    markTooltip(miss, rec.handle).startsWith(`@${rec.handle} ${DOT} ${pinDate(miss.postedAt)} ${DOT} `) && markTooltip(miss, rec.handle).includes(VERDICT_WORDS.wrong) && markTooltip(miss, rec.handle).endsWith(clampPost(miss.text, miss.quote)) && postIdOfMark(`${CALLED_MARK_PREFIX}123`) === '123' && postIdOfMark('fill:123') === null && postIdOfMark(7) === null,
  )
  const feedMark: TvMark = { id: 'fill:1', time: 100, color: { border: '#fff', background: '#fff' }, text: 'Bought', label: 'B', labelFontColor: '#000', minSize: 18 }
  const ours: TvMark[] = [
    { ...feedMark, id: 'called:1', time: 150 },
    { ...feedMark, id: 'called:2', time: 900 },
  ]
  const info = { ticker: 'BTC' } as TvSymbolInfo
  const feedOf = (read: (t: string) => readonly TvMark[]) => withCalledMarks({ getMarks: ((_i, _f, _t, onData) => onData([feedMark])) as TvDatafeed['getMarks'] }, read)
  let got: TvMark[] = []
  feedOf(() => ours).getMarks(info, 0, 500, (x) => (got = x), '1D')
  let gotThrow: TvMark[] = []
  feedOf(() => {
    throw new Error('boom')
  }).getMarks(info, 0, 500, (x) => (gotThrow = x), '1D')
  check(
    'called chart marks: the plot\'s marks ride beside the datafeed\'s own (a wallet\'s fills): only the ones in the asked range, the feed\'s never dropped or reordered, and a failure on our side still draws the feed\'s',
    got.map((x) => x.id).join() === 'fill:1,called:1' && gotThrow.map((x) => x.id).join() === 'fill:1',
    got.map((x) => x.id).join(),
  )

  // ── nothing of a plot is ever kept ────────────────────────────────────
  const pinSnap: ShapeSnapshot = { id: 'PIN1', name: 'callout', points: [{ time: hit.barTime, price: hit.priceAt }, { time: hit.barTime, price: hit.priceAt * 1.1 }], props: { text: String(hitShape.options.text) } }
  const tallySnap: ShapeSnapshot = { id: 'TALLY', name: 'anchored_text', points: [], props: { text: label.text } }
  const userSnap: ShapeSnapshot = { id: 'USER1', name: 'horizontal_line', points: [{ price: 120 }], props: {} }
  const owns = (id: string) => id === 'PIN1' || id === 'TALLY'
  const kept = withoutCalled([pinSnap, userSnap, tallySnap], owns)
  check(
    'called chart fence: a pin never crosses the bridge (Ask the chart, Share, a published call) and never shows in "Your drawings": the chart\'s shapes are read without the plot\'s; the viewer\'s own level still does both',
    kept.length === 1 && kept[0].id === 'USER1' && linesFromShapes(kept, 20).length === 1 && linesFromShapes(kept, 20)[0].kind === 'h' && linesFromShapes([pinSnap], 20).length === 1 && planFor(kept, { symbol: 'BTC', source: 'coinbase', last: 100, pricescale: 100 }).every((it) => it.shapeId === 'USER1') && withoutCalled([pinSnap], () => false).length === 1,
  )
  const saved = {
    layout: 's',
    charts: [
      {
        chartProperties: { paneProperties: { topMargin: 30, bottomMargin: 31, background: '#000' } },
        panes: [
          {
            sources: [
              { type: 'MainSeries', id: '_seriesId', state: { symbol: 'BTC' } },
              { type: 'LineToolHorzLine', id: 'USER1', state: {} },
              { type: 'LineToolCallout', id: 'PIN1', state: { text: 'a post' } },
              { type: 'LineToolAnchoredText', id: 'TALLY', state: {} },
            ],
            rightAxisesState: [{ state: { m_topMargin: 0.3, m_bottomMargin: 0.31, m_isAutoScale: true }, sources: ['_seriesId', 'USER1', 'PIN1'] }],
            leftAxisesState: [{ state: { m_topMargin: 0.1, m_bottomMargin: 0.08 }, sources: [] }],
          },
        ],
      },
    ],
  }
  type Saved = typeof saved
  const before = JSON.stringify(saved)
  const cleaned = cleanLayout(saved, owns, { original: { top: 10, bottom: 8 }, applied: { top: 30, bottom: 31 } }) as Saved
  const untouched = cleanLayout(saved, () => false, null) as Saved
  check(
    'called chart fence: a layout on its way to storage holds nothing of a plot: no pin among its sources or on a price scale, and the margins the viewer had before the rails widened them; the viewer\'s own drawing and every other setting stay, and the live layout is not edited',
    cleaned.charts[0].panes[0].sources.map((s) => s.id).join() === '_seriesId,USER1' && cleaned.charts[0].panes[0].rightAxisesState[0].sources.join() === '_seriesId,USER1' && cleaned.charts[0].chartProperties.paneProperties.topMargin === 10 && cleaned.charts[0].chartProperties.paneProperties.bottomMargin === 8 && cleaned.charts[0].panes[0].rightAxisesState[0].state.m_topMargin === 0.1 && cleaned.charts[0].panes[0].rightAxisesState[0].state.m_bottomMargin === 0.08 && cleaned.charts[0].panes[0].rightAxisesState[0].state.m_isAutoScale === true && cleaned.charts[0].chartProperties.paneProperties.background === '#000' && cleaned.charts[0].panes[0].leftAxisesState[0].state.m_topMargin === 0.1 && JSON.stringify(saved) === before && !JSON.stringify(cleaned).includes('a post'),
  )
  check(
    'called chart fence: with no plot up a layout is stored as it is (margins the viewer set by hand are theirs), the margins are read back as the library wrote them, and something that is not a layout is handed back untouched',
    untouched.charts[0].chartProperties.paneProperties.topMargin === 30 && untouched.charts[0].panes[0].sources.length === 4 && readMargins(saved).top === 30 && readMargins(saved).bottom === 31 && readMargins(null).top === 10 && readMargins({ charts: [{}] }).bottom === 8 && (cleanLayout({ nope: 1 }, owns, null) as { nope: number }).nope === 1,
  )

  // ── the time axis ─────────────────────────────────────────────────────
  const daily: AxisSample[] = Array.from({ length: 300 }, (_, i) => ({ x: i, t: 1_000_000 + Math.floor(i / 3) * DAY }))
  const weekly: AxisSample[] = Array.from({ length: 100 }, (_, i) => ({ x: i * 2, t: 1_000_000 + Math.floor(i / 5) * 7 * DAY }))
  check(
    'called chart axis: a call\'s bar is found from samples of the time axis: the centre of its own bar on daily bars, the week that holds it on weekly ones; a call before the first bar on screen, or a whole bar past the last, is off screen',
    xForTime(daily, 1_000_000 + 10 * DAY) === 31 && xForTime(daily, 1_000_000 + 10 * DAY + 3600) === 31 && xForTime(weekly, 1_000_000 + 9 * DAY) === 14 && xForTime(daily, 999_999) === null && xForTime(daily, 1_000_000 + 99 * DAY) === 298 && xForTime(daily, 1_000_000 + 100 * DAY) === null && xForTime([], 5) === null && timeForX(daily, 31) === 1_000_000 + 10 * DAY && timeForX(daily, -50) === 1_000_000 && timeForX(daily, 9999) === 1_000_000 + 99 * DAY && timeForX([], 3) === null,
  )
  const range = fitRange(rec.calls, NOW_SEC)
  const one = fitRange([{ barTime: NOW_SEC - 3 * DAY }], NOW_SEC)
  check(
    '"Fit all calls" is daily bars from before the first call to now: every pin on screen with air on the left, and one recent call still opens on months of chart, not three days',
    !!range && rec.calls.every((c) => c.barTime > range.from && c.barTime <= range.to) && range.to === NOW_SEC && range.from <= rec.calls[0].barTime - 10 * DAY && !!one && NOW_SEC - one.from >= 120 * DAY && fitRange([], NOW_SEC) === null,
  )

  // ── the address ───────────────────────────────────────────────────────
  const p = parsePlotParams('?tf=4h&x=%40CZ_Binance&side=bear&pins=1997305021854646273,nope,1997305021854646273,2011725039006646274&vs=ETH')
  check(
    'called chart address: `?x=` is the handle (as typed, with an @, or a profile link), `side` only bull or bear, `pins` only well-formed post ids, no repeats, at most what a URL may carry; no handle, or one that is not a handle, plots nothing',
    p?.handle === 'cz_binance' && p.side === 'bear' && p.pins.join() === '1997305021854646273,2011725039006646274' && parsePlotParams('?x=https%3A%2F%2Fx.com%2Fjack&side=sideways')?.handle === 'jack' && parsePlotParams('?x=jack&side=sideways')?.side === 'all' && parsePlotParams('?side=bear') === null && parsePlotParams('?x=not%20a%20handle') === null && parsePlotParams('?x=') === null && cleanPins(Array.from({ length: 20 }, (_, i) => `1997305021854646${String(i).padStart(3, '0')}`)).length === PIN_URL_MAX && cleanPins('abc,12,<script>').length === 0,
    JSON.stringify(p),
  )
  const url = plotUrl({ handle: 'jack', side: 'bear', pins: ['1997305021854646273', '2011725039006646274'] }, '/t/BTC', '?tf=4h&vs=ETH&x=old&pins=1')
  check(
    'called chart address: the plot is mirrored into the address beside whatever else is there (the frame, a compare): `All` and the rule\'s own pins are left out, ids are a readable comma list, clearing takes all three params off, and the address reads back as the same plot',
    url === '/t/BTC?tf=4h&vs=ETH&x=jack&side=bear&pins=1997305021854646273,2011725039006646274' && plotUrl({ handle: 'jack', side: 'all', pins: [] }, '/t/BTC', '') === '/t/BTC?x=jack' && plotUrl(null, '/t/BTC', '?x=jack&side=bear&pins=1&tf=4h') === '/t/BTC?tf=4h' && plotUrl(null, '/t/BTC', '?x=jack') === '/t/BTC' && samePlot(parsePlotParams(url.slice(url.indexOf('?'))), { handle: 'jack', side: 'bear', pins: ['1997305021854646273', '2011725039006646274'] }) && plotUrl({ handle: 'jack', side: 'bull', pins: [] }, '/t/BTC', '') === chartHref('jack', 'BTC', 'bull') && samePlot(parsePlotParams(chartHref('jack', 'btc').split('?')[1] ? `?${chartHref('jack', 'btc').split('?')[1]}` : ''), { handle: 'jack', side: 'all', pins: [] }) && !samePlot(null, { handle: 'jack', side: 'all', pins: [] }) && samePlot(null, null),
    url,
  )
  check(
    'called chart address: the record is read once per handle and side; the pins are not in the read (toggling one costs no request)',
    recordApiUrl({ handle: 'jack', side: 'all' }, 'BTC') === '/api/x/record?handle=jack&sym=BTC' && recordApiUrl({ handle: 'jack', side: 'bear' }, 'xyz:AAPL') === '/api/x/record?handle=jack&sym=xyz%3AAAPL&side=bear',
  )

  // ── what the server may send ──────────────────────────────────────────
  const ready = asRecordResponse({ status: 'ready', record: rec })
  check(
    'called chart answers: only a body in the contract\'s shape is drawn: the four statuses; a ready one must carry a record with its words, tally and calls; the count of posts still to label is kept only as a positive whole number; anything else is nothing',
    ready?.status === 'ready' && !('unlabeled' in (ready as object)) && (asRecordResponse({ status: 'ready', record: rec, unlabeled: 12 }) as { unlabeled?: number }).unlabeled === 12 && !('unlabeled' in (asRecordResponse({ status: 'ready', record: rec, unlabeled: -3 }) as object)) && !('unlabeled' in (asRecordResponse({ status: 'ready', record: rec, unlabeled: '9' }) as object)) && asRecordResponse({ status: 'ready', record: { handle: 'x' } }) === null && asRecordResponse({ status: 'ready', record: { ...rec, scanned: undefined } }) === null && asRecordResponse({ status: 'ready', record: pasteOnly() })?.status === 'ready' && asRecordResponse({ status: 'ready' }) === null && asRecordResponse({ status: 'done' }) === null && asRecordResponse(null) === null && asRecordResponse('ready') === null && asRecordResponse({ status: 'unscanned', handle: 'jack', symbol: 'BTC', canScan: 'yes' })?.status === 'unscanned' && (asRecordResponse({ status: 'unscanned', handle: 'jack', symbol: 'BTC', canScan: 'yes' }) as { canScan: boolean }).canScan === false && (asRecordResponse({ status: 'scanning', handle: 'jack', symbol: 'BTC', scanId: 'abc123', progress: 'Read 212 posts' }) as { progress: string }).progress === 'Read 212 posts' && asRecordResponse({ status: 'scanning', handle: 7 }) === null,
  )
  const refused = asRecordResponse({ status: 'refused', reason: 'Two scans a day.', next: [{ label: 'Plotted handles', href: '/x' }, { label: 'bad', href: 7 }, 'junk'] })
  check(
    'called chart answers: a refusal keeps its reason and its well-formed next steps, and a next step is followed only when it is a path on this site (never another host, never a scheme, never `//host`)',
    refused?.status === 'refused' && refused.next.length === 1 && asRecordResponse({ status: 'refused' }) === null && safeNextHref('/x') === '/x' && safeNextHref('/t/BTC?x=jack') === '/t/BTC?x=jack' && safeNextHref('//evil.example') === null && safeNextHref('/\\evil.example') === null && safeNextHref('https://evil.example') === null && safeNextHref('javascript:alert(1)') === null && safeNextHref('x') === null && safeNextHref(`/${'a'.repeat(400)}`) === null,
  )

  // ── the viewer's pins ─────────────────────────────────────────────────
  const unpicked = rec.calls.find((c) => !c.picked) as CalledCall
  const picked0 = rec.calls.find((c) => c.picked) as CalledCall
  const added = togglePin(rec, unpicked.postId)
  const removed = togglePin(rec, picked0.postId)
  const mine = applyPins(rec, [unpicked.postId])
  const full = applyPins(rec, rec.calls.slice(0, PIN_URL_MAX).map((c) => c.postId))
  const extra = rec.calls.find((c) => !full.calls.find((f) => f.postId === c.postId)?.picked)
  check(
    'called chart pins: a viewer chooses which calls are PINNED and never which are COUNTED: pinning changes `picked` and nothing else (the tally, the verdicts, the order stay); no valid pin means the rule\'s picks stand',
    'pins' in added && added.pins.includes(unpicked.postId) && added.pins.length === pickedIds.length + 1 && 'pins' in removed && !removed.pins.includes(picked0.postId) && mine.calls.filter((c) => c.picked).map((c) => c.postId).join() === unpicked.postId && JSON.stringify(mine.tally) === JSON.stringify(rec.tally) && mine.words.headline === rec.words.headline && mine.calls.map((c) => `${c.postId}${c.verdict}`).join() === rec.calls.map((c) => `${c.postId}${c.verdict}`).join() && applyPins(rec, []) === rec && applyPins(rec, ['123456789']) === rec && applyPins(rec, pickedIds) === rec,
  )
  check(
    `called chart pins: a plot keeps at least one pin and holds at most ${PIN_URL_MAX}; a refusal says which in plain words, and a call that is not on the plot is not pinned`,
    'refused' in togglePin(mine, unpicked.postId) && full.calls.filter((c) => c.picked).length === PIN_URL_MAX && !!extra && 'refused' in togglePin(full, extra.postId) && /Unpin one first/.test((togglePin(full, extra.postId) as { refused: string }).refused) && 'refused' in togglePin(rec, '123456789'),
  )
  check(
    'called chart add: a pasted link is checked before it is sent: it must be one post on X, and when the link names an account it must be the plotted one (a post link with no account in it goes to the server, which reads its author from X)',
    checkPostLink('https://x.com/pantessa_test/status/1997305021854646273', 'pantessa_test').ok && checkPostLink(' https://x.com/i/status/1997305021854646273 ', 'pantessa_test').ok && !checkPostLink('https://x.com/someone_else/status/1997305021854646273', 'pantessa_test').ok && !checkPostLink('https://x.com/pantessa_test', 'pantessa_test').ok && !checkPostLink('https://evil.example/pantessa_test/status/1997305021854646273', 'pantessa_test').ok && /by @someone_else/.test((checkPostLink('https://x.com/someone_else/status/1997305021854646273', 'pantessa_test') as { reason: string }).reason),
  )
  const sug = plottedFrom({ plotted: [{ handle: 'Jack', symbol: 'btc', name: 'jack' }, { handle: 'jack', symbol: 'ETH' }, { handle: 'not a handle' }, { handle: 'cz_binance', symbol: '<x>' }, null, 7] })
  check(
    'called chart door: the suggestions are the public list\'s handles, each once, each a real handle; a market that is not a market is dropped; a list in no known envelope suggests nothing',
    sug.length === 2 && sug[0].handle === 'jack' && sug[0].symbol === 'BTC' && sug[1].handle === 'cz_binance' && sug[1].symbol === null && plottedFrom(null).length === 0 && plottedFrom({ status: 'refused' }).length === 0 && plottedFrom(Array.from({ length: 30 }, (_, i) => ({ handle: `user_${i}` }))).length === 6,
    JSON.stringify(sug),
  )
  const dots = classicMarkers(rec)
  check(
    'called chart classic: on the built-in chart every call is a dot on its bar that says its verdict in a glyph and the verdict\'s own word; no plot, no dots',
    dots.length === rec.calls.length && dots.every((d, i) => d.t === rec.calls[i].barTime && d.label === `${VERDICT_GLYPH[rec.calls[i].verdict]} ${VERDICT_WORDS[rec.calls[i].verdict]}`) && classicMarkers(null).length === 0,
  )

  // ── who is looking ────────────────────────────────────────────────────
  const claimed = { verified: { at: NOW }, profile: { ...FIXTURE_PROFILE, xUserId: '42' } }
  check(
    'called chart owner: "this viewer is the account" only when the record itself is verified AND the viewer\'s proven X user id is the account\'s; never from the handle in the cookie (a handle can change hands), never for a record that is not verified, never with no id on either side',
    viewerOwns(claimed, { xUserId: '42', handle: 'renamed_since' }) && !viewerOwns(claimed, { xUserId: '43', handle: FIXTURE_HANDLE }) && !viewerOwns({ ...claimed, verified: null }, { xUserId: '42', handle: FIXTURE_HANDLE }) && !viewerOwns({ verified: { at: NOW }, profile: FIXTURE_PROFILE }, { xUserId: '42', handle: FIXTURE_HANDLE }) && !viewerOwns(claimed, null) && !viewerOwns(null, { xUserId: '42', handle: 'x' }),
  )
  check(
    'called chart owner: the identity is read from the sign-in route\'s answer as a user id and a real handle, or it is nobody',
    viewerFrom({ identity: { xUserId: '42', handle: 'Jack' }, available: true })?.handle === 'jack' && viewerFrom({ identity: { xUserId: '42', handle: 'Jack' } })?.xUserId === '42' && viewerFrom({ identity: null }) === null && viewerFrom({ identity: { handle: 'jack' } }) === null && viewerFrom({ identity: { xUserId: '42', handle: 'not a handle' } }) === null && viewerFrom(null) === null && viewerFrom('x') === null,
  )

  // ── wiring (source) ───────────────────────────────────────────────────
  const adv = read('components/markets/chart/AdvancedChart.tsx')
  const pins = read('lib/tv/called-pins.ts')
  const hook = read('lib/called-it/use-record.ts')
  const door = read('components/called/HandleDoor.tsx')
  const panel = read('components/called/CallsPanel.tsx')
  const page = read('components/markets/shell/SymbolPage.tsx')
  const mount = read('components/markets/chart/ChartMount.tsx')
  const css = read('components/called/called-chart.css')
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check(
    'called chart wiring: on the Advanced chart a pin\'s drawing event stops at the plot (its click goes to the strip; it is never synced or saved as a drawing), the shapes are read without the plot\'s, and EVERY write of the layout goes through the plot\'s cleaner',
    /if \(called\.event\(id, type\)\) return\s+if \(type === 'click'\) setFocusId\(id\)/.test(code(adv)) && adv.includes('withoutCalled(chart.getAllShapes(), called.owns)') && (code(adv).match(/writeStoredLayout\(/g) ?? []).length === 2 && (code(adv).match(/writeStoredLayout\(called\.cleanLayout\(s\)\)/g) ?? []).length === 2 && adv.includes('withCalledMarks(feed, called.marks)') && adv.includes('called.attach(w, chart, host)') && /called\.detach\(\)[\s\S]*widget\?\.remove\(\)/.test(adv) && adv.includes('called.retheme()'),
  )
  check(
    'called chart wiring: the door sits on the chart\'s own bar on both engines (the symbol page hands it in beside Compare), the Calls strip sits right under the chart and parks with it, and the built-in chart gets the calls as dots',
    /<PlotHandleButton symbol=\{sym\} \/>\}\s+\{pair && <CompareControl/.test(page) && /<CallsPanel symbol=\{sym\} parked=\{!showChart\} \/>/.test(page) && page.indexOf('<CallsPanel') > page.indexOf('<ChartMount') && page.indexOf('<CallsPanel') < page.lastIndexOf('<AskChart ') && mount.includes('useClassicCalledMarkers(symbol)') && /<MarketChart[\s\S]*markers=\{classicMarkers\}/.test(mount) && /<AdvancedChart[\s\S]*markers=\{allMarkers\}/.test(mount),
  )
  check(
    'called chart wiring: the pins file touches no React and no browser global outside its controller\'s guarded calls, and no browser file of this lane imports the server\'s side of the feature (the X identity\'s secret, the store, the scan) except as a type',
    !/from 'react'/.test(pins) && !/\bwindow\./.test(code(pins)) && [hook, door, panel, pins].every((s) => !/import (?!type)[^\n]*called-it\/(x-auth|store|scan|record|budget|classify|source)/.test(s)) && door.includes("from '@/components/called/VerifyWithX'") && /<VerifyWithX variant="line"/.test(door),
  )
  check(
    'called chart wiring: a post\'s text reaches the page as text only (no raw HTML anywhere in this lane\'s components), a link out is rebuilt by the server from the post\'s id and opened with no opener, and an avatar is drawn only from X\'s own image hosts',
    [door, panel].every((s) => !s.includes('dangerouslySetInnerHTML') && !s.includes('innerHTML')) && panel.includes('rel="noopener noreferrer nofollow"') && panel.includes("u.hostname === 'pbs.twimg.com' || u.hostname === 'abs.twimg.com'") && panel.includes('<PostText call={call} />'),
  )
  check(
    'called chart wiring: the strip takes its words from the contract: the record\'s own headline, standing and method, the verdict words and the move line; it words none of them itself',
    panel.includes('record.words.headline') && panel.includes('record.words.standing') && panel.includes('record.words.method') && panel.includes('VERDICT_WORDS[call.verdict]') && panel.includes('moveLine(call)') && !/called it|missed|no real move|too early to say|Not verified/.test(code(panel).replace(/Called it/g, '')),
  )
  check(
    'called chart wiring: the strip says what the scan read (the record\'s coverage words, beside the tally), that pasted posts are shown and not counted, marks every pasted row with the contract\'s mark, says a model wrote each label, and draws no count for a record with no scan (it offers the scan instead)',
    panel.includes('record.words.coverage') && panel.includes('record.words.added') && /call\.origin === 'added'[\s\S]{0,260}\{ADDED_MARK\}/.test(panel) && panel.includes('{LABEL_CAVEAT}') && panel.includes('{DELETED_NOTE}') && panel.includes('sideCounts(record)') && /!record\.scanned \?[\s\S]{0,400}called_scan/.test(panel) && LABEL_CAVEAT.length > 10 && !/whole chart|chart's window|this window/.test(code(panel)),
  )
  check(
    'called chart wiring: the strip\'s Share sends the post lane RECORD wrote (somebody else\'s record in the third person, the account\'s own in the first only when the owner rule says so), the record\'s own image with the viewer\'s pins, and composes no share text of its own',
    /viewerOwns\(record, viewer\) \? myCalledPost\(record\) : calledPost\(record\)/.test(panel) && panel.includes('postHref(post)') && panel.includes('calledImageHref(record.handle, record.symbol, record.side, plot.pins)') && !/xIntentHref\(/.test(panel) && /variant === 'chart' \?[\s\S]{0,700}<VerifyWithX variant="line"/.test(door),
  )
  check(
    'called chart wiring: a display name and a post\'s text are each isolated in a <bdi> (a right-to-left run cannot reorder the row around it), and Verify with X is never handed a `next` built from anything (it reads its own page on press)',
    /<bdi>\{cleanPostText\(record\.profile\.name\)/.test(panel) && (panel.match(/<bdi>/g) ?? []).length >= 3 && !/<VerifyWithX[^>]*\bnext=/.test(door) && !/<VerifyWithX[^>]*\bnext=/.test(panel),
  )
  // The prefix is this lane's alone, in every stylesheet in the repo.
  const sheets: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.css')) sheets.push(full)
    }
  }
  for (const d of ['app', 'components']) walk(new URL(`../${d}`, import.meta.url).pathname)
  const others = sheets.filter((f) => !f.endsWith('components/called/called-chart.css'))
  const foreign = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.[a-zA-Z][\w-]*/g) ?? []).filter((c) => !/^\.(xcc|is-[a-z]+$|sym$|mkt-chart__bar$|mkt-chart__right$|mkt-view$|mkt-pool$|mkt-sharebtn$|tchart__fs$|mk-vs__open$|\d)/.test(c))
  check(
    'called chart css: every class this lane styles wears its own prefix (`xcc`; a state class like `is-focus` only ever on one of them), the few host classes it reaches into are the chart bar\'s on a phone, and no other stylesheet in the repo uses the prefix',
    sheets.length > 20 && others.every((f) => !/\.xcc[-_\w]*/.test(readFileSync(f, 'utf8'))) && foreign.length === 0 && !/(^|[\s,>+~])\.is-[a-z]+/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
    foreign.slice(0, 8).join(' '),
  )
}

// ── The controller, against a chart that is not the library ─────────────

interface FakeShape {
  id: string
  points: TvPoint[]
  options: TvShapeOptions
  anchored?: { x: number; y: number }
  props: Record<string, unknown>
}

function fakeChart(rec: CalledRecord, pane: PaneSize) {
  const range = fitRange(rec.calls, Math.floor(Date.now() / 1000)) ?? { from: 0, to: 1 }
  const first = Math.floor(range.from / DAY) * DAY
  const days = Math.ceil((range.to - first) / DAY) + 1
  const spacing = (pane.width * 0.95) / days
  const prices = rec.calls.map((c) => c.priceAt)
  const lo = Math.min(...prices) * 0.5
  const hi = Math.max(...prices) * 1.5
  const shapes = new Map<string, FakeShape>()
  const events: string[] = []
  const overrides: Record<string, unknown>[] = []
  const listeners: Record<string, ((...a: never[]) => void)[]> = {}
  let n = 0
  let res = '1D'
  const make = (points: TvPoint[], options: TvShapeOptions, anchored?: { x: number; y: number }) => {
    const id = `S${++n}`
    shapes.set(id, { id, points, options, anchored, props: { ...(options.overrides ?? {}) } })
    return Promise.resolve(id)
  }
  const sub = { subscribe: () => undefined, unsubscribe: () => undefined }
  const chart = {
    symbol: () => 'BTC',
    resolution: () => res,
    setResolution: (r: string) => {
      res = r
      return Promise.resolve(true)
    },
    setSymbol: () => undefined,
    getVisibleRange: () => range,
    setVisibleRange: () => {
      events.push('fit')
      return Promise.resolve()
    },
    onIntervalChanged: () => sub,
    onVisibleRangeChanged: () => sub,
    crossHairMoved: () => sub,
    onDataLoaded: () => sub,
    createShape: (p: TvPoint, o: TvShapeOptions) => make([p], o),
    createMultipointShape: (p: TvPoint[], o: TvShapeOptions) => make(p, o),
    createAnchoredShape: (pos: { x: number; y: number }, o: TvShapeOptions) => make([], o, pos),
    getAllShapes: () => [...shapes.values()].map((s) => ({ id: s.id, name: s.options.shape })),
    getShapeById: (id: string) => {
      const s = shapes.get(id)
      if (!s) throw new Error('no shape')
      return {
        getPoints: () => s.points as { time?: number; price: number }[],
        getProperties: () => s.props,
        setPoints: (p: TvPoint[]) => {
          s.points = p
        },
        setProperties: (p: Record<string, unknown>) => Object.assign(s.props, p),
        bringToFront: () => undefined,
        setAnchoredPosition: (pos: { x: number; y: number }) => {
          s.anchored = pos
        },
      }
    },
    removeEntity: (id: string) => {
      shapes.delete(id)
    },
    removeAllShapes: () => shapes.clear(),
    refreshMarks: () => events.push('marks'),
    clearMarks: () => undefined,
    resetData: () => undefined,
    getPanes: () => [{ hasMainSeries: () => true, getHeight: () => pane.height, getMainSourcePriceScale: () => ({ priceToCoordinate: (p: number) => pane.height * (1 - (p - lo) / (hi - lo)) }) }],
    createStudy: () => Promise.resolve(null),
    selection: () => ({ add: () => undefined, clear: () => undefined }),
    getTimeScale: () => ({
      setBarSpacing: () => undefined,
      barSpacing: () => spacing,
      width: () => pane.width,
      coordinateToTime: (x: number) => {
        const i = Math.floor(x / spacing)
        return i >= 0 && i < days ? first + i * DAY : null
      },
    }),
  } satisfies TvChartApi
  const widget = {
    onChartReady: () => undefined,
    headerReady: () => Promise.resolve(),
    activeChart: () => chart,
    subscribe: (e: string, cb: (...a: never[]) => void) => {
      ;(listeners[e] ??= []).push(cb)
    },
    unsubscribe: () => undefined,
    changeTheme: () => Promise.resolve(),
    applyOverrides: (o: Record<string, unknown>) => {
      overrides.push(o)
    },
    setCSSCustomProperty: () => undefined,
    takeClientScreenshot: () => Promise.reject(new Error('no canvas')),
    save: (cb: (s: object) => void) => cb({ charts: [{ chartProperties: { paneProperties: { topMargin: 12, bottomMargin: 9 } }, panes: [] }] }),
    selectLineTool: () => undefined,
    remove: () => undefined,
  } satisfies TvWidget
  return { chart, widget, shapes, events, overrides, listeners }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function calledChartControllerPins(check: Check): Promise<void> {
  // The controller reads the clock for "now": the record is built on today's.
  const now = Date.now()
  const end = Math.floor(now / 1000 / DAY) * DAY
  const candles: Candle[] = Array.from({ length: 400 }, (_, i) => {
    const c = 100 + 40 * Math.sin(i / 23) + i * 0.05
    return { t: end - (399 - i) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }
  })
  const rec = buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'all', profile: FIXTURE_PROFILE, verified: null, posts: fixturePosts(now), candles, nowMs: now, scannedAt: now, postsRead: 11 })
  const picked = rec.calls.filter((c) => c.picked)
  const f = fakeChart(rec, LAPTOP)
  const picks: string[] = []
  const ctl = createCalledPins({ symbol: 'BTC', inks: () => INKS, onPick: (id) => picks.push(id) })
  ctl.set({ record: rec, focusId: null, fitNonce: 1 })
  ctl.attach(f.widget, f.chart)
  await wait(500)
  const all = [...f.shapes.values()]
  const callouts = all.filter((s) => s.options.shape === 'callout')
  const tally = all.filter((s) => s.options.shape === 'anchored_text')
  const flagged = (o: TvShapeOptions) => o.lock === true && o.disableSelection === true && o.disableSave === true && o.disableUndo === true
  check(
    'called chart controller: plotting draws one card per picked call and one tally line, each created locked, unselectable and with saving off; the first plot asks the chart for the daily fit once',
    callouts.length === picked.length && tally.length === 1 && all.every((s) => flagged(s.options)) && f.events.filter((e) => e === 'fit').length === 1 && callouts.every((s) => picked.some((c) => c.barTime === s.points[0].time && c.priceAt === s.points[0].price)),
    `${callouts.length}/${picked.length} cards, ${tally.length} tally, fits ${f.events.filter((e) => e === 'fit').length}`,
  )
  check(
    'called chart controller: every shape it drew is the plot\'s (never read as a drawing), the calls with no card are the datafeed\'s marks on this symbol only, and the pane\'s margins were widened from the viewer\'s own',
    all.every((s) => ctl.owns(s.id)) && !ctl.owns('USER1') && ctl.marks('BTC').length === rec.calls.length - picked.length && ctl.marks('COINBASE:BTC').length === rec.calls.length - picked.length && ctl.marks('ETH').length === 0 && f.overrides.length >= 1 && Number(f.overrides[0]['paneProperties.topMargin']) > 12 && Number(f.overrides[0]['paneProperties.bottomMargin']) > 9,
    JSON.stringify(f.overrides),
  )
  const saved = { charts: [{ chartProperties: { paneProperties: { topMargin: f.overrides[f.overrides.length - 1]['paneProperties.topMargin'], bottomMargin: f.overrides[f.overrides.length - 1]['paneProperties.bottomMargin'] } }, panes: [{ sources: [{ id: 'USER1', type: 'LineToolHorzLine' }, ...all.map((s) => ({ id: s.id, type: 'LineToolCallout' }))] }] }] }
  const stored = ctl.cleanLayout(saved) as typeof saved
  check(
    'called chart controller: while a plot is up, the layout it hands to storage holds the viewer\'s drawing and the viewer\'s margins, and no pin',
    stored.charts[0].panes[0].sources.map((s) => s.id).join() === 'USER1' && stored.charts[0].chartProperties.paneProperties.topMargin === 12 && stored.charts[0].chartProperties.paneProperties.bottomMargin === 9,
    JSON.stringify(stored.charts[0].chartProperties),
  )
  const firstCard = callouts[0]
  const handled = ctl.event(firstCard.id, 'click')
  const notOurs = ctl.event('USER1', 'click')
  ctl.set({ record: rec, focusId: picks[0] ?? null, fitNonce: 1 })
  await wait(30)
  check(
    'called chart controller: a click on a card names its post to the strip and stops there; a click on the viewer\'s own drawing is not the plot\'s; the call the strip points at wears a thicker card',
    handled && !notOurs && picks.length === 1 && picked.some((c) => c.postId === picks[0]) && firstCard.props.linewidth === 2 && callouts.slice(1).every((s) => s.props.linewidth === 1),
  )
  // A pin toggle: one more card, the same tally.
  const extra = rec.calls.find((c) => !c.picked)
  if (extra && picked.length < calloutPlan(LAPTOP).total) {
    ctl.set({ record: applyPins(rec, [...picked.map((c) => c.postId), extra.postId]), focusId: null, fitNonce: 1 })
    await wait(400)
    const now2 = [...f.shapes.values()].filter((s) => s.options.shape === 'callout')
    check('called chart controller: pinning one more call draws one more card, takes its mark away and does not ask for the fit again', now2.length === picked.length + 1 && ctl.marks('BTC').length === rec.calls.length - picked.length - 1 && f.events.filter((e) => e === 'fit').length === 1, `${now2.length} cards`)
  }
  // The library's own "remove drawings" takes a pin: it comes back.
  const victim = [...f.shapes.values()].find((s) => s.options.shape === 'callout') as FakeShape
  const before = [...f.shapes.values()].filter((s) => s.options.shape === 'callout').length
  f.shapes.delete(victim.id)
  ctl.event(victim.id, 'remove')
  await wait(400)
  check('called chart controller: a pin the library\'s own "remove drawings" took is drawn again (a pin is the plot\'s, not a drawing)', [...f.shapes.values()].filter((s) => s.options.shape === 'callout').length === before)
  // A phone: no cards.
  const fp = fakeChart(rec, PHONE)
  const phone = createCalledPins({ symbol: 'BTC', inks: () => INKS, onPick: () => undefined })
  phone.set({ record: rec, focusId: null, fitNonce: 1 })
  phone.attach(fp.widget, fp.chart)
  await wait(500)
  check(
    'called chart controller: on a phone\'s pane no card is drawn: every call is a mark, and the tally line is still on the pane',
    [...fp.shapes.values()].filter((s) => s.options.shape === 'callout').length === 0 && [...fp.shapes.values()].filter((s) => s.options.shape === 'anchored_text').length === 1 && phone.marks('BTC').length === rec.calls.length,
  )
  phone.detach()
  // Another symbol's plot is not this chart's.
  const other = createCalledPins({ symbol: 'ETH', inks: () => INKS, onPick: () => undefined })
  const fo = fakeChart(rec, LAPTOP)
  other.set({ record: rec, focusId: null, fitNonce: 1 })
  other.attach(fo.widget, fo.chart)
  await wait(120)
  check('called chart controller: a plot is drawn only on its own symbol\'s chart', fo.shapes.size === 0 && other.marks('ETH').length === 0)
  other.detach()
  // Clear: nothing left, margins given back.
  ctl.set({ record: null, focusId: null, fitNonce: 1 })
  await wait(120)
  const last = f.overrides[f.overrides.length - 1]
  check(
    'called chart controller: clearing the handle removes every pin and the tally, takes the marks off, and gives the pane back the margins the viewer had',
    f.shapes.size === 0 && ctl.marks('BTC').length === 0 && last['paneProperties.topMargin'] === 12 && last['paneProperties.bottomMargin'] === 9 && (ctl.cleanLayout({ charts: [{ chartProperties: { paneProperties: { topMargin: 12, bottomMargin: 9 } }, panes: [] }] }) as { charts: { chartProperties: { paneProperties: { topMargin: number } } }[] }).charts[0].chartProperties.paneProperties.topMargin === 12,
    JSON.stringify(last),
  )
  ctl.detach()
  ctl.detach()
}

const INTERNAL = { 'x-yf-internal-run': '1' }

export async function calledChartPinsServed(check: Check, BASE: string): Promise<void> {
  // The controller's pins are pure but take a moment (they wait on its timers): they ride with the served half, which
  // the harness awaits, so test-api runs them without a line of its own.
  await calledChartControllerPins(check)
  const get = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: INTERNAL })
    return { status: res.status, text: await res.text() }
  }
  const page = await get('/t/BTC')
  const plotted = await get('/t/BTC?x=pantessa_test&side=bear')
  const classic = await get('/t/BTC?chart=classic')
  check(
    'called chart (served): the symbol page serves the door on its chart bar ("Plot a handle", empty) and no Calls strip: a plot is read from the address after the page mounts, so a link with `?x=` is the same HTML and never an error',
    page.status === 200 && page.text.includes('data-called-door="empty"') && />Plot a handle<\/span>/.test(page.text) && !page.text.includes('data-called=') && plotted.status === 200 && plotted.text.includes('data-called-door="empty"') && classic.status === 200 && classic.text.includes('data-called-door="empty"'),
    `status ${page.status}/${plotted.status}/${classic.status}`,
  )
  const order = page.text.indexOf('data-called-door') > 0 && page.text.indexOf('data-called-door') < page.text.indexOf('mk-vs__open')
  check('called chart (served): the door sits on the chart\'s bar just before Compare', order)

  const rec = await get('/api/x/record?handle=pantessa_test&sym=BTC')
  const body = asRecordResponse(JSON.parse(rec.text))
  const record = body?.status === 'ready' ? body.record : null
  check('called chart (served): the fixture record on BTC is an answer the chart draws: ready, calls on real daily bars at real closes, the rule\'s picks marked', !!record && record.calls.length >= 6 && record.calls.every((c) => c.barTime > 0 && c.priceAt > 0) && record.calls.filter((c) => c.picked).length >= 2 && record.calls.filter((c) => c.picked).length <= PICK_MAX, rec.text.slice(0, 160))
  if (record) {
    // The record's real bars and closes, at the view a plot opens on.
    let ok = true
    let note = ''
    for (const pane of [LAPTOP, { width: 958, height: 520 }, { width: 640, height: 395 }]) {
      const plan = calloutPlan(pane)
      const ids = boxedIds(record.calls, plan.total)
      const sizes = Object.fromEntries(ids.map((id) => [id, boxSize(pinText(record.calls.find((c) => c.postId === id) as CalledCall, record.handle, { textWidth: plan.textWidth, measure, wordLines: plan.wordLines }).lines, measure)]))
      const range = fitRange(record.calls, Math.floor(Date.now() / 1000)) as { from: number; to: number }
      const span = (range.to - range.from) * 1.05
      const anchors = ids.map((id) => ({ id, x: (((record.calls.find((c) => c.postId === id) as CalledCall).barTime - range.from) / span) * pane.width, y: pane.height / 2 }))
      const keepBottom = tallyLabel(record, pane).keepBottom
      const placed = layoutCallouts({ pane, anchors, sizes, keepBottom })
      if (!noOverlap(placed) || !inside(placed, pane, keepBottom) || placed.length !== ids.length) {
        ok = false
        note = `${pane.width}x${pane.height}`
      }
    }
    check('called chart (served): the fixture\'s real pins lay out with no two cards overlapping and none outside the pane, at a laptop\'s, a wide and a narrow pane', ok, note)
    const bear = asRecordResponse(JSON.parse((await get('/api/x/record?handle=pantessa_test&sym=BTC&side=bear')).text))
    check(
      'called chart (served): the Bear toggle is the same record filtered: only bearish calls, the tally its own, both sides\' counts still there for the toggle',
      bear?.status === 'ready' && bear.record.calls.length > 0 && bear.record.calls.every((c) => c.stance === 'bear') && bear.record.tally.total === bear.record.bySide.bear.total && bear.record.bySide.bull.total === record.bySide.bull.total && bear.record.calls.length < record.calls.length,
    )
    const pin = record.calls.find((c) => !c.picked)
    if (pin) {
      const own = asRecordResponse(JSON.parse((await get(`/api/x/record?handle=pantessa_test&sym=BTC&pins=${pin.postId}`)).text))
      check(
        'called chart (served): the pins this page applies in the browser are the pins the server would apply for the same address (a shared link draws the same plot)',
        own?.status === 'ready' && own.record.calls.map((c) => `${c.postId}${c.picked ? '*' : ''}`).join() === applyPins(record, [pin.postId]).calls.map((c) => `${c.postId}${c.picked ? '*' : ''}`).join() && JSON.stringify(own.record.tally) === JSON.stringify(record.tally),
      )
    }
  }
  const handles = await get('/api/x/handles')
  let list: unknown = null
  try {
    list = JSON.parse(handles.text)
  } catch {
    /* judged below */
  }
  check('called chart (served): the door\'s suggestions come from the public list, which answers a list the door can read (and never the fixture or an internal run)', handles.status === 200 && Array.isArray((list as { plotted?: unknown })?.plotted) && plottedFrom(list, 50).every((p) => p.handle !== FIXTURE_HANDLE && !p.handle.startsWith('zz_pin_')), handles.text.slice(0, 120))
  const never = asRecordResponse(JSON.parse((await get('/api/x/record?handle=zz_pin_ch_none&sym=BTC')).text))
  check('called chart (served): a handle nobody has plotted answers "unscanned" with whether a scan can run, which the strip turns into words and a next step', never?.status === 'unscanned' && never.handle === 'zz_pin_ch_none' && typeof never.canScan === 'boolean')
  const garbage = asRecordResponse(JSON.parse((await get('/api/x/record?handle=not%20a%20handle&sym=BTC')).text))
  check('called chart (served): a refusal arrives with a reason and at least one path on this site to go to', garbage?.status === 'refused' && garbage.reason.length > 10 && garbage.next.length >= 1 && garbage.next.every((n) => safeNextHref(n.href) !== null))
}

if (process.argv[1]?.endsWith('called-chart-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledChartPins(check)
    if (process.env.BASE) await calledChartPinsServed(check, process.env.BASE)
    else await calledChartControllerPins(check)
    console.log(failed ? `\n${failed} of ${n} called-it chart pins failed` : `\nall ${n} called-it chart pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
