// THE APPS PAGE, SEEN (squad apps-page, 2026-11-17): headless Chrome over CDP
// (Node's own WebSocket — no Playwright on this Mac) opens /chat as a
// connected wallet, takes a screenshot and prints what it measured, so every
// lane can LOOK at its own work and the gate can assert the one promise that
// no source pin can see: the chat is on screen at every scroll position.
//
// Signed in the way the harness signs in (the .env.local burner's SIWE cookie
// + a watch-only EIP-6963 wallet on the same address). Every request carries
// `x-yf-internal-run: 1`. A watch-only wallet cannot sign: nothing here can
// move money.
//
// Usage (server under test must be `next start`, never the dev server):
//   BASE=http://localhost:4700 node scripts/apps-page-shot.mjs \
//     --apps=uniswap-free            (comma list of slugs → /chat?mcps=…)
//     --w=1440 --h=900               (viewport; --w=390 --h=844 is the phone)
//     --out=/abs/path/shot.png       (omit → no screenshot)
//     --wait=9000                    (ms to let the scan settle)
//     --scroll=bottom                (scroll the page's scroller before the shot)
//     --chat=closed                  (close the dock first; default leaves it)
//     --click='[data-apps-browse]'   (click a selector before the shot)
//     --ask='What is my biggest position?'  (type into the composer, no send)
//     --path=/chat?tab=mcps          (override the whole path)
//     --ls='key=value'               (write one localStorage entry before the page's scripts run;
//                                     ADDR in key or value becomes the watched address, lowercased)
//     --assert                       (exit 1 unless the page's promises hold)
// WALLET=0x… watches another address with NO session (connect-only).
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
const PROFILE = `/tmp/claude-apps-page-shot-${PORT}`
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
  const ls = arg('ls')
  if (ls && ls !== true) {
    const [k, v] = [ls.slice(0, ls.indexOf('=')), ls.slice(ls.indexOf('=') + 1)].map((x) => x.replaceAll('ADDR', address.toLowerCase()))
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})}catch{}` }, sessionId)
  }
  const phone = W < 1024
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 2 : 1, mobile: phone }, sessionId)
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  const ev = async (s) => {
    const r = await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.result?.value
  }
  await send('Page.navigate', { url: `${BASE}${PATH}` }, sessionId)
  await sleep(WAIT)

  if (arg('chat') === 'closed') {
    await ev(`(() => { const b = document.querySelector('[data-dock-close]'); if (b) b.click() })()`)
    await sleep(400)
  }
  const click = arg('click')
  if (click && click !== true) {
    await ev(`(() => { const b = document.querySelector(${JSON.stringify(click)}); if (b) b.click() })()`)
    await sleep(700)
  }
  const ask = arg('ask')
  if (ask && ask !== true) {
    await ev(`(() => { const t = document.querySelector('[data-composer-input]'); if (!t) return; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(ask)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await sleep(300)
  }
  if (arg('scroll') === 'bottom') {
    await ev(`(() => { const s = document.querySelector('[data-apps-scroll]') || document.querySelector('[data-app-scroll]'); if (s) s.scrollTop = s.scrollHeight })()`)
    await sleep(500)
  }

  const m = await ev(`(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), shown: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 } }
    const inView = (b) => !!b && b.shown && b.y >= 0 && b.y + b.h <= innerHeight + 1 && b.x >= 0 && b.x + b.w <= innerWidth + 1
    const page = document.querySelector('[data-apps-page]')
    const scroller = document.querySelector('[data-apps-scroll]')
    const composer = r('[data-chat-dock] [data-composer-pill]') || r('[data-composer-pill]')
    const askbar = r('[data-apps-askbar]')
    return {
      url: location.pathname + location.search,
      viewport: [innerWidth, innerHeight],
      appsPage: !!page,
      density: page ? page.getAttribute('data-density') : null,
      chat: page ? page.getAttribute('data-chat') : null,
      chips: [...document.querySelectorAll('[data-apps-chip][aria-pressed="true"]')].map((e) => e.getAttribute('data-apps-chip')),
      sections: [...document.querySelectorAll('[data-apps-section]')].map((e) => e.getAttribute('data-apps-section')),
      lines: [...document.querySelectorAll('[data-apps-line]')].map((e) => e.getAttribute('data-apps-line')),
      needs: document.querySelector('[data-apps-needs]') ? Number(document.querySelector('[data-apps-needs]').getAttribute('data-apps-needs')) : 0,
      headline: (document.querySelector('.apg-headline') || {}).textContent || null,
      scroller: scroller ? { top: Math.round(scroller.scrollTop), height: scroller.clientHeight, content: scroller.scrollHeight } : null,
      dock: r('[data-chat-dock]'),
      composer, composerInView: inView(composer),
      askbar, askbarInView: inView(askbar),
      chatInReach: inView(composer) || inView(askbar),
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      docScrollY: document.documentElement.scrollHeight - innerHeight,
      splashCards: document.querySelectorAll('[data-splash-card]').length,
      drawer: !!document.querySelector('aside .apprail__toggle'),
    }
  })()`)
  const errors = events.filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? e.params.exceptionDetails?.text)
  console.log(JSON.stringify({ ...m, pageErrors: errors }, null, 2))

  if (OUT && OUT !== true) {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
    console.log(`shot → ${OUT}`)
  }
  if (arg('assert')) {
    const bad = []
    if (errors.length) bad.push(`page errors: ${errors.join(' | ')}`)
    if (m.docOverflowX > 0) bad.push(`the document overflows sideways by ${m.docOverflowX}px`)
    if (!phone && !m.appsPage) bad.push('the apps page is not showing')
    if (!phone && !m.chatInReach) bad.push('neither the dock\'s composer nor the pinned ask bar is fully on screen')
    if (!phone && m.splashCards > 0) bad.push('splash cards rendered beside the apps page')
    for (const b of bad) console.log(`❌ ${b}`)
    if (!bad.length) console.log('✅ the page\'s promises hold')
    exitCode = bad.length ? 1 : 0
  }
  ws.close()
} finally {
  chrome.kill()
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
process.exit(exitCode)
