// THE LANDING ON A PHONE (squad landing, lane MOBILE, 2026-11-10): one drive
// that proves the home's landing (hero · tour · trust section · closing doors)
// and /story's stacked tour on a phone, and saves a shot of every screen.
//
//   BASE=http://localhost:4508 node scripts/landing-mobile-drive.mjs
//   npm run drive:landing-mobile                   (BASE defaults to :4508)
//
// Flags: --port=9508 (CDP) · --out=<dir> (shots; default the squad's
// shots/mobile) · --quick (390 only, dark only) · --no-shots
//
// Screens: 375×812, 390×844, 430×932 in both postures (the stranger's: no
// `pantessa.home.tour.v1`; the returning visitor's: `=closed`) and both
// themes, on `/` and `/story`, plus 768×1024 once. Every screen checks:
//   • no horizontal overflow (the document, and every element of the landing
//     inside the viewport unless a sideways scroller of its own holds it);
//   • no tappable thing under 44 px inside the landing's sections
//     ([data-splash-claim], [data-seat="Tour"|"How"|"Close"], /story's #tour);
//   • inputs do not zoom (computed font-size ≥ 16 px);
//   • no page error, no WebSocket.
// On `/` as a stranger: every one of the eight sides opens on a tap with its
// panel fully inside the column; `/#tour-links` lands with Links open and in
// view; "See everything it does" scrolls the tour into view inside the
// phone's inner scroller. The returning posture: the slim strip, no stage.
//
// No Playwright on this machine: Chrome over CDP through Node's own
// WebSocket (the recipe of scripts/landing-shot.mjs). Every request carries
// `x-yf-internal-run: 1`. One ✅/❌ line per check; exit 1 on any ❌.

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
const BASE = process.env.BASE ?? 'http://localhost:4508'
const PORT = Number(flag('port', 9508))
const OUT = String(flag('out', '/Users/nate/pantessa/squad-landing-2026-11-10/shots/mobile'))
const QUICK = !!flag('quick')
const SHOTS = !flag('no-shots')
const WAIT = Number(flag('wait', 2200))
fs.mkdirSync(OUT, { recursive: true })
const PROFILE = path.join(os.tmpdir(), `claude-landing-mobile-${PORT}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SIDES = ['charts', 'ask', 'links', 'autopilots', 'community', 'earn', 'wallet', 'build']
const HOME_SECTIONS = ['[data-splash-claim]', '[data-seat="Tour"]', '[data-seat="How"]', '[data-seat="Close"]']
const STORY_SECTIONS = ['#tour']
const TOUR_KEY = 'pantessa.home.tour.v1'

let failed = 0
let passed = 0
const check = (name, ok, extra) => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const measures = []

// ── In-page probes (strings evaluated in the page) ──
// Is `el` held by a sideways scroller of its own (a code block, a tab row)?
// Then its right edge past the viewport is the scroller's business, not overflow.
const PROBE = `
window.__mob = {
  heldSideways(el, stop) {
    for (let p = el.parentElement; p && p !== stop.parentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { if (p.scrollWidth > p.clientWidth + 1 || ox === 'hidden' || ox === 'clip') return true }
    }
    return false
  },
  visible(el) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return false
    if (el.closest('[hidden], [aria-hidden="true"]')) return false
    return true
  },
  label(el) { return (el.getAttribute('data-journey') || el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 48) },
  audit(sels) {
    const vw = innerWidth
    const out = { overflow: [], small: [], inputs: [], missing: [] }
    for (const sel of sels) {
      const root = document.querySelector(sel)
      if (!root) { out.missing.push(sel); continue }
      if (!this.visible(root)) continue
      for (const el of root.querySelectorAll('*')) {
        if (!this.visible(el)) continue
        const r = el.getBoundingClientRect()
        if ((r.right > vw + 1 || r.left < -1) && !this.heldSideways(el, root)) out.overflow.push(sel + ' ' + (el.className && el.className.baseVal === undefined ? String(el.className).split(' ')[0] : el.tagName) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
      }
      for (const el of root.querySelectorAll('a[href], button, [role="tab"], input, select, textarea, summary')) {
        if (!this.visible(el)) continue
        const r = el.getBoundingClientRect()
        if (Math.min(r.width, r.height) < 43.5) out.small.push(this.label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
      }
      for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), select, textarea')) {
        if (!this.visible(el)) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 16) out.inputs.push(this.label(el) + ' ' + fs + 'px')
      }
    }
    out.overflow = [...new Set(out.overflow)]
    return out
  },
  rect(sel) { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) } },
  scroller() { return document.querySelector('[data-app-scroll]') && getComputedStyle(document.querySelector('[data-app-scroll]')).overflowY !== 'visible' && document.querySelector('[data-app-scroll]').scrollHeight > document.querySelector('[data-app-scroll]').clientHeight ? document.querySelector('[data-app-scroll]') : document.scrollingElement },
  barTop() { const b = document.querySelector('[data-spine-bar]'); if (!b) return innerHeight; const r = b.getBoundingClientRect(); return r.height && r.top < innerHeight ? Math.round(r.top) : innerHeight },
  smallText(sels) {
    const out = []
    for (const sel of sels) {
      const root = document.querySelector(sel); if (!root) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue
        const el = n.parentElement; if (!el || !this.visible(el)) continue
        const cs = getComputedStyle(el)
        const fs = parseFloat(cs.fontSize)
        // 11 px (--fs-xs) is the scale's floor for a mono or upper-case label; running words want 12 px.
        const label = /mono/i.test(cs.fontFamily) || cs.textTransform === 'uppercase'
        if (fs < 10.5 || (fs < 11.5 && !label)) out.push(this.label(el).slice(0, 30) + ' ' + fs + 'px')
      }
    }
    return [...new Set(out)]
  },
}
true`

fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })

let ws
let id = 0
const pending = new Map()
const events = []
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params, sessionId }))
  })

async function openScreen({ w, h, theme, posture, pathname, reduce = false }) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  const S = (method, params = {}) => send(method, params, sessionId)
  await S('Page.enable')
  await S('Runtime.enable')
  await S('Network.enable')
  await S('Network.setExtraHTTPHeaders', { headers: { 'x-yf-internal-run': '1' } })
  const mobile = w < 768
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile })
  if (mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await S('Emulation.setFocusEmulationEnabled', { enabled: true })
  const media = [{ name: 'prefers-color-scheme', value: theme }]
  if (reduce) media.push({ name: 'prefers-reduced-motion', value: 'reduce' })
  await S('Emulation.setEmulatedMedia', { features: media })
  // The posture: the stranger has no tour choice and no remembered session; the returning visitor chose `closed`.
  const ls = posture === 'return' ? `localStorage.setItem(${JSON.stringify(TOUR_KEY)}, 'closed')` : `localStorage.removeItem(${JSON.stringify(TOUR_KEY)}); localStorage.removeItem('pantessa.home.user.v1')`
  await S('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); ${ls} } catch {}` })
  const ev = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    return r.result?.result?.value
  }
  await S('Page.navigate', { url: `${BASE}${pathname}` })
  for (let i = 0; i < 80; i++) {
    if ((await ev('document.readyState').catch(() => '')) === 'complete') break
    await sleep(250)
  }
  await sleep(WAIT)
  await ev(PROBE)
  const tap = async (sel, { block = 'center' } = {}) => {
    const p = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 } })()`)
    if (!p) return false
    await sleep(120)
    if (mobile) {
      await S('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
      await S('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    }
    await sleep(700)
    return true
  }
  // Grow the viewport by the inner scroller's overflow so a tall element can be shot whole.
  const grow = async () => {
    const extra = await ev(`(() => { const s = document.querySelector('[data-app-scroll]'); return s ? Math.max(0, s.scrollHeight - s.clientHeight) : 0 })()`)
    if (extra > 0) {
      await S('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(h + extra, 15000), deviceScaleFactor: 2, mobile })
      await sleep(700)
    }
    return extra
  }
  const unGrow = async () => {
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile })
    await sleep(500)
  }
  const shoot = async (sel, name) => {
    if (!SHOTS) return
    const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX), y: Math.max(0, r.top + scrollY), width: Math.ceil(r.width), height: Math.ceil(Math.min(r.height, 14000)) } })()`)
    if (!box || !box.width || !box.height) return
    const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 } })
    if (shot.result?.data) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'))
  }
  const shootViewport = async (name) => {
    if (!SHOTS) return
    const shot = await S('Page.captureScreenshot', { format: 'png' })
    if (shot.result?.data) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'))
  }
  const mine = (method) => events.filter((e) => e.sessionId === sessionId && e.method === method)
  const close = async () => {
    await send('Target.closeTarget', { targetId })
  }
  return { S, ev, tap, grow, unGrow, shoot, shootViewport, mine, close, mobile }
}

function auditLines(tag, a, extraSmall = []) {
  check(`${tag}: sections present`, a.missing.length === 0, a.missing.join(', '))
  check(`${tag}: nothing past the column`, a.overflow.length === 0, a.overflow.slice(0, 6).join(' · '))
  const small = [...a.small, ...extraSmall]
  check(`${tag}: every target ≥ 44 px`, small.length === 0, small.slice(0, 8).join(' · '))
  check(`${tag}: inputs ≥ 16 px (no zoom)`, a.inputs.length === 0, a.inputs.join(' · '))
}

async function homeScreen({ w, h, theme, posture }) {
  const tag = `/ ${w}x${h} ${theme} ${posture}`
  const stem = `home-${w}-${theme}-${posture}`
  const p = await openScreen({ w, h, theme, posture, pathname: '/' })
  const { ev } = p
  const doc = await ev(`({ vw: innerWidth, sw: document.documentElement.scrollWidth, home: document.documentElement.dataset.home, coarse: matchMedia('(pointer: coarse)').matches })`)
  check(`${tag}: no horizontal page overflow`, doc.sw <= doc.vw + 1, `${doc.sw} > ${doc.vw}`)
  check(`${tag}: posture is ${posture}`, doc.home === posture, `data-home=${doc.home}`)
  if (p.mobile) check(`${tag}: (pointer: coarse) matches`, doc.coarse)
  const a = await ev(`__mob.audit(${JSON.stringify(HOME_SECTIONS)})`)
  auditLines(tag, a)
  const tiny = await ev(`__mob.smallText(${JSON.stringify(HOME_SECTIONS)})`)
  check(`${tag}: no text under 12 px (11 px only for labels) in the landing`, tiny.length === 0, tiny.slice(0, 6).join(' · '))

  // Heights and the fold.
  const m = await ev(`(() => ({ hero: __mob.rect('[data-splash-claim]'), tour: __mob.rect('[data-seat="Tour"]'), how: __mob.rect('[data-seat="How"]'), close: __mob.rect('[data-seat="Close"]'), readEyebrow: __mob.rect('.read__eyebrow'), readLine: __mob.rect('.read__line'), bar: __mob.barTop(), firstLine: (() => { const l = document.querySelector('.read__line'); if (!l) return null; const range = document.createRange(); range.selectNodeContents(l); const rs = [...range.getClientRects()].filter((r) => r.height > 4); return rs.length ? Math.round(rs[0].bottom) : null })() }))()`)
  const row = { screen: tag, hero: m.hero?.h, tour: m.tour?.h, how: m.how?.h, close: m.close?.h, readEyebrowY: m.readEyebrow?.y, readFirstLineBottom: m.firstLine, barTop: m.bar }
  if (p.mobile && posture === 'new') {
    check(`${tag}: stranger hero ≤ 240 px`, (m.hero?.h ?? 999) <= 240, `${m.hero?.h}px`)
    check(`${tag}: THE READ's first line above the bottom bar`, m.firstLine != null && m.firstLine <= m.bar, `line bottom ${m.firstLine}, bar ${m.bar}`)
  }
  if (p.mobile && posture === 'return') check(`${tag}: returning claim ≤ 48 px`, (m.hero?.h ?? 999) <= 48, `${m.hero?.h}px`)
  await p.shootViewport(`${stem}-first-screen`)

  if (posture === 'return') {
    const s = await ev(`({ strip: __mob.rect('[data-tour-strip]'), stage: !!document.querySelector('[data-tour-stage]'), doors: document.querySelectorAll('[data-tour-door]').length })`)
    check(`${tag}: the strip shows, the stage is not mounted`, !!s.strip && s.strip.h > 0 && !s.stage, JSON.stringify(s))
    check(`${tag}: the strip carries eight doors`, s.doors === 8, `${s.doors}`)
    row.strip = s.strip?.h
  }

  if (posture === 'new' && p.mobile) {
    // Every side opens on a tap, its panel inside the column.
    const heights = {}
    for (const side of SIDES) {
      const open = await ev(`!!document.querySelector('[data-tour-panel="${side}"]')`)
      const tapped = !open && (await p.tap(`[data-tour-tab="${side}"]`))
      const r = await ev(`(() => { const el = document.querySelector('[data-tour-panel="${side}"]'); if (!el) return null; const a = __mob.audit(['[data-tour-panel="${side}"]']); return { rect: __mob.rect(el), a, row: __mob.rect('[data-tour-tab="${side}"]'), vh: innerHeight, bar: __mob.barTop(), expanded: document.querySelector('[data-tour-tab="${side}"]').getAttribute('aria-expanded'), panels: document.querySelectorAll('[data-tour-panel]').length } })()`)
      check(`${tag}: ${side} opens on a tap`, !!r && r.panels === 1, r ? `panels ${r.panels}, expanded ${r.expanded}` : 'no panel')
      if (!r) continue
      check(`${tag}: ${side} panel inside the column`, r.rect.x >= 0 && r.rect.r <= w + 1 && r.a.overflow.length === 0, `${r.rect.x}..${r.rect.r} ${r.a.overflow.slice(0, 4).join(' · ')}`)
      check(`${tag}: ${side} targets ≥ 44 px, inputs ≥ 16 px`, r.a.small.length === 0 && r.a.inputs.length === 0, [...r.a.small, ...r.a.inputs].slice(0, 6).join(' · '))
      if (tapped) check(`${tag}: ${side} row in view after the tap`, r.row.y >= 0 && r.row.y < r.bar, `row y ${r.row.y}`)
      heights[side] = r.rect.h
      const tinyP = await ev(`__mob.smallText(['[data-tour-panel="${side}"]'])`)
      check(`${tag}: ${side} no text under 12 px (11 px only for labels)`, tinyP.length === 0, tinyP.slice(0, 5).join(' · '))
    }
    row.panels = heights
    // Shots of each side (dark at every width; light at 390).
    if (SHOTS && (theme === 'dark' || w === 390)) {
      for (const side of SIDES) {
        await p.tap(`[data-tour-tab="${side}"]`)
        await p.grow()
        await p.shoot(`[data-tour-panel="${side}"]`, `${stem}-side-${side}`)
        await p.unGrow()
      }
    }
    // "See everything it does" scrolls the tour into view inside the phone's inner scroller.
    await ev(`(() => { const s = __mob.scroller(); s.scrollTop = 0; return true })()`)
    await sleep(300)
    const before = await ev(`({ y: __mob.rect('#tour').y, st: __mob.scroller().scrollTop })`)
    const tapped = await p.tap('[data-hero-door="tour"]')
    await sleep(900)
    const after = await ev(`({ y: __mob.rect('#tour').y, st: __mob.scroller().scrollTop, bar: __mob.barTop(), scroller: __mob.scroller() === document.scrollingElement ? 'document' : 'inner' })`)
    check(`${tag}: "See everything it does" brings the tour into view (${after.scroller} scroller)`, tapped && after.y >= 0 && after.y < 160 && after.st > before.st, `tour y ${before.y} → ${after.y}, scrollTop ${before.st} → ${after.st}`)
  }

  if (SHOTS && (theme === 'dark' || w === 390)) {
    await p.grow()
    for (const [sel, name] of [['[data-splash-claim]', 'hero'], ['[data-seat="Tour"]', 'tour'], ['[data-seat="How"]', 'how'], ['[data-seat="Close"]', 'close']]) await p.shoot(sel, `${stem}-${name}`)
  }
  check(`${tag}: no page error`, p.mine('Runtime.exceptionThrown').length === 0, p.mine('Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description ?? '').split('\n')[0]).join(' · '))
  check(`${tag}: no WebSocket`, p.mine('Network.webSocketCreated').length === 0, p.mine('Network.webSocketCreated').map((e) => e.params.url).join(' · '))
  measures.push(row)
  await p.close()
}

async function deepLinkScreen({ w, h, theme }) {
  const tag = `/#tour-links ${w}x${h} ${theme}`
  const p = await openScreen({ w, h, theme, posture: 'new', pathname: '/#tour-links' })
  await sleep(800)
  const r = await p.ev(`({ panel: !!document.querySelector('[data-tour-panel="links"]'), row: __mob.rect('[data-tour-tab="links"]'), bar: __mob.barTop(), panels: document.querySelectorAll('[data-tour-panel]').length })`)
  check(`${tag}: lands with Links open`, r.panel && r.panels === 1, JSON.stringify({ panel: r.panel, panels: r.panels }))
  check(`${tag}: Links row in view`, !!r.row && r.row.y >= 0 && r.row.y < r.bar, `row y ${r.row?.y}, bar ${r.bar}`)
  await p.shootViewport(`deeplink-links-${w}-${theme}`)
  check(`${tag}: no page error`, p.mine('Runtime.exceptionThrown').length === 0)
  await p.close()
}

async function storyScreen({ w, h, theme, posture }) {
  const tag = `/story ${w}x${h} ${theme} ${posture}`
  const p = await openScreen({ w, h, theme, posture, pathname: '/story' })
  const doc = await p.ev(`({ vw: innerWidth, sw: document.documentElement.scrollWidth })`)
  check(`${tag}: no horizontal page overflow`, doc.sw <= doc.vw + 1, `${doc.sw} > ${doc.vw}`)
  // Panels lazy-load their own sheets; let every block be laid out once.
  await p.ev(`(async () => { for (const el of document.querySelectorAll('#tour [id^="tour-"]')) { el.scrollIntoView({ block: 'start', behavior: 'instant' }); await new Promise((r) => setTimeout(r, 120)) } document.scrollingElement.scrollTop = 0; return true })()`)
  await sleep(600)
  const a = await p.ev(`__mob.audit(${JSON.stringify(STORY_SECTIONS)})`)
  auditLines(tag, a)
  const tiny = await p.ev(`__mob.smallText(${JSON.stringify(STORY_SECTIONS)})`)
  check(`${tag}: no text under 12 px (11 px only for labels) in the tour`, tiny.length === 0, tiny.slice(0, 6).join(' · '))
  const blocks = await p.ev(`[...document.querySelectorAll('#tour [data-tour-panel]')].map((el) => { const r = __mob.rect(el); return { id: el.getAttribute('data-tour-panel'), x: r.x, r: r.r, h: r.h } })`)
  check(`${tag}: eight panels, each inside the column`, blocks.length === 8 && blocks.every((b) => b.x >= 0 && b.r <= w + 1 && b.h > 0), blocks.map((b) => `${b.id} ${b.x}..${b.r} h${b.h}`).join(' · '))
  const tourH = await p.ev(`__mob.rect('#tour')?.h`)
  measures.push({ screen: tag, storyTour: tourH, panels: Object.fromEntries(blocks.map((b) => [b.id, b.h])) })
  if (SHOTS && (theme === 'dark' || w === 390) && posture === 'new') await p.shoot('#tour', `story-${w}-${theme}-tour`)
  check(`${tag}: no page error`, p.mine('Runtime.exceptionThrown').length === 0, p.mine('Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description ?? '').split('\n')[0]).join(' · '))
  check(`${tag}: no WebSocket`, p.mine('Network.webSocketCreated').length === 0)
  await p.close()
}

let code = 0
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
  ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    } else events.push(d)
  }
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/`, { headers: { 'x-yf-internal-run': '1' } })).status < 500) break
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }

  const phones = QUICK ? [[390, 844]] : [[375, 812], [390, 844], [430, 932]]
  const themes = QUICK ? ['dark'] : ['dark', 'light']
  for (const [w, h] of phones)
    for (const theme of themes)
      for (const posture of ['new', 'return']) {
        await homeScreen({ w, h, theme, posture })
        await storyScreen({ w, h, theme, posture })
      }
  for (const [w, h] of phones) await deepLinkScreen({ w, h, theme: 'dark' })
  if (!QUICK) {
    await homeScreen({ w: 768, h: 1024, theme: 'dark', posture: 'new' })
    await storyScreen({ w: 768, h: 1024, theme: 'dark', posture: 'new' })
  }
  try {
    fs.rmSync(path.join(OUT, '_row.png'), { force: true })
  } catch {}
  fs.writeFileSync(path.join(OUT, 'measures.json'), JSON.stringify(measures, null, 2))
  console.log(`\nmeasures → ${path.join(OUT, 'measures.json')}`)
  ws.close()
} catch (err) {
  console.error(`landing-mobile-drive: ${err?.stack ?? err}`)
  code = 2
} finally {
  chrome.kill('SIGKILL')
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall green (${passed})`)
process.exit(code || (failed ? 1 : 0))
