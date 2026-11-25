// A SYMBOL PAGE'S ASKS RUN IN THE APP, driven in a real browser (2026-11-16).
// Nate on /t/AAPL: "let's not direct AI chat buys or questions to an embed,
// let's send them to the app page and make sure to add the correct MCPs the
// user will need to run the prompt."
//
// Headless Chrome over CDP (Node's own WebSocket — no Playwright on this Mac),
// signed in the way the harness signs in (the .env.local burner's SIWE cookie +
// a watch-only EIP-6963 wallet on the same address). Every `POST /api/chat` is
// CAUGHT AND ANSWERED BY THE DRIVE (CDP Fetch): the drive proves what the
// browser sends and where — the route's builds are the harness's job — and no
// turn reaches the planner, so nothing can spend.
//
//   1. /t/AAPL, the rail ticket's Buy  → lands on the bare /chat, ONE turn fires
//      with the ticket's sentence, and the set carries Robinhood + NEAR Intents
//   2. /t/AAPL, the say row's question → /chat, the turn names the symbol
//      ("… (AAPL)"), the set carries Robinhood
//   3. /t/UNI, ⌘K → the sheet is a composer; its send closes it, mounts no chat
//      runtime on the page, and fires on /chat with Uniswap in the set
//   4. the symbol page itself mounts no chat runtime (no inline order ticket)
//   5. a visitor with no wallet: Buy opens the connect door and nothing leaves
//      the page; a question lands in /chat's composer, parked, never fired
//   6. no page exceptions
// Usage: BASE=http://localhost:4530 node scripts/symbol-ask-drive.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9453)
const BASE = process.env.BASE ?? 'http://localhost:4530'
const PROFILE = `/tmp/claude-symbol-ask-drive-${PORT}`
const HDR = { 'x-yf-internal-run': '1' }

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} symbol ask: ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
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
const mockWallet = (addr) => `(() => { const ADDR='${addr}'; const provider={request:async({method})=>{ if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR]; if(method==='eth_chainId')return'0x2105'; if(method==='wallet_switchEthereumChain')return null; if(method==='wallet_getPermissions'||method==='wallet_requestPermissions')return[{parentCapability:'eth_accounts'}]; throw Object.assign(new Error('watch-only wallet: '+method),{code:4200}) },on:()=>{},removeListener:()=>{}};
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
const chatPosts = new Map() // sessionId → [{ message, slugs, names }]
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params, sessionId }))
  })
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
    return
  }
  if (d.method === 'Fetch.requestPaused') {
    // Every chat turn stops here: recorded, answered by the drive, never sent on.
    const req = d.params.request
    let body = {}
    try {
      body = JSON.parse(req.postData ?? '{}')
    } catch {
      /* recorded as empty */
    }
    const rows = Array.isArray(body.activeServers) ? body.activeServers : []
    const list = chatPosts.get(d.sessionId) ?? []
    list.push({ message: body.message, slugs: rows.map((r) => r.slug), names: rows.map((r) => r.name) })
    chatPosts.set(d.sessionId, list)
    const answer = Buffer.from(JSON.stringify({ reply: 'Caught by the drive: this turn never reached the planner.' })).toString('base64')
    void send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: answer }, d.sessionId)
    return
  }
  events.push(d)
}

async function tab({ signedIn = true, w = 1440, h = 900 } = {}) {
  const ctx = signedIn ? {} : { browserContextId: (await send('Target.createBrowserContext')).result.browserContextId }
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank', ...ctx })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setExtraHTTPHeaders', { headers: HDR }, sessionId)
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/chat', requestStage: 'Request' }] }, sessionId)
  if (signedIn) {
    await send('Network.setCookie', { name: 'yf_session', value: session, url: BASE }, sessionId)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(account.address) }, sessionId)
  }
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
  const until = async (expr, ms = 25000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const val = await ev(expr).catch(() => null)
      if (val) return val
      await sleep(250)
    }
    return null
  }
  const type = async (text) => send('Input.insertText', { text }, sessionId)
  const key = async (k, extra = {}) => {
    const base = { key: k, code: k === 'Enter' ? 'Enter' : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k === 'Enter' ? 13 : k.toUpperCase().charCodeAt(0), ...extra }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: '\r' } : {}) }, sessionId)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId)
  }
  const posts = () => chatPosts.get(sessionId) ?? []
  const errors = () => events.filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
  return { ev, go, until, type, key, posts, errors }
}

const here = `location.pathname + location.search`
const has = (list, re) => list.some((s) => re.test(String(s)))
const RUNTIME = `!!document.querySelector('.mk-ask__ticket, .mk-ask__runtime, .askdoor__runtime')`
const walletHere = `!/Sign in\\b|Connect\\b/.test(document.querySelector('.mkt-frame__acct')?.textContent ?? 'Sign in')`

try {
  // ── 1. the rail ticket's Buy ──────────────────────────────────────────
  const a = await tab()
  await a.go('/t/AAPL')
  const ask1 = await a.until(`(() => { const b = document.querySelector('.mkt-railticket .mkt-ticket__send[data-ask]'); return b && !b.disabled ? b.getAttribute('data-ask') : null })()`)
  await a.until(walletHere, 15000)
  check('the rail ticket on /t/AAPL offers a sized buy', /^Buy \$\d[\d.,]* of AAPL$/.test(ask1 ?? ''), String(ask1))
  check('the symbol page mounts no chat runtime (no inline order ticket) before the press', (await a.ev(RUNTIME)) === false)
  await a.ev(`document.querySelector('.mkt-railticket .mkt-ticket__send[data-ask]').click()`)
  const landed1 = await a.until(`location.pathname === '/chat' ? (${here}) : null`, 15000)
  check('the Buy lands on the bare /chat (the app), never a ?prompt= URL', landed1 === '/chat', String(landed1 ?? (await a.ev(here))))
  await a.until(`false`, 500)
  const fired1 = await (async () => {
    const end = Date.now() + 25000
    while (Date.now() < end && a.posts().length === 0) await sleep(250)
    return a.posts()
  })()
  check('…and ONE turn fires there with the ticket\'s sentence, unprompted', fired1.length === 1 && fired1[0].message === ask1, JSON.stringify(fired1.map((p) => p.message)))
  check('…with Robinhood (the venue that trades AAPL) and NEAR Intents (the funding companion) ON in the set', has(fired1[0]?.slugs ?? [], /robinhood/) && (has(fired1[0]?.slugs ?? [], /near-intents/) || has(fired1[0]?.names ?? [], /near\s?intents/i)), JSON.stringify(fired1[0]?.slugs))

  // A conversation that opens on an ask is the ask's: no wallet or app card
  // above it, and none under the reply when the wallet's saved apps land
  // after the send (Nate, 2026-11-25: the Pantessa Wallet card under a job).
  await sleep(6000)
  const cards1 = await a.ev(`[...document.querySelectorAll('[data-splash-card]')].map((c) => c.getAttribute('data-splash-card')).join(',')`)
  check('…and no dashboard card paints in that conversation, above the ask or under the reply', cards1 === '', String(cards1))

  // ── 2. the say row's question ─────────────────────────────────────────
  const b = await tab()
  await b.go('/t/AAPL')
  await b.until(`document.querySelector('.mkt-railticket__in')`)
  await b.until(walletHere, 15000)
  await b.ev(`document.querySelector('.mkt-railticket__in').focus()`)
  await b.type('why is it moving?')
  await b.key('Enter')
  const landed2 = await b.until(`location.pathname === '/chat' ? (${here}) : null`, 15000)
  const fired2 = await (async () => {
    const end = Date.now() + 25000
    while (Date.now() < end && b.posts().length === 0) await sleep(250)
    return b.posts()
  })()
  check('a question typed in the rail\'s say row lands on /chat and fires, naming its symbol', landed2 === '/chat' && fired2.length === 1 && fired2[0].message === 'why is it moving? (AAPL)', `${landed2} ${JSON.stringify(fired2.map((p) => p.message))}`)
  check('…with Robinhood ON for its reads', has(fired2[0]?.slugs ?? [], /robinhood/), JSON.stringify(fired2[0]?.slugs))

  // ── 3. ⌘K on /t/UNI ───────────────────────────────────────────────────
  const c = await tab()
  await c.go('/t/UNI')
  await c.until(`document.querySelector('[data-ask-door="rail"]')`)
  await c.until(walletHere, 15000)
  await c.ev(`document.querySelector('[data-ask-door="rail"]').click()`)
  const sheet = await c.until(`!!document.querySelector('.askdoor__input')`, 8000)
  check('⌘K / Ask on /t/UNI opens the sheet as a composer', sheet === true)
  await c.ev(`document.querySelector('.askdoor__input').focus()`)
  await c.type('Buy $25 of UNI')
  await c.key('Enter')
  await sleep(400)
  const runtimeOnPage = await c.ev(RUNTIME)
  const landed3 = await c.until(`location.pathname === '/chat' ? (${here}) : null`, 15000)
  const fired3 = await (async () => {
    const end = Date.now() + 25000
    while (Date.now() < end && c.posts().length === 0) await sleep(250)
    return c.posts()
  })()
  check('its send mounts no chat runtime over the chart; it lands on /chat and fires as typed', runtimeOnPage === false && landed3 === '/chat' && fired3.length === 1 && fired3[0].message === 'Buy $25 of UNI', `${runtimeOnPage} ${landed3} ${JSON.stringify(fired3.map((p) => p.message))}`)
  check('…with Uniswap (the page knows UNI is a spot swap; the sentence has no swap word) ON in the set', has(fired3[0]?.slugs ?? [], /uniswap/), JSON.stringify(fired3[0]?.slugs))

  // ── 5. a visitor with no wallet ───────────────────────────────────────
  const g = await tab({ signedIn: false })
  await g.go('/t/AAPL')
  await g.until(`(() => { const x = document.querySelector('.mkt-railticket .mkt-ticket__send[data-ask]'); return x && !x.disabled })()`)
  await g.ev(`document.querySelector('.mkt-railticket .mkt-ticket__send[data-ask]').click()`)
  const doorUp = await g.until(`[...document.querySelectorAll('[role=dialog]')].some((d) => /Connect a wallet/.test(d.textContent))`, 8000)
  check('no wallet: Buy opens the connect door and nothing leaves the page', doorUp === true && (await g.ev(`location.pathname`)) === '/t/AAPL' && g.posts().length === 0, `${doorUp} ${await g.ev(here)}`)
  const g2 = await tab({ signedIn: false })
  await g2.go('/t/AAPL')
  await g2.until(`document.querySelector('.mkt-railticket__in')`)
  await g2.ev(`document.querySelector('.mkt-railticket__in').focus()`)
  await g2.type('why is it moving?')
  await g2.key('Enter')
  const parked = await g2.until(`location.pathname === '/chat' ? ([...document.querySelectorAll('textarea')].map((t) => t.value).find((x) => x) ?? null) : null`, 15000)
  await sleep(2500)
  check('no wallet: a question lands in /chat\'s composer, parked with its symbol, and fires nothing by itself', parked === 'why is it moving? (AAPL)' && g2.posts().length === 0, `${parked} posts ${g2.posts().length}`)

  // ── 6. clean ──────────────────────────────────────────────────────────
  const errs = [...a.errors(), ...b.errors(), ...c.errors(), ...g.errors(), ...g2.errors()]
  check('no page exceptions on any screen', errs.length === 0, errs.slice(0, 3).join(' | '))
} catch (e) {
  check('the drive ran to the end', false, String(e?.stack ?? e))
} finally {
  console.log(`\nsymbol ask drive: ${pass} passed / ${fail} failed`)
  ws.close()
  chrome.kill('SIGKILL')
  await sleep(300)
  fs.rmSync(PROFILE, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
