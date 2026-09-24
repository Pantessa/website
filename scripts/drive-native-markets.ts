/**
 * drive-native-markets — the MARKETS lane's measured phone checklist (squad
 * mobile-native, 2026-09-24; blackboard ~/yeetful/squad-native-2026-09-24/,
 * MARKETS.md rows 1–9).
 *
 * Nate's screenshot 1 is this surface: iPhone Safari on /markets, scrolled
 * into the Crypto ledger, the "Ask" pill floating over the DOT row's 24h cell.
 * Every row here reads NUMBERS off the real page (overlap px, target sizes,
 * font sizes, scrollWidth vs clientWidth, a chart's visible range before and
 * after a synthetic touch gesture) and prints one verdict line per check.
 *
 * Two engines, because they fail differently:
 *   - chrome-iphone375: installed Chrome wearing `devices['iPhone 13 Mini']` (375 wide,
 *     isMobile, hasTouch, the Safari UA). Playwright's WebKit isn't usable on
 *     this Mac (1.60 wants webkit-2287, only 1578 is installed and it hangs),
 *     so real Safari is the owner's phone drill.
 *   - chrome-pixel7: Chrome with `devices['Pixel 7']` + custom widths. Chrome is the
 *     engine with real synthetic touch gestures (CDP
 *     Input.synthesizeScrollGesture / synthesizePinchGesture), which is how the
 *     chart's "a vertical swipe scrolls the screen" is PROVEN, not assumed.
 *
 * Nothing here signs, sends or fires a turn: the drive is a stranger (no
 * wallet) plus, for the rail, a guest watchlist seeded in localStorage.
 *
 * Usage:
 *   npx tsx scripts/drive-native-markets.ts --tag=before --base=http://localhost:3894
 *   npx tsx scripts/drive-native-markets.ts --tag=after  --rows=2,3,5
 *
 * Exits 1 when a judged check fails (`--measure-only` never fails: the BEFORE
 * run records main's numbers, it doesn't judge them).
 */

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// playwright-core resolves from ~/node_modules and is CommonJS: required, not
// imported, so tsc never chases types that aren't installed here.
const req = createRequire(path.join(process.cwd(), 'anchor.js'))
/* eslint-disable @typescript-eslint/no-explicit-any */
const pw: any = req('playwright-core')

const arg = (k: string, d = '') => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const BASE = arg('base', process.env.BASE ?? 'http://localhost:3894').replace(/\/$/, '')
const TAG = arg('tag', 'run')
const ROWS = new Set(
  arg('rows', '1,2,3,4,5,6,7,8,9')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean),
)
const MEASURE_ONLY = process.argv.includes('--measure-only')
export const MARKETS_SHOT_DIR = process.env.MARKETS_SHOT_DIR ?? '/Users/nategeier/yeetful/squad-native-2026-09-24/gates/shots/markets'

type Verdict = { row: number; check: string; ok: boolean; detail: string; note?: boolean }
const verdicts: Verdict[] = []
const record: Record<string, unknown> = {}
function judge(row: number, check: string, ok: boolean, detail: string) {
  verdicts.push({ row, check, ok, detail })
  console.log(`${ok ? '✅' : '❌'} [${row}] ${check} — ${detail}`)
}
function note(row: number, check: string, detail: string) {
  verdicts.push({ row, check, ok: true, detail, note: true })
  console.log(`   [${row}] ${check} — ${detail}`)
}

// A guest watchlist, so the rail has rows to measure (the hook reads this key
// before any wallet: lib/watchlists GUEST_LISTS_KEY).
const GUEST_LIST = JSON.stringify([
  { id: 'g_drivemkts01', owner: null, name: 'Drive', slug: null, symbols: ['ETH', 'AAPL', 'BTC', 'HYPE', 'SOL'], isPublic: false, createdAt: '2026-09-24T00:00:00.000Z' },
])

type Engine = 'chrome-iphone375' | 'chrome-pixel7'
async function newPage(engine: Engine, opts: { width?: number; height?: number; theme?: 'dark' | 'light'; seedList?: boolean; device?: string } = {}) {
  // Both profiles run in installed Chrome: Playwright's WebKit isn't usable on
  // this Mac (playwright-core 1.60 wants webkit-2287; only 1578 is installed,
  // and it hangs). The iPhone profile is Chrome wearing the iPhone 13 Mini
  // descriptor (375 wide, isMobile, hasTouch, the Safari UA). Safari itself
  // is the real-phone drill.
  const { defaultBrowserType: _ignored, ...device } = pw.devices[opts.device ?? (engine === 'chrome-iphone375' ? 'iPhone 13 Mini' : 'Pixel 7')]
  const browser = await pw.chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({
    ...device,
    ...(opts.width ? { viewport: { width: opts.width, height: opts.height ?? device.viewport.height } } : {}),
    colorScheme: opts.theme ?? 'dark',
  })
  // Every request to the server under test says it's a harness run.
  await context.route(`${BASE}/**`, (route: any) => route.continue({ headers: { ...route.request().headers(), 'x-yf-internal-run': '1' } }))
  const theme = opts.theme ?? 'dark'
  await context.addInitScript(
    `try { localStorage.setItem('yf-theme', ${JSON.stringify(theme)}); ${opts.seedList ? `localStorage.setItem('pantessa.watchlists.v1', ${JSON.stringify(GUEST_LIST)});` : ''} } catch {}`,
  )
  const page = await context.newPage()
  return { browser, context, page }
}

/** What the current screen scrolls: the frame's scroller once SHELL's frame
 *  lands (lib/app-scroller's rule), else the document. Runs in the page. */
const SCROLLER_JS = `(() => {
  const el = document.querySelector('[data-app-scroll]')
  const oy = el ? getComputedStyle(el).overflowY : ''
  return el && (oy === 'auto' || oy === 'scroll') ? el : document.scrollingElement
})()`

async function scrollTo(page: any, top: number) {
  await page.evaluate(`(${SCROLLER_JS}).scrollTo({ top: ${top}, behavior: 'instant' })`)
  await page.waitForTimeout(120)
}

async function scrollTop(page: any): Promise<number> {
  return page.evaluate(`(${SCROLLER_JS}).scrollTop`)
}

function rectOf(r: any) {
  return r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}` : 'none'
}

/** The ask pill vs every content rect under it, at the current scroll. */
async function pillOverlap(page: any) {
  return page.evaluate(`(() => {
    const pill = document.querySelector('[data-ask-door="pill"]')
    const pr = pill && getComputedStyle(pill).display !== 'none' && pill.getClientRects().length ? pill.getBoundingClientRect() : null
    if (!pr || pr.width === 0) return { pill: null, hits: [] }
    const sel = 'tr.mk-table__row td, .mk-trend__row, .mk-earn__row, .mkt-row, .wl__row, .sym__act-chip, .mkt-route, .mkt-chip, .mkt-sec__more, .mkt-card, .tchart, .mk-askdock'
    const hits = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      const w = Math.min(r.right, pr.right) - Math.max(r.left, pr.left)
      const h = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top)
      if (w > 0 && h > 0) {
        const tr = el.closest('tr')
        hits.push({ what: (tr && tr.dataset.symbol ? tr.dataset.symbol + ' ' : '') + (el.className || el.tagName).toString().split(' ')[0], w: Math.round(w), h: Math.round(h) })
      }
    }
    return { pill: { x: pr.x, y: pr.y, w: pr.width, h: pr.height }, hits }
  })()`)
}

/** Size of every visible element matching `sel` (the hit box a thumb gets). */
async function sizes(page: any, sel: string) {
  return page.evaluate(`(() => {
    const out = []
    for (const el of document.querySelectorAll(${JSON.stringify(sel)})) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      out.push({ w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, op: Number(cs.opacity), fs: parseFloat(cs.fontSize), txt: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) })
    }
    return out
  })()`)
}
const minOf = (xs: { w: number; h: number }[], k: 'w' | 'h') => (xs.length ? Math.min(...xs.map((x) => x[k])) : NaN)

async function barRect(page: any) {
  return page.evaluate(`(() => { const b = document.querySelector('[data-spine-bar]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, ih: innerHeight } })()`)
}

async function docMetrics(page: any) {
  return page.evaluate(`(() => { const d = document.scrollingElement; const s = ${SCROLLER_JS}; return { docSH: d.scrollHeight, docST: d.scrollTop, ih: innerHeight, iw: innerWidth, sw: d.scrollWidth, cw: d.clientWidth, scroller: s === d ? 'document' : (s.className || s.tagName).toString().split(' ')[0], scSW: s.scrollWidth, scCW: s.clientWidth } })()`)
}

async function openMarkets(page: any, pathname = '/markets') {
  await page.goto(`${BASE}${pathname}`, { waitUntil: 'load', timeout: 60_000 })
  // Hydration signal: a client-only node (the quotes fill the ledger cells).
  await page.waitForFunction(`document.querySelectorAll('tr.mk-table__row td.mk-table__num .mk-table__dash').length < document.querySelectorAll('tr.mk-table__row td.mk-table__num').length`, null, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(600)
}

async function openSymbol(page: any, sym: string, tab = '') {
  await page.goto(`${BASE}/t/${sym}${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForSelector('.sym__chart canvas', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(900)
}

// ── Row 1 + 2 + 5 + 8 on /markets ─────────────────────────────────────────
async function marketsRows(engine: Engine) {
  const { browser, page } = await newPage(engine, { seedList: false })
  try {
    await openMarkets(page)
    const m = await docMetrics(page)
    const bar = await barRect(page)
    note(1, `${engine} /markets document`, `scrollHeight ${m.docSH} vs innerHeight ${m.ih} · scroller=${m.scroller} · bar ${bar ? rectOf(bar) : 'none'} (bottom ${bar?.bottom} of ${bar?.ih})`)
    record[`${engine}.markets.doc`] = m

    // The pill at rest.
    const rest = await pillOverlap(page)
    // Nate's screenshot: scrolled into the Crypto ledger. Walk the page in
    // viewport-sized steps and keep the worst overlap, and the DOT row case.
    const total = await page.evaluate(`(${SCROLLER_JS}).scrollHeight`)
    let worst = { at: 0, area: 0, hits: [] as any[] }
    let dotCase: any = null
    for (let top = 0; top < total; top += Math.round(m.ih * 0.6)) {
      await scrollTo(page, top)
      const o = await pillOverlap(page)
      const area = o.hits.reduce((a: number, h: any) => a + h.w * h.h, 0)
      if (area > worst.area) worst = { at: top, area, hits: o.hits }
    }
    // Put the Crypto board's DOT row on the pill's y (the screenshot's frame).
    const dotY = await page.evaluate(`(() => { const r = document.querySelector('#crypto tr[data-symbol="DOT"]'); if (!r) return null; const s = ${SCROLLER_JS}; return r.getBoundingClientRect().top + s.scrollTop })()`)
    if (dotY !== null && rest.pill) {
      await scrollTo(page, Math.max(0, dotY - rest.pill.y + 4))
      dotCase = await pillOverlap(page)
      await page.mouse.move(1, 1)
      mkdirSync(MARKETS_SHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(MARKETS_SHOT_DIR, `${TAG}-${engine}-markets-crypto-dot.png`) })
    } else {
      await page.evaluate(`document.querySelector('#crypto') && document.querySelector('#crypto').scrollIntoView()`)
      await page.waitForTimeout(150)
      await page.mouse.move(1, 1)
      mkdirSync(MARKETS_SHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(MARKETS_SHOT_DIR, `${TAG}-${engine}-markets-crypto.png`) })
      dotCase = await pillOverlap(page)
    }
    const fmtHits = (hs: any[]) => (hs.length ? hs.slice(0, 6).map((h) => `${h.what} ${h.w}×${h.h}`).join(', ') : 'nothing')
    record[`${engine}.markets.pill`] = { rest, worst, dotCase }
    const pillShown = !!rest.pill
    if (MEASURE_ONLY || TAG === 'before') {
      note(2, `${engine} the Ask pill at rest`, pillShown ? `pill ${rectOf(rest.pill)} over ${fmtHits(rest.hits)}` : 'no floating pill')
      note(2, `${engine} the Ask pill, worst scroll step`, pillShown ? `at scroll ${worst.at}: ${fmtHits(worst.hits)} (${worst.area}px²)` : 'no floating pill')
      note(2, `${engine} the Ask pill on the DOT row (screenshot 1)`, dotCase?.pill ? fmtHits(dotCase.hits) : 'no floating pill')
    } else {
      judge(2, `${engine} no content under a floating Ask pill at rest, mid-scroll or on the DOT row`, rest.hits.length === 0 && worst.area === 0 && (dotCase?.hits?.length ?? 0) === 0, pillShown ? `pill ${rectOf(rest.pill)} · worst ${worst.area}px² · dot ${fmtHits(dotCase?.hits ?? [])}` : 'no floating pill on the markets frame')
      const trig = await sizes(page, '[data-ask-door="rail"]')
      judge(2, `${engine} the Ask lives in the top strip: visible, ≥44px tall`, trig.length === 1 && trig[0].h >= 44, trig.length ? `${trig[0].w}×${trig[0].h} "${trig[0].txt}"` : 'missing')
    }

    // Targets (row 5).
    await scrollTo(page, 0)
    const rows = await sizes(page, 'tr.mk-table__row')
    const trend = await sizes(page, '.mk-trend__row')
    const sort = await sizes(page, '.mk-table__sort')
    const more = await sizes(page, '.mkt-sec__more')
    const tabs = await sizes(page, '.mkt-frame__tab')
    const view = await sizes(page, '.mk-view__btn')
    const earnChips = await sizes(page, '.mk-earn__chip')
    const earnGo = await sizes(page, '.mk-earn__go, .mk-earn__act button, .mk-earn__act a')
    const search = await sizes(page, '.mkt-search__box input')
    const topAsk = await sizes(page, '[data-ask-door="rail"]')
    const acct = await sizes(page, '.mkt-frame__acct button, .mkt-frame__acct a')
    const map = await page.evaluate(`!!document.querySelector('[data-seat="MarketMap"]')`)
    const t = {
      rows: minOf(rows, 'h'),
      trend: minOf(trend, 'h'),
      sort: [minOf(sort, 'w'), minOf(sort, 'h')],
      more: [minOf(more, 'w'), minOf(more, 'h')],
      tabs: [minOf(tabs, 'w'), minOf(tabs, 'h')],
      view: [minOf(view, 'w'), minOf(view, 'h')],
      earnChips: [minOf(earnChips, 'w'), minOf(earnChips, 'h')],
      earnGo: [minOf(earnGo, 'w'), minOf(earnGo, 'h')],
      searchFont: search[0]?.fs,
      topAsk: topAsk[0] ? [topAsk[0].w, topAsk[0].h] : null,
      acct: acct[0] ? [acct[0].w, acct[0].h] : null,
      map,
    }
    record[`${engine}.markets.targets`] = t
    const line = `rows ${t.rows}px (${rows.length}) · trending ${t.trend} · sort ${t.sort.join('×')} · SHOW ALL ${t.more.join('×')} · board tabs ${t.tabs.join('×')} · Map/List ${t.view.join('×')} · earn chips ${t.earnChips.join('×')} · earn go ${t.earnGo.join('×')} · search font ${t.searchFont}px · top Ask ${t.topAsk?.join('×')} · account ${t.acct?.join('×')} · map on a phone: ${map}`
    if (MEASURE_ONLY || TAG === 'before') note(5, `${engine} /markets targets`, line)
    else {
      judge(5, `${engine} /markets: every ledger + trending row ≥44px tall`, t.rows >= 44 && (Number.isNaN(t.trend) || t.trend >= 44), `rows ${t.rows} · trending ${t.trend}`)
      judge(5, `${engine} /markets: sort heads, SHOW ALL, board tabs, Map/List, earn chips ≥44px tall`, [t.sort[1], t.more[1], t.tabs[1], t.view[1], t.earnChips[1]].every((h) => Number.isNaN(h) || h >= 44), line)
      judge(5, `${engine} /markets: the search field is ≥16px (no iOS focus zoom)`, (t.searchFont ?? 0) >= 16, `${t.searchFont}px`)
    }
    const hov = await page.evaluate(`matchMedia('(hover: none)').matches`)
    note(5, `${engine} (hover: none)`, String(hov))
  } finally {
    await browser.close()
  }
}

// ── The rail (row 5: rows, the ⋯ menu) ────────────────────────────────────
async function railRows(engine: Engine) {
  const { browser, page } = await newPage(engine, { seedList: true })
  try {
    await openMarkets(page)
    await page.waitForSelector('.wl__row', { timeout: 15_000 }).catch(() => {})
    const railRect = await page.evaluate(`(() => { const r = document.querySelector('.mkt-frame__rail'); if (!r) return null; const b = r.getBoundingClientRect(); const s = ${SCROLLER_JS}; return { y: b.top + s.scrollTop, h: b.height } })()`)
    const rowsSz = await sizes(page, '.wl__row')
    const more = await sizes(page, '.wl__rowMore')
    const icons = await sizes(page, '.wl__head .wl__icon, .wl__pickBtn')
    const add = await sizes(page, '.wl__addWrap input')
    const r = { railY: railRect?.y, rows: rowsSz.length, rowH: minOf(rowsSz, 'h'), more: more[0] ? [more[0].w, more[0].h, more[0].op] : null, headIcons: [minOf(icons, 'w'), minOf(icons, 'h')], addFont: add[0]?.fs }
    record[`${engine}.rail`] = r
    const line = `rail at y ${r.railY} · ${r.rows} rows min ${r.rowH}px · ⋯ ${r.more?.join('×')} (w×h×opacity) · head icons ${r.headIcons.join('×')} · add field ${r.addFont}px`
    if (MEASURE_ONLY || TAG === 'before') note(5, `${engine} the watchlist rail`, line)
    else {
      judge(5, `${engine} rail: rows ≥44px, the ⋯ menu ≥44px and fully visible (no hover-only), head icons ≥44px`, r.rowH >= 44 && !!r.more && r.more[0] >= 44 && r.more[1] >= 44 && r.more[2] === 1 && r.headIcons[1] >= 44, line)
      judge(5, `${engine} rail: the add field is ≥16px`, (r.addFont ?? 0) >= 16, `${r.addFont}px`)
    }
  } finally {
    await browser.close()
  }
}

/** The chart instance behind `.mkt-chart__engine`, found through the React
 *  fiber's hook refs (name-independent: a production build minifies names). */
const CHART_JS = `(() => {
  const el = document.querySelector('.sym__chart .mkt-chart__engine')
  if (!el) return null
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'))
  let f = key ? el[key] : null
  for (let i = 0; f && i < 40; i++, f = f.return) {
    let h = f.memoizedState
    for (let j = 0; h && j < 80; j++, h = h.next) {
      const c = h.memoizedState && h.memoizedState.current
      if (c && typeof c.timeScale === 'function' && typeof c.options === 'function') return c
    }
  }
  return null
})()`

// ── /t/<sym>: rows 1, 3, 5 ─────────────────────────────────────────────────
async function symbolRows(engine: Engine, sym: string) {
  const { browser, page } = await newPage(engine)
  try {
    await openSymbol(page, sym)
    const head = await page.evaluate(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }; return { head: r('.sym__head'), name: r('.sym__name'), last: r('.sym__last'), chart: r('.sym .tchart'), tabs: r('.sym__tabs'), ask: r('.mk-askdock__bar'), top: r('.mkt-frame__top'), plot: r('.sym .mkt-chart__canvas'), bar: r('.sym .mkt-chart__bar'), ind: r('.sym .mkt-chart__ind'), tools: r('.sym .mkt-chart__tools') } })()`)
    const chips = await sizes(page, '.sym__act-chip')
    const fs = await sizes(page, '.tchart__fs')
    const tf = await sizes(page, '.sym .tok__tfbtn')
    const ind = await sizes(page, '.sym .mkt-ind')
    const tools = await sizes(page, '.sym .mkt-tool')
    const tabs = await sizes(page, '.sym__tab')
    const touch = await page.evaluate(`(() => {
      const c = ${CHART_JS}
      const eng = document.querySelector('.sym__chart .mkt-chart__engine')
      const canvasTa = eng ? getComputedStyle(eng).touchAction : null
      if (!c) return { found: false, canvasTa }
      const o = c.options()
      return { found: true, canvasTa, handleScroll: o.handleScroll, pinch: o.handleScale && o.handleScale.pinch }
    })()`)
    record[`${engine}.${sym}.head`] = { head, chips, fs, tf, ind, tools, tabs, touch }
    const line = `head ${rectOf(head.head)} · title ${rectOf(head.name)} · price ${rectOf(head.last)} · chart ${rectOf(head.chart)} (plot ${rectOf(head.plot)}, controls ${rectOf(head.bar)}) · tabs ${rectOf(head.tabs)} · act chips ${minOf(chips, 'w')}×${minOf(chips, 'h')} (${chips.length}) · full-screen ${fs[0] ? `${fs[0].w}×${fs[0].h}` : 'none'} · tf ${minOf(tf, 'h')} · overlays ${minOf(ind, 'h')} · tools ${minOf(tools, 'h')} · section tabs ${minOf(tabs, 'w')}×${minOf(tabs, 'h')} · Ask-the-chart bar ${rectOf(head.ask)}`
    note(1, `${engine} /t/${sym}`, line)
    const hs = touch.handleScroll ?? {}
    const tl = `canvas touch-action ${touch.canvasTa} · vertTouchDrag ${hs.vertTouchDrag} · horzTouchDrag ${hs.horzTouchDrag} · pinch ${touch.pinch} (chart found: ${touch.found})`
    if (MEASURE_ONLY || TAG === 'before') note(3, `${engine} /t/${sym} chart touch options`, tl)
    else {
      judge(3, `${engine} /t/${sym}: a phone chart hands vertical swipes to the screen (vertTouchDrag off, touch-action pan-y) and keeps pan + pinch`, touch.found && hs.vertTouchDrag === false && hs.horzTouchDrag === true && touch.pinch === true && touch.canvasTa === 'pan-y', tl)
      judge(3, `${engine} /t/${sym}: the full-screen control is ≥44px`, !!fs[0] && fs[0].w >= 44 && fs[0].h >= 44, fs[0] ? `${fs[0].w}×${fs[0].h}` : 'none')
      // Two rows: 44 (timeframes) + 8 + 50 (the tools group's own 2px pad +
      // 1px border around 44px tools). A stock's pool pill adds a 44px row.
      judge(3, `${engine} /t/${sym}: the overlays share a row with the drawing tools and get ≥100px to scroll in`, !!head.ind && !!head.tools && Math.abs(head.ind.y - head.tools.y) <= 4 && head.ind.w >= 100, `overlays ${rectOf(head.ind)} · tools ${rectOf(head.tools)}`)
      judge(3, `${engine} /t/${sym}: the plot keeps ≥240px on a phone and its controls take two rows (a stock's pool pill adds one)`, !!head.plot && head.plot.h >= 240 && !!head.bar && head.bar.h <= (sym === 'AAPL' ? 44 + 8 + 44 + 8 + 50 : 44 + 8 + 50) + 1, `plot ${rectOf(head.plot)} · controls ${rectOf(head.bar)}`)
      judge(5, `${engine} /t/${sym}: act chips, timeframes, overlays, tools and section tabs ≥44px tall`, [minOf(chips, 'h'), minOf(tf, 'h'), minOf(ind, 'h'), minOf(tools, 'h'), minOf(tabs, 'h')].every((h) => Number.isNaN(h) || h >= 44), line)
    }
    await page.mouse.move(1, 1)
    mkdirSync(MARKETS_SHOT_DIR, { recursive: true })
    await page.screenshot({ path: path.join(MARKETS_SHOT_DIR, `${TAG}-${engine}-t-${sym}.png`) })
  } finally {
    await browser.close()
  }
}

// ── Row 5 on /t's Trade tab: the route table + the order card ───────────────
async function tradeRows(engine: Engine) {
  const { browser, page } = await newPage(engine)
  try {
    await openSymbol(page, 'ETH', 'trade')
    await page.waitForSelector('.mkt-route__chip', { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(500)
    const q = async (sel: string) => {
      const xs = await sizes(page, sel)
      return { n: xs.length, h: minOf(xs, 'h'), w: minOf(xs, 'w') }
    }
    const t = {
      filters: await q('.mkt-routes__filter'),
      chips: await q('.mkt-route__chip'),
      presets: await q('.mkt-order__preset'),
      custom: await q('.mkt-order__custom'),
      sides: await q('.mkt-order__side'),
      send: await q('.mkt-order__send'),
      overview: await q('.mkt-chip'),
    }
    record[`${engine}.trade`] = t
    const line = Object.entries(t).map(([k, v]) => `${k} ${v.n ? `${v.h}px (${v.n})` : 'none'}`).join(' · ')
    if (MEASURE_ONLY || TAG === 'before') note(5, `${engine} /t/ETH Trade tab`, line)
    else judge(5, `${engine} /t/ETH Trade tab: route filters, route chips, order presets, the amount field, Buy/Sell and Send ≥44px tall`, Object.values(t).every((v) => !v.n || v.h >= 44), line)
  } finally {
    await browser.close()
  }
}

// ── Row 3 proof: real synthetic touch gestures over the chart (Chrome) ─────
async function chartGestures(sym: string) {
  const { browser, page } = await newPage('chrome-pixel7')
  try {
    await openSymbol(page, sym)
    const cdp = await page.context().newCDPSession(page)
    const box = await page.evaluate(`(() => { const e = document.querySelector('.sym__chart .mkt-chart__engine'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    // Bring the whole chart on screen, a little down from the top.
    await page.evaluate(`document.querySelector('.sym__chart').scrollIntoView({ block: 'center' })`)
    await page.waitForTimeout(200)
    const b = await page.evaluate(`(() => { const e = document.querySelector('.sym__chart .mkt-chart__engine'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    const cx = Math.round(b.x + b.w / 2)
    const cy = Math.round(b.y + b.h / 2)
    const range = async () => page.evaluate(`(() => { const c = ${CHART_JS}; const r = c && c.timeScale().getVisibleLogicalRange(); return r ? { from: r.from, to: r.to } : null })()`)

    // Vertical swipe UP over the chart: the screen should scroll.
    const st0 = await scrollTop(page)
    const r0 = await range()
    await cdp.send('Input.synthesizeScrollGesture', { x: cx, y: cy, yDistance: -260, xDistance: 0, gestureSourceType: 'touch', speed: 1200, repeatCount: 1 })
    await page.waitForTimeout(700)
    const st1 = await scrollTop(page)
    const r1 = await range()
    const vScrolled = st1 - st0
    // Horizontal swipe over the chart: the chart should pan, the screen should not.
    await page.evaluate(`document.querySelector('.sym__chart').scrollIntoView({ block: 'center' })`)
    await page.waitForTimeout(200)
    const b2 = await page.evaluate(`(() => { const e = document.querySelector('.sym__chart .mkt-chart__engine'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    const st2 = await scrollTop(page)
    const r2 = await range()
    await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(b2.x + b2.w * 0.3), y: Math.round(b2.y + b2.h / 2), xDistance: 160, yDistance: 0, gestureSourceType: 'touch', speed: 800 })
    await page.waitForTimeout(700)
    const st3 = await scrollTop(page)
    const r3 = await range()
    const panned = r2 && r3 ? Math.round((r3.to - r2.to) * 100) / 100 : null
    // Pinch out over the chart: the chart zooms, the page doesn't.
    const r4 = await range()
    await cdp.send('Input.synthesizePinchGesture', { x: Math.round(b2.x + b2.w / 2), y: Math.round(b2.y + b2.h / 2), scaleFactor: 2.2, gestureSourceType: 'touch', relativeSpeed: 300 })
    await page.waitForTimeout(700)
    const r5 = await range()
    const vv = await page.evaluate(`window.visualViewport ? visualViewport.scale : 1`)
    const w4 = r4 ? r4.to - r4.from : 0
    const w5 = r5 ? r5.to - r5.from : 0
    const res = { vScrolled, vRangeMoved: r0 && r1 ? Math.round((r1.to - r0.to) * 100) / 100 : null, hScrolled: st3 - st2, panned, pinchWidth: [Math.round(w4 * 10) / 10, Math.round(w5 * 10) / 10], pageScale: vv, box }
    record[`chrome-pixel7.${sym}.gestures`] = res
    const line = `vertical swipe: screen moved ${vScrolled}px (chart range moved ${res.vRangeMoved}) · horizontal swipe: chart panned ${panned} bars, screen moved ${res.hScrolled}px · pinch: visible bars ${res.pinchWidth[0]} → ${res.pinchWidth[1]}, page scale ${vv}`
    if (MEASURE_ONLY || TAG === 'before') note(3, `chrome-pixel7 /t/${sym} touch gestures over the chart`, line)
    else {
      judge(3, `chrome-pixel7 /t/${sym}: a vertical swipe on the chart scrolls the screen`, vScrolled >= 120, line)
      judge(3, `chrome-pixel7 /t/${sym}: a horizontal swipe pans the chart and never the screen`, panned !== null && Math.abs(panned) > 1 && res.hScrolled === 0, line)
      judge(3, `chrome-pixel7 /t/${sym}: a pinch zooms the chart, never the page`, w5 > 0 && w5 < w4 * 0.8 && vv === 1, line)
    }
  } finally {
    await browser.close()
  }
}

// ── Rows 6 + 7: the ask door and the rail's dialogs ───────────────────────
async function sheetRows(engine: Engine) {
  const { browser, page } = await newPage(engine, { seedList: true })
  try {
    await openMarkets(page)
    // The ask door from the top strip (no dock on /markets: the sheet opens).
    const trig = page.locator('[data-ask-door="rail"]').first()
    await trig.click()
    await page.waitForTimeout(400)
    const door = await page.evaluate(`(() => {
      const panel = document.querySelector('[data-sheet="ask"] .sheet__panel') || document.querySelector('.askdoor__sheet')
      const input = document.querySelector('.askdoor__input')
      if (!panel) return null
      const r = panel.getBoundingClientRect()
      return { kind: panel.classList.contains('sheet__panel') ? 'Sheet' : 'askdoor', rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bottom: r.bottom, ih: innerHeight, inputFont: input ? parseFloat(getComputedStyle(input).fontSize) : null, grabber: !!panel.querySelector('.sheet__grabber'), focused: document.activeElement === input }
    })()`)
    const dismiss: Record<string, boolean> = {}
    const isOpen = () => page.evaluate(`!!(document.querySelector('[data-sheet="ask"]') || document.querySelector('[data-ask-door="sheet"]'))`)
    // Escape.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    dismiss.escape = !(await isOpen())
    // Scrim tap (top-left corner, above the sheet).
    if (!(await isOpen())) {
      await trig.click()
      await page.waitForTimeout(350)
    }
    await page.mouse.click(8, 40)
    await page.waitForTimeout(350)
    dismiss.scrim = !(await isOpen())
    // Back gesture: history.back() must close it and stay on /markets.
    if (!(await isOpen())) {
      await trig.click()
      await page.waitForTimeout(350)
    }
    const before = page.url()
    await page.evaluate('history.back()')
    await page.waitForTimeout(700)
    dismiss.back = !(await isOpen()) && page.url() === before
    if (page.url() !== before) await page.goto(before, { waitUntil: 'load' })
    record[`${engine}.askdoor`] = { door, dismiss }
    const line = `${door ? `${door.kind} ${rectOf(door.rect)} bottom ${door.bottom}/${door.ih} · input ${door.inputFont}px · grabber ${door.grabber} · focused ${door.focused}` : 'did not open'} · closes on Escape ${dismiss.escape} · tap outside ${dismiss.scrim} · back ${dismiss.back}`
    if (MEASURE_ONLY || TAG === 'before') note(6, `${engine} the ask door on a phone`, line)
    else {
      judge(6, `${engine} the ask door is the Sheet on a phone, input ≥16px, flush to the bottom`, !!door && door.kind === 'Sheet' && (door.inputFont ?? 0) >= 16 && Math.abs(door.bottom - door.ih) <= 1, line)
      judge(6, `${engine} the ask door closes on Escape and a tap outside`, dismiss.escape && dismiss.scrim, line)
      judge(6, `${engine} the back gesture closes the ask door and stays on the page (SHELL's Sheet internals)`, dismiss.back, line)
    }

    // Row 7: the rail's dialogs (ImportModal from the head; AlertForm needs
    // an account, so its sheet is proven by source pins + the harness).
    await page.goto(`${BASE}/markets`, { waitUntil: 'load' })
    await page.waitForSelector('.wl__row', { timeout: 15_000 }).catch(() => {})
    const imp = page.locator('.wl__head [aria-label="Import from TradingView"]').first()
    let impRes: any = null
    if (await imp.count()) {
      await imp.click()
      await page.waitForTimeout(400)
      impRes = await page.evaluate(`(() => {
        const panel = document.querySelector('[data-sheet="wl-import"] .sheet__panel') || document.querySelector('.wl__modal')
        if (!panel) return null
        const r = panel.getBoundingClientRect()
        const fields = [...panel.querySelectorAll('input, textarea, select')].map((e) => parseFloat(getComputedStyle(e).fontSize))
        return { kind: panel.classList.contains('sheet__panel') ? 'Sheet' : 'modal', rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bottom: r.bottom, ih: innerHeight, fieldFonts: fields }
      })()`)
      const openImp = () => page.evaluate(`!!(document.querySelector('[data-sheet="wl-import"]') || document.querySelector('.wl__modal'))`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const esc = !(await openImp())
      if (!esc) {
        await page.mouse.click(8, 40)
        await page.waitForTimeout(300)
      }
      impRes = { ...impRes, escape: esc }
    }
    record[`${engine}.import`] = impRes
    const il = impRes ? `${impRes.kind} ${rectOf(impRes.rect)} bottom ${impRes.bottom}/${impRes.ih} · fields ${impRes.fieldFonts?.join(',')}px · Escape closes ${impRes.escape}` : 'no import button'
    if (MEASURE_ONLY || TAG === 'before') note(7, `${engine} ImportModal on a phone`, il)
    else judge(7, `${engine} ImportModal is the Sheet on a phone: fields ≥16px, Escape closes`, !!impRes && impRes.kind === 'Sheet' && (impRes.fieldFonts ?? []).every((f: number) => f >= 16) && impRes.escape, il)
  } finally {
    await browser.close()
  }
}

// ── Row 9: the pictures, dark + light at 375 (the numbers are the proof) ───
async function shots() {
  for (const theme of ['dark', 'light'] as const) {
    const { browser, page } = await newPage('chrome-iphone375', { theme, seedList: true })
    try {
      mkdirSync(MARKETS_SHOT_DIR, { recursive: true })
      const snap = async (name: string) => {
        await page.mouse.move(1, 1)
        await page.waitForTimeout(250)
        await page.screenshot({ path: path.join(MARKETS_SHOT_DIR, `${TAG}-shot-${theme}-${name}.png`) })
      }
      await openMarkets(page)
      await snap('markets-top')
      await page.evaluate(`document.querySelector('#crypto') && document.querySelector('#crypto').scrollIntoView()`)
      await page.waitForTimeout(300)
      await snap('markets-crypto')
      await page.locator('[data-ask-door="rail"]').first().click()
      await page.waitForTimeout(500)
      await snap('markets-askdoor')
      await page.keyboard.press('Escape')
      await openSymbol(page, 'ETH')
      await snap('t-ETH-top')
      await page.evaluate(`document.querySelector('.sym__chart').scrollIntoView({ block: 'start' })`)
      await page.waitForTimeout(300)
      await snap('t-ETH-chart')
    } finally {
      await browser.close()
    }
  }
}

// ── Row 4: what sticks, by rect top after a scroll (document or frame) ─────
async function stickyRows(engine: Engine) {
  const { browser, page } = await newPage(engine)
  try {
    await openMarkets(page)
    const read = () =>
      page.evaluate(`(() => { const t = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null }; const h = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : null }; return { top: t('.mkt-frame__top'), topH: h('.mkt-frame__top'), tabs: t('.mkt-frame__tabs'), search: t('.mkt-search'), sc: (${SCROLLER_JS}).scrollTop } })()`)
    const at0 = await read()
    await scrollTo(page, 900)
    const at900 = await read()
    await scrollTo(page, 3200)
    const at3200 = await read()
    // Tap a board tab while the strip is stuck: the board lands under it.
    await page.locator('.mkt-frame__tab[href="#crypto"]').first().click()
    await page.waitForTimeout(900)
    const crypto = await page.evaluate(`(() => { const s = document.querySelector('#crypto'); const t = document.querySelector('.mkt-frame__tabs'); return { sec: Math.round(s.getBoundingClientRect().top), tabsBottom: Math.round(t.getBoundingClientRect().bottom) } })()`)
    const frame = await page.evaluate(`(() => { const d = document.scrollingElement; const sc = ${SCROLLER_JS}; const bar = document.querySelector('[data-spine-bar]'); const b = bar ? bar.getBoundingClientRect() : null; const s = sc.getBoundingClientRect(); const hit = document.elementFromPoint(innerWidth / 2, innerHeight - 10); return { docST: d.scrollTop, docSH: d.scrollHeight, ih: innerHeight, scroller: sc === d ? 'document' : String(sc.className).split(' ')[0], scBottom: Math.round(s.bottom), barTop: b ? Math.round(b.top) : null, barBottom: b ? Math.round(b.bottom) : null, inBar: !!(bar && hit && bar.contains(hit)) } })()`)
    record[`${engine}.sticky.markets`] = { at0, at900, at3200, crypto, frame }
    const fl = `document scrollTop ${frame.docST} · scrollHeight ${frame.docSH}/${frame.ih} · scroller ${frame.scroller} ends at ${frame.scBottom} · bar ${frame.barTop}–${frame.barBottom} · bottom 10px is the bar: ${frame.inBar}`
    if (MEASURE_ONLY || TAG === 'before') note(4, `${engine} /markets frame`, fl)
    else judge(4, `${engine} /markets: the document never scrolls (the frame's scroller is .mkt-frame) and the scroller ends where the bar starts, so no row can pass under it`, frame.docST === 0 && frame.docSH <= frame.ih + 1 && frame.scroller === 'mkt-frame' && frame.barTop !== null && frame.scBottom <= frame.barTop + 1 && frame.barBottom === frame.ih && frame.inBar, fl)
    const stuck = (r: any) => r.top === 0 && r.tabs !== null && Math.abs(r.tabs - (r.topH ?? 52)) <= 1
    const line = `top strip ${at0.top}→${at900.top}→${at3200.top} · board tabs ${at0.tabs}→${at900.tabs}→${at3200.tabs} (strip ${at0.topH}px) · search ${at0.search}→${at900.search} · Crypto tapped: section top ${crypto.sec} vs tabs bottom ${crypto.tabsBottom}`
    if (MEASURE_ONLY || TAG === 'before') note(4, `${engine} /markets sticky`, line)
    else {
      judge(4, `${engine} /markets: the top strip and the board tabs stick (strip at 0, tabs right under it) at 900 and 3200px`, stuck(at900) && stuck(at3200), line)
      judge(4, `${engine} /markets: tapping a board tab lands its section just under the stuck tabs (not under them)`, crypto.sec >= crypto.tabsBottom - 1 && crypto.sec <= crypto.tabsBottom + 40, line)
    }

    await openSymbol(page, 'ETH')
    const readSym = () =>
      page.evaluate(`(() => { const t = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null }; return { top: t('.mkt-frame__top'), tabs: t('.sym__tabs'), body: t('.sym__body') } })()`)
    const s0 = await readSym()
    await scrollTo(page, 1400)
    const s1 = await readSym()
    await page.locator('.sym__tab[data-tab="news"]').first().click()
    await page.waitForTimeout(300)
    const s2 = await readSym()
    // …and after the tab's content lands (News loads; a short tab once let the
    // footer anchor the scroll and the page jumped to the bottom).
    await page.waitForTimeout(1800)
    const s3 = await readSym()
    record[`${engine}.sticky.t`] = { s0, s1, s2, s3 }
    const sl = `top strip ${s0.top}→${s1.top} · section tabs ${s0.tabs}→${s1.tabs} · after a News tap while stuck: tabs ${s2.tabs}, body ${s2.body} · once loaded: tabs ${s3.tabs}, body ${s3.body}`
    if (MEASURE_ONLY || TAG === 'before') note(4, `${engine} /t/ETH sticky`, sl)
    else {
      judge(4, `${engine} /t/ETH: the section tabs stick right under the top strip after a scroll`, s1.top === 0 && s1.tabs !== null && Math.abs(s1.tabs - 52) <= 1, sl)
      const under = (r: any) => r.tabs !== null && r.body !== null && Math.abs(r.tabs - 52) <= 1 && r.body - r.tabs >= 30 && r.body - r.tabs <= 60
      judge(4, `${engine} /t/ETH: a tab switch made while stuck lands the new tab at its top (its body starts right under the tabs), and stays there once the tab's content loads`, under(s2) && under(s3), sl)
    }
  } finally {
    await browser.close()
  }
}

// ── Row 2 (brochure): the pill's page-foot reserve lets the last line clear
//    it. The reserve never applied before this squad (MARKETS.md F10). ─────────
async function brochureFoot(engine: Engine, pathname: string) {
  const { browser, page } = await newPage(engine)
  try {
    await page.goto(`${BASE}${pathname}`, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForTimeout(800)
    await page.evaluate(`(${SCROLLER_JS}).scrollTo({ top: 1e7, behavior: 'instant' })`)
    await page.waitForTimeout(300)
    const r = await page.evaluate(`(() => {
      const pill = document.querySelector('[data-ask-door="pill"]')
      const pr = pill && pill.getClientRects().length ? pill.getBoundingClientRect() : null
      const pad = parseFloat(getComputedStyle(document.body).paddingBottom)
      if (!pr) return { pill: null, pad, hits: [] }
      const hits = []
      for (const el of document.querySelectorAll('footer a, footer p, footer button, footer span, footer li, main a, main p, main button')) {
        if (el.children.length && el.tagName !== 'A' && el.tagName !== 'BUTTON') continue
        if (el.closest('[aria-hidden="true"]')) continue // decorative (the footer's giant wordmark)
        const b = el.getBoundingClientRect()
        if (!b.width || !b.height) continue
        const w = Math.min(b.right, pr.right) - Math.max(b.left, pr.left)
        const h = Math.min(b.bottom, pr.bottom) - Math.max(b.top, pr.top)
        if (w > 0 && h > 0) hits.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24) + ' ' + Math.round(w) + '×' + Math.round(h))
      }
      return { pill: { x: pr.x, y: pr.y, w: pr.width, h: pr.height }, pad, hits }
    })()`)
    record[`${engine}.brochure${pathname}`] = r
    const line = `${pathname} scrolled to the end: body reserve ${r.pad}px · pill ${rectOf(r.pill)} over ${r.hits.length ? r.hits.slice(0, 4).join(', ') : 'nothing'}`
    if (MEASURE_ONLY || TAG === 'before') note(2, `${engine} brochure foot`, line)
    else judge(2, `${engine} ${pathname}: at the page's end the last line clears the pill (the reserve applies)`, !r.pill || (r.pad >= 60 && r.hits.length === 0), line)
  } finally {
    await browser.close()
  }
}

// ── Row 8: no horizontal scroll, 360–414 + 844×390, dark + light ──────────
async function overflowRows() {
  const widths: [number, number][] = [
    [360, 780],
    [375, 812],
    [390, 844],
    [414, 896],
    [844, 390],
  ]
  const pages = ['/markets', '/t/AAPL', '/t/ETH', '/t/HYPE']
  const fails: string[] = []
  let n = 0
  for (const theme of ['dark', 'light'] as const) {
    const { browser, context } = await newPage('chrome-pixel7', { theme })
    try {
      for (const [w, h] of widths) {
        const page = await context.newPage()
        await page.setViewportSize({ width: w, height: h })
        for (const p of pages) {
          await page.goto(`${BASE}${p}`, { waitUntil: 'load', timeout: 60_000 })
          await page.waitForTimeout(p === '/markets' ? 700 : 1100)
          const m = await docMetrics(page)
          // The widest offender, when there is one (a node wider than the page).
          const wide = await page.evaluate(`(() => { let best = null; const iw = document.documentElement.clientWidth; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width && r.right > iw + 1) { const cs = getComputedStyle(e); if (cs.position === 'fixed') continue; let p = e.parentElement, clipped = false; while (p) { const o = getComputedStyle(p).overflowX; if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') { clipped = true; break } p = p.parentElement } if (!clipped && (!best || r.right > best.right)) best = { right: Math.round(r.right), cls: (e.className || e.tagName).toString().slice(0, 40) } } } return best })()`)
          n++
          const ok = m.sw <= m.cw && m.scSW <= m.scCW
          if (!ok) fails.push(`${theme} ${w}×${h} ${p}: doc ${m.sw}/${m.cw} scroller ${m.scSW}/${m.scCW}${wide ? ` (${wide.cls} → ${wide.right})` : ''}`)
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
  record.overflow = { n, fails }
  judge(8, `no horizontal scroll on ${pages.length} pages × ${widths.length} sizes × 2 themes`, fails.length === 0, fails.length ? fails.slice(0, 6).join(' | ') : `${n}/${n} clean`)
}

async function main() {
  console.log(`drive-native-markets · ${TAG} · ${BASE}`)
  if (ROWS.has(1) || ROWS.has(2) || ROWS.has(5)) {
    await marketsRows('chrome-iphone375')
    await marketsRows('chrome-pixel7')
    await railRows('chrome-iphone375')
    await brochureFoot('chrome-iphone375', '/pricing')
  }
  if (ROWS.has(1) || ROWS.has(3) || ROWS.has(5)) {
    for (const s of ['AAPL', 'ETH']) await symbolRows('chrome-iphone375', s)
    await symbolRows('chrome-pixel7', 'ETH')
    await tradeRows('chrome-iphone375')
  }
  if (ROWS.has(3)) await chartGestures('ETH')
  if (ROWS.has(4)) {
    await stickyRows('chrome-iphone375')
    await stickyRows('chrome-pixel7')
  }
  if (ROWS.has(6) || ROWS.has(7)) {
    await sheetRows('chrome-iphone375')
    await sheetRows('chrome-pixel7')
  }
  if (ROWS.has(8)) await overflowRows()
  if (ROWS.has(9)) await shots()
  mkdirSync(MARKETS_SHOT_DIR, { recursive: true })
  writeFileSync(path.join(MARKETS_SHOT_DIR, `${TAG}-numbers.json`), JSON.stringify({ at: new Date().toISOString(), base: BASE, record, verdicts }, null, 2))
  const judged = verdicts.filter((v) => !v.note)
  const failed = judged.filter((v) => !v.ok)
  console.log(`\n${judged.length - failed.length}/${judged.length} judged checks green · numbers → ${path.join(MARKETS_SHOT_DIR, `${TAG}-numbers.json`)}`)
  if (!MEASURE_ONLY && failed.length) process.exit(1)
}

// Only when run directly: the harness may import this file's exports.
if (process.argv[1] && /drive-native-markets\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
