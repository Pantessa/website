// THE LANDING'S EYES (squad landing, 2026-11-10): one headless-Chrome shot +
// measure tool every lane uses to SEE its own work and prove the page's
// posture at a width. No Playwright on this machine: Chrome over CDP through
// Node's own WebSocket (the recipe scripts/guest-chat-drive.mjs proved).
//
//   BASE=http://localhost:4500 node scripts/landing-shot.mjs --path=/ --w=1440 --h=900 --out=/abs/dir --name=home
//
// Flags (all optional but --out):
//   --path=/            the page (default /)
//   --w= --h=           viewport (1440x900; 375x812 and 390x844 are the phone)
//   --dpr=1             device pixel ratio (2 for a crisp crop to read small type)
//   --theme=dark|light  emulates prefers-color-scheme
//   --full              the whole document, not the viewport (tall pages: prefer --sel)
//   --sel=<css>         shoot just this element (scrolled into view, clipped to its box)
//   --scroll=<css|px>   scroll this element into view (or to a y offset) before the shot
//   --click=<css>       click this element (center point, a real mouse event) before the shot
//   --hover=<css>       hover it before the shot
//   --eval=<js>         run this in the page after load, before the shot
//   --hide=a,b          hide these selectors (a fixed overlay sits on an element crop)
//   --ls=k=v            localStorage entry set BEFORE the page's own scripts (repeatable; v may be JSON)
//   --reduce            emulate prefers-reduced-motion: reduce
//   --wait=2500         settle time after load, ms
//   --rect=a,b,c        print the bounding box of each selector
//   --port=9500         CDP port — give every lane its own
//   --name=shot         file name stem
//
// Prints one JSON line: { file, width, height, docWidth, overflowX, smallTargets,
// errors, sockets, rects, title }. `overflowX` is true when the document is
// wider than the viewport (a phone must be false). `smallTargets` lists visible
// links/buttons inside --scope (default `main`) under 44px on the short side —
// only reported when --w is under 768. `sockets` counts WebSockets the page
// opened (the home opens none). Exit code 1 on a page error, so a lane can
// gate on it.
//
// Every request carries `x-yf-internal-run: 1` — nothing here reads as a
// stranger's visit.

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
const flags = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3))

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE ?? 'http://localhost:4500'
const PORT = Number(flag('port', 9500))
const W = Number(flag('w', 1440))
const H = Number(flag('h', 900))
const DPR = Number(flag('dpr', 1))
const PATHNAME = String(flag('path', '/'))
const OUT = flag('out')
const NAME = String(flag('name', 'shot'))
const WAIT = Number(flag('wait', 2500))
const SCOPE = String(flag('scope', 'main'))
if (!OUT || OUT === true) {
  console.error('landing-shot: --out=/absolute/dir is required')
  process.exit(2)
}
fs.mkdirSync(OUT, { recursive: true })
const PROFILE = path.join(os.tmpdir(), `claude-landing-shot-${PORT}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
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
  await S('Network.setExtraHTTPHeaders', { headers: { 'x-yf-internal-run': '1' } })
  await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: W < 768 })
  if (W < 768) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await S('Emulation.setFocusEmulationEnabled', { enabled: true })
  const media = []
  const theme = flag('theme')
  if (theme === 'dark' || theme === 'light') media.push({ name: 'prefers-color-scheme', value: theme })
  if (flag('reduce')) media.push({ name: 'prefers-reduced-motion', value: 'reduce' })
  if (media.length) await S('Emulation.setEmulatedMedia', { features: media })
  const ls = flags('ls').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])
  if (ls.length) {
    await S('Page.addScriptToEvaluateOnNewDocument', { source: `try { for (const [k, v] of ${JSON.stringify(ls)}) localStorage.setItem(k, v) } catch {}` })
  }
  const ev = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    return r.result?.result?.value
  }

  // The server may still be starting.
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}${PATHNAME}`, { headers: { 'x-yf-internal-run': '1' } })).status < 500) break
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  await S('Page.navigate', { url: `${BASE}${PATHNAME}` })
  for (let i = 0; i < 80; i++) {
    if ((await ev('document.readyState').catch(() => '')) === 'complete') break
    await sleep(250)
  }
  await sleep(WAIT)

  const center = async (sel) =>
    ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)

  // --hide=a,b : take these out of the shot (the floating Ask pill is fixed to
  // the viewport and lands on top of an element crop).
  const hide = flag('hide')
  if (hide && hide !== true) {
    await ev(`for (const el of document.querySelectorAll(${JSON.stringify(String(hide))})) el.style.visibility = 'hidden'`)
  }
  const scroll = flag('scroll')
  if (scroll && scroll !== true) {
    if (/^\d+$/.test(scroll)) await ev(`window.scrollTo(0, ${Number(scroll)})`)
    else await ev(`document.querySelector(${JSON.stringify(scroll)})?.scrollIntoView({ block: 'start' })`)
    await sleep(500)
  }
  const js = flag('eval')
  if (js && js !== true) {
    await ev(String(js))
    await sleep(400)
  }
  const hover = flag('hover')
  if (hover && hover !== true) {
    const p = await center(hover)
    if (p) await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
    await sleep(400)
  }
  const click = flag('click')
  if (click && click !== true) {
    const p = await center(click)
    if (!p) console.error(`landing-shot: --click found nothing for ${click}`)
    else {
      await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
      await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    }
    await sleep(900)
  }

  const metrics = await ev(`(() => {
    const de = document.documentElement
    const out = { width: innerWidth, height: innerHeight, docWidth: de.scrollWidth, docHeight: de.scrollHeight, title: document.title, path: location.pathname + location.search + location.hash }
    out.overflowX = de.scrollWidth > innerWidth + 1
    if (innerWidth < 768) {
      const small = []
      for (const el of document.querySelectorAll(${JSON.stringify(SCOPE)} + ' a[href], ' + ${JSON.stringify(SCOPE)} + ' button, ' + ${JSON.stringify(SCOPE)} + ' [role="tab"]')) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue
        if (el.closest('[hidden], [aria-hidden="true"]')) continue
        if (Math.min(r.width, r.height) < 43.5) small.push((el.getAttribute('data-journey') || el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
      }
      out.smallTargets = small.slice(0, 40)
      out.smallTargetCount = small.length
    }
    return out
  })()`)
  const rects = {}
  const rectSel = flag('rect')
  if (rectSel && rectSel !== true) {
    for (const sel of String(rectSel).split(',')) {
      rects[sel] = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) } })()`)
    }
  }

  // The phone frame scrolls INSIDE an element (app/native-shell.css), so the
  // document is one viewport tall and a tall shot would be clipped. For --full
  // and --sel, grow the viewport by the tallest inner scroller's overflow:
  // everything lays out at once, nothing is hidden behind a scroll.
  if (flag('full') || (flag('sel') && flag('sel') !== true)) {
    const grow = await ev(`(() => { let best = 0; for (const el of document.querySelectorAll('body *')) { const extra = el.scrollHeight - el.clientHeight; if (extra < 40) continue; const oy = getComputedStyle(el).overflowY; if (oy !== 'auto' && oy !== 'scroll') continue; if (extra > best) best = extra } return best })()`)
    if (grow > 0) {
      await S('Emulation.setDeviceMetricsOverride', { width: W, height: Math.min(H + grow, 16000), deviceScaleFactor: DPR, mobile: W < 768 })
      await sleep(900)
    }
  }

  let shot
  const sel = flag('sel')
  if (sel && sel !== true) {
    const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX), y: Math.max(0, r.top + scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height) } })()`)
    if (!box) throw new Error(`--sel found nothing for ${sel}`)
    await sleep(400)
    shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 } })
  } else if (flag('full')) {
    const tall = await ev('Math.max(document.documentElement.scrollHeight, innerHeight)')
    shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: metrics.width, height: Math.min(tall, 16000), scale: 1 } })
  } else {
    shot = await S('Page.captureScreenshot', { format: 'png' })
  }
  const file = path.join(String(OUT), `${NAME}-${W}x${H}${theme && theme !== true ? `-${theme}` : ''}.png`)
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))

  const mine = (method) => events.filter((e) => e.sessionId === sessionId && e.method === method)
  const errors = mine('Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text ?? '').split('\n')[0])
  const sockets = mine('Network.webSocketCreated').map((e) => e.params.url)
  console.log(JSON.stringify({ file, ...metrics, rects, errors, sockets }))
  if (errors.length) code = 1
  ws.close()
} catch (err) {
  console.error(`landing-shot: ${err?.message ?? err}`)
  code = 2
} finally {
  chrome.kill('SIGKILL')
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
process.exit(code)
