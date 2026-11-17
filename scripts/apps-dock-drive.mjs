// THE DOCK, DRIVEN (squad apps-page, DOCK lane, 2026-11-17): headless Chrome
// over CDP opens the apps page as a connected wallet (the same scaffolding as
// scripts/apps-page-shot.mjs), SENDS real asks into the docked chat, waits for
// each answer, screenshots it and asserts the dock's promises:
//   - nothing in the dock scrolls sideways (the thread scroller, and no
//     element in the thread reaches past the dock's right edge),
//   - the composer is fully on screen after the answer,
//   - the PAGE's own scroller did not move because the chat did.
// Every request carries `x-yf-internal-run: 1`. A watch-only wallet cannot
// sign: a money ask comes back as the card, nothing moves.
//
//   BASE=http://localhost:4714 node scripts/apps-dock-drive.mjs \
//     --apps=uniswap-free --w=1440 --h=900 \
//     --asks='What is my biggest position?||Swap $5 of ETH to USDC on Base' \
//     --out=/abs/dir/prefix          (writes <prefix>-1.png, -2.png, …)
//     --timeout=60000                (ms to wait for each answer)
//     --shortcut                     (first: close the dock, press "/", expect it open + focused)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const arg = (name, dflt = null) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9000 + Math.floor(Math.random() * 900))
const BASE = process.env.BASE ?? 'http://localhost:4700'
const W = Number(arg('w', 1440))
const H = Number(arg('h', 900))
const WAIT = Number(arg('wait', 9000))
const APPS = arg('apps', 'uniswap-free')
const PATH = arg('path', `/chat?mcps=${APPS}`)
const OUT = arg('out')
const PROFILE = `/tmp/claude-apps-dock-drive-${PORT}`
const HDR = { 'x-yf-internal-run': '1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function burnerKey() {
  const env = fs.readFileSync('.env.local', 'utf8')
  const pk = (env.match(/^PRIVATE_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^"|"$/g, '')
  if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
  return pk.startsWith('0x') ? pk : `0x${pk}`
}
function cookie(res, name) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return m[1]
  }
  return null
}
async function signIn(account) {
  const n = await fetch(`${BASE}/api/auth/nonce`, { headers: HDR })
  const nonceCookie = cookie(n, 'yf_siwe_nonce')
  const { nonce } = await n.json()
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const v = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...HDR, ...(nonceCookie ? { cookie: `yf_siwe_nonce=${nonceCookie}` } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = cookie(v, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${v.status})`)
  return session
}
const mockWallet = (addr) => `(() => { const ADDR='${addr}'; const provider={request:async({method})=>{ if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR]; if(method==='eth_chainId')return'0x2105'; if(method==='wallet_switchEthereumChain')return null; throw new Error('unsupported: '+method)}, on:()=>{}, removeListener:()=>{} };
  const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000001',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})); window.addEventListener('eip6963:requestProvider',announce); announce();
  try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{} })()`

for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: HDR })).status < 500) break
  } catch {
    /* not up yet */
  }
  await sleep(500)
}
let address = process.env.WALLET ?? null
let session = null
if (!address) {
  const account = privateKeyToAccount(burnerKey())
  address = account.address
  session = await signIn(account)
}

fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
let exitCode = 0
try {
  let v = null
  for (let i = 0; i < 50 && !v; i++) {
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
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setExtraHTTPHeaders', { headers: HDR }, sessionId)
  if (session) await send('Network.setCookie', { name: 'yf_session', value: session, url: BASE }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(address) }, sessionId)
  const phone = W < 1024
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 2 : 1, mobile: phone }, sessionId)
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  const ev = async (s) => {
    const r = await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.result?.value
  }

  await send('Page.navigate', { url: `${BASE}${PATH}` }, sessionId)
  await sleep(WAIT)
  const pageReady = await ev(`!!document.querySelector('[data-apps-page]') && !!document.querySelector('[data-chat-dock="open"] [data-composer-input]')`)
  if (!pageReady) throw new Error('the apps page with an open dock is not showing')

  // Scroll the PAGE a little first, so "the chat did not move the page" means something.
  const pageTop0 = await ev(`(() => { const s = document.querySelector('[data-apps-scroll]'); if (!s) return null; s.scrollTop = Math.min(240, s.scrollHeight - s.clientHeight); return Math.round(s.scrollTop) })()`)

  const MEASURE = `(() => {
    const dock = document.querySelector('[data-chat-dock]')
    const d = dock.getBoundingClientRect()
    const bubbles = [...dock.querySelectorAll('[data-bubble]')]
    let scroller = null
    for (let e = bubbles[0]?.parentElement; e && e !== dock; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') { scroller = e; break }
    }
    const pill = dock.querySelector('[data-composer-pill]')
    const p = pill ? pill.getBoundingClientRect() : null
    const past = []
    if (scroller) {
      for (const el of scroller.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > d.right + 1) {
          // Clipped by an ancestor that scrolls sideways on purpose (a code block, a wide table)?
          let clip = null
          for (let a = el.parentElement; a && a !== scroller; a = a.parentElement) {
            const ox = getComputedStyle(a).overflowX
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { clip = a; break }
          }
          if (clip && clip.getBoundingClientRect().right <= d.right + 1) continue
          past.push((el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')).slice(0, 90) + ' +' + Math.round(r.right - d.right) + 'px')
        }
      }
    }
    const inner = scroller ? [...scroller.querySelectorAll('*')].filter((el) => { const ox = getComputedStyle(el).overflowX; return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1 }).map((el) => el.tagName.toLowerCase() + ' ' + el.scrollWidth + '/' + el.clientWidth) : []
    const s = document.querySelector('[data-apps-scroll]')
    const last = bubbles.filter((b) => b.getAttribute('data-bubble') === 'assistant').pop()
    return {
      dock: [Math.round(d.x), Math.round(d.width)],
      bubbles: bubbles.length,
      assistants: bubbles.filter((b) => b.getAttribute('data-bubble') === 'assistant').length,
      lastText: last ? last.innerText.slice(0, 160).replace(/\\s+/g, ' ') : null,
      threadScrollX: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
      pastDock: past.slice(0, 12),
      innerScrollers: inner.slice(0, 6),
      composerInView: !!p && p.top >= 0 && p.bottom <= innerHeight + 1 && p.left >= d.left - 1 && p.right <= d.right + 1,
      pageTop: s ? Math.round(s.scrollTop) : null,
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      height: scroller ? scroller.scrollHeight : 0,
    }
  })()`

  const bad = []
  if (arg('shortcut')) {
    await ev(`document.querySelector('[data-dock-close]').click()`)
    await sleep(500)
    const closed = await ev(`document.querySelector('[data-apps-page]').getAttribute('data-chat')`)
    await ev(`document.activeElement && document.activeElement.blur()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191, text: '/' }, sessionId)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 }, sessionId)
    await sleep(600)
    const after = await ev(`({ chat: document.querySelector('[data-apps-page]').getAttribute('data-chat'), focused: document.activeElement === document.querySelector('[data-chat-dock] [data-composer-input]'), value: document.querySelector('[data-chat-dock] [data-composer-input]').value })`)
    console.log(JSON.stringify({ shortcut: { closedFirst: closed, ...after } }))
    if (closed !== 'closed' || after.chat !== 'open' || !after.focused || after.value !== '') bad.push(`"/" did not open the dock with the composer focused and empty: ${JSON.stringify(after)}`)
  }
  const asks = String(arg('asks', 'What is my biggest position?')).split('||').map((a) => a.trim()).filter(Boolean)
  const TIMEOUT = Number(arg('timeout', 60000))
  let n = 0
  for (const ask of asks) {
    n += 1
    const before = await ev(MEASURE)
    await ev(`document.querySelector('[data-chat-dock] [data-composer-input]').focus()`)
    await send('Input.insertText', { text: ask }, sessionId)
    await sleep(150)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' }, sessionId)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId)
    // Wait for a new answer, then for the thread to stop growing.
    const t0 = Date.now()
    let m = before
    let stableSince = 0
    let lastSig = ''
    while (Date.now() - t0 < TIMEOUT) {
      await sleep(500)
      m = await ev(MEASURE)
      const sig = `${m.assistants}|${m.height}|${m.lastText}`
      if (m.assistants > before.assistants) {
        if (sig === lastSig) {
          if (!stableSince) stableSince = Date.now()
          if (Date.now() - stableSince > 3000) break
        } else stableSince = 0
      }
      lastSig = sig
    }
    await sleep(400)
    m = await ev(MEASURE)
    const answered = m.assistants > before.assistants
    console.log(JSON.stringify({ ask, answered, waitedMs: Date.now() - t0, ...m }, null, 2))
    if (OUT && OUT !== true) {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
      fs.writeFileSync(`${OUT}-${n}.png`, Buffer.from(shot.result.data, 'base64'))
      console.log(`shot → ${OUT}-${n}.png`)
    }
    if (!answered) bad.push(`"${ask}": no answer within ${TIMEOUT}ms`)
    if (m.threadScrollX > 0) bad.push(`"${ask}": the thread scrolls sideways by ${m.threadScrollX}px`)
    if (m.pastDock.length) bad.push(`"${ask}": past the dock's edge: ${m.pastDock.join(' | ')}`)
    if (!m.composerInView) bad.push(`"${ask}": the composer is not fully on screen`)
    if (pageTop0 != null && m.pageTop !== pageTop0) bad.push(`"${ask}": the page's scroller moved ${pageTop0} → ${m.pageTop}`)
    if (m.docOverflowX > 0) bad.push(`"${ask}": the document overflows sideways by ${m.docOverflowX}px`)
  }
  const errors = events.filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? e.params.exceptionDetails?.text)
  if (errors.length) bad.push(`page errors: ${errors.join(' | ')}`)
  for (const b of bad) console.log(`❌ ${b}`)
  if (!bad.length) console.log(`✅ the dock held for ${asks.length} ask(s)`)
  exitCode = bad.length ? 1 : 0
  ws.close()
} finally {
  chrome.kill()
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
process.exit(exitCode)
