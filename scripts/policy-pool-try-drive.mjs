// THE POLICY POOL — "Try it" drive (TRYIT lane, squad policy-pool 2026-11-02).
// Headless Chrome over CDP (Node's own WebSocket — no Playwright on this Mac)
// drives /policy-pool's three buttons and the chat sentence against a local
// `next start`, with the agent wallet (.env.local PRIVATE_KEY) behind an
// EIP-6963 "Mock Wallet" announced into the page. The page NEVER sees the
// key: the mock provider hands eth_sendTransaction to this script over a CDP
// BINDING (Runtime.addBinding — no network, so the app's CSP never sees a
// request), the script signs with viem on Base Sepolia ONLY (any other chain
// id is refused) and resolves the hash back into the page — the wallet's
// eth_sendTransaction contract, so the app's own SendTxChain / SendTxButton /
// wagmi path is the one exercised, not a shortcut.
//
//   BASE=http://localhost:4610 node scripts/policy-pool-try-drive.mjs
//   SHOTS=/path/to/dir   where the screenshots land (default: the squad blackboard)
//
// Scenes: the connect door (a stranger presses a button → the unified door,
// connect-only lanes, the ask held, NO call to the try door yet) → the mock
// wallet connects and the held ask runs → over-cap refused → plain swap
// reverts NotAttested on-chain → the attested $1 fills → the ledger row opens
// → light + 375 shots → /chat "Buy $1 of ETH through the policy pool" builds
// the artifact on Base Sepolia from a Base picker.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createPublicClient, createWalletClient, fallback, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9461)
const BASE = process.env.BASE ?? 'http://localhost:4610'
const SHOTS = process.env.SHOTS ?? '/Users/nate/pantessa/squad-policy-pool-2026-11-02/tryit-shots'
const PROFILE = `/tmp/claude-pp-try-drive-${PORT}`
const HDR = { 'x-yf-internal-run': '1' }
const SEPOLIA_HEX = '0x14a34'

fs.mkdirSync(SHOTS, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} try drive: ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── env ─────────────────────────────────────────────────────────────────────
const envText = fs.readFileSync('.env.local', 'utf8')
const envOf = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^"|"$/g, '')
const pk = envOf('PRIVATE_KEY')
if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
const alchemyKey = envOf('ALCHEMY_API_KEY')
const transport = alchemyKey
  ? fallback([viemHttp('https://base-sepolia.g.alchemy.com/v2/', { fetchOptions: { headers: { Authorization: `Bearer ${alchemyKey}` } } }), viemHttp()])
  : viemHttp()
const wallet = createWalletClient({ account, chain: baseSepolia, transport })
const reader = createPublicClient({ chain: baseSepolia, transport })

// ── the signer: Base Sepolia only, the key never leaves Node ────────────────
const signed = []
async function signerRequest(method, params = []) {
  if (method === 'eth_sendTransaction') {
    const tx = params[0] ?? {}
    if (tx.chainId !== undefined && Number(tx.chainId) !== 84532) throw new Error(`the drive signs only on Base Sepolia (84532), not ${Number(tx.chainId)}`)
    if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) throw new Error('from is not the drive wallet')
    const hash = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data ?? '0x',
      value: tx.value ? BigInt(tx.value) : 0n,
      ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
    })
    signed.push({ to: tx.to, hash, gas: tx.gas ?? null })
    console.log(`   signer: sent ${hash} → ${tx.to}${tx.gas ? ` (gas ${BigInt(tx.gas)})` : ''}`)
    return hash
  }
  if (/^(personal_sign|eth_sign|eth_signTypedData)/.test(method)) throw new Error(`the drive does not ${method} — connect-only`)
  // Reads a wallet would answer itself go to the chain.
  return reader.request({ method, params })
}

// ── the mock wallet announced into every page ───────────────────────────────
const mockWallet = (addr) => `(() => {
  const ADDR='${addr}'; let chain='0x2105'; const listeners={};
  const emit=(ev,arg)=>(listeners[ev]||[]).forEach((fn)=>{try{fn(arg)}catch{}});
  window.__ppPending=window.__ppPending||{};
  window.__ppResolve=(id,result,error)=>{const p=window.__ppPending[id];if(!p)return;delete window.__ppPending[id];if(error){console.error('[mock wallet] failed: '+error);const e=new Error(error);e.code=-32603;e.data={message:error};p.rej(e)}else p.res(result)};
  const remote=(method,params)=>new Promise((res,rej)=>{const id=String(Math.random()).slice(2);window.__ppPending[id]={res,rej};window.__ppSign(JSON.stringify({id,method,params}))});
  const provider={
    isMockWallet:true,
    request:async({method,params})=>{
      if(!/^eth_(accounts|chainId|requestAccounts)$|^net_version$/.test(method))console.log('[mock wallet] '+method);
      if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR];
      if(method==='eth_chainId')return chain;
      if(method==='net_version')return String(parseInt(chain,16));
      if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;setTimeout(()=>emit('chainChanged',chain),0);return null}
      if(method==='wallet_addEthereumChain')return null;
      if(method==='wallet_requestPermissions'||method==='wallet_getPermissions')return[{parentCapability:'eth_accounts'}];
      if(method==='eth_sendTransaction'){const tx={...params[0],chainId:params[0].chainId??parseInt(chain,16)};console.log('[mock wallet] eth_sendTransaction '+JSON.stringify({to:tx.to,gas:tx.gas,chainId:tx.chainId,dataLen:(tx.data||'').length}));return remote(method,[tx])}
      return remote(method,params||[])
    },
    on:(ev,fn)=>{(listeners[ev]=listeners[ev]||[]).push(fn)},
    removeListener:(ev,fn)=>{listeners[ev]=(listeners[ev]||[]).filter((f)=>f!==fn)},
  };
  const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000002',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail}));
  window.addEventListener('eip6963:requestProvider',announce); announce();
  window.__mockWallet=provider;
})()`

// ── Chrome over CDP ─────────────────────────────────────────────────────────
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/policy-pool`, { headers: HDR })).status < 500) break
  } catch {
    /* not up yet */
  }
  await sleep(500)
}
fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--use-gl=swiftshader', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
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
const netLog = []
const netFail = []
const rpcSeen = []
const rpcMethods = {}
const pageErrors = []
const tabLabel = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
    return
  }
  if (d.method === 'Network.requestWillBeSent') {
    netLog.push({ url: d.params.request.url, method: d.params.request.method, t: Date.now(), id: d.params.requestId })
    if (/sepolia\.base\.org|publicnode/.test(d.params.request.url) && d.params.request.postData) {
      try {
        const body = JSON.parse(d.params.request.postData)
        for (const call of Array.isArray(body) ? body : [body]) rpcMethods[call.method] = (rpcMethods[call.method] ?? 0) + 1
      } catch {
        rpcMethods['?'] = (rpcMethods['?'] ?? 0) + 1
      }
    }
  }
  if (d.method === 'Network.loadingFailed') netFail.push({ id: d.params.requestId, err: d.params.errorText, blocked: d.params.blockedReason ?? null })
  if (d.method === 'Network.responseReceived' && /sepolia\.base\.org|publicnode|alchemy/.test(d.params.response.url)) rpcSeen.push({ url: d.params.response.url.replace(/\/v2\/.*$/, '/v2/…'), status: d.params.response.status })
  if (d.method === 'Runtime.bindingCalled' && d.params.name === '__ppSign') {
    const { id: reqId, method, params } = JSON.parse(d.params.payload)
    const sess = d.sessionId
    void signerRequest(method, params)
      .then((result) => send('Runtime.evaluate', { expression: `window.__ppResolve(${JSON.stringify(reqId)}, ${JSON.stringify(result ?? null)}, null)` }, sess))
      .catch((e) => {
        const msg = e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : String(e)
        console.log(`   signer: ${method} FAILED — ${msg}`)
        return send('Runtime.evaluate', { expression: `window.__ppResolve(${JSON.stringify(reqId)}, null, ${JSON.stringify(msg)})` }, sess)
      })
    return
  }
  if (d.method === 'Runtime.consoleAPICalled') {
    const text = (d.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
    if (/\[mock wallet\]|policy-pool|try/i.test(text)) console.log(`   page: ${text.slice(0, 240)}`)
  }
  if (d.method === 'Runtime.exceptionThrown') pageErrors.push(`[${tabLabel.get(d.sessionId) ?? 'tab'}] ${(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text ?? 'exception').slice(0, 160)}`)
}
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params, sessionId }))
  })

async function tab({ w = 1440, h = 1000, mobile = false, scheme = 'dark', connected = false, label = 'main' } = {}) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  tabLabel.set(sessionId, label)
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Runtime.addBinding', { name: '__ppSign' }, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setExtraHTTPHeaders', { headers: HDR }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(account.address) }, sessionId)
  if (connected) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{}` }, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile }, sessionId)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId)
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
    return r.result?.result?.value
  }
  const go = async (url) => {
    await send('Page.navigate', { url }, sessionId)
    await sleep(1500)
  }
  const waitFor = async (expr, ms = 15000, label = expr) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      let val = null
      try {
        val = await ev(expr)
      } catch {
        /* the page may be mid-navigation */
      }
      if (val) return val
      await sleep(400)
    }
    throw new Error(`timeout waiting for ${label.slice(0, 120)}`)
  }
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    const file = path.join(SHOTS, name)
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    console.log(`   📸 ${file}`)
  }
  const close = () => send('Target.closeTarget', { targetId })
  return { ev, go, waitFor, click, shot, close, sessionId }
}

const PHASE = (a) => `document.querySelector('.pp-try__card[data-try="${a}"]')?.dataset.phase`
const LINE = (a) => `document.querySelector('.pp-try__card[data-try="${a}"] .pp-try__line span')?.textContent ?? ''`
const HITS = (a) => `[...document.querySelectorAll('.pp-try__card[data-try="${a}"] .pp-try__walk li[data-hit="true"]')].map((l) => l.textContent.trim())`
const TXURL = (a) => `document.querySelector('.pp-try__card[data-try="${a}"] .pp-try__tx')?.href ?? ''`
// SCENES=B,C,G runs a subset (A is the door; without it the tab starts connected).
const ONLY = (process.env.SCENES ?? 'A,B,C,D,E,F,G').split(',').map((x) => x.trim().toUpperCase())
let diag = async () => ''
const scene = async (name, fn) => {
  if (!ONLY.includes(name.slice(0, 1))) return console.log(`\n── ${name} — skipped (SCENES) ──`)
  console.log(`\n── ${name} ──`)
  try {
    await fn()
  } catch (e) {
    check(`scene ${name.slice(0, 1)} ran to its end`, false, e instanceof Error ? e.message : String(e))
    try {
      console.log(`   diag: ${(await diag()).slice(0, 1500)}`)
    } catch {
      /* no diag */
    }
  }
}
const tryCalls = () => netLog.filter((n) => n.url.includes('/api/policy-pool/try') && n.method === 'POST').length

try {
  // ── Scene A: the stranger's door (rule 6) ────────────────────────────────
  const t = await tab({ connected: !ONLY.includes('A') })
  diag = async () => {
    const byUrl = {}
    for (const r of rpcSeen) byUrl[`${r.url} ${r.status}`] = (byUrl[`${r.url} ${r.status}`] ?? 0) + 1
    const failed = netFail.map((f) => { const n = netLog.find((x) => x.id === f.id); return `${(n?.url ?? '?').slice(0, 80)} ${f.err}${f.blocked ? ` (${f.blocked})` : ''}` }).filter((x) => !/cdp|coinbase/i.test(x)).slice(-8)
    return `card=${JSON.stringify(await t.ev(`document.querySelector('.pp-try__card[data-phase]:not([data-phase="idle"])')?.innerText ?? ''`))} refreshCalls=${netLog.filter((n) => n.url.includes('/api/tx/refresh')).length} tryCalls=${tryCalls()} rpc=${JSON.stringify(byUrl)} rpcMethods=${JSON.stringify(rpcMethods)} failed=${JSON.stringify(failed)}`
  }
  await t.go(`${BASE}/policy-pool`)
  await t.waitFor(`document.querySelectorAll('[data-try-button]').length === 3`, 20000, 'three buttons')
  check('the strip renders its three buttons on the deployed pool', (await t.ev(`document.querySelector('.pp-try')?.dataset.tryStrip`)) === 'on')
  await scene('A · a stranger presses "Ask for $5,000" → the unified connect door, the ask held', async () => {
  const before = tryCalls()
  await t.click('[data-try-button="overcap"]')
  const doorTitle = await t.waitFor(`document.querySelector('.ca__panel[role="dialog"] .ca__title')?.textContent ?? ''`, 10000, 'the unified door')
  await sleep(400)
  await t.shot('door-1440-dark.png')
  check('a stranger\'s tap opens the UNIFIED door on its connect-only lane ("Connect a wallet"), not a raw wallet list', doorTitle === 'Connect a wallet', `title="${doorTitle}"`)
  check('nothing was asked of the server while the ask is held (no POST /api/policy-pool/try yet)', tryCalls() === before, `calls=${tryCalls() - before}`)
  // The wallet lane → RainbowKit's list → the announced Mock Wallet.
  await t.click('.ca__wallet--lead')
  let connectedVia = 'rainbowkit'
  try {
    await t.waitFor(`[...document.querySelectorAll('button')].some((b) => /Mock Wallet/.test(b.textContent))`, 8000, 'the Mock Wallet option')
    await t.ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => /Mock Wallet/.test(b.textContent)); b.click(); return true })()`)
  } catch {
    connectedVia = 'stored-reconnect'
    await t.ev(`localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')`)
    await t.go(`${BASE}/policy-pool`)
    await t.waitFor(`document.querySelectorAll('[data-try-button]').length === 3`, 20000)
    await t.click('[data-try-button="overcap"]')
  }
  const overPhase = await t.waitFor(`(${PHASE('overcap')}) === 'refused' ? 'refused' : ''`, 30000, 'the over-cap refusal')
  const overLine = await t.ev(LINE('overcap'))
  check(`the held ask ran when the wallet landed (${connectedVia}) and the desk policy refused $5,000 with its cap sentence`, overPhase === 'refused' && /per-order cap/.test(overLine), overLine.slice(0, 160))
  const overHits = await t.waitFor(`(${HITS('overcap')}).length ? ${HITS('overcap')} : null`, 30000, 'the guard_refused row')
  check('a guard_refused row landed in the ledger for that intent', overHits.includes('Guard refused'), overHits.join(','))
  await t.ev(`document.querySelector('.pp-try').scrollIntoView({ block: 'start' })`)
  await sleep(300)
  await t.shot('overcap-1440-dark.png')
  const wrongChain = await t.ev(`!!document.querySelector('.pp-try__state[data-state="chain"]')`)
  check('a wallet on Base is told the pool is on Base Sepolia and offered a chain switch (honest state)', wrongChain === true)
  })
  if (!ONLY.includes('A')) await t.waitFor(`!!document.querySelector('.pp-try__state')`, 20000, 'the connected state line').catch(() => {})

  // ── Scene B: the plain swap, no attestation ──────────────────────────────
  await scene('B · "Swap without the note" → the wallet signs, the hook reverts NotAttested on-chain', async () => {
  await t.click('[data-try-button="plain"]')
  const plainPhase = await t.waitFor(`['watching','error','done'].includes(${PHASE('plain')}) ? ${PHASE('plain')} : ''`, 150000, 'the plain swap outcome')
  const plainLine = await t.ev(LINE('plain'))
  const plainTx = await t.ev(TXURL('plain'))
  check('the plain swap was broadcast by the wallet and REVERTED on-chain with the hook\'s NotAttested()', plainPhase === 'watching' && /NotAttested\(\)/.test(plainLine) && /sepolia\.basescan\.org\/tx\/0x/.test(plainTx), `${plainPhase}: ${plainLine.slice(0, 160)} ${plainTx}`)
  const plainHits = await t.waitFor(`(${HITS('plain')}).length ? ${HITS('plain')} : null`, 40000, 'the onchain_revert row')
  check('an onchain_revert row landed in the ledger within a poll', plainHits.includes('Reverted on-chain'), plainHits.join(','))
  const chainNow = await t.ev(`window.__mockWallet.request({ method: 'eth_chainId' })`)
  check('the wallet was switched to Base Sepolia for the send (the mock reports 0x14a34)', chainNow === SEPOLIA_HEX, chainNow)
  await t.ev(`document.querySelector('.pp-try').scrollIntoView({ block: 'start' })`)
  await sleep(300)
  await t.shot('plain-1440-dark.png')
  })

  // ── Scene C: the attested $1 through the desk ────────────────────────────
  await scene('C · "Buy $1 through the desk" → policy → attestation → guard → the wallet signs → fill', async () => {
  await t.click('[data-try-button="attested"]')
  const attPhase = await t.waitFor(`['signing','refused','error'].includes(${PHASE('attested')}) ? ${PHASE('attested')} : ''`, 60000, 'the attested build')
  const attLine = await t.ev(LINE('attested'))
  check('the desk built the attested artifact for the viewer\'s wallet (guard passed · attested) and the app\'s own SendTxChain card appeared', attPhase === 'signing' && /Guard passed/.test(attLine) && (await t.ev(`!!document.querySelector('.pp-try__card[data-try="attested"] .pp-try__chain')`)), `${attPhase}: ${attLine.slice(0, 160)}`)
  const stepsN = await t.ev(`document.querySelectorAll('.pp-try__card[data-try="attested"] .pp-try__chain ol > li').length`)
  await sleep(500)
  await t.shot('attested-card-1440-dark.png')
  // The first step is a tap (the app never auto-fires step 1); later steps
  // auto-fire on desktop for known wallets — a tap is pressed whenever the
  // card offers one, as a person would.
  const SIGN_BTN = `(() => { const b = [...document.querySelectorAll('.pp-try__card[data-try="attested"] .pp-try__chain button')].find((b) => /^sign/i.test(b.textContent.trim()) && !b.disabled); return b ? b.textContent.trim() : '' })()`
  const t0 = Date.now()
  let taps = 0
  let finalPhase = ''
  while (Date.now() - t0 < 300000) {
    const ph = await t.ev(PHASE('attested'))
    if (['watching', 'done', 'error'].includes(ph)) {
      finalPhase = ph
      break
    }
    const label = await t.ev(SIGN_BTN)
    if (label) {
      taps++
      console.log(`   tap ${taps}: "${label}"`)
      await t.ev(`(() => { const b = [...document.querySelectorAll('.pp-try__card[data-try="attested"] .pp-try__chain button')].find((b) => /^sign/i.test(b.textContent.trim()) && !b.disabled); b.click(); return true })()`)
      await sleep(4000)
      if (await t.ev(SIGN_BTN)) console.log(`   after tap ${taps}: ${JSON.stringify((await t.ev(`document.querySelector('.pp-try__card[data-try="attested"] .pp-try__chain')?.innerText ?? ''`)).slice(-220))}`)
      continue
    }
    await sleep(1000)
  }
  if (!finalPhase) throw new Error(`timeout waiting for the attested fill after ${taps} taps`)
  const finalLine = await t.ev(LINE('attested'))
  const attTx = await t.ev(TXURL('attested'))
  check(`the ${stepsN}-step chain signed through the wallet and FILLED — DeskFill emitted, the strip read it from the chain`, finalPhase === 'watching' && /Filled\. DeskFill emitted/.test(finalLine) && /sepolia\.basescan\.org\/tx\/0x/.test(attTx), `${finalPhase}: ${finalLine.slice(0, 200)} ${attTx}`)
  const attHits = await t.waitFor(`(${HITS('attested')}).length >= 5 ? ${HITS('attested')} : null`, 90000, 'the five ledger rows')
  check('the ledger walk reads guard passed → attested → signed → mined → fill for that intent', ['Guard passed', 'Attested', 'Signed', 'Mined', 'Fill'].every((k) => attHits.includes(k)), attHits.join(','))
  await t.ev(`document.querySelector('.pp-try').scrollIntoView({ block: 'start' })`)
  await sleep(300)
  await t.shot('attested-1440-dark.png')
  })

  // ── Scene D: the ledger row opens from the strip ─────────────────────────
  await scene('D · "Open the ledger row" → the row\'s timeline opens below', async () => {
  await t.ev(`(() => { const b = [...document.querySelectorAll('.pp-try__card[data-try="attested"] button')].find((b) => /Open the ledger row/.test(b.textContent)); b?.click(); return !!b })()`)
  const tl = await t.waitFor(`document.querySelector('.pp-timeline .pp-timeline__head')?.textContent ?? ''`, 20000, 'the timeline')
  check('the attested intent\'s timeline opened in the ledger (the strip links to its row)', /chat-try-/.test(tl), tl.slice(0, 120))
  await sleep(600)
  await t.shot('ledger-timeline-1440-dark.png')
  })

  // ── Scene E: light theme ────────────────────────────────────────────────
  await scene('E · light theme', async () => {
  const tl2 = await tab({ scheme: 'light', connected: true, label: 'light' })
  await tl2.go(`${BASE}/policy-pool`)
  await tl2.waitFor(`document.querySelectorAll('[data-try-button]').length === 3`, 20000)
  await tl2.waitFor(`!!document.querySelector('.pp-try__state')`, 15000, 'a connected state line').catch(() => {})
  await tl2.ev(`document.querySelector('.pp-try').scrollIntoView({ block: 'start' })`)
  await sleep(600)
  await tl2.shot('strip-1440-light.png')
  await tl2.close()
  })

  // ── Scene F: the phone ───────────────────────────────────────────────────
  await scene('F · 375 wide', async () => {
  const tm = await tab({ w: 375, h: 812, mobile: true, connected: true, label: '375' })
  await tm.go(`${BASE}/policy-pool`)
  await tm.waitFor(`document.querySelectorAll('[data-try-button]').length === 3`, 20000)
  const overflow = await tm.ev(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })`)
  check('375 wide: no horizontal overflow with the strip in place', overflow.sw <= overflow.iw, JSON.stringify(overflow))
  const btnH = await tm.ev(`Math.min(...[...document.querySelectorAll('[data-try-button]')].map((b) => b.getBoundingClientRect().height))`)
  check('375 wide: every button is at least 44px tall', btnH >= 44, `${btnH}px`)
  await tm.ev(`document.querySelector('.pp-try').scrollIntoView({ block: 'start' })`)
  await sleep(600)
  await tm.shot('strip-375-dark.png')
  await tm.close()
  })

  // ── Scene G: the chat sentence ───────────────────────────────────────────
  await scene('G · /chat "Buy $1 of ETH through the policy pool" from a Base picker', async () => {
  const tc = await tab({ connected: true, label: 'chat' })
  await tc.go(`${BASE}/chat`)
  const ta = await tc.waitFor(`(() => { const t = [...document.querySelectorAll('textarea')].find((x) => /^Ask/.test(x.placeholder || '') && x.offsetParent); return t ? 'ok' : '' })()`, 30000, 'the composer')
  void ta
  await tc.ev(`(() => { const t = [...document.querySelectorAll('textarea')].find((x) => /^Ask/.test(x.placeholder || '') && x.offsetParent); t.focus(); return true })()`)
  await send('Input.insertText', { text: 'Buy $1 of ETH through the policy pool' }, tc.sessionId)
  await sleep(300)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, tc.sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, tc.sessionId)
  let chatLine = ''
  try {
    chatLine = await tc.waitFor(`(() => { const b = document.body.innerText; const m = b.match(/🏠 The policy pool lives on Base Sepolia[^\\n]*/); return m ? m[0] : '' })()`, 90000, 'the 🏠 line in the chat')
  } catch (e) {
    const body = await tc.ev(`document.querySelector('main')?.innerText.slice(-900) ?? document.body.innerText.slice(-900)`)
    const chatCalls = netLog.filter((n) => n.url.endsWith('/api/chat') && n.method === 'POST').length
    console.log(`   chat diag: POST /api/chat ×${chatCalls}; page tail: ${JSON.stringify(body)}`)
    throw e
  }
  const chatCard = await tc.waitFor(`/Step 1 of \\d|All \\d steps confirmed/.test(document.body.innerText) ? 'card' : ''`, 30000, 'the SendTxChain card')
  check('the chat sentence from a Base picker built the policy-pool artifact on Base Sepolia and said so in one line', /Base Sepolia/.test(chatLine) && chatCard === 'card', chatLine.slice(0, 160))
  await sleep(800)
  await tc.shot('chat-1440-dark.png')
  await tc.close()
  })

  // React #418 on /policy-pool @1440 predates this lane (measured 2026-11-02 on
  // the pre-TRYIT tree at :4401 as well — a text hydration mismatch on the
  // ledger's relative times); it is reported, not failed. Anything else fails.
  const hydration = pageErrors.filter((e) => /#418|#423|#425/.test(e))
  const other = pageErrors.filter((e) => !/#418|#423|#425/.test(e))
  if (hydration.length) console.log(`   note: ${hydration.length} React hydration warning(s), pre-existing on the base tree: ${hydration.map((e) => e.slice(0, 60)).join(' | ')}`)
  check('no uncaught page exceptions across the drive beyond the pre-existing hydration note (the embedded wallet\'s CORS refusals are not exceptions)', other.length === 0, other.slice(0, 3).join(' | ').slice(0, 300))
  const primaryFailed = netFail.filter((f) => /sepolia\.base\.org/.test(netLog.find((x) => x.id === f.id)?.url ?? '')).length
  const fallbackFailed = netFail.filter((f) => /base-sepolia-rpc\.publicnode/.test(netLog.find((x) => x.id === f.id)?.url ?? '')).length
  const fallbackOk = rpcSeen.filter((r) => /publicnode/.test(r.url) && r.status === 200).length
  console.log(`\nRPC calls the page made to Base Sepolia, by method: ${JSON.stringify(rpcMethods)}; sepolia.base.org dropped ${primaryFailed} (net::ERR_FAILED — a 429 without CORS headers), publicnode answered ${fallbackOk} and dropped ${fallbackFailed}; all failed requests incl. mainnet.base.org + the embedded wallet's CORS refusals: ${netFail.length}`)
  check('every Base Sepolia read the page needed was answered — the measured publicnode fallback absorbed what sepolia.base.org dropped (lib/wallet-chains)', fallbackFailed === 0 && fallbackOk >= primaryFailed, `primary dropped ${primaryFailed}, fallback ok ${fallbackOk}, fallback dropped ${fallbackFailed}`)
  console.log(`\nsigned by the drive wallet (${account.address}):`)
  for (const s of signed) console.log(`   ${s.hash} → ${s.to}${s.gas ? ' (fixed gas)' : ''}`)
  await t.close()
} catch (e) {
  check('the drive ran to its end', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log(`\n${pass} passed, ${fail} failed`)
  ws.close()
  chrome.kill()
  await sleep(500)
  fs.rmSync(PROFILE, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
