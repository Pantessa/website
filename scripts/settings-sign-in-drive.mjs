// SETTINGS, CONNECTED BUT NOT SIGNED IN (2026-11-17): headless Chrome over CDP
// (Node's own WebSocket; no Playwright on this Mac) proves the dashboard's
// gate (lib/app-entry dashboardGate) in a real browser:
//
//   1. A wallet connected with NO session presses the spine's SETTINGS seat on
//      `/`: it lands on /dashboard and sees the sign-in card (it used to be
//      sent home with no word why).
//   2. The card's button signs (the wallet here signs with the .env.local
//      burner through a CDP binding) and the dashboard opens in place.
//   3. Nobody here (no wallet, no session) opening /dashboard is still sent
//      home.
//
// Every request carries `x-yf-internal-run: 1`. A SIWE signature moves no
// money; the wallet answers nothing but accounts, chain and personal_sign.
//
// Usage (server under test must be `next start`, never the dev server):
//   BASE=http://localhost:4740 node scripts/settings-sign-in-drive.mjs [--out=/abs/dir]
// W=390 H=844 runs it on a phone: the SETTINGS seat folds behind MORE there,
// so the phone run opens /dashboard by its address instead of the seat.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE ?? 'http://localhost:4740'
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? null
const W = Number(process.env.W ?? 1440)
const H = Number(process.env.H ?? 900)
const PHONE = W < 1024
const HDR = { 'x-yf-internal-run': '1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function burnerKey() {
  const env = fs.readFileSync('.env.local', 'utf8')
  const pk = (env.match(/^PRIVATE_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^"|"$/g, '')
  if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
  return pk.startsWith('0x') ? pk : `0x${pk}`
}
const account = privateKeyToAccount(burnerKey())

// An EIP-6963 wallet on the burner's address. personal_sign goes out through
// the `__driveSign` binding and comes back through window.__driveSigned.
const mockWallet = (addr) => `(() => { const ADDR='${addr}'; const waits=new Map(); let n=0;
  window.__driveSigned=(id,sig)=>{ const w=waits.get(id); waits.delete(id); w&&w(sig) };
  const provider={request:async({method,params})=>{
    if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR];
    if(method==='eth_chainId')return'0x2105';
    if(method==='net_version')return'8453';
    if(method==='wallet_switchEthereumChain')return null;
    if(method==='personal_sign'){ const id=++n; window.__driveSignCount=(window.__driveSignCount||0)+1; return await new Promise((r)=>{ waits.set(id,r); window.__driveSign(JSON.stringify({id,msg:params[0]})) }) }
    throw new Error('unsupported: '+method)}, on:()=>{}, removeListener:()=>{} };
  const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000002',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})); window.addEventListener('eip6963:requestProvider',announce); announce();
  try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{} })()`

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function withChrome(fn) {
  const port = 9000 + Math.floor(Math.random() * 900)
  const profile = `/tmp/claude-settings-drive-${port}`
  fs.rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  const exited = new Promise((r) => chrome.once('exit', r))
  try {
    let v = null
    for (let i = 0; i < 50 && !v; i++) {
      try {
        v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      } catch {
        await sleep(200)
      }
    }
    if (!v) throw new Error('chrome did not start')
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const pending = new Map()
    const listeners = []
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d)
        pending.delete(d.id)
      } else for (const l of listeners) l(d)
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
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: PHONE ? 2 : 1, mobile: PHONE }, sessionId)
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
    const ev = async (s) => (await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)).result?.result?.value
    const go = (path) => send('Page.navigate', { url: BASE + path }, sessionId)
    const until = async (s, ms = 15000) => {
      const t = Date.now()
      while (Date.now() - t < ms) {
        if (await ev(s)) return true
        await sleep(250)
      }
      return false
    }
    const shot = async (name) => {
      if (!OUT) return
      const { data } = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result
      fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    }
    await fn({ send, ev, go, until, shot, sessionId, listeners })
    ws.close()
  } finally {
    chrome.kill()
    await exited
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: HDR })).status < 500) break
  } catch {
    /* not up yet */
  }
  await sleep(500)
}
if (OUT) fs.mkdirSync(OUT, { recursive: true })

// ── 1 + 2: a connected wallet, no session ──────────────────────────────────
await withChrome(async ({ send, ev, go, until, shot, sessionId, listeners }) => {
  await send('Runtime.addBinding', { name: '__driveSign' }, sessionId)
  listeners.push(async (d) => {
    if (d.method !== 'Runtime.bindingCalled' || d.params?.name !== '__driveSign') return
    const { id, msg } = JSON.parse(d.params.payload)
    const signature = await account.signMessage({ message: { raw: msg } })
    await send('Runtime.evaluate', { expression: `window.__driveSigned(${id}, '${signature}')` }, sessionId)
  })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(account.address) }, sessionId)
  await go('/')
  const seat = 'aside a[aria-label="Settings"]'
  if (!PHONE) check('the spine shows SETTINGS on `/`', await until(`!!document.querySelector('${seat}')`))
  const me = await ev(`fetch('/api/auth/me').then(r=>r.json()).then(j=>j.address??null)`)
  check('no session to start with', me === null, String(me))
  // Let wagmi restore the mock wallet before the press.
  await until(`[...document.querySelectorAll('button')].some(b=>/0x[0-9a-f]{4}…|\\.eth/i.test(b.textContent||''))`, 8000)
  await sleep(800)
  if (PHONE) await go('/dashboard')
  else await ev(`document.querySelector('${seat}').click()`)
  const onCard = await until(`location.pathname==='/dashboard' && !!document.querySelector('[data-dashboard-sign-in]')`)
  check(`${PHONE ? '/dashboard' : 'SETTINGS'} with a connected wallet lands on /dashboard with the sign-in card (not home)`, onCard, await ev('location.pathname'))
  await sleep(1500)
  check('…and stays there (no trip home)', await ev(`location.pathname==='/dashboard'`))
  check('the card fired no signature by itself', (await ev('window.__driveSignCount||0')) === 0)
  check('the brochure nav is gone and the card is not squeezed', await ev(`!document.querySelector('header.nav') && document.querySelector('[data-dashboard-sign-in] > div').getBoundingClientRect().width >= Math.min(400, innerWidth - 40)`))
  check('no sideways overflow', await ev('document.documentElement.scrollWidth <= innerWidth'))
  await shot(`1-sign-card-${W}`)
  await ev(`[...document.querySelectorAll('[data-dashboard-sign-in] button')].find(b=>/Sign in/.test(b.textContent)).click()`)
  const opened = await until(`location.pathname==='/dashboard' && !document.querySelector('[data-dashboard-sign-in]') && !!document.querySelector('.dash__rail')`, 20000)
  check('one signature from the button opens the dashboard in place', opened, await ev('location.pathname'))
  check('exactly one signature asked for', (await ev('window.__driveSignCount||0')) === 1)
  const after = await ev(`fetch('/api/auth/me').then(r=>r.json()).then(j=>j.address??null)`)
  check('the session is the wallet', typeof after === 'string' && after.toLowerCase() === account.address.toLowerCase(), String(after))
  await shot(`2-dashboard-${W}`)
})

// ── 3: nobody here ─────────────────────────────────────────────────────────
await withChrome(async ({ go, until, ev }) => {
  await go('/dashboard')
  const home = await until(`location.pathname==='/'`, 15000)
  check('no wallet and no session: /dashboard still sends you home', home, await ev('location.pathname'))
  check('…with no sign-in card on the way', !(await ev(`!!document.querySelector('[data-dashboard-sign-in]')`)))
})

const bad = results.filter((r) => !r).length
console.log(`\n${results.length - bad}/${results.length}`)
process.exit(bad ? 1 : 0)
