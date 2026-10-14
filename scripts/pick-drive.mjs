// THE ONE PICK, driven (GTM squad 2026-10-13, lane PICK): headless Chrome over
// CDP (Node's own WebSocket — no Playwright on this Mac) against a running
// `next start`. Proves the one selection flows through every live surface:
//   0. a fresh browser that never touched a row remembers nothing (a default is never "yours")
//   1. fill The Front on the deck from "Biggest" (a hand) → the memory holds three
//   2. reload → the deck's Tape stage shows those three as its chips
//   3. /live?view=siege marches the same three (scoreboard + ?t=)
//   4. remove one on /live's tape → gone from the memory, the URL, the deck, the siege — and a second tab follows
//   5. ?t= wins over the memory (and is never written as a hand's)
//   6. a lens the pick does not hold reads as no lens; a lens it holds sticks
// Usage: BASE=http://localhost:4041 node scripts/pick-drive.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9441)
const BASE = process.env.BASE ?? 'http://localhost:4041'
const OUT = process.env.OUT ?? ''
const KEY = 'pantessa.markets.pick.v1'
const PROFILE = `/tmp/claude-pick-drive-${PORT}`
if (OUT) fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function version() {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch {
      await sleep(200)
    }
  }
  throw new Error('chrome did not start')
}
const v = await version()
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
let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} pick drive: ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

async function tab(w = 1440, h = 900) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId)
  // A hidden headless page skips rAF and parks visibility-gated work; this one is always "looked at".
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  const ev = async (s) => {
    const r = await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.result?.value
  }
  const go = async (path) => {
    await send('Page.navigate', { url: `${BASE}${path}` }, sessionId)
    await sleep(600)
  }
  const until = async (expr, ms = 20000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const v = await ev(expr).catch(() => null)
      if (v) return v
      await sleep(250)
    }
    return null
  }
  // Poll an expression until its value passes `ok` (the reads land at the venue's pace); the last value either way.
  const settle = async (expr, ok, ms = 15000) => {
    const end = Date.now() + ms
    let last = null
    while (Date.now() < end) {
      last = await ev(expr).catch(() => null)
      if (last != null && ok(last)) return last
      await sleep(300)
    }
    return last
  }
  const shot = async (name) => {
    if (!OUT) return
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
  }
  const errors = () =>
    events
      .filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown')
      .map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
  return { sessionId, targetId, ev, go, until, settle, shot, errors }
}

const memory = (t) => t.ev(`(() => { try { const v = JSON.parse(localStorage.getItem('${KEY}') || 'null'); return v ? JSON.stringify(v.markets) : null } catch { return 'bad' } })()`)
const tickers = (ms) => ms.map((m) => m.replace(/^xyz:/, ''))

try {
  const a = await tab()

  // ── 0. A hand-less default is never remembered ──────────────────────
  await a.go('/')
  await a.until(`document.querySelector('.deck') && document.querySelectorAll('.pulse__markets .pulse__m').length > 3`)
  await sleep(7000) // past the 4s wallet hold and the 6s fallback: the opening has painted
  const fresh = await a.ev(`JSON.stringify({ pick: localStorage.getItem('${KEY}'), armies: localStorage.getItem('pantessa.live.armies.v1'), live: localStorage.getItem('pantessa.live.markets.v1'), own: document.querySelectorAll('.pulse__markets .pulse__mown').length, url: location.pathname + location.search })`)
  const f0 = JSON.parse(fresh)
  check('a fresh browser remembers nothing after the opening paints on `/` (no pick key, neither old key written), the default leads the pulse row, and `/` never gains ?t=', f0.pick === null && f0.armies === null && f0.live === null && f0.own >= 1 && f0.url === '/', fresh)
  await a.go('/live?view=front')
  await a.until(`document.querySelectorAll('.battle__table tbody tr').length >= 1 && !document.querySelector('.battle__empty')`, 25000)
  await sleep(1500)
  const f1 = await a.ev(`JSON.stringify({ pick: localStorage.getItem('${KEY}'), t: new URLSearchParams(location.search).get('t') })`)
  check('…and /live?view=front with no hand still writes no memory (the URL mirrors what is shown)', JSON.parse(f1).pick === null && !!JSON.parse(f1).t, f1)

  // ── 1. Fill The Front on the deck by hand ───────────────────────────
  await a.go('/')
  await a.until(`document.querySelector('[data-channel="front"]')`)
  await a.ev(`document.querySelector('.deck [data-channel="front"]').click()`)
  // The field's own venue list (not your chips) has landed: the fill-from has rows to fill from.
  await a.until(`[...document.querySelectorAll('.battle--stage .battle__chips .battle__pick')].some((b) => !/yours$/.test(b.textContent))`, 25000)
  await a.ev(`[...document.querySelectorAll('.battle--stage .battle__modes button')].find((b) => /Biggest/.test(b.textContent)).click()`)
  await a.settle(`localStorage.getItem('${KEY}')`, (v) => !!v, 5000)
  const memRaw = await memory(a)
  const M = memRaw ? JSON.parse(memRaw) : []
  const pressed = await a.ev(`JSON.stringify([...document.querySelectorAll('.battle--stage .battle__pick[aria-pressed="true"] .battle__pick-n')].map((n) => n.textContent))`)
  const journey = await a.ev(`JSON.stringify([...document.querySelectorAll('.battle--stage .battle__modes button')].map((b) => b.getAttribute('data-journey')))`)
  check('"Fill from Biggest" on the deck\'s Front writes three markets to the one memory by hand, and the field presses exactly those', M.length === 3 && JSON.stringify(JSON.parse(pressed).map((x) => x.replace(/·xyz$/, ''))) === JSON.stringify(tickers(M)), `memory ${memRaw} pressed ${pressed}`)
  check('every picker control on the field wears a data-journey label', /Fill Front from biggest/.test(journey) && (await a.ev(`[...document.querySelectorAll('.battle--stage .battle__pick')].every((b) => /^(Add|Drop) .+ on Front$/.test(b.getAttribute('data-journey') || ''))`)), journey)
  await a.shot('1-deck-front-filled')

  // ── 2. Reload → the Tape stage shows them ───────────────────────────
  await a.go('/')
  await a.until(`document.querySelector('[data-channel="tape"]')`)
  await a.ev(`document.querySelector('.deck [data-channel="tape"]').click()`)
  const tapeChips = await a.settle(`JSON.stringify([...document.querySelectorAll('.deck__tapepick .pulse__mown > .pulse__m')].map((b) => b.textContent.replace(/^xyz/, '')))`, (v) => v === JSON.stringify(tickers(M)))
  check('after a reload the deck\'s Tape stage carries the same three as its chips, each with a × and a journey label', JSON.stringify(JSON.parse(tapeChips)) === JSON.stringify(tickers(M)) && (await a.ev(`[...document.querySelectorAll('.deck__tapepick .pulse__mx')].every((b) => /^Remove .+ from your markets$/.test(b.getAttribute('data-journey') || ''))`)), `tape ${tapeChips} memory ${JSON.stringify(M)}`)
  await a.shot('2-deck-tape')
  // the pulse channel too
  await a.ev(`document.querySelector('.deck [data-channel="pulse"]').click()`)
  const pulseChips = await a.settle(`JSON.stringify([...document.querySelectorAll('.pulse__markets .pulse__mown > .pulse__m')].map((b) => b.textContent.replace(/^xyz/, '')))`, (v) => v === JSON.stringify(tickers(M)))
  check('…and the pulse channel leads its row with them', JSON.stringify(JSON.parse(pulseChips)) === JSON.stringify(tickers(M)), pulseChips)
  // The deck's ladder follows the FIRST of the pick (the lens and the hot market are its fallbacks).
  await a.ev(`document.querySelector('.deck__flick').click()`)
  const ladder = await a.settle(`document.querySelector('.ladder')?.dataset.market ?? null`, (v) => v === M[0], 10000)
  check(`the streaming order book follows the first pick (${M[0]})`, ladder === M[0], `ladder ${ladder}`)
  await a.ev(`document.querySelector('.deck__flick').click()`)

  // ── 3. /live?view=siege marches them ────────────────────────────────
  await a.go('/live?view=siege')
  await a.settle(`JSON.stringify([...document.querySelectorAll('.battle__table tbody tr .battle__name')].map((n) => n.textContent.replace(/·xyz$/, '')).sort())`, (v) => v === JSON.stringify([...tickers(M)].sort()), 25000)
  const siege = await a.ev(`JSON.stringify({ rows: [...document.querySelectorAll('.battle__table tbody tr .battle__name')].map((n) => n.textContent.replace(/·xyz$/, '')).sort(), t: new URLSearchParams(location.search).get('t'), view: new URLSearchParams(location.search).get('view') })`)
  const sg = JSON.parse(siege)
  check('/live?view=siege marches the same three and mirrors them as ?t=', JSON.stringify(sg.rows) === JSON.stringify([...tickers(M)].sort()) && sg.t === M.join(',') && sg.view === 'siege', siege)
  await a.shot('3-live-siege')

  // ── 4. Remove one on /live's tape → gone everywhere (and in a second tab) ──
  const b = await tab()
  await b.go('/live?view=front')
  await b.until(`document.querySelectorAll('.battle__table tbody tr .battle__name').length >= 3`, 25000)
  await a.go('/live')
  await a.until(`document.querySelectorAll('.live__markets .live__mown').length >= 3`, 15000)
  const gone = M[0]
  await a.ev(`[...document.querySelectorAll('.live__markets .live__mx')].find((x) => x.getAttribute('aria-label') === 'Remove ${gone} from your markets').click()`)
  await sleep(800)
  const after = JSON.parse((await memory(a)) ?? '[]')
  const tapeUrl = await a.ev(`new URLSearchParams(location.search).get('t')`)
  const liveChips = await a.ev(`JSON.stringify([...document.querySelectorAll('.live__markets .live__mown > .live__m')].map((b) => b.textContent))`)
  check(`× on /live's tape removes ${gone}: the memory, the URL's ?t= and the row drop it`, JSON.stringify(after) === JSON.stringify(M.slice(1)) && tapeUrl === M.slice(1).join(',') && !JSON.parse(liveChips).some((c) => c.replace(/^xyz/, '') === tickers([gone])[0]), `memory ${JSON.stringify(after)} url ${tapeUrl} chips ${liveChips}`)
  const bRows = await b.settle(`JSON.stringify([...document.querySelectorAll('.battle__table tbody tr .battle__name')].map((n) => n.textContent.replace(/·xyz$/, '')).sort())`, (v) => v === JSON.stringify([...tickers(M.slice(1))].sort()), 5000)
  check('…a second tab on The Front follows through the storage event', JSON.stringify(JSON.parse(bRows)) === JSON.stringify([...tickers(M.slice(1))].sort()), bRows)
  await a.go('/')
  await a.until(`document.querySelector('[data-channel="tape"]')`)
  await a.ev(`document.querySelector('.deck [data-channel="tape"]').click()`)
  const tape2 = await a.settle(`JSON.stringify([...document.querySelectorAll('.deck__tapepick .pulse__mown > .pulse__m')].map((b) => b.textContent.replace(/^xyz/, '')))`, (v) => v === JSON.stringify(tickers(M.slice(1))))
  check('…and the deck\'s Tape stage no longer shows it', JSON.stringify(JSON.parse(tape2)) === JSON.stringify(tickers(M.slice(1))), tape2)
  await a.go('/live?view=siege')
  const siege2 = await a.settle(`JSON.stringify([...document.querySelectorAll('.battle__table tbody tr .battle__name')].map((n) => n.textContent.replace(/·xyz$/, '')).sort())`, (v) => v === JSON.stringify([...tickers(M.slice(1))].sort()), 25000)
  check('…nor does /live?view=siege', JSON.stringify(JSON.parse(siege2)) === JSON.stringify([...tickers(M.slice(1))].sort()), siege2)

  // ── 5. ?t= wins over the memory, and is never written as a hand's ───
  await a.go('/live?view=front&t=btc,eth')
  await a.settle(`JSON.stringify([...document.querySelectorAll('.battle__table tbody tr .battle__name')].map((n) => n.textContent).sort())`, (v) => v === JSON.stringify(['BTC', 'ETH']), 25000)
  const url5 = await a.ev(`JSON.stringify({ rows: [...document.querySelectorAll('.battle__table tbody tr .battle__name')].map((n) => n.textContent).sort(), t: new URLSearchParams(location.search).get('t'), mem: localStorage.getItem('${KEY}') })`)
  const u5 = JSON.parse(url5)
  check('?t=btc,eth wins over the memory (the field marches BTC and ETH, the URL keeps them) and the memory is untouched', JSON.stringify(u5.rows) === JSON.stringify(['BTC', 'ETH']) && u5.t === 'BTC,ETH' && JSON.stringify(JSON.parse(u5.mem).markets) === JSON.stringify(M.slice(1)), url5)

  // ── 6. The lens must be a pick ──────────────────────────────────────
  const outsider = ['XRP', 'LINK', 'AVAX', 'ADA'].find((m) => !M.includes(m))
  await a.go(`/live?m=${outsider}`)
  await a.until(`document.querySelectorAll('.live__markets .live__mown').length >= 1`, 15000)
  await sleep(1200)
  const l1 = await a.ev(`JSON.stringify({ on: document.querySelector('.live__markets .live__m.is-on')?.textContent ?? null, m: new URLSearchParams(location.search).get('m') })`)
  check(`/live?m=${outsider} (not a pick) reads as no lens: All is on and the URL drops ?m=`, /^All/.test(JSON.parse(l1).on ?? '') && JSON.parse(l1).m === null, l1)
  const inside = M[1]
  await a.go(`/live?m=${encodeURIComponent(inside)}`)
  await a.until(`document.querySelectorAll('.live__markets .live__mown').length >= 1`, 15000)
  await sleep(1200)
  const l2 = await a.ev(`JSON.stringify({ on: document.querySelector('.live__markets .live__m.is-on')?.textContent ?? null, m: new URLSearchParams(location.search).get('m'), pressed: document.querySelector('.live__markets .live__m.is-on')?.getAttribute('data-journey') })`)
  check(`/live?m=${inside} (a pick) is the lens: its chip is on and ?m= stays`, (JSON.parse(l2).on ?? '').replace(/^xyz/, '') === tickers([inside])[0] && JSON.parse(l2).m === inside, l2)
  await a.shot('6-live-lens')

  const errs = [...a.errors(), ...b.errors()]
  check('no page exceptions on any surface', errs.length === 0, errs.slice(0, 3).join(' | '))
} catch (e) {
  check('the drive ran to the end', false, String(e?.stack ?? e))
} finally {
  console.log(`\npick drive: ${pass} passed / ${fail} failed`)
  ws.close()
  chrome.kill('SIGKILL')
  fs.rmSync(PROFILE, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
