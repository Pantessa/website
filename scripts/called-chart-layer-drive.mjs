// THE MARKS LAYER, DRIVEN (squad mobile-sleek, lane CHART, 2026-11-24).
//
// The tiles and cards of a plotted handle are paint over the chart's pane
// (lib/tv/called-overlay). A pin can prove where the layer WOULD put a mark;
// only a browser can prove the paint stays on its bar while a hand moves the
// chart. This drives a real chart through Chrome's own input pipeline (CDP
// `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent`: the same events a
// mouse and a finger make, not synthetic DOM events) and, at every step, asks
// the CHART where each call's bar and price are and compares that with where
// the layer drew its tip (`data-tips` on the layer's canvas).
//
//   BASE=http://localhost:4811 node scripts/called-chart-layer-drive.mjs --port=9611 [--shots=/abs/dir]
//
// Needs a dev server started with XCALLS_FAKE=1 and the licensed chart library
// in public/ (scripts/tv-library.mjs). It scans nothing and signs nothing.
// Exit code 1 when a check fails.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (k, d) => {
  const hit = args.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return d
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE ?? 'http://localhost:4811'
const PORT = Number(flag('port', 9611))
const SHOTS = flag('shots')
const HANDLE = String(flag('handle', 'dcinvestor'))
const SYMBOL = String(flag('sym', 'ETH'))
const GAP_HANDLE = String(flag('gap-handle', 'pantessa_test'))
const GAP_SYMBOL = String(flag('gap-sym', 'TSLA'))
const ONLY = flag('only')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HEAD = { 'x-yf-internal-run': '1' }

let failed = 0
let passed = 0
const check = (name, ok, extra) => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra !== undefined ? ` — ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`)
}

const PROFILE = path.join(os.tmpdir(), `claude-layer-drive-${PORT}`)
fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })

try {
  let v = null
  for (let i = 0; i < 60 && !v; i++) {
    try {
      v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch {
      await sleep(200)
    }
  }
  if (!v) throw new Error('chrome did not start')
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    } else events.push(d)
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => {
      const i = ++id
      pending.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params, sessionId }))
    })
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  const S = (method, params = {}) => send(method, params, sessionId)
  await S('Page.enable')
  await S('Runtime.enable')
  await S('Network.enable')
  await S('Network.setExtraHTTPHeaders', { headers: HEAD })
  const ev = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    return r.result?.result?.value
  }
  const viewport = async (w, h, phone) => {
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: phone })
    await S('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 })
  }
  const shot = async (name) => {
    if (!SHOTS || SHOTS === true) return
    fs.mkdirSync(String(SHOTS), { recursive: true })
    const r = await S('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(String(SHOTS), `${name}.png`), Buffer.from(r.result.data, 'base64'))
  }

  const recordOf = async (handle, sym, side) => {
    const r = await (await fetch(`${BASE}/api/x/record?handle=${handle}&sym=${sym}${side && side !== 'all' ? `&side=${side}` : ''}`, { headers: HEAD })).json()
    return r.record?.calls ?? []
  }
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/x/record?handle=${HANDLE}&sym=${SYMBOL}`, { headers: HEAD })).status < 500) break
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }

  /**
   * One reading, taken inside a frame AFTER the layer's own paint of that
   * frame: the layer's tips and, for the same calls, what the chart says.
   */
  const READ = (calls) => `(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const f = document.querySelector('.tvx__host iframe')
    const d = f && f.contentDocument
    const c = d && d.querySelector('canvas[data-called-marks]')
    if (!c) return { layer: false, search: location.search }
    const calls = ${JSON.stringify(Object.fromEntries(calls.map((k) => [k.postId, [k.barTime, k.priceAt]])))}
    const api = f.contentWindow.tradingViewApi.activeChart()
    const ts = api.getTimeScale()
    const panes = api.getPanes()
    const ps = (panes.find((p) => p.hasMainSeries()) || panes[0]).getMainSourcePriceScale()
    const fr = f.getBoundingClientRect()
    const r = c.getBoundingClientRect()
    const sp = ts.barSpacing()
    const tips = JSON.parse(c.dataset.tips || '[]').map(([id, x, y]) => {
      const k = calls[id]
      return { id, x, y, bar: k ? k[0] : null, tL: ts.coordinateToTime(x - sp * 0.35), tR: ts.coordinateToTime(x + sp * 0.35), yWant: k ? ps.priceToCoordinate(k[1]) : null }
    })
    const wrap = c.parentElement.getBoundingClientRect()
    let ink = 0
    try { const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < px.length; i += 4 * 97) if (px[i]) ink++ } catch (e) { ink = -1 }
    return {
      layer: true, marks: +c.dataset.marks, cards: +c.dataset.cards, hits: JSON.parse(c.dataset.hits || '[]'), tips, ink,
      ox: fr.left + r.left, oy: fr.top + r.top, w: r.width, h: r.height, fits: Math.abs(r.width - wrap.width) < 1 && Math.abs(r.height - wrap.height) < 1,
      res: api.resolution(), from: api.getVisibleRange().from, to: api.getVisibleRange().to, spacing: sp, shapes: api.getAllShapes().map((s) => s.name), search: location.search,
      // What is on the visible part of the page: the pane's box in the viewport.
      top: fr.top + r.top, bottom: fr.top + r.bottom, vh: innerHeight,
    }
  })()`
  /** Every tip sits on its own call's bar (within the middle 70% of the bar) and on its price (within 1.5px). `gap`: the bar may be the last one before a closed market. */
  const glued = (s, opts = {}) => {
    if (!s.layer || !s.tips.length) return { ok: false, why: 'no tips to check', n: 0 }
    const bad = s.tips.filter((t) => {
      if (t.bar === null || t.yWant === null) return true
      const onBar = opts.gap ? t.tL === t.tR && t.tL <= t.bar && t.bar - t.tL < 5 * 86400 : opts.intraday ? t.tL === t.tR && t.tL <= t.bar && t.bar - t.tL < opts.intraday : t.tL === t.bar && t.tR === t.bar
      return !onBar || Math.abs(t.y - t.yWant) > 1.5
    })
    return { ok: bad.length === 0, n: s.tips.length, bad: bad.slice(0, 3) }
  }
  const open = async (pathname, calls, wait = 9000) => {
    await S('Page.navigate', { url: `${BASE}${pathname}` })
    for (let i = 0; i < 80; i++) {
      if ((await ev('document.readyState').catch(() => '')) === 'complete') break
      await sleep(250)
    }
    let s = null
    for (let i = 0; i < 40; i++) {
      await sleep(i === 0 ? Math.min(wait, 3000) : 500)
      s = await ev(READ(calls)).catch(() => null)
      if (s?.layer && s.marks > 0 && s.tips.length > 0) break
    }
    await sleep(1200)
    return ev(READ(calls))
  }
  const mouse = (type, x, y, extra = {}) => S('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left', buttons: extra.buttons ?? 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra })
  const touch = (type, points) => S('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) })
  const tapAt = async (x, y) => {
    await touch('touchStart', [{ x, y }])
    await sleep(60)
    await touch('touchEnd', [])
  }
  const centerOf = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  const sum = (s) => s.hits.reduce((n, h) => n + h[3], 0) + s.cards

  const all = await recordOf(HANDLE, SYMBOL)
  const want = (section) => !ONLY || ONLY === true || String(ONLY).split(',').includes(section)

  // ── DESKTOP: a real mouse ─────────────────────────────────────────────
  if (want('desktop')) {
    await viewport(1440, 900, false)
    let s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
    check(`desktop: the layer is up over the pane, fits it, and every call is on it (${all.length} calls = the tiles' counts + the cards)`, s.layer && s.fits && sum(s) === all.length && s.cards > 0, { marks: s.marks, cards: s.cards, sum: s.layer ? sum(s) : null })
    let g = glued(s)
    check(`desktop, at rest: every tip is on its call's own bar and price (${g.n} tips)`, g.ok, g)

    // A real drag: press on an empty part of the pane, move in steps, read while the button is still down.
    const px = s.ox + s.w * 0.55
    const py = s.oy + s.h * 0.52
    const from0 = s.from
    const to0 = s.to
    await mouse('mouseMoved', px, py)
    await mouse('mousePressed', px, py, { buttons: 1 })
    let mid = []
    for (let i = 1; i <= 14; i++) {
      await mouse('mouseMoved', px + i * 17, py + (i % 3), { buttons: 1 })
      if (i === 5 || i === 9 || i === 14) mid.push(glued((s = await ev(READ(all)))))
    }
    check(`desktop, DURING a mouse drag (button down, read at three points): every tip is still on its bar and price`, mid.every((m) => m.ok) && (s.from !== from0 || s.to !== to0), { mid, moved: s.from !== from0 || s.to !== to0 })
    await shot('chart-r2-drag-mid-1440')
    await mouse('mouseReleased', px + 14 * 17, py)
    await sleep(700)
    s = await ev(READ(all))
    g = glued(s)
    check(`desktop, after the drag: glued (${g.n} tips), the chart moved (its newest bar on screen is ${Math.round((to0 - s.to) / 86400)} days earlier), nothing lost (${sum(s)} of ${all.length} calls on a pane that still shows them all, or fewer where bars left it)`, g.ok && (s.from !== from0 || s.to !== to0) && sum(s) <= all.length, g)

    // The wheel zooms: crowds split, the tips stay on their bars.
    const sp0 = s.spacing
    for (let i = 0; i < 6; i++) {
      await S('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px, y: py, deltaX: 0, deltaY: -240 })
      await sleep(60)
    }
    const midZoom = glued((s = await ev(READ(all))))
    await sleep(600)
    s = await ev(READ(all))
    g = glued(s)
    check(`desktop, a wheel zoom (bar width ${sp0.toFixed(1)} -> ${s.spacing.toFixed(1)}px): glued right after the last tick and once settled`, midZoom.ok && g.ok && s.spacing !== sp0, { midZoom, g })
    await shot('chart-r2-zoomed-1440')

    // A window resize.
    await viewport(1100, 800, false)
    await sleep(1800)
    s = await ev(READ(all))
    g = glued(s)
    check(`desktop, the window resized to 1100x800: the layer fits the new pane and is glued (${g.n} tips)`, s.fits && g.ok, { fits: s.fits, g })
    await viewport(1440, 900, false)
    await sleep(1500)

    // A click on a tile opens that call; the opened call's own tile is on its bar.
    s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
    const lone = s.hits.find((h) => h[3] === 1 && h[4] === 0)
    if (lone) {
      await mouse('mouseMoved', s.ox + lone[1], s.oy + lone[2])
      await mouse('mousePressed', s.ox + lone[1], s.oy + lone[2], { buttons: 1 })
      await mouse('mouseReleased', s.ox + lone[1], s.oy + lone[2])
      await sleep(1500)
      s = await ev(READ(all))
      g = glued(s)
      const cardUp = await ev(`!!document.querySelector('.xcf')`)
      check(`desktop, a real click on a tile: that call opens (the call card is up), its tile is the lifted one, and it is on its bar`, cardUp && s.hits.some((h) => h[0] === lone[0] && h[4] === 1) && g.ok, { cardUp, focus: s.hits.filter((h) => h[4] === 1), g })
    } else check('desktop: a lone tile to click exists', false)

    // The band: Bear, then All. The counts on the pane follow the side.
    const bear = await recordOf(HANDLE, SYMBOL, 'bear')
    const side = async (name) => {
      const p = await centerOf(`.xch__side[data-side="${name}"]`)
      if (!p) return false
      await mouse('mouseMoved', p.x, p.y)
      await mouse('mousePressed', p.x, p.y, { buttons: 1 })
      await mouse('mouseReleased', p.x, p.y)
      await sleep(3500)
      return true
    }
    if (await side('bear')) {
      s = await ev(READ(bear))
      g = glued(s)
      check(`desktop, the band's Bear: the pane holds the ${bear.length} bear calls and no other, glued`, s.search.includes('side=bear') && sum(s) <= bear.length && sum(s) > 0 && s.tips.every((t) => t.bar !== null) && g.ok, { sum: sum(s), want: bear.length, g })
      await side('all')
      s = await ev(READ(all))
      check(`desktop, back to All: the pane holds the calls again`, sum(s) > bear.length && glued(s).ok, { sum: sum(s) })
    } else check('desktop: the band has its side toggle', false)

    // Close the handle: nothing of the plot is left behind. Then plot it again.
    const x = await centerOf('[data-journey="called_clear"]')
    if (x) {
      await mouse('mouseMoved', x.x, x.y)
      await mouse('mousePressed', x.x, x.y, { buttons: 1 })
      await mouse('mouseReleased', x.x, x.y)
      await sleep(2500)
      s = await ev(READ(all))
      check(`desktop, the handle closed: no tile, no card, not one painted pixel, and no shape of the plot on the chart (the tally and the rule are gone too)`, !s.search.includes('x=') && s.layer && s.marks === 0 && s.cards === 0 && s.ink === 0 && s.tips.length === 0 && s.shapes.length === 0, { search: s.search, marks: s.marks, cards: s.cards, ink: s.ink, shapes: s.shapes })
      await shot('chart-r2-closed-1440')
      s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
      check(`desktop, plotted again: every call is back (${sum(s)}) and glued`, sum(s) === all.length && glued(s).ok, { sum: sum(s) })
    } else check('desktop: the band has its close control', false)
  }

  // ── PHONE: a real finger ──────────────────────────────────────────────
  if (want('phone')) {
    await viewport(390, 844, true)
    let s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
    let g = glued(s)
    check(`phone: the layer is up, fits the pane, counts every call (${s.layer ? sum(s) : '-'} of ${all.length}), no card on a pane this narrow`, s.layer && s.fits && sum(s) === all.length && s.cards === 0, { marks: s.marks, cards: s.cards })
    // A touch needs the pane on screen.
    await ev(`document.querySelector('.tvx__canvas').scrollIntoView({ block: 'center' })`)
    await sleep(500)
    s = await ev(READ(all))

    // One finger, dragged: the chart pans, the page does not scroll, the tiles ride their bars.
    const fx = s.ox + s.w * 0.6
    const fy = s.oy + s.h * 0.62
    const from0 = s.from
    const scroll0 = await ev('scrollY')
    await touch('touchStart', [{ x: fx, y: fy }])
    const mid = []
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', [{ x: fx - i * 9, y: fy }])
      await sleep(16)
      if (i === 6 || i === 12) mid.push(glued((s = await ev(READ(all)))))
    }
    await shot('chart-r2-touch-pan-mid-390')
    await touch('touchEnd', [])
    await sleep(900)
    s = await ev(READ(all))
    g = glued(s)
    const panned = s.from !== from0
    check(`phone, a one-finger drag across the pane: the chart panned (${Math.round((s.from - from0) / 86400)} days), read twice with the finger down and once after, every tip on its bar`, panned && mid.every((m) => m.ok || m.n === 0) && (g.ok || g.n === 0), { panned, mid, g })
    check('phone: the drag did not scroll the page under the chart', Math.abs((await ev('scrollY')) - scroll0) < 2)

    // Two fingers, spread: a pinch zooms; the crowds split and stay on their bars.
    s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
    await ev(`document.querySelector('.tvx__canvas').scrollIntoView({ block: 'center' })`)
    await sleep(500)
    s = await ev(READ(all))
    const sp0 = s.spacing
    const marks0 = s.marks
    const cx = s.ox + s.w * 0.5
    const cy = s.oy + s.h * 0.6
    await touch('touchStart', [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }])
    let pinchMid = null
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', [{ x: cx - 20 - i * 6, y: cy }, { x: cx + 20 + i * 6, y: cy }])
      await sleep(16)
      if (i === 8) pinchMid = glued((s = await ev(READ(all))))
    }
    await touch('touchEnd', [])
    await sleep(900)
    s = await ev(READ(all))
    g = glued(s)
    check(`phone, a two-finger pinch out: the bars widened (${sp0.toFixed(2)} -> ${s.spacing.toFixed(2)}px), ${marks0} marks became ${s.marks}, glued with the fingers down and after`, s.spacing > sp0 * 1.2 && (pinchMid.ok || pinchMid.n === 0) && (g.ok || g.n === 0), { pinchMid, g })
    await shot('chart-r2-pinched-390')

    // A real tap on a mark opens its call; a tap on bare pane opens nothing.
    s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
    await ev(`document.querySelector('.tvx__canvas').scrollIntoView({ block: 'center' })`)
    await sleep(500)
    s = await ev(READ(all))
    await tapAt(s.ox + s.w * 0.5, s.oy + s.h - 20)
    await sleep(700)
    const afterBare = await ev(READ(all))
    const target = s.hits.slice().sort((a, b) => b[2] - a[2])[0]
    await tapAt(s.ox + target[1] + 14, s.oy + target[2] + 12)
    await sleep(1600)
    s = await ev(READ(all))
    check(`phone, a real tap 18px off a mark's centre (inside its 44px target) opens a call under that mark; a tap on bare pane opened nothing`, !afterBare.hits.some((h) => h[4] === 1) && s.hits.some((h) => h[4] === 1) && all.some((k) => k.postId === s.hits.find((h) => h[4] === 1)?.[0]), { bare: afterBare.hits.filter((h) => h[4] === 1), focus: s.hits.filter((h) => h[4] === 1) })
    const openId = s.hits.find((h) => h[4] === 1)?.[0]
    const focusTip = s.tips.find((t) => t.id === openId)
    const focusHit = s.hits.find((h) => h[4] === 1)
    const card = await ev(`(() => { const el = document.querySelector('.xcf'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height } })()`)
    check(`phone, with that call open: its tile and the square on its bar are on the visible part of the pane, clear of the call card (card top ${card ? Math.round(card.top) : '-'}px)`, !!focusTip && !!focusHit && !!card && s.oy + focusHit[2] + 15 < card.top && s.oy + focusTip.y < card.top && s.oy + focusHit[2] - 15 > 0, { card, tileY: focusHit ? s.oy + focusHit[2] : null, tipY: focusTip ? s.oy + focusTip.y : null })
    await shot('chart-r2-open-390')

    // The bar size, by a real tap on the phone's own row: 4H and back to 1D.
    s = await open(`/t/${SYMBOL}?x=${HANDLE}`, all)
    const tf = async (n) => {
      const p = await centerOf(`.tvx-tf button:nth-child(${n})`)
      await tapAt(p.x, p.y)
      await sleep(4500)
    }
    await tf(4)
    s = await ev(READ(all))
    g = glued(s, { intraday: 86400 })
    check(`phone, the bar size to 4H: the chart is on 240-minute bars and every tip is on the first bar of its call's day (${g.n} tips)`, s.res === '240' && (g.ok || (g.n === 0 && s.marks > 0)), { res: s.res, g, marks: s.marks })
    await tf(5)
    s = await ev(READ(all))
    g = glued(s)
    check(`phone, back to 1D: daily bars, glued (${g.n} tips)`, /^1?D$/i.test(s.res) && (g.ok || (g.n === 0 && s.marks > 0)), { res: s.res, g })

    // Rotate: 390x844 to 844x390 and back.
    await viewport(844, 390, true)
    await sleep(2500)
    s = await ev(READ(all))
    g = glued(s)
    check(`phone, rotated to 844x390: the layer fits the new pane (${Math.round(s.w)}x${Math.round(s.h)}), is glued, and still counts every call it shows`, s.fits && (g.ok || g.n === 0) && s.marks > 0, { fits: s.fits, g, marks: s.marks })
    await shot('chart-r2-rotated-844')
    await viewport(390, 844, true)
    await sleep(2500)
    s = await ev(READ(all))
    g = glued(s)
    check(`phone, rotated back: fits and glued`, s.fits && (g.ok || g.n === 0) && s.marks > 0, { fits: s.fits, g })
  }

  // ── A MARKET THAT CLOSES (weekend gaps) ───────────────────────────────
  if (want('gap')) {
    const gapCalls = await recordOf(GAP_HANDLE, GAP_SYMBOL)
    await viewport(1440, 900, false)
    let s = await open(`/t/${GAP_SYMBOL}?x=${GAP_HANDLE}`, gapCalls)
    const days = s.layer ? (s.to - s.from) / 86400 : 0
    const bars = s.layer ? s.w / s.spacing : 0
    let g = glued(s, { gap: true })
    check(`a market that closes (${GAP_SYMBOL}: about ${Math.round(bars)} bars drawn over ${Math.round(days)} days, so it has gaps): every tip is on its call's bar, or on the last bar before a closed day (${g.n} tips)`, s.layer && sum(s) === gapCalls.length && g.ok && bars < days * 0.9, { g, days, bars, sum: s.layer ? sum(s) : null, want: gapCalls.length })
    const px = s.ox + s.w * 0.5
    const py = s.oy + s.h * 0.5
    await mouse('mouseMoved', px, py)
    await mouse('mousePressed', px, py, { buttons: 1 })
    for (let i = 1; i <= 10; i++) await mouse('mouseMoved', px + i * 13, py, { buttons: 1 })
    const mid = glued((s = await ev(READ(gapCalls))), { gap: true })
    await mouse('mouseReleased', px + 130, py)
    await sleep(700)
    g = glued((s = await ev(READ(gapCalls))), { gap: true })
    check(`a market that closes, dragged: glued with the button down and after`, mid.ok && g.ok, { mid, g })
    await shot('chart-r2-gaps-1440')
  }

  const errors = events.filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text ?? '').split('\n')[0])
  check('no page error through the whole drive', errors.length === 0, errors.slice(0, 3))
  ws.close()
} catch (err) {
  console.error(`called-chart-layer-drive: ${err?.stack ?? err}`)
  failed++
} finally {
  chrome.kill('SIGKILL')
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} of ${passed + failed} layer drive checks failed` : `\nall ${passed} layer drive checks green`)
process.exit(failed ? 1 : 0)
