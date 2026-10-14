// THE ONE PICK'S READS, counted (2026-10-13; the follow-up QA's FINAL gate filed):
// a signed-in visitor opens `/`, `/live` and `/live?view=front`, and headless
// Chrome over CDP (Node's own WebSocket — no Playwright on this Mac) counts
// every `GET /api/watchlists` the page makes. Before: one per
// `useMarketPick()` instance (six on `/`, two on `/live`). After: ONE per
// page — one subscriber (components/live/PickReads) owns the watchlist +
// holdings reads and every surface reads the store.
//
// Signed in the way the harness signs in (scripts/test-api.ts signIn): the
// .env.local burner's real SIWE session cookie + a watch-only EIP-6963 wallet
// announcing the same address (without a wallet the page ends an orphan
// session — lib/session). Every request carries `x-yf-internal-run: 1`.
//
//   1. `/`               — GET /api/watchlists ×1 in the first 10s (6 before)
//   2. `/` → Front       — switching the deck to a channel that mounts another
//                           instance adds NO read (7 before)
//   3. `/live`           — ×1 (2 before)
//   4. `/live?view=front`— ×1 (2 before), and the field opens FROM YOUR WATCHLIST:
//                           the lifted read still feeds the opening (openingPick)
//   5. no page exceptions, no failed /api/watchlists answers
// Usage: BASE=http://localhost:4041 node scripts/pick-reads-drive.mjs
//        EXPECT_HOME=6 EXPECT_LIVE=2 … to pin a BASE build's numbers instead.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9443)
const BASE = process.env.BASE ?? 'http://localhost:4041'
const EXPECT_HOME = Number(process.env.EXPECT_HOME ?? 1)
const EXPECT_LIVE = Number(process.env.EXPECT_LIVE ?? 1)
const EXPECT_FRONT = Number(process.env.EXPECT_FRONT ?? 1)
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 10000)
const PROFILE = `/tmp/claude-pick-reads-drive-${PORT}`
const HDR = { 'x-yf-internal-run': '1' }

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} pick reads: ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── The session: the harness's SIWE recipe, as a browser cookie ─────────────
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
// A watch-only wallet on the burner's address (the gate's recipe): wagmi
// reconnects to it, so the session is a connected one, not an orphan.
const mockWallet = (addr) => `(() => { const ADDR='${addr}'; const provider={request:async({method})=>{ if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR]; if(method==='eth_chainId')return'0x2105'; if(method==='wallet_switchEthereumChain')return null; throw new Error('unsupported: '+method)}, on:()=>{}, removeListener:()=>{} };
  const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000001',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})); window.addEventListener('eip6963:requestProvider',announce); announce();
  try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{} })()`

// ── Chrome over CDP ─────────────────────────────────────────────────────────
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: HDR })).status < 500) break
  } catch {
    /* not up yet */
  }
  await sleep(500)
}
const account = privateKeyToAccount(burnerKey())
const session = await signIn(account)
console.log(`signed in as ${account.address.slice(0, 6)}…${account.address.slice(-4)} on ${BASE}`)

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
  await send('Network.setCookie', { name: 'yf_session', value: session, url: BASE }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(account.address) }, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId)
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
  const mine = (method) => events.filter((e) => e.sessionId === sessionId && e.method === method)
  /** `GET /api/watchlists` (the lists route exactly — not /holdings, not /alerts) since `since`. */
  const listReads = (since = 0) =>
    mine('Network.requestWillBeSent').filter((e) => {
      const u = new URL(e.params.request.url)
      return e.params.request.method === 'GET' && u.origin === new URL(BASE).origin && u.pathname === '/api/watchlists' && e.params.wallTime * 1000 >= since
    })
  const failedLists = () =>
    mine('Network.responseReceived').filter((e) => new URL(e.params.response.url).pathname.startsWith('/api/watchlists') && e.params.response.status >= 400).map((e) => `${e.params.response.status} ${new URL(e.params.response.url).pathname}`)
  const errors = () => mine('Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
  return { ev, go, until, listReads, failedLists, errors }
}

try {
  const a = await tab()

  // ── 1. `/` ────────────────────────────────────────────────────────────
  await a.go('/')
  await a.until(`document.querySelector('.deck') && document.querySelectorAll('.pulse__markets .pulse__m').length > 3`)
  await sleep(WINDOW_MS)
  const home = a.listReads().length
  const signedIn = await a.ev(`document.documentElement.hasAttribute('data-spine') && !/Sign in\\b/.test(document.querySelector('.mkt-frame__acct')?.textContent ?? '')`)
  check(`\`/\` signed in makes GET /api/watchlists ×${EXPECT_HOME} in its first ${WINDOW_MS / 1000}s (counted ${home})`, home === EXPECT_HOME, `counted ${home}`)
  check('…and the visitor really is signed in (no Sign in door in the top strip, the spine on)', signedIn === true, String(signedIn))

  // ── 2. a channel that mounts another instance adds no read ───────────
  const t2 = Date.now()
  await a.ev(`document.querySelector('.deck [data-channel="front"]').click()`)
  await a.until(`document.querySelector('.battle--stage .battle__count')`, 20000)
  await sleep(4000)
  const afterSwitch = a.listReads(t2).length
  check(`switching the deck to The Front (a fresh surface, a fresh PickSheet seat) adds ${EXPECT_HOME === 1 ? 'NO' : 'one'} read (counted ${afterSwitch} more)`, afterSwitch === (EXPECT_HOME === 1 ? 0 : 1), `counted ${afterSwitch}`)
  const stageCount = await a.until(`(() => { const t = document.querySelector('.battle--stage .battle__count')?.textContent ?? ''; return /from your/.test(t) ? t : null })()`, 12000)
  check('…and the deck\'s Front opens from the signed-in reads the subscriber published (the count line names your watchlist or your wallet)', !!stageCount && /from your (watchlist|wallet)/.test(stageCount), String(stageCount))

  // ── 3. `/live` ────────────────────────────────────────────────────────
  const b = await tab()
  await b.go('/live')
  await b.until(`document.querySelectorAll('.live__markets .live__m').length > 1`, 20000)
  await sleep(WINDOW_MS)
  const live = b.listReads().length
  check(`\`/live\` signed in makes GET /api/watchlists ×${EXPECT_LIVE} (counted ${live})`, live === EXPECT_LIVE, `counted ${live}`)

  // ── 4. `/live?view=front` opens from the watchlist ───────────────────
  const c = await tab()
  await c.go('/live?view=front')
  await c.until(`document.querySelectorAll('.battle__table tbody tr').length >= 1 && !document.querySelector('.battle__empty')`, 25000)
  await sleep(WINDOW_MS)
  const front = c.listReads().length
  check(`\`/live?view=front\` signed in makes GET /api/watchlists ×${EXPECT_FRONT} (counted ${front})`, front === EXPECT_FRONT, `counted ${front}`)
  const countLine = await c.ev(`document.querySelector('.battle__count')?.textContent ?? ''`)
  check('The Front opens "from your watchlist" (or your wallet): the lifted read feeds openingPick exactly as before', /from your (watchlist|wallet)/.test(countLine), countLine)
  const memory = await c.ev(`localStorage.getItem('pantessa.markets.pick.v1')`)
  check('a default opening is never written as a hand\'s (the memory stays empty)', memory === null, String(memory))

  // ── 5. clean ──────────────────────────────────────────────────────────
  const errs = [...a.errors().map((e) => `[/] ${e}`), ...b.errors().map((e) => `[/live] ${e}`), ...c.errors().map((e) => `[/live?view=front] ${e}`)]
  const bad = [...a.failedLists(), ...b.failedLists(), ...c.failedLists()]
  check('no page exceptions on any surface, no failed /api/watchlists answer', errs.length === 0 && bad.length === 0, [...errs, ...bad].slice(0, 3).join(' | '))
} catch (e) {
  check('the drive ran to the end', false, String(e?.stack ?? e))
} finally {
  console.log(`\npick reads drive: ${pass} passed / ${fail} failed`)
  ws.close()
  chrome.kill('SIGKILL')
  fs.rmSync(PROFILE, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
