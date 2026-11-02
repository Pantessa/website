// A GUEST'S SEND ON /chat ANSWERS AND NEVER NAVIGATES AWAY (2026-10-20).
//
// The bare /chat is public to look at (#978, lib/app-entry isPublicAppPath)
// and its banner promises "Ask anything — no wallet needed" (lib/guest-trial).
// A guest's thread is a LOCAL chat (lib/chat-ids: no DB row, ephemeral), and
// the first send used to rewrite the address bar to /chat/<localId> — an open
// thread's address, which the spine's gate reads as the signed-in app's and
// bounces a signed-out visitor home from (AppSpine, #757). The guest's turn
// was counted, the answer never shown, and the visitor stood on `/`.
//
// Now a local thread keeps the bare /chat (lib/chat-ids chatHrefFor): only a
// DB-backed thread has an address of its own. This drive is the proof in a
// real browser: headless Chrome over CDP, a fresh profile, NO wallet provider,
// no cookies — the stranger of the funnel.
//
//   BASE=http://localhost:4360 node scripts/guest-chat-drive.mjs
//
// Env: CHROME (binary), CDP_PORT (default 9461), BASE (the server under test,
// started with MK2_AI_MOCK=1 … like every harness server), WIDTH/HEIGHT
// (1440×900; 375×812 drives the phone posture). The read ask runs
// the real planner (one house answer); the money ask is answered by the swap
// layer's own wall (connect door, ask held) with no model call. Every request
// carries `x-yf-internal-run: 1`, so nothing here reads as a stranger's turn.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9461)
const BASE = process.env.BASE ?? 'http://localhost:4360'
const PROFILE = path.join(os.tmpdir(), `claude-guest-chat-drive-${PORT}`)
/** Viewport. WIDTH=375 HEIGHT=812 runs the phone posture (the rail is a screen there). */
const WIDTH = Number(process.env.WIDTH ?? 1440)
const HEIGHT = Number(process.env.HEIGHT ?? 900)
const HDR = { 'x-yf-internal-run': '1' }
const MONEY_ASK = 'Swap $5 of ETH to USDC'
const READ_ASK = 'What is Pantessa, in one sentence?'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} guest chat: ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** The bare /chat, any query (the rail mirrors `?tab=` into the address bar). Not /chat/<id>, not `/`. */
const onChat = (p) => p.split('?')[0] === '/chat'

for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/chat`, { headers: HDR })).status < 500) break
  } catch {
    /* not up yet */
  }
  await sleep(500)
}

fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
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

async function tab(w = 1440, h = 900) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setExtraHTTPHeaders', { headers: HDR }, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId)
  // Evidence, not behaviour: every history write the page makes, in order,
  // so a bounce names its path (/chat/<localId> from the send, then `/`).
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__hist = []; for (const k of ['pushState', 'replaceState']) { const o = history[k]; history[k] = function (st, t, url) { try { window.__hist.push(k + ' ' + String(url)) } catch {} return o.apply(this, arguments) } } })()` }, sessionId)
  // Key events reach the focused textarea only while the page believes it is
  // focused — a headless page is not, unless told so.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  const ev = async (s) => {
    const r = await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.result?.value
  }
  const go = async (p) => {
    await send('Page.navigate', { url: `${BASE}${p}` }, sessionId)
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
  const mine = (method) => events.filter((e) => e.sessionId === sessionId && e.method === method)
  const errors = () => mine('Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
  /** Every navigation since `since`: document loads (Page.frameNavigated, top
   *  frame) AND the App Router's soft ones (router.replace/push are
   *  history writes — Page.navigatedWithinDocument). */
  const navs = (since = 0) =>
    events
      .filter((e, i) => e.sessionId === sessionId && i >= since)
      .flatMap((e) => {
        if (e.method === 'Page.frameNavigated' && !e.params.frame.parentId && e.params.frame.url) return [new URL(e.params.frame.url)]
        if (e.method === 'Page.navigatedWithinDocument' && e.params.url) return [new URL(e.params.url)]
        return []
      })
      .map((u) => u.pathname + u.search)
  const mark = () => events.length
  /** The page's own history writes in order (who moved the address bar), from the hook installed below. */
  const hist = () => ev(`JSON.stringify(window.__hist ?? [])`)
  /** Type into the guest composer (the textarea whose placeholder starts "Ask" — "Ask your N agents anything…" on a desktop, "Ask anything…" on a phone) and press Send. */
  const ask = async (text) => {
    const focused = await ev(`(() => { const t = [...document.querySelectorAll('textarea')].find((e) => /^Ask /.test(e.placeholder || '')); if (!t) return false; t.focus(); return document.activeElement === t })()`)
    if (!focused) return false
    await send('Input.insertText', { text }, sessionId)
    await sleep(150)
    return ev(`(() => { const b = document.querySelector('button[aria-label="Send"]'); if (!b || b.disabled) return false; b.click(); return true })()`)
  }
  /** The transcript as the visitor reads it: user rows (right-aligned) and assistant rows. */
  const rows = () =>
    ev(`(() => { const all = [...document.querySelectorAll('div')]; const user = all.filter((d) => d.classList.contains('flex-row-reverse') && d.classList.contains('gap-3')).map((d) => d.textContent.trim().slice(0, 120)); const bot = all.filter((d) => d.classList.contains('max-sm:flex-col') && d.classList.contains('gap-3')).map((d) => ({ text: d.textContent.trim().slice(0, 160), door: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /connect/i.test(t)) })); return { user, bot, path: location.pathname + location.search } })()`)
  /** The CHATS list: open beside the chat on a desktop (`?tab=chats` from the start); on a phone it is its own screen behind the bar's CHATS seat. */
  const openRail = async () => {
    if (w >= 768) return true
    // The VISIBLE seat: the desktop column's CHATS seat is in the DOM at every width, hidden on a phone.
    await ev(`[...document.querySelectorAll('a,button')].filter((e) => e.getClientRects().length > 0).find((e) => e.textContent.trim() === 'CHATS')?.click()`)
    return !!(await until(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'New Chat') ? 'open' : null`, 8000))
  }
  return { ev, go, until, errors, navs, mark, hist, ask, rows, openRail, sessionId }
}

try {
  const a = await tab(WIDTH, HEIGHT)
  const phone = WIDTH < 768
  await a.go(phone ? '/chat' : '/chat?tab=chats')
  const banner = await a.until(`/no wallet needed/i.test(document.body.textContent) && [...document.querySelectorAll('textarea')].some((e) => /^Ask /.test(e.placeholder || '')) ? location.pathname + location.search : null`, 20000)
  check(`a stranger on /chat (no wallet, no cookies, ${WIDTH}px) sees the guest banner ("no wallet needed") and the composer, and is not sent home`, !!banner && onChat(banner), String(banner))

  // ── 1. A money ask with no wallet: the swap layer's own wall, the ask held ──
  const m1 = a.mark()
  const sent1 = await a.ask(MONEY_ASK)
  check(`the composer takes "${MONEY_ASK}" and Send is pressed`, sent1 === true, String(sent1))
  const door = await a.until(`(() => { const all = [...document.querySelectorAll('div')]; const bot = all.filter((d) => d.classList.contains('max-sm:flex-col') && d.classList.contains('gap-3')); return bot.some((d) => [...d.querySelectorAll('button')].some((b) => /connect/i.test(b.textContent))) ? location.pathname : null })()`, 25000)
  await sleep(2500) // the bounce, when it comes, comes within ~2s of the send
  const r1 = await a.rows()
  const navs1 = a.navs(m1)
  console.log(`   history writes after the send: ${await a.hist()}`)
  check('the address bar stays on /chat after the send (never /chat/<localId>, never home)', onChat(r1.path) && navs1.every(onChat), `path ${r1.path}, navigations ${JSON.stringify(navs1)}`)
  check('the ask shows as the visitor\'s own bubble', r1.user.some((t) => t.includes(MONEY_ASK)), JSON.stringify(r1.user))
  check('the reply is the swap layer\'s own connect door, the ask held (a Connect button inside the reply, no planner turn)', !!door && r1.bot.some((b) => b.door.length > 0), JSON.stringify(r1.bot))

  // ── 2. The rail: the thread is listed as the guest's, and tapping it stays ──
  check('the CHATS list opens (beside the chat on a desktop; its own screen behind the bar\'s CHATS seat on a phone)', await a.openRail())
  const listed = await a.until(`(() => { const row = [...document.querySelectorAll('div.group.cursor-pointer')].find((d) => d.textContent.includes(${JSON.stringify(MONEY_ASK.slice(0, 30))})); return row ? 'listed' : null })()`, 8000)
  check('the CHATS rail lists the guest\'s thread', listed === 'listed', String(listed))
  const m2 = a.mark()
  await a.ev(`[...document.querySelectorAll('div.group.cursor-pointer')].find((d) => d.textContent.includes(${JSON.stringify(MONEY_ASK.slice(0, 30))}))?.click()`)
  await sleep(2500)
  const r2 = await a.rows()
  const navs2 = a.navs(m2)
  check('tapping the thread in the rail keeps the visitor on /chat with the thread on screen (never /chat/<localId>, never home)', r2.path.startsWith('/chat') && !/^\/chat\/./.test(r2.path) && r2.user.some((t) => t.includes(MONEY_ASK)) && !navs2.some((p) => p === '/' || /^\/chat\/./.test(p)), `path ${r2.path}, navigations ${JSON.stringify(navs2)}, user rows ${JSON.stringify(r2.user)}`)

  // ── 3. A read: the house answers, the visitor stays ──
  const m3 = a.mark()
  const sent3 = await a.ask(READ_ASK)
  check(`the composer takes "${READ_ASK}" and Send is pressed`, sent3 === true, String(sent3))
  const answered = await a.until(`(() => { const all = [...document.querySelectorAll('div')]; const bot = all.filter((d) => d.classList.contains('max-sm:flex-col') && d.classList.contains('gap-3')); const user = all.filter((d) => d.classList.contains('flex-row-reverse') && d.classList.contains('gap-3')); const last = bot[bot.length - 1]; return user.length >= 2 && bot.length >= 2 && last && last.textContent.trim().length > 20 && !/Routing…|Thinking/.test(last.textContent) ? location.pathname : null })()`, 60000)
  await sleep(1500)
  const r3 = await a.rows()
  const navs3 = a.navs(m3)
  check('the read gets a house answer in the thread and the address bar still says /chat', answered === '/chat' && onChat(r3.path) && navs3.every(onChat) && r3.bot.length >= 2, `answered ${answered}, path ${r3.path}, navigations ${JSON.stringify(navs3)}, rows ${JSON.stringify(r3.bot.map((b) => b.text.slice(0, 60)))}`)

  // ── 4. New Chat starts a fresh thread on the same address ──
  const m4 = a.mark()
  await a.openRail()
  await a.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New Chat')?.click()`)
  await sleep(1500)
  const r4 = await a.rows()
  const navs4 = a.navs(m4)
  check('New Chat in the rail clears the screen for a fresh thread and keeps the guest on /chat', r4.user.length === 0 && r4.path.startsWith('/chat') && !navs4.some((p) => p === '/'), `path ${r4.path}, navigations ${JSON.stringify(navs4)}, user rows ${r4.user.length}`)

  const errs = a.errors()
  check('no page exceptions along the way', errs.length === 0, errs.slice(0, 3).join(' | '))
} finally {
  ws.close()
  // Let Chrome finish writing its profile before the directory goes (an rm
  // under a closing browser races ENOTEMPTY).
  const gone = new Promise((r) => chrome.once('exit', r))
  chrome.kill()
  await Promise.race([gone, sleep(5000)])
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* a profile left in tmp is not a finding */
  }
}

console.log(`\n${pass} passed, ${fail} failed (${BASE})`)
process.exit(fail ? 1 : 0)
