// THE JOBS RAIL'S EMPTY STATE, SEEN (squad lane1, the jobs audit, 2026-11-17;
// lane OFFERS). Adapted from scripts/apps-page-shot.mjs: headless Chrome over
// CDP opens the JOBS rail and prints which state the offer door is in, its
// words and its one control, and takes a screenshot.
//
//   BASE=http://localhost:4801 node scripts/jobs-offers-shot.mjs --w=1440 --h=900 --out=/abs/shot.png
//   NOWALLET=1 …            no wallet at all (a stranger)
//   WALLET=0x… …            a watch-only wallet on that address, NO session
//   (neither)               the .env.local burner, signed in
//   STUB='{"8453":[0,0],"42161":[40,0.001]}' …   answer /api/wallet/balances
//                           from this table (chainId -> [USDC, ETH]; chains
//                           left out read empty) instead of the chain, to see
//                           a state no test wallet is in. Said in the output.
// Every request carries `x-yf-internal-run: 1`. A watch-only wallet cannot
// sign and this script presses nothing: nothing here can move money.
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
const BASE = process.env.BASE ?? 'http://localhost:4801'
const W = Number(arg('w', 1440))
const H = Number(arg('h', 900))
const WAIT = Number(arg('wait', 9000))
const APPS = arg('apps', 'uniswap-free')
const PATH = arg('path', '/chat?tab=jobs')
const OUT = arg('out')
const PROFILE = `/tmp/claude-jobs-offers-shot-${PORT}`
const NOWALLET = process.env.NOWALLET === '1'
const STUB = process.env.STUB ? JSON.parse(process.env.STUB) : null
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
if (!address && !NOWALLET) {
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
  if (!NOWALLET) await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(address) }, sessionId)
  if (STUB) {
    // Answer the balances read from the table (see the header).
    const NAMES = { 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism', 1: 'Ethereum', 4663: 'Robinhood Chain' }
    const bodyJson = JSON.stringify({
      address: String(address).toLowerCase(), at: new Date().toISOString(), ethUsd: 2000,
      chains: Object.keys(NAMES).map((id) => { const v = STUB[id]; return v === 'fail' ? { id: Number(id), name: NAMES[id], ok: false } : { id: Number(id), name: NAMES[id], ok: true, nativeEth: v ? v[1] : 0, stable: { symbol: Number(id) === 4663 ? 'USDG' : 'USDC', balance: v ? v[0] : 0 } } }),
    })
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/wallet/balances*' }] }, sessionId)
    const prev = ws.onmessage
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.method === 'Fetch.requestPaused') {
        ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', sessionId, params: { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(bodyJson).toString('base64') } }))
        return
      }
      prev(m)
    }
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

  const phoneTab = arg('phonetab')
  if (phoneTab && phoneTab !== true) {
    await ev(`(() => { const b = [...document.querySelectorAll('button, a')].find((e) => (e.textContent || '').trim().toUpperCase() === ${JSON.stringify(String(phoneTab).toUpperCase())} && e.getBoundingClientRect().width > 0); if (b) b.click() })()`)
    await sleep(1500)
  }
  const m = await ev(`(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 }
    const doors = [...document.querySelectorAll('[data-job-offer]')].filter(vis)
    return {
      url: location.pathname + location.search,
      viewport: [innerWidth, innerHeight],
      stubbed: ${STUB ? 'true' : 'false'},
      doors: doors.map((d) => {
        const b = d.getBoundingClientRect()
        const card = d.querySelector('[data-door="jobs"]')
        const ctl = card ? [...card.querySelectorAll('.door__acts button, .door__acts a')].map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim(), act: e.getAttribute('data-door-act'), title: e.getAttribute('title'), href: e.getAttribute('href'), h: Math.round(e.getBoundingClientRect().height) })) : []
        return { state: d.getAttribute('data-job-offer'), box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], inView: b.y >= 0 && b.bottom <= innerHeight + 1, eyebrow: (card && card.querySelector('.door__eyebrow') || {}).textContent || null, text: (card && card.querySelector('.door__text') || d).textContent, controls: ctl }
      }),
      jobRows: [...document.querySelectorAll('[data-job-row]')].filter(vis).map((e) => e.getAttribute('data-job-row')),
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
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
    if (!m.doors.length) bad.push('no job offer door on screen')
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
