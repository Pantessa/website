// Pins for squad called-it, lane RECORD (2026-11-11). This lane owns this file:
// the pure half runs anywhere, the served half against a built server.
// Wired into test-api by the contract commit; the lane only adds checks here.
//   npx tsx scripts/called-record-pins.ts                    (npm run pins:called-record)
//   BASE=http://localhost:PORT npx tsx scripts/called-record-pins.ts
//   BASE=… npx tsx --env-file=.env.local scripts/called-record-pins.ts   (adds the two checks that write, then delete, zz_pin_rec* rows on the TEST DB)
//
// What is held here:
//   · the share image's layout: for 0 to 6 calls at any spread of dates, cards
//     never overlap each other or the scoreboard, a leader never crosses a
//     card or another leader, every call keeps its dot;
//   · the landing chart's flags, the month marks, the drawn window;
//   · a post's words: clamped for a small card and never reworded, marked
//     around the quoted span byte for byte, never HTML;
//   · the share texts: ASCII, the handle tagged inside the sentence, the full
//     tally in numbers, 280 with the link counted as X counts it; a record
//     nobody scanned states no counts at all; a display name never enters one;
//   · what is counted: a pasted post is shown in its own group, marked, never
//     counted; a paste-only record has no tally on the page, the image or the
//     post; what the scans read is the record's own coverage line;
//   · the avatar rule: X's two image hosts over https and nothing else;
//   · the addresses: /x is public, the image's address carries the page's side;
//   · served: every answer is a real page and a real picture.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts } from '../lib/called-it/fixture'
import {
  ADDED_MARK,
  DELETED_NOTE,
  LABEL_CAVEAT,
  METHOD_LINE,
  PICK_MAX,
  SCAN_WINDOW_DAYS,
  STANDING_NOT_VERIFIED,
  TWITTER_EPOCH_MS,
  VERDICT_WORDS,
  buildRecord,
  chartHref,
  recordHeadline,
  recordHref,
  standingVerified,
  type CalledRecord,
  type RecordResponse,
} from '../lib/called-it/spec'
import {
  AVATAR_HOSTS,
  AVATAR_TIMEOUT_MS,
  OG_CARD,
  OG_COLUMN,
  OG_MAX_CARDS,
  OG_PANEL,
  OG_SIZE,
  RAIL_LEVELS,
  RAIL_MIN_DX,
  avatarFetchUrl,
  calledImageHref,
  clampPostText,
  clampPostWidth,
  fmtCallPrice,
  fmtCount,
  fmtUtcDate,
  fmtUtcDateTime,
  headlineParts,
  headlineTally,
  initialOf,
  linePaths,
  monthTicks,
  ogLayout,
  plotFromSec,
  plotScale,
  railPins,
  splitQuote,
  textUnits,
  unreadShare,
  cleanLine,
  type ClosePoint,
  type OgCallIn,
  type OgLayout,
  type Pt,
  type Rect,
} from '../lib/called-it/card-layout'
import { CALLED_NO_TALLY, SHARE_ASCII_RE, X_LINK_WEIGHT, X_POST_MAX, calledPost, myCalledPost, postHref, xPostWeight } from '../lib/share-posts'
import { isCalledPath, isPublicAppPath } from '../lib/app-entry'
import { X_MENTION } from '../lib/social'
import { SITE_URL } from '../lib/site-url'
import type { Candle } from '../lib/charts'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400
const NOW = Date.UTC(2026, 10, 11, 12)

// ── Geometry the layout pins are judged with ────────────────────────────

/** A seeded generator, so a failure names a spread anyone can replay. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const side = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
/** Two segments cross at a point inside both (a shared end, or touching, is not a crossing). */
function crosses(a1: Pt, a2: Pt, b1: Pt, b2: Pt, eps = 0.05): boolean {
  const d1 = side(b1, b2, a1)
  const d2 = side(b1, b2, a2)
  const d3 = side(a1, a2, b1)
  const d4 = side(a1, a2, b2)
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}
/** A segment enters a rectangle's inside (the rectangle shrunk by `inset`, so running along an edge does not count). */
function entersRect(p: Pt, q: Pt, r: Rect, inset = 0.6): boolean {
  const x0 = r.x + inset
  const x1 = r.x + r.w - inset
  const y0 = r.y + inset
  const y1 = r.y + r.h - inset
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  for (const [pp, qq] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ] as const) {
    if (pp === 0) {
      if (qq < 0) return false
    } else {
      const t = qq / pp
      if (pp < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
    }
  }
  return t1 - t0 > 1e-6
}
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (a: Rect, b: Rect, slack = 0.11) => a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.w <= b.x + b.w + slack && a.y + a.h <= b.y + b.h + slack

/** What one layout must hold. Returns the first thing it breaks, or null. */
function layoutFault(L: OgLayout, carded: readonly OgCallIn[], others: readonly OgCallIn[] = []): string | null {
  const calls = [...carded, ...others]
  const want = Math.min(new Set(carded.map((c) => c.id)).size, OG_MAX_CARDS)
  if (L.cards.length !== want) return `cards ${L.cards.length} of ${want}`
  if (overlap(OG_PANEL, OG_COLUMN)) return 'panel over scoreboard'
  if (!inside(L.band, L.panel)) return 'band outside panel'
  const tops = L.cards.filter((c) => c.row === 'top')
  const bottoms = L.cards.filter((c) => c.row === 'bottom')
  if (tops.length > 2 || bottoms.length > 2) return 'three cards in a row'
  for (const c of L.cards) {
    if (!inside(c, L.panel)) return `card ${c.id} outside the panel`
    if (overlap(c, OG_COLUMN)) return `card ${c.id} over the scoreboard`
    if (c.x < L.panel.x + OG_CARD.inset - 0.11 || c.x + c.w > L.panel.x + L.panel.w - OG_CARD.inset + 0.11) return `card ${c.id} past the inset`
    if (c.row === 'top' ? c.y + c.h > L.band.y : c.y < L.band.y + L.band.h) return `card ${c.id} over the band`
    if (c.anchor.x < L.band.x - 0.11 || c.anchor.x > L.band.x + L.band.w + 0.11 || c.anchor.y < L.band.y - 0.11 || c.anchor.y > L.band.y + L.band.h + 0.11) return `anchor ${c.id} off the band`
    if (c.attach.y !== (c.row === 'top' ? c.y + c.h : c.y)) return `leader ${c.id} leaves the wrong edge`
    if (c.attach.x < c.x + OG_CARD.attachInset - 0.11 || c.attach.x > c.x + c.w - OG_CARD.attachInset + 0.11) return `leader ${c.id} leaves at a corner`
  }
  for (let i = 0; i < L.cards.length; i++) {
    for (let j = i + 1; j < L.cards.length; j++) {
      const a = L.cards[i]
      const b = L.cards[j]
      if (overlap(a, b)) return `cards ${a.id} and ${b.id} overlap`
      if (a.row === b.row && Math.abs(a.x - b.x) < a.w + OG_CARD.gap - 0.21) return `cards ${a.id} and ${b.id} closer than the gap`
      if (crosses(a.attach, a.anchor, b.attach, b.anchor)) return `leaders ${a.id} and ${b.id} cross`
    }
    for (const other of L.cards) if (entersRect(L.cards[i].attach, L.cards[i].anchor, other)) return `leader ${L.cards[i].id} crosses card ${other.id}`
  }
  // Every top point stands at or above every bottom point (why a top and a bottom leader cannot cross).
  if (tops.length && bottoms.length && Math.max(...tops.map((c) => c.anchor.y)) > Math.min(...bottoms.map((c) => c.anchor.y)) + 0.11) return 'a top card took a lower point than a bottom card'
  const ids = new Set(calls.map((c) => c.id))
  if (L.dots.length !== ids.size || L.dots.some((d) => !ids.has(d.id))) return `dots ${L.dots.length} of ${ids.size}`
  if (L.dots.filter((d) => d.carded).length !== L.cards.length) return 'a carded dot is missing'
  return null
}

/** A walk of daily closes ending today. */
function walk(r: () => number, n = 366): ClosePoint[] {
  const end = Math.floor(NOW / 1000 / DAY) * DAY
  let c = 100
  return Array.from({ length: n }, (_, i) => {
    c = Math.max(1, c * (1 + (r() - 0.5) * 0.08))
    return { t: end - (n - 1 - i) * DAY, c }
  })
}

function bars(f: (i: number) => number, n = 400): Candle[] {
  const end = Math.floor(NOW / 1000 / DAY) * DAY
  return Array.from({ length: n }, (_, i) => {
    const c = f(i)
    return { t: end - (n - 1 - i) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }
  })
}

const idAt = (ms: number, seq: number) => ((BigInt(ms - TWITTER_EPOCH_MS) << BigInt(22)) | BigInt(seq)).toString()

export function calledRecordPins(check: Check): void {
  // ── The share image: where the cards stand ──
  let fault: string | null = null
  let layouts = 0
  const r = rng(20261111)
  for (let trial = 0; trial < 6000 && !fault; trial++) {
    const closes = walk(r, 120 + Math.floor(r() * 300))
    const scale = plotScale(closes)!
    const n = Math.floor(r() * 7) // 0 to 6 calls
    const mode = Math.floor(r() * 6)
    const base = Math.floor(r() * closes.length)
    const calls: OgCallIn[] = Array.from({ length: n }, (_, i) => {
      // any spread: anywhere · a three-day cluster · the first bars · the last bars · one bar for all · the two ends
      const k = mode === 0 ? Math.floor(r() * closes.length) : mode === 1 ? Math.min(closes.length - 1, base + Math.floor(r() * 3)) : mode === 2 ? Math.floor(r() * 4) : mode === 3 ? closes.length - 1 - Math.floor(r() * 4) : mode === 4 ? base : i % 2 ? 0 : closes.length - 1
      // on the line, or (a record judged on a newer bar) off it
      const price = r() < 0.85 ? closes[k].c : scale.lo + r() * (scale.hi - scale.lo)
      return { id: `c${i}`, t: closes[k].t, price }
    })
    // Some of the calls get a card (the first four of them), the rest are dots.
    const cut = Math.floor(r() * (n + 1))
    const carded = calls.slice(0, cut === 0 ? n : cut)
    const others = calls.slice(carded.length)
    const bad = layoutFault(ogLayout(scale, carded, others), carded, others)
    if (bad) fault = `trial ${trial} (spread ${mode}, ${carded.length} carded of ${n}): ${bad}`
    layouts++
  }
  check(
    `called-it image layout: over ${layouts} seeded spreads of 0 to 6 calls (anywhere, a three-day cluster, the first bars, the last bars, one bar for all, the two ends; on the line or off it) the post cards stay inside the panel and off the scoreboard, never overlap, stand at most two to a row with the gap between them, and every leader leaves its own card's band-side edge, stays in the band, crosses no card and crosses no other leader`,
    fault === null && layouts === 6000,
    fault ?? '',
  )

  const flat = walk(rng(7), 200)
  const sc = plotScale(flat)!
  const four: OgCallIn[] = [40, 90, 140, 190].map((k, i) => ({ id: `p${i}`, t: flat[k].t, price: flat[k].c }))
  const A = ogLayout(sc, four)
  const B = ogLayout(sc, [...four].reverse())
  const key = (L: OgLayout) => JSON.stringify([...L.cards].sort((a, b) => (a.id < b.id ? -1 : 1)))
  const one = ogLayout(sc, [four[0]])
  const none = ogLayout(sc, [])
  check(
    `called-it image layout: four calls make two rows of two, the higher two points above the line and the lower two below; the order the calls arrive in changes nothing; a fifth and sixth call are dots, never a fifth card; no calls leaves the whole panel to the line, one call takes one row and gives the rest back; no chart means no cards and no dots`,
    A.cards.length === 4 && A.cards.filter((c) => c.row === 'top').length === 2 && key(A) === key(B) && layoutFault(A, four) === null &&
      ogLayout(sc, [...four, { id: 'p4', t: flat[100].t, price: flat[100].c }, { id: 'p5', t: flat[20].t, price: flat[20].c }]).cards.length === OG_MAX_CARDS &&
      ogLayout(sc, [...four, { id: 'p4', t: flat[100].t, price: flat[100].c }]).dots.length === 5 &&
      none.cards.length === 0 && none.band.h > A.band.h + 2 * OG_CARD.h && one.cards.length === 1 && one.band.h > A.band.h + OG_CARD.h && one.band.h < none.band.h &&
      ogLayout(null, four).cards.length === 0 && ogLayout(null, four).dots.length === 0 && OG_SIZE.w === 1200 && OG_SIZE.h === 630 && OG_PANEL.x + OG_PANEL.w <= OG_SIZE.w && OG_COLUMN.x + OG_COLUMN.w < OG_PANEL.x,
    `${A.cards.length} cards, bands ${none.band.h} / ${one.band.h} / ${A.band.h}`,
  )

  // ── The line, the flags, the month marks, the drawn window ──
  const up: ClosePoint[] = Array.from({ length: 100 }, (_, i) => ({ t: 1_700_000_000 + i * DAY, c: 100 + i }))
  const us = plotScale(up, [500, -3, Number.NaN])!
  const lp = linePaths(up, plotScale(up)!, { x: 0, y: 0, w: 1000, h: 300 })
  check(
    'called-it plot: the first bar is the left edge and the last the right, the highest close the top and the lowest the bottom; a call priced outside the closes widens the scale instead of leaving the plot; a time or a price outside the range is clamped onto the edge; fewer than two closes is no plot; the path has one point per close and no hole',
    plotScale(up)!.x(up[0].t) === 0 && plotScale(up)!.x(up[99].t) === 1 && plotScale(up)!.y(199) === 0 && plotScale(up)!.y(100) === 1 && us.hi === 500 && us.lo === 100 && us.y(500) === 0 &&
      us.x(0) === 0 && us.x(9e12) === 1 && us.y(1e9) === 0 && us.y(-5) === 1 && plotScale([up[0]]) === null && plotScale([]) === null &&
      lp.line.startsWith('M0 300L') && lp.line.split('L').length === 100 && lp.area.endsWith('Z') && !/NaN|undefined|Infinity/.test(lp.line + lp.area),
    lp.line.slice(0, 40),
  )
  const mk = (x: number, picked: boolean, i: number, origin: 'scan' | 'added' = 'scan') => ({ postId: String(1000 + i), barTime: up[0].t + Math.round(x * 99) * DAY, priceAt: 150, picked, verdict: 'right' as const, origin })
  const crowd = railPins([mk(0.1, true, 0), mk(0.12, true, 1), mk(0.14, true, 2), mk(0.5, true, 3), mk(0.52, false, 4), mk(0.9, true, 5)], plotScale(up)!)
  const flown = crowd.pins.filter((p) => p.picked)
  const lone = railPins([mk(0.1, true, 0), mk(0.5, true, 1), mk(0.9, true, 2)], plotScale(up)!)
  const mob = railPins(Array.from({ length: 8 }, (_, i) => mk(0.4 + i * 0.01, true, i)), plotScale(up)!)
  check(
    `called-it flags: a call's number is its place in the record by date, from 1, picked or not; two pinned calls closer than ${RAIL_MIN_DX * 100}% of the plot never share a rail row (three neighbours take three rows); calls far apart all fly on the top row; eight in a crowd still use at most ${RAIL_LEVELS} rows; a call that is not pinned flies no flag; a post a viewer pasted is flagged as added so it can be drawn hollow`,
    crowd.pins.map((p) => p.n).join() === '1,2,3,4,5,6' && new Set(flown.slice(0, 3).map((p) => p.level)).size === 3 && crowd.levels === 3 && flown[3].level === 0 && flown[4].level === 0 && crowd.pins[4].picked === false &&
      lone.levels === 1 && lone.pins.every((p) => p.level === 0 && !p.added) && railPins([mk(0.2, false, 0, 'added'), mk(0.6, true, 1, 'added'), mk(0.8, true, 2)], plotScale(up)!).pins.map((p) => p.added).join() === 'true,true,false' && mob.levels === RAIL_LEVELS && mob.pins.every((p) => p.level >= 0 && p.level < RAIL_LEVELS) && railPins([], plotScale(up)!).levels === 0,
    JSON.stringify(flown.map((p) => p.level)),
  )
  const t0 = Date.UTC(2025, 10, 12) / 1000
  const t1 = Date.UTC(2026, 10, 11) / 1000
  const ticks = monthTicks(t0, t1)
  check(
    'called-it month marks: at most six, on the first of a month, left to right inside the plot, the newest month always marked; the first mark and every January carry the year, the others the month alone (never "Mar 26", which reads as a day)',
    ticks.length > 0 && ticks.length <= 6 && ticks.every((t, i) => t.x >= 0 && t.x <= 1 && (i === 0 || ticks[i - 1].x < t.x)) && /\d{4}$/.test(ticks[0].label) && ticks[ticks.length - 1].label.startsWith('Nov') &&
      ticks.every((t) => /^[A-Z][a-z]{2}( \d{4})?$/.test(t.label)) && ticks.filter((t) => t.label.startsWith('Jan')).every((t) => t.label === 'Jan 2026') && monthTicks(t1, t0).length === 0 && monthTicks(t0, t0 + 5 * DAY).length === 0,
    ticks.map((t) => t.label).join(' · '),
  )
  const nowSec = Math.floor(NOW / 1000)
  check(
    `called-it drawn window: the line starts one scan window (${SCAN_WINDOW_DAYS} days) back, not at the chart's first bar; a call older than that (a post a viewer pasted) pulls the start to three weeks before it; nothing is drawn from before the record's own first bar; no calls draws the scan window`,
    plotFromSec((nowSec - 600 * DAY) * 1000, NOW, nowSec - 340 * DAY, SCAN_WINDOW_DAYS) === nowSec - SCAN_WINDOW_DAYS * DAY &&
      plotFromSec((nowSec - 600 * DAY) * 1000, NOW, nowSec - 500 * DAY, SCAN_WINDOW_DAYS) === nowSec - 521 * DAY &&
      plotFromSec((nowSec - 200 * DAY) * 1000, NOW, nowSec - 100 * DAY, SCAN_WINDOW_DAYS) === nowSec - 200 * DAY &&
      plotFromSec((nowSec - 600 * DAY) * 1000, NOW, null, SCAN_WINDOW_DAYS) === nowSec - SCAN_WINDOW_DAYS * DAY,
  )
  const ps = plotScale(up)!
  check(
    'called-it unread stretch: the chart\'s window is not coverage. When the scans read less than what is drawn (a scan stopped at its cap), the unread share of the plot is known so both pictures can dim it; coverage that reaches the first drawn bar, coverage older than the plot, no coverage at all and a sliver under one percent dim nothing',
    unreadShare(ps, (up[0].t + 50 * DAY) * 1000) > 0.5 && unreadShare(ps, (up[0].t + 50 * DAY) * 1000) < 0.51 && unreadShare(ps, up[0].t * 1000) === 0 && unreadShare(ps, (up[0].t - 400 * DAY) * 1000) === 0 && unreadShare(ps, null) === 0 && unreadShare(ps, undefined) === 0 &&
      unreadShare(ps, Number.NaN) === 0 && unreadShare(ps, (up[0].t + 0.5 * DAY) * 1000) === 0 && unreadShare(ps, 9e15) === 1,
    String(unreadShare(ps, (up[0].t + 50 * DAY) * 1000)),
  )

  // ── A post's words ──
  const long = 'BITCOIN TO $250K BY CHRISTMAS. I have never been more certain of anything in my life, and if you are not all in right now you do not understand the asset.'
  const family = 'Buying 👨‍👩‍👧‍👦 again and again and again and again and again and again and again and again'
  const hostile = 'Top‮ is in\u0000.⁦ Sold\u0007 it all'
  const cl = clampPostText(long, 70)
  const cw = clampPostWidth(long, 62)
  check(
    'called-it card text: a long post is cut on a word with an ellipsis and never past its budget, by count for a line and by drawn width for a card (capitals and emoji run wider); what is kept is the post\'s own words in order, never a reword; a short post comes back whole; whitespace becomes one space; a bidi override and a control character are dropped and nothing else is (from a post for a small card, and from a display name before it is drawn); an emoji sequence is never cut in half',
    Array.from(cl).length <= 70 && cl.endsWith('…') && long.startsWith(cl.slice(0, -1)) && textUnits(cw) <= 62 && cw.endsWith('…') && long.startsWith(cw.slice(0, -1)) && cw.length < cl.length + 12 &&
      clampPostText('Top is in.', 70) === 'Top is in.' && clampPostWidth('Top is in.', 62) === 'Top is in.' && clampPostText('a\n\n b\t c', 70) === 'a b c' && clampPostText(hostile, 70) === 'Top is in. Sold it all' &&
      !/[\ud800-\udbff]$/.test(clampPostText(family, 9).slice(0, -1)) && !/[\ud800-\udbff]$/.test(clampPostWidth(family, 12).slice(0, -1)) && textUnits('WWWW') > textUnits('iiii') && textUnits('日本') === 4 &&
      cleanLine('‮evil‬ Name\u0000⁦ 🦄', 24) === 'evil Name 🦄' && !/[‪-‮⁦-⁩\u0000-\u001f]/.test(cleanLine('a‮b⁧c\u0003d', 24)),
    `${cl} | ${cw}`,
  )
  const post = 'Loading up here.\nThis is the  bottom, mark this post. $250K (soon)?'
  const sq = splitQuote(post, 'This is the bottom')
  const whole = splitQuote('Top is in.', 'Top is in.')
  const special = splitQuote(post, '$250K (soon)?')
  check(
    'called-it quoted span: the three pieces around the mark join back into the post byte for byte; the stored quote is whitespace-normalized, so it is matched with whitespace collapsed on both sides (a newline, a run of spaces, a no-break space); a quote that is the whole post marks the whole post; a quote full of pattern characters is matched as plain text; a span the post does not hold marks nothing',
    !!sq && sq.join('') === post && sq[1] === 'This is the  bottom' && sq[0] === 'Loading up here.\n' && !!whole && whole[0] === '' && whole[1] === 'Top is in.' && whole[2] === '' &&
      !!special && special[1] === '$250K (soon)?' && special.join('') === post && splitQuote('Top\n is   in. Sold.', 'Top is in')?.[1] === 'Top\n is   in' && splitQuote('gm all, top is in', 'gm all')?.[1] === 'gm all' && splitQuote(post, 'words the post never said') === null && splitQuote(post, '') === null && splitQuote(post, null) === null && splitQuote(post, '.*') === null,
  )
  const h1 = recordHeadline('pantessa_test', 'BTC', 'all', { total: 10, right: 5, wrong: 2, flat: 1, open: 2 })
  const hp = headlineParts(h1)
  const hb = headlineParts(recordHeadline('a', 'ETH', 'bear', { total: 1, right: 0, wrong: 1, flat: 0, open: 0 }))
  const h0 = recordHeadline('a', 'ETH', 'bear', { total: 0, right: 0, wrong: 0, flat: 0, open: 0 })
  check(
    'called-it headline pieces: the page colours the headline by cutting it into who and each count, and the pieces joined are spec\'s sentence to the letter (no word is the page\'s own); each count knows its verdict; "no calls found" is not a tally and is printed whole',
    !!hp && hp.who + hp.counts.map((c) => c.text).join(', ') + hp.end === h1 && hp.counts.map((c) => c.kind).join() === 'total,right,wrong,flat,open' && hp.counts[1].text === `5 ${VERDICT_WORDS.right}` &&
      !!hb && hb.who === '@a, bearish on ETH: ' && hb.counts.map((c) => c.kind).join() === 'total,wrong' && headlineParts(h0) === null && headlineTally(h1) === '10 calls, 5 called it, 2 missed, 1 no real move, 2 too early to say.' && headlineTally(h0) === 'no calls found in this window.',
    JSON.stringify(hp),
  )
  check(
    'called-it small words: dates are UTC and written out (never a number a reader could take two ways); a price wears the chart\'s unit; counts shorten; an avatar falls back to a letter',
    fmtUtcDate(Date.UTC(2026, 5, 14, 23, 59)) === '14 Jun 2026' && fmtUtcDateTime(Date.UTC(2026, 0, 3, 7, 5)) === '3 Jan 2026, 07:05 UTC' && fmtCallPrice(104312.5) === '$104,313' && fmtCallPrice(7.1329) === '$7.13' && fmtCallPrice(0.0421) === '$0.0421' &&
      fmtCallPrice(4.841, 'yield') === '4.841%' && fmtCallPrice(7444.7, 'level') === '7,445' && fmtCount(950) === '950' && fmtCount(4200) === '4.2K' && fmtCount(12_000) === '12K' && fmtCount(1_240_000) === '1.2M' &&
      initialOf('Fixture Desk', 'pantessa_test') === 'F' && initialOf('🦄 ', 'pantessa_test') === 'P' && initialOf(null, '_9') === '9' && initialOf('', '_') === '@',
  )

  // ── The share texts ──
  const posts = fixturePosts(NOW)
  const rec = (handle: string, symbol: string, sideOf: 'all' | 'bull' | 'bear', verified: boolean): CalledRecord =>
    buildRecord({ handle, symbol, side: sideOf, profile: { ...FIXTURE_PROFILE, handle }, verified: verified ? { at: NOW } : null, posts: posts.map((p) => ({ ...p, handle })), candles: bars((i) => 100 + i), nowMs: NOW, scannedAt: NOW, postsRead: posts.length })
  const fx = rec(FIXTURE_HANDLE, 'BTC', 'all', false)
  const theirs = calledPost(fx)
  const mine = myCalledPost(rec(FIXTURE_HANDLE, 'BTC', 'all', true))
  const bear = calledPost(rec(FIXTURE_HANDLE, 'ETH', 'bear', false))
  check(
    'called-it share text (somebody else): the ticker leads as a cashtag, the handle is tagged inside the sentence (a post that opens with a mention is filed as a reply), the tally is the record\'s own words in numbers, the standing line says "Not verified", the house account is named, the link is the record\'s own address and comes last',
    theirs.text === `$BTC calls by @pantessa_test, each pinned to the day it was posted: 10 calls, 5 called it, 3 missed, 2 too early to say. ${STANDING_NOT_VERIFIED} Plot any handle with ${X_MENTION}:` &&
      theirs.url === `${SITE_URL}/x/pantessa_test/BTC` && theirs.title === fx.words.headline && bear.text.startsWith('Bearish $ETH calls by @pantessa_test, each pinned to the day it was posted: 4 calls, ') && bear.url === `${SITE_URL}/x/pantessa_test/ETH?side=bear` &&
      postHref(theirs).startsWith('https://twitter.com/intent/tweet?') && new URL(postHref(theirs)).searchParams.get('url') === theirs.url && new URL(postHref(theirs)).searchParams.get('text') === theirs.text,
    theirs.text,
  )
  check(
    'called-it share text (the account itself, verified): first person, the same tally, and the word "Verified" only because the record\'s own standing line says it',
    mine.text === `My $BTC calls, each pinned to the day I posted it: 10 calls, 5 called it, 3 missed, 2 too early to say. ${standingVerified(FIXTURE_HANDLE)} Plot yours with ${X_MENTION}:` && !/verified/i.test(theirs.text.replace('Not verified', '')) && mine.url === theirs.url,
    mine.text,
  )
  const worst = (handle: string, symbol: string, sideOf: 'all' | 'bull' | 'bear', verified: boolean, digits: number) => {
    const n = 10 ** digits - 1
    const tally = { total: n, right: Math.floor(n / 3), wrong: Math.floor(n / 3), flat: Math.floor(n / 5), open: Math.floor(n / 9) }
    return { handle, symbol, side: sideOf, words: { headline: recordHeadline(handle, symbol, sideOf, tally), standing: verified ? standingVerified(handle) : STANDING_NOT_VERIFIED } }
  }
  const h15 = 'abcdefghijklmno'
  const cases = (['all', 'bull', 'bear'] as const).flatMap((s) => [calledPost(worst(h15, 'BTC', s, false, 4)), myCalledPost(worst(h15, 'BTC', s, true, 4)), calledPost(worst(h15, 'XYZ:LONGSYMBOL.NAME-24CH', s, false, 5)), myCalledPost(worst(h15, 'XYZ:LONGSYMBOL.NAME-24CH', s, true, 5)), calledPost(worst(h15, 'SP500', s, false, 4))])
  const full = calledPost(worst(h15, 'BTC', 'bear', false, 4))
  check(
    `called-it share text length: on a 15-character handle with a four-digit tally in every count the fullest text fits X's ${X_POST_MAX} with the link counted as X counts it (${X_LINK_WEIGHT}); a 24-character symbol with five-digit counts drops the closing sentence before it would run over, and still tags the handle and states every count; every text is one line of printable ASCII, opens with no mention, carries no hashtag and no link of its own, and tags the handle exactly once`,
    cases.every((p) => xPostWeight(p.text) <= X_POST_MAX && SHARE_ASCII_RE.test(p.text) && !p.text.startsWith('@') && !p.text.includes('#') && !/https?:|www\./.test(p.text) && p.text.split(`@${h15}`).length === 2 && /\d{4,5} calls, \d+ called it, \d+ missed, \d+ no real move, \d+ too early to say\./.test(p.text)) &&
      full.text.endsWith(`${STANDING_NOT_VERIFIED} Plot any handle with ${X_MENTION}:`) && xPostWeight(full.text) <= X_POST_MAX && xPostWeight('a'.repeat(256)) === 280 &&
      calledPost(worst(h15, 'SP500', 'all', false, 2)).text.startsWith('SP500 calls by @') && calledPost(worst(h15, 'btc', 'all', false, 2)).text.startsWith('$BTC calls by @'),
    `${xPostWeight(full.text)} · ${Math.max(...cases.map((p) => xPostWeight(p.text)))} · ${full.text}`,
  )

  // A record nobody scanned: its posts were pasted by viewers. No tally on the page, in the picture or in the post.
  const pastedPosts = posts.filter((p) => p.label.stance !== 'none').slice(0, 3).map((p) => ({ ...p, origin: 'added' as const }))
  const pasted = (verified: boolean, sideOf: 'all' | 'bull' | 'bear' = 'all') => buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: sideOf, profile: FIXTURE_PROFILE, verified: verified ? { at: NOW } : null, posts: pastedPosts, candles: bars((i) => 100 + i), nowMs: NOW, scannedAt: null, postsRead: 0 })
  const pp = calledPost(pasted(false))
  const pm = myCalledPost(pasted(true))
  const noCounts = (text: string) => !/\d/.test(text.replace(`@${FIXTURE_HANDLE}`, '').replace(`@${h15}`, '').replace('XYZ:LONGSYMBOL.NAME-24CH', '')) && !/\bcalls?\b|called it|missed|no real move|too early/.test(text)
  const longPasted = calledPost({ ...worst(h15, 'XYZ:LONGSYMBOL.NAME-24CH', 'bear', false, 5), scanned: false })
  check(
    'called-it share text (a record nobody scanned): posts a viewer pasted are never written up as a record. The record itself has no tally (scanned false, every count zero, the headline says so), and the post states no number and no verdict at all, says the posts were pinned by a viewer and that there is no tally, still tags the handle, still carries the standing line, still fits',
    !pasted(false).scanned && pasted(false).tally.total === 0 && pasted(false).added === 3 && pasted(false).words.headline === '@pantessa_test on BTC: 3 posts added by a viewer. No scan yet, so no tally.' && headlineParts(pasted(false).words.headline) === null &&
      pp.text === `$BTC posts by @pantessa_test, pinned by a viewer to the day each was posted. ${CALLED_NO_TALLY} Not verified. Plot any handle with ${X_MENTION}:` && pm.text === `My $BTC posts, each pinned to the day I posted it. ${CALLED_NO_TALLY} ${standingVerified(FIXTURE_HANDLE)} Plot yours with ${X_MENTION}:` &&
      [pp, pm, calledPost(pasted(false, 'bear')), myCalledPost(pasted(true, 'bull')), longPasted].every((x) => noCounts(x.text) && SHARE_ASCII_RE.test(x.text) && xPostWeight(x.text) <= X_POST_MAX && x.text.includes(CALLED_NO_TALLY) && !x.text.startsWith('@')) && CALLED_NO_TALLY === 'No scan yet, so no tally.',
    `${pp.text} | ${pm.text} | ${longPasted.text}`,
  )
  // A display name is X's text and never enters a post: the handle alone names the account.
  const loudName = '🦄🚀 ‮REVO‬ 名前 "<b>"'
  const named = buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'all', profile: { ...FIXTURE_PROFILE, name: loudName }, verified: { at: NOW }, posts, candles: bars((i) => 100 + i), nowMs: NOW, scannedAt: NOW, postsRead: posts.length })
  check(
    'called-it share text and a display name: a name full of emoji, another script, markup and a right-to-left override changes nothing in a post. The text, its title and its link are the same printable ASCII as for a plain name, and no character of the name is in them',
    named.profile.name === loudName && [calledPost(named), myCalledPost(named)].every((x) => SHARE_ASCII_RE.test(x.text) && SHARE_ASCII_RE.test(x.title) && SHARE_ASCII_RE.test(x.url) && !x.text.includes('REVO') && !x.title.includes('REVO') && !/[<>"]/.test(x.text)) &&
      calledPost(named).text === theirs.text.replace(STANDING_NOT_VERIFIED, standingVerified(FIXTURE_HANDLE)) && myCalledPost(named).text === mine.text,
  )

  // ── Addresses ──
  check(
    'called-it addresses: /x, an account and a record are public pages (a link to them is never a sign-in door), and /x402, /xyz and /xx are not them; the share image\'s address carries the page\'s handle, market, side and (only when the page had its own) pins; the default side is left out',
    ['/x', '/x/', '/x/cz_binance', '/x/cz_binance/BTC', '/x/cz_binance/BTC?side=bear', '/x?xauth=denied', '/x#plot'].every((p) => isCalledPath(p) && isPublicAppPath(p)) &&
      ['/x402', '/xyz', '/xx', '/xchain', '/ex/x', '/api/x/record'].every((p) => !isCalledPath(p)) && !isPublicAppPath('/wallet') &&
      calledImageHref('cz_binance', 'btc') === '/api/og/called?handle=cz_binance&sym=BTC' && calledImageHref('cz_binance', 'BTC', 'bear') === '/api/og/called?handle=cz_binance&sym=BTC&side=bear' &&
      calledImageHref('cz_binance', 'BTC', 'all', ['123456', '234567']) === '/api/og/called?handle=cz_binance&sym=BTC&pins=123456%2C234567' && recordHref('cz_binance', 'BTC', 'bull') === '/x/cz_binance/BTC?side=bull' && chartHref('cz_binance', 'BTC') === '/t/BTC?x=cz_binance',
  )

  // ── Avatars ──
  check(
    `called-it avatar rule: an avatar is fetched only over https from pbs.twimg.com or abs.twimg.com, exactly (a look-alike host, another host with X's name in its path, a port, credentials, http, a data: or javascript: address and an address literal are all refused); X's 48px file is swapped for its 200px sibling; the wait is ${AVATAR_TIMEOUT_MS / 1000} seconds`,
    avatarFetchUrl('https://pbs.twimg.com/profile_images/1/abc_normal.jpg') === 'https://pbs.twimg.com/profile_images/1/abc_200x200.jpg' && avatarFetchUrl('https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png') === 'https://abs.twimg.com/sticky/default_profile_images/default_profile_200x200.png' &&
      avatarFetchUrl('https://PBS.twimg.com/profile_images/1/abc.jpg#x') === 'https://pbs.twimg.com/profile_images/1/abc.jpg' &&
      [
        'http://pbs.twimg.com/a.jpg',
        'https://pbs.twimg.com.evil.example/a.jpg',
        'https://evil.example/pbs.twimg.com/a.jpg',
        'https://evil.example/?u=https://pbs.twimg.com/a.jpg',
        'https://pbs.twimg.com:8443/a.jpg',
        'https://user:pass@pbs.twimg.com/a.jpg',
        'https://pbs.twimg.com@evil.example/a.jpg',
        'https://twimg.com/a.jpg',
        'https://video.twimg.com/a.jpg',
        'https://169.254.169.254/latest/meta-data',
        'https://localhost/a.jpg',
        'data:image/png;base64,AAAA',
        'javascript:alert(1)',
        '//pbs.twimg.com/a.jpg',
        '',
        `https://pbs.twimg.com/${'a'.repeat(600)}.jpg`,
      ].every((u) => avatarFetchUrl(u) === null) && avatarFetchUrl(null) === null && avatarFetchUrl(undefined) === null && AVATAR_HOSTS.size === 2 && AVATAR_TIMEOUT_MS === 2000,
  )

  // ── The source: what the files themselves promise ──
  const avatar = read('app/x/_lib/avatar.ts')
  const callCard = read('components/called/CallCard.tsx')
  const chart = read('components/called/RecordChart.tsx')
  const shareRow = read('components/called/ShareRow.tsx')
  const recordPage = read('app/x/[handle]/[symbol]/page.tsx')
  const handlePage = read('app/x/[handle]/page.tsx')
  const doorPage = read('app/x/page.tsx')
  const parts = read('app/x/_lib/parts.tsx')
  const view = read('app/x/_lib/view.ts')
  const plotted = read('app/x/_lib/plotted.ts')
  const ogRoute = read('app/api/og/called/route.tsx')
  const ogCard = read('app/api/og/called/card.tsx')
  const mineSrc = [callCard, chart, shareRow, recordPage, handlePage, doorPage, parts, view, plotted, ogRoute, ogCard, avatar]
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
  check(
    'called-it post text is data: nothing this lane draws sets inner HTML; a card\'s words are a text node around a <mark>; the one link out of a card is rebuilt from the handle and the post\'s id (postUrl), never read from a post or from the record\'s own url; the share image\'s drawing is built from numbers and takes no text from a post',
    mineSrc.every((s) => !code(s).includes('dangerouslySetInnerHTML')) && /const href = call\.url \? postUrl\(handle, call\.postId\) : null/.test(callCard) && !/href=\{call\.url/.test(callCard) && /<mark className="xrc-call__quote">\{parts\[1\]\}<\/mark>/.test(callCard) &&
      !/call\.text|\.text\b/.test(code(ogCard).slice(code(ogCard).indexOf('function exhibitSvg'), code(ogCard).indexOf('function schematicSvg'))) && /clampPostWidth\(call\.text, CARD_TEXT_UNITS\)/.test(ogCard),
  )
  check(
    'called-it avatar fetch: the server asks only the address the rule returns, follows no redirect (only a plain 200 is an avatar), gives the whole exchange the two seconds, takes a small JPEG, PNG or GIF and nothing else, and a miss is a null (the caller draws the initial); it does not go through the framework\'s fetch (a cached page refuses an uncached read there, which would silently cost every listed row its picture); a page never puts X\'s image address in a visitor\'s browser',
    /const url = avatarFetchUrl\(raw\)\s*\n\s*if \(!url\) return null/.test(avatar) && /import \{ request \} from 'node:https'/.test(avatar) && !/\bfetch\(/.test(code(avatar)) && /res\.statusCode !== 200 \|\| !AVATAR_TYPES\.has\(type\)/.test(avatar) &&
      /setTimeout\(\(\) => \{\s*\n\s*req\.destroy\(\)\s*\n\s*finish\(null\)\s*\n\s*\}, AVATAR_TIMEOUT_MS\)/.test(avatar) && /size > AVATAR_MAX_BYTES/.test(avatar) && /hostname: u\.hostname, port: 443/.test(avatar) &&
      !/avatarUrl\}/.test(code(parts)) && /<img src=\{uri\} alt="" \/>/.test(parts) && !/src=\{[^}]*avatarUrl/.test(mineSrc.map(code).join('\n')),
  )
  check(
    'called-it reads: the pages and the image read the record through readRecord (one loader, never a fetch of our own API), the list through the store behind a catch that answers an empty list; the door page is cached a minute and reads no query; the record page is dynamic by its query, not by a force flag; the image route exports its handler and Next\'s own names only',
    /readRecord\(\{ handle: handleRaw, symbol: symbolRaw, side: sideRaw, pins: pinsRaw \}\)/.test(view) && /loadCandleSeries\(symbol, '1d', \{ deep: true \}\)/.test(view) && mineSrc.every((s) => !/fetch\([^)]*\/api\/x\//.test(code(s))) &&
      /catch \{\s*\n\s*return \{ rows: \[\], failed: true \}/.test(plotted) && /export const revalidate = 60/.test(doorPage) && !/force-dynamic|searchParams|cookies\(/.test(code(doorPage)) && !/force-dynamic/.test(code(recordPage)) && /searchParams/.test(recordPage) &&
      [...code(ogRoute).matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]).sort().join() === 'GET,dynamic,runtime' && /loadRecordView\(/.test(ogRoute),
  )
  check(
    'called-it honesty in the source: the word "Verified" reaches a page only as the record\'s own standing line or behind the record\'s own rule (verifiedOf); the tally a page prints is the record\'s headline; the landing loads no chart library and opens no sign-in door; the client share row composes nothing and imports nothing of the X sign-in',
    /\{record\.words\.standing\}/.test(recordPage) && /verifiedOf\(await getHandle\(h\)\)/.test(plotted) && /r\.verified \? ' · Verified' : ''/.test(doorPage) && /verified \? standingVerified\(handle\) : STANDING_NOT_VERIFIED/.test(handlePage) &&
      /headlineParts\(record\.words\.headline\)/.test(recordPage) && mineSrc.every((s) => !/lightweight-charts|charting_library|components\/markets\/chart|SpineLink/.test(code(s))) &&
      shareRow.startsWith("'use client'") && !/x-auth/.test(shareRow) && !/calledPost|myCalledPost/.test(code(shareRow)) && /mine \? myCalledPost\(record\) : calledPost\(record\)/.test(recordPage),
  )
  check(
    'called-it owner, names and the way back (review): "this viewer is the owner" is the record being verified AND X\'s user id on the cookie being the record\'s own, never the cookie\'s handle; a display name and a post\'s text are isolated (<bdi>) where a page prints them and a name is cleaned before it is drawn; Verify with X is mounted with no path of this lane\'s making (it reads its own page on press); a display name is not an input of any share text',
    /const mine = !!record\.verified && !!me && !!record\.profile\.xUserId && me\.xUserId === record\.profile\.xUserId/.test(recordPage) && !/me\.handle/.test(code(recordPage)) && !/me\.handle/.test(code(handlePage)) &&
      /<bdi>\{name\}<\/bdi>/.test(recordPage) && /cleanLine\(record\.profile\.name, 60\)/.test(recordPage) && /<bdi>\{cleanLine\(top\?\.name \?\? '', 60\)\}<\/bdi>/.test(handlePage) && /<p className="xrc-call__text">\s*<bdi>/.test(callCard) &&
      /cleanLine\(record\.profile\.name, 24\)/.test(ogCard) && /<VerifyWithX symbol=\{symbol\} \/>/.test(parts) && !/<VerifyWithX[^>]*next=/.test(mineSrc.join('\n')) && !/profile|\.name\b/.test(code(read('lib/share-posts.ts')).slice(code(read('lib/share-posts.ts')).indexOf('export interface CalledPostInput'))),
  )
  check(
    'called-it what is counted, in the source (review R1, R8): the landing draws what the scan found and what viewers pasted as two groups, the pasted group under spec\'s mark and never inside the tally; a card and a picture card for a pasted post wear spec\'s ADDED_MARK (not a string of their own); a record nobody scanned offers the scan and its picture is its own kind, never "record"; the coverage line and the added line a page or a picture prints are the record\'s own words; nothing says "since" about what was read; how it is judged says what a label is and that a deleted post leaves',
    /scannedCalls = numbered\.filter\(\(c\) => c\.call\.origin === 'scan'\)/.test(recordPage) && /addedCalls = numbered\.filter\(\(c\) => c\.call\.origin === 'added'\)/.test(recordPage) && /data-added-group=\{addedCalls\.length\}/.test(recordPage) &&
      /\{call\.origin === 'added' && <span className="xrc-call__added">\{ADDED_MARK\}<\/span>\}/.test(callCard) && !/added by a viewer/.test(code(callCard)) && /\{ADDED_MARK\}<\/span>/.test(ogCard) && !/'added by a viewer'/.test(code(ogCard)) &&
      /\{pasteOnly && \(\s*<p className="xrc-next">/.test(recordPage) && /!body\.record\.calls\.length \? 'empty' : body\.record\.scanned \? 'record' : 'pasted'/.test(ogRoute) &&
      /\{record\.words\.coverage && <p data-coverage>\{record\.words\.coverage\}<\/p>\}/.test(recordPage) && /\{record\.words\.added && <p data-added>\{record\.words\.added\}<\/p>\}/.test(recordPage) && /\{record\.words\.coverage\}<\/span>/.test(ogCard) &&
      !/[·,] since |SINCE \$\{/.test(code(recordPage) + code(ogCard) + code(chart)) && /<p>\{METHOD_LINE\}<\/p>/.test(parts) && /\{LABEL_CAVEAT\}/.test(parts) && /\{DELETED_NOTE\}/.test(parts) && /readFrom=\{view\.readFrom\}/.test(recordPage) && /unreadShare\(scale, record\.coverage\?\.from\)/.test(ogCard),
  )
  const css = read('components/called/called-record.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const classes = [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c))
  const foreign: string[] = []
  const walkCss = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name === 'node_modules' || name.startsWith('.') || name === 'charting_library') continue
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) walkCss(rel)
      else if (name.endsWith('.css') && rel !== 'components/called/called-record.css' && /\.xrc[\w-]*/.test(readFileSync(join(ROOT, rel), 'utf8'))) foreign.push(rel)
    }
  }
  for (const d of ['app', 'components', 'public']) walkCss(d)
  check(
    'called-it stylesheet: every class it styles is its own (xrc), no other stylesheet in the repo uses that prefix, and it holds no literal colour, px font or px radius (the one token scale)',
    classes.length > 60 && classes.every((c) => c === 'xrc' || c.startsWith('xrc-') || c.startsWith('xrc__') || c.startsWith('is-')) && foreign.length === 0 && !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/\b(?:rgba?|hsla?|oklch)\(/.test(css) && !/font-size:\s*\d+px/.test(css) && !/border-radius:\s*(?:[5-9]|\d{2,})px/.test(css),
    `${classes.filter((c) => !(c === 'xrc' || c.startsWith('xrc-') || c.startsWith('xrc__') || c.startsWith('is-'))).slice(0, 5).join(' ')} ${foreign.join(' ')}`,
  )
  check('called-it sitemap: /x is listed, and a record\'s own page is not (it reaches a crawler by its link)', /\{ url: `\$\{SITE\}\/x`, changeFrequency: 'hourly'/.test(read('app/sitemap.ts')) && !/\/x\/\$\{/.test(read('app/sitemap.ts')))
  void PICK_MAX
  void ADDED_MARK
}

// ── Served ──────────────────────────────────────────────────────────────

const HEAD = { 'x-yf-internal-run': '1' }
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
/** The page as a reader gets it: scripts, styles, tags and React's comment seams off, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENT[m])
    .replace(/\s+/g, ' ')
}
const metaOf = (html: string, key: string): string | null => {
  const m = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`).exec(html) ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`).exec(html)
  return m ? m[1].replace(/&amp;/g, '&') : null
}

async function pinDb() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url || /ep-wild-credit/.test(url) || process.env.USE_DB === 'false') return null
  const { default: prisma } = await import('../lib/db')
  return prisma
}

export async function calledRecordPinsServed(check: Check, BASE: string): Promise<void> {
  const page = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: HEAD, redirect: 'manual' })
    return { status: r.status, location: r.headers.get('location'), html: r.status < 300 ? await r.text() : '' }
  }
  const image = async (qs: string) => {
    const r = await fetch(`${BASE}/api/og/called${qs}`, { headers: HEAD, redirect: 'manual' })
    const buf = Buffer.from(await r.arrayBuffer())
    const png = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47
    return { status: r.status, type: r.headers.get('content-type'), card: r.headers.get('x-pantessa-card'), cache: r.headers.get('cache-control') ?? '', w: png ? buf.readUInt32BE(16) : 0, h: png ? buf.readUInt32BE(20) : 0, bytes: buf.length }
  }
  const okPng = (i: Awaited<ReturnType<typeof image>>) => i.status === 200 && i.type === 'image/png' && i.w === 1200 && i.h === 630 && i.bytes > 20_000

  try {
    const api = (await (await fetch(`${BASE}/api/x/record?handle=${FIXTURE_HANDLE}&sym=BTC`, { headers: HEAD })).json()) as RecordResponse
    const rec = api.status === 'ready' ? api.record : null
    const p = await page(`/x/${FIXTURE_HANDLE}/BTC`)
    const t = textOf(p.html)
    const picked = rec ? rec.calls.filter((c) => c.picked).length : -1
    check(
      'called-it landing (served, the fixture on BTC): the page a stranger opens carries the record\'s headline to the letter, its standing line, every call\'s full text, a card and a chart mark per call (a numbered flag that links to its card for each pinned one, a dot for the rest), the toggle with both sides\' counts, what the scan read in the record\'s own words (and nothing that says "since"), the share row, the door, and how it is judged (what a label is, that a label can be wrong, that a deleted post leaves); nothing on it links to X (the fixture\'s posts are not real posts)',
      p.status === 200 && !!rec && t.includes(rec.words.headline) && t.includes(rec.words.standing) && rec.calls.every((c) => t.includes(c.text)) && (p.html.match(/<li class="xrc-call /g) ?? []).length === rec.calls.length &&
        (p.html.match(/class="xrc-pin is-/g) ?? []).length === picked && (p.html.match(/class="xrc-dot is-/g) ?? []).length === rec.calls.length - picked && rec.calls.every((c, i) => p.html.includes(`id="call-${i + 1}"`) && p.html.includes(`href="#call-${i + 1}"`) === c.picked) &&
        /All <span class="xrc-sides__n">10<\/span>/.test(p.html.replace(/<!--[\s\S]*?-->/g, '')) && p.html.includes('data-share="row"') && p.html.includes('id="plot"') && t.includes('How this is judged') && t.includes('Not investment advice. Posts belong to their authors.') &&
        (p.html.match(/<mark class="xrc-call__quote">/g) ?? []).length === rec.calls.length && !/https:\/\/x\.com\/pantessa_test\/status/.test(p.html) && !t.includes('View on X') && p.html.includes(`href="/t/BTC?x=${FIXTURE_HANDLE}"`) &&
        !!rec.words.coverage && t.includes(rec.words.coverage) && !/ since \d/i.test(t) && t.includes(METHOD_LINE) && t.includes(LABEL_CAVEAT) && t.includes(DELETED_NOTE) && !p.html.includes('data-added-group') && p.html.includes('data-scanned="yes"'),
      `${p.status} ${rec?.calls.length ?? '-'} calls, ${picked} pinned, headline ${rec ? t.includes(rec.words.headline) : '-'}`,
    )
    const og = metaOf(p.html, 'og:image') ?? ''
    const tw = metaOf(p.html, 'twitter:image') ?? ''
    check(
      'called-it landing metadata (served): the title and the card text are the record\'s headline, the card is the large one, and og:image and twitter:image are this lane\'s image route for the same handle and market with no side (the default is left out)',
      !!rec && (metaOf(p.html, 'og:title') ?? '').replace(/&#x27;/g, "'") === rec.words.headline && /<title>@pantessa_test on BTC: 10 calls[^<]* · Called it on Pantessa<\/title>/.test(p.html) && metaOf(p.html, 'twitter:card') === 'summary_large_image' &&
        /\/api\/og\/called\?handle=pantessa_test&sym=BTC$/.test(og) && og === tw && !og.includes('side=') && (metaOf(p.html, 'description') ?? '').startsWith(STANDING_NOT_VERIFIED),
      og,
    )
    const bear = await page(`/x/${FIXTURE_HANDLE}/BTC?side=bear`)
    const bearOg = metaOf(bear.html, 'og:image') ?? ''
    const onePin = rec ? rec.calls[0].postId : '1'
    const pinsPage = await page(`/x/${FIXTURE_HANDLE}/BTC?pins=${onePin},junk`)
    check(
      'called-it landing toggle and pins (served): the bear address shows only the four bear calls under a bearish headline and its image address carries side=bear; an address with its own pin draws that one flag, says a viewer chose it and that the tally counts every call, hands the pin to the image, and is not indexed',
      bear.status === 200 && (bear.html.match(/<li class="xrc-call /g) ?? []).length === 4 && textOf(bear.html).includes('@pantessa_test, bearish on BTC: 4 calls') && /\/api\/og\/called\?handle=pantessa_test&sym=BTC&side=bear$/.test(bearOg) && bear.html.includes('aria-current="page"') &&
        pinsPage.status === 200 && (pinsPage.html.match(/class="xrc-pin is-/g) ?? []).length === 1 && textOf(pinsPage.html).includes('pins were chosen by a viewer. The tally counts every call the scan found.') && textOf(pinsPage.html).includes('10 calls') &&
        (metaOf(pinsPage.html, 'og:image') ?? '').endsWith(`&pins=${onePin}`) && /noindex/.test(metaOf(pinsPage.html, 'robots') ?? ''),
      `${bear.status} ${bearOg} · ${pinsPage.status} ${metaOf(pinsPage.html, 'og:image')}`,
    )

    const iRec = await image(`?handle=${FIXTURE_HANDLE}&sym=BTC`)
    const iBear = await image(`?handle=${FIXTURE_HANDLE}&sym=BTC&side=bear`)
    const iPins = await image(`?handle=${FIXTURE_HANDLE}&sym=ETH&pins=${onePin}`)
    const iNone = await image('?handle=zz_pin_rec_none&sym=BTC')
    const iGarbage = await image(`?handle=${encodeURIComponent('<script>alert(1)</script>')}&sym=BTC`)
    const iBare = await image('')
    const iHandle = await image(`?handle=${FIXTURE_HANDLE}`)
    const iSym = await image(`?handle=${FIXTURE_HANDLE}&sym=${encodeURIComponent('<img src=x>')}`)
    const iNoChart = await image(`?handle=${FIXTURE_HANDLE}&sym=NOCHART99`)
    check(
      'called-it share image (served): a 1200 by 630 PNG every time, never a 500. The fixture draws its record (also with a side, also with its own pins); a handle nobody plotted draws "not plotted yet"; a garbage handle and no handle draw the feature\'s own card; a handle alone draws the account\'s card; a garbage market and a market with no chart draw the refusal; a drawn record is held five minutes at the edge and anything that can change in a moment fifteen seconds',
      okPng(iRec) && iRec.card === 'record' && okPng(iBear) && iBear.card === 'record' && okPng(iPins) && iPins.card === 'record' && okPng(iNone) && iNone.card === 'unscanned' && okPng(iGarbage) && iGarbage.card === 'generic' && okPng(iBare) && iBare.card === 'generic' &&
        okPng(iHandle) && iHandle.card === 'handle' && okPng(iSym) && iSym.card === 'refused' && okPng(iNoChart) && iNoChart.card === 'refused' && /s-maxage=300/.test(iRec.cache) && /s-maxage=15/.test(iNone.cache),
      [iRec, iBear, iPins, iNone, iGarbage, iBare, iHandle, iSym, iNoChart].map((i) => `${i.status}:${i.card}:${i.w}x${i.h}`).join(' '),
    )

    const door = await page('/x')
    const acct = await page(`/x/${FIXTURE_HANDLE}`)
    const nobody = await page('/x/zz_pin_rec_none/BTC')
    const script = await page(`/x/${encodeURIComponent('<script>alert(1)</script>')}/BTC`)
    const badSym = await page(`/x/${FIXTURE_HANDLE}/${encodeURIComponent('<img src=x onerror=alert(1)>')}`)
    const badAcct = await page(`/x/${encodeURIComponent('"><svg onload=alert(1)>')}`)
    const canon = await page('/x/@Pantessa_Test/btc?side=bear')
    const canonAcct = await page('/x/@Pantessa_Test')
    const tn = textOf(nobody.html)
    check(
      'called-it pages (served): every address answers a real page with the door. /x asks "Whose calls?" and shows what a plot is; an account with no plots offers markets to start on; a handle nobody plotted says so, says what a scan does and links to the live chart with the handle already on it; a string that is not a handle and a string that is not a market are refused in words, with the door, and nothing of the string is echoed as markup; @Name and a lower-case market land on the one canonical address',
      door.status === 200 && textOf(door.html).includes('Whose calls?') && door.html.includes('id="plot"') && door.html.includes('xrc-schema') && textOf(door.html).includes('Recently plotted') && /<link rel="canonical" href="[^"]*\/x"/.test(door.html) &&
        acct.status === 200 && textOf(acct.html).includes(`@${FIXTURE_HANDLE}`) && acct.html.includes('id="plot"') && (acct.html.includes(`href="/x/${FIXTURE_HANDLE}/BTC"`) || acct.html.includes('class="xrc-row"')) &&
        nobody.status === 200 && tn.includes('Nobody has plotted @zz_pin_rec_none on BTC yet.') && tn.includes(`up to ${SCAN_WINDOW_DAYS} days back`) && nobody.html.includes('href="/t/BTC?x=zz_pin_rec_none"') && nobody.html.includes('id="plot"') && /noindex/.test(metaOf(nobody.html, 'robots') ?? '') &&
        script.status === 200 && textOf(script.html).includes('That is not an X handle.') && script.html.includes('id="plot"') && !/<script>alert\(1\)/.test(script.html) && !textOf(script.html).includes('alert(1)') &&
        badSym.status === 200 && textOf(badSym.html).includes('Name a market to plot the handle on.') && !badSym.html.includes('<img src=x') && !badSym.html.includes('onerror=alert') &&
        badAcct.status === 200 && textOf(badAcct.html).includes('That is not an X handle.') && !badAcct.html.includes('<svg onload') &&
        [307, 308].includes(canon.status) && (canon.location ?? '').endsWith(`/x/${FIXTURE_HANDLE}/BTC?side=bear`) && [307, 308].includes(canonAcct.status) && (canonAcct.location ?? '').endsWith(`/x/${FIXTURE_HANDLE}`),
      `${door.status} ${acct.status} ${nobody.status} ${script.status} ${badSym.status} ${badAcct.status} ${canon.status}→${canon.location} ${canonAcct.status}→${canonAcct.location}`,
    )
    const sm = await (await fetch(`${BASE}/sitemap.xml`, { headers: HEAD })).text()
    check('called-it sitemap (served): /x is in the sitemap', /<loc>[^<]+\/x<\/loc>/.test(sm))
  } catch (err) {
    check('called-it record (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }

  // ── Against the TEST database: a scanned account with no calls, and a hostile post ──
  let db: Awaited<ReturnType<typeof pinDb>> = null
  try {
    db = await pinDb()
  } catch {
    db = null
  }
  if (!db) {
    console.log('   (called-it record: no DATABASE_URL in this process, so the two checks that write zz_pin_rec* rows were not run)')
    return
  }
  const clean = async () => {
    await db!.$executeRawUnsafe(`DELETE FROM x_calls WHERE post_id IN (SELECT post_id FROM x_posts WHERE handle LIKE 'zz_pin_rec%')`)
    await db!.$executeRawUnsafe(`DELETE FROM x_posts WHERE handle LIKE 'zz_pin_rec%'`)
    await db!.$executeRawUnsafe(`DELETE FROM x_scans WHERE handle LIKE 'zz_pin_rec%'`)
    await db!.$executeRawUnsafe(`DELETE FROM x_handles WHERE handle LIKE 'zz_pin_rec%'`)
  }
  try {
    const Store = await import('../lib/called-it/store')
    await clean()
    const now = Date.now()
    const today = Math.floor(now / 86_400_000) * 86_400_000
    const scanned = async (handle: string, postsRead: number, callsFound: number) => {
      const { scan } = await Store.startScan({ handle, symbol: 'BTC', provider: 'fixture', requestedBy: 'ip:zz_pin_record', isInternal: true, windowFrom: now - SCAN_WINDOW_DAYS * 86_400_000, windowTo: now })
      await Store.updateScan(scan.id, { status: 'done', postsRead, callsFound, costUsd: 0, note: 'pin', finished: true })
    }

    // 1. Scanned, no calls found: an honest page and an honest picture.
    const E = 'zz_pin_rec_e'
    await Store.saveProfile({ handle: E, name: E, avatarUrl: null, followers: null, blue: false, xUserId: null })
    await scanned(E, 0, 0)
    const pe = await (await fetch(`${BASE}/x/${E}/BTC`, { headers: HEAD })).text()
    const te = textOf(pe)
    const ie = await fetch(`${BASE}/api/og/called?handle=${E}&sym=BTC`, { headers: HEAD })
    await ie.arrayBuffer()
    check(
      'called-it landing (served, a scanned account with no calls): the page says no calls were found in spec\'s own words and that the scan found no posts, draws the market\'s line with no pins, offers the live chart and the door, shows no toggle and no share row (there is nothing to share), is not indexed, and the image draws the same honest card',
      te.includes(`@${E} on BTC: no calls found in this window.`) && te.includes(`The scan found no posts by @${E} about BTC.`) && te.includes(STANDING_NOT_VERIFIED) && pe.includes('data-status="ready"') && pe.includes('data-calls="0"') &&
        !pe.includes('data-share="row"') && !pe.includes('class="xrc-sides"') && !pe.includes('class="xrc-pin ') && pe.includes(`href="/t/BTC?x=${E}"`) && pe.includes('id="plot"') && /noindex/.test(metaOf(pe, 'robots') ?? '') &&
        ie.status === 200 && ie.headers.get('x-pantessa-card') === 'empty' && ie.headers.get('content-type') === 'image/png',
      `${ie.status} ${ie.headers.get('x-pantessa-card')} ${te.includes('no calls found in this window.')}`,
    )

    // 2. A post and a name that are markup, on a record with one call the scan found and one a viewer pasted:
    //    text on the page, text in the picture, the link out rebuilt from the id, the pasted post apart and uncounted.
    const H = 'zz_pin_rec_h'
    const evil = '<img src=x onerror=alert(1)> the bottom is in </p><script>alert(2)</script> & "quotes" https://evil.example/x'
    const at1 = today - 120 * 86_400_000 + 13 * 3_600_000
    const at2 = today - 60 * 86_400_000 + 9 * 3_600_000
    const id1 = idAt(at1, 7)
    const id2 = idAt(at2, 8)
    await Store.saveProfile({ handle: H, name: '<b>Name</b> ‮"&', avatarUrl: 'https://evil.example/a.png', followers: 12, blue: true, xUserId: null })
    await Store.savePosts([
      { id: id1, handle: H, text: evil, postedAt: at1, likes: 10, replies: 1, reposts: 1, isReply: false, source: 'x-api' },
      { id: id2, handle: H, text: 'Top is in.', postedAt: at2, likes: 5, replies: 0, reposts: 0, isReply: false, source: 'x-api' },
    ])
    await Store.saveLabels([
      { postId: id1, symbol: 'BTC', stance: 'bull', conviction: 3, quote: 'the bottom is in', origin: 'scan', model: 'pin' },
      { postId: id2, symbol: 'BTC', stance: 'bear', conviction: 3, quote: 'Top is in.', origin: 'added', model: 'pin' },
    ])
    await scanned(H, 2, 1)
    const ph = await (await fetch(`${BASE}/x/${H}/BTC`, { headers: HEAD })).text()
    const th = textOf(ph)
    const ih = await fetch(`${BASE}/api/og/called?handle=${H}&sym=BTC`, { headers: HEAD })
    await ih.arrayBuffer()
    const group = ph.slice(ph.indexOf('data-added-group="1"'))
    const beforeGroup = ph.slice(0, ph.indexOf('data-added-group="1"'))
    check(
      'called-it landing (served, a post and a name that are markup): the post and the name are on the page as the text they are and nowhere as markup (not in the document, not in the data the page ships), each inside <bdi>, the name without its right-to-left override; the quoted span is marked inside the hostile text and as a whole one-line post alike; "View on X" goes to x.com/<handle>/status/<id> built from the id; the address inside the post is not a link; an avatar address that is not X\'s is never fetched or printed; X\'s paid check draws nothing; the image answers a picture',
      th.includes(evil) && th.includes('<b>Name</b> "&') && !ph.includes('<img src=x onerror') && !ph.includes('<script>alert(2)') && !ph.includes('<b>Name</b>') && !/onerror=alert\(1\)>/.test(ph.replace(/&gt;/g, '')) && !ph.includes('‮') &&
        /<bdi>&lt;b&gt;Name&lt;\/b&gt; &quot;&amp;<\/bdi>/.test(ph) && /<p class="xrc-call__text"><bdi>&lt;img src=x/.test(ph) &&
        ph.includes('<mark class="xrc-call__quote">the bottom is in</mark>') && ph.includes('<mark class="xrc-call__quote">Top is in.</mark>') &&
        ph.includes(`href="https://x.com/${H}/status/${id1}"`) && ph.includes(`href="https://x.com/${H}/status/${id2}"`) && !ph.includes('href="https://evil.example') && !ph.includes('evil.example/a.png') && (ph.match(/View on X/g) ?? []).length >= 2 &&
        !/verified/i.test(th.replace(/Not verified\./g, '').replace(/say Verified\./g, '').replace(/Verify with X/g, '')) && ih.status === 200 && ih.headers.get('x-pantessa-card') === 'record' && ih.headers.get('content-type') === 'image/png',
      `${ih.status} ${ih.headers.get('x-pantessa-card')} text:${th.includes(evil)} raw:${ph.includes('<img src=x onerror')} bdi:${/<bdi>&lt;b&gt;Name/.test(ph)}`,
    )
    check(
      'called-it landing (served, a scanned record with a pasted post): the tally counts what the scan found and nothing else (one call, in the headline and on the toggle); the pasted post is shown in its own group under the scanned call, wears spec\'s mark, and the record\'s own sentence says it is shown and not counted; the coverage line is the record\'s own',
      th.includes(`@${H} on BTC: 1 call`) && !th.includes(`@${H} on BTC: 2 calls`) && /All <span class="xrc-sides__n">1<\/span>/.test(ph.replace(/<!--[\s\S]*?-->/g, '')) && th.includes('1 more post was added by viewers. It is shown and not counted.') &&
        ph.includes('data-added-group="1"') && (beforeGroup.match(/<li class="xrc-call /g) ?? []).length === 1 && beforeGroup.includes(`data-call="${id1}"`) && (group.match(/<li class="xrc-call /g) ?? []).length === 1 && group.includes(`data-call="${id2}"`) && group.includes('data-origin="added"') &&
        (th.match(new RegExp(ADDED_MARK, 'g')) ?? []).length >= 2 && /Read 2 matching posts from \d+ [A-Z][a-z]{2} \d{4} to \d+ [A-Z][a-z]{2} \d{4}\./.test(th) && ph.includes('data-coverage') && ph.includes('class="xrc-dot is-') && /xrc-dot is-(right|wrong|flat|open) is-added/.test(ph),
      `${th.includes(`@${H} on BTC: 1 call`)} group:${ph.includes('data-added-group="1"')} before:${(beforeGroup.match(/<li class="xrc-call /g) ?? []).length} in:${(group.match(/<li class="xrc-call /g) ?? []).length}`,
    )

    // 3. Posts a viewer pasted, and no scan: shown, marked, and NO tally anywhere (the page, the post, the picture).
    const P = 'zz_pin_rec_p'
    const at3 = today - 80 * 86_400_000 + 11 * 3_600_000
    const at4 = today - 45 * 86_400_000 + 15 * 3_600_000
    const id3 = idAt(at3, 9)
    const id4 = idAt(at4, 10)
    await Store.saveProfile({ handle: P, name: 'Pasted Only', avatarUrl: null, followers: 900, blue: false, xUserId: null })
    await Store.savePosts([
      { id: id3, handle: P, text: 'This is the bottom. Buying.', postedAt: at3, likes: 3, replies: 0, reposts: 0, isReply: false, source: 'x-api' },
      { id: id4, handle: P, text: 'Short it here.', postedAt: at4, likes: 1, replies: 0, reposts: 0, isReply: false, source: 'x-api' },
    ])
    await Store.saveLabels([
      { postId: id3, symbol: 'BTC', stance: 'bull', conviction: 3, quote: 'This is the bottom', origin: 'added', model: 'pin' },
      { postId: id4, symbol: 'BTC', stance: 'bear', conviction: 2, quote: 'Short it here', origin: 'added', model: 'pin' },
    ])
    const pq = await (await fetch(`${BASE}/x/${P}/BTC`, { headers: HEAD })).text()
    const tq = textOf(pq)
    const iq = await fetch(`${BASE}/api/og/called?handle=${P}&sym=BTC`, { headers: HEAD })
    await iq.arrayBuffer()
    const intent = /href="(https:\/\/twitter\.com\/intent\/tweet\?[^"]+)"/.exec(pq)?.[1].replace(/&amp;/g, '&') ?? ''
    const intentText = intent ? (new URL(intent).searchParams.get('text') ?? '') : ''
    check(
      'called-it landing (served, posts a viewer pasted and no scan): the page is not a record. The headline is spec\'s "posts added by a viewer. No scan yet, so no tally."; there are no count chips, no toggle, no coverage line and nothing indexed; both posts are in the pasted group, each marked; the scan is offered on the live chart; the share row\'s post states no count and says there is no tally; the image is its own kind ("pasted"), never "record"',
      pq.includes('data-status="ready"') && pq.includes('data-scanned="no"') && tq.includes(`@${P} on BTC: 2 posts added by a viewer. No scan yet, so no tally.`) && !pq.includes('class="xrc-count') && !pq.includes('class="xrc-sides"') && !pq.includes('data-coverage') &&
        pq.includes('data-added-group="2"') && (pq.match(/<li class="xrc-call /g) ?? []).length === 2 && (pq.match(/data-origin="added"/g) ?? []).length === 2 && (tq.match(new RegExp(ADDED_MARK, 'g')) ?? []).length >= 2 &&
        pq.includes(`href="/t/BTC?x=${P}"`) && tq.includes(`Scan @${P} on the live BTC chart`) && /noindex/.test(metaOf(pq, 'robots') ?? '') && tq.includes('Share these posts') && !tq.includes('Share this record') &&
        intentText === `$BTC posts by @${P}, pinned by a viewer to the day each was posted. ${CALLED_NO_TALLY} Not verified. Plot any handle with ${X_MENTION}:` && !/\d/.test(intentText) &&
        (metaOf(pq, 'og:title') ?? '').includes('No scan yet, so no tally.') && iq.status === 200 && iq.headers.get('x-pantessa-card') === 'pasted' && iq.headers.get('content-type') === 'image/png',
      `${iq.status} ${iq.headers.get('x-pantessa-card')} chips:${pq.includes('class="xrc-count')} group:${pq.includes('data-added-group="2"')} intent:${intentText}`,
    )
  } catch (err) {
    check('called-it record (served, TEST DB): the rows could be written and read', false, err instanceof Error ? err.message : String(err))
  } finally {
    try {
      await clean()
      const left = (await db.$queryRawUnsafe(`SELECT (SELECT count(*) FROM x_scans WHERE handle LIKE 'zz_pin_rec%')::int + (SELECT count(*) FROM x_posts WHERE handle LIKE 'zz_pin_rec%')::int + (SELECT count(*) FROM x_handles WHERE handle LIKE 'zz_pin_rec%')::int AS n`)) as { n: number }[]
      check('called-it record (served, TEST DB): the pins delete every row they wrote', left[0].n === 0, String(left[0].n))
    } catch (err) {
      check('called-it record (served, TEST DB): the pins delete every row they wrote', false, err instanceof Error ? err.message : String(err))
    }
  }
}

if (process.argv[1]?.endsWith('called-record-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledRecordPins(check)
    if (process.env.BASE) await calledRecordPinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-it record pins failed` : `\nall ${n} called-it record pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
