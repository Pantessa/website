// The CoW sign card's error line, driven in a real browser (2026-11-11).
//
// On prod a wallet SIGNED a $25 USDC → UNI limit order, CoW's order book
// refused it, and the card said "Signature rejected in the wallet". This
// drive proves the card now tells the two apart, through the app's own
// path: /chat builds the order from the sentence, SignOrderButton asks the
// wallet over wagmi, the relay posts to CoW's real Base order book.
//
// The wallet is a FRESH, NEVER-FUNDED throwaway key, generated per run and
// announced into the page as an EIP-6963 "Mock Wallet". The page never sees
// the key: eth_signTypedData_v4 reaches this script over a CDP binding
// (Runtime.addBinding), and the script signs ONLY CoW's own Base order domain
// ("Gnosis Protocol" v2, chain 8453, the settlement contract). The key holds
// nothing, so CoW stops every order at its balance check: nothing can be
// placed. eth_sendTransaction and every other signing method are refused.
//
// Scenes:
//   A  the wallet signs → CoW refuses (InsufficientBalance) → the card shows
//      CoW's words, never "in the wallet"
//   B  the wallet says no (4001 "User rejected the request.") → the card says
//      the signature was rejected in the wallet and names Base
//
//   BASE=http://localhost:4490 node scripts/cow-refusal-drive.mjs
//   SHOTS=/path/to/dir  (default: the OS temp dir)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9471)
const BASE = process.env.BASE ?? 'http://localhost:4490'
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), 'cow-refusal-drive')
const PROFILE = path.join(os.tmpdir(), `cow-refusal-drive-profile-${PORT}`)
// Internal-run: any row the relay files is stamped internal (never a stranger's wall).
const HDR = { 'x-yf-internal-run': '1' }
const ASK = 'limit order: buy 4.2245 UNI for at most 25 USDC'
const COW_DOMAIN = { name: 'Gnosis Protocol', version: 'v2', chainId: 8453, verifyingContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41' }

fs.mkdirSync(SHOTS, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} cow refusal drive: ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the throwaway signer: CoW's Base order domain only ──────────────────────
const account = privateKeyToAccount(generatePrivateKey())
let mode = 'sign' // 'sign' | 'refuse'
const signedTyped = []
async function signerRequest(method, params = []) {
  if (method === 'eth_signTypedData_v4') {
    if (mode === 'refuse') {
      const e = new Error('User rejected the request.')
      e.code = 4001
      throw e
    }
    const [from, json] = params
    if (String(from).toLowerCase() !== account.address.toLowerCase()) throw new Error('from is not the drive wallet')
    const td = typeof json === 'string' ? JSON.parse(json) : json
    const d = td.domain ?? {}
    if (d.name !== COW_DOMAIN.name || d.version !== COW_DOMAIN.version || Number(d.chainId) !== COW_DOMAIN.chainId || String(d.verifyingContract).toLowerCase() !== COW_DOMAIN.verifyingContract) {
      throw new Error(`the drive signs only CoW's Base order domain, not ${JSON.stringify(d)}`)
    }
    const { EIP712Domain: _drop, ...types } = td.types
    const sig = await account.signTypedData({ domain: d, types, primaryType: td.primaryType, message: td.message })
    signedTyped.push({ primaryType: td.primaryType, sellAmount: td.message?.sellAmount })
    return sig
  }
  throw new Error(`the drive does not ${method}`)
}

const mockWallet = (addr) => `(() => {
  const ADDR='${addr}'; let chain='0x2105'; const listeners={};
  const emit=(ev,arg)=>(listeners[ev]||[]).forEach((fn)=>{try{fn(arg)}catch{}});
  window.__cwPending=window.__cwPending||{};
  window.__cwResolve=(id,result,error,code)=>{const p=window.__cwPending[id];if(!p)return;delete window.__cwPending[id];if(error){const e=new Error(error);e.code=code||-32603;p.rej(e)}else p.res(result)};
  const remote=(method,params)=>new Promise((res,rej)=>{const id=String(Math.random()).slice(2);window.__cwPending[id]={res,rej};window.__cwSign(JSON.stringify({id,method,params}))});
  const provider={
    isMockWallet:true,
    request:async({method,params})=>{
      if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR];
      if(method==='eth_chainId')return chain;
      if(method==='net_version')return String(parseInt(chain,16));
      if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;setTimeout(()=>emit('chainChanged',chain),0);return null}
      if(method==='wallet_addEthereumChain')return null;
      if(method==='wallet_requestPermissions'||method==='wallet_getPermissions')return[{parentCapability:'eth_accounts'}];
      return remote(method,params||[])
    },
    on:(ev,fn)=>{(listeners[ev]=listeners[ev]||[]).push(fn)},
    removeListener:(ev,fn)=>{listeners[ev]=(listeners[ev]||[]).filter((f)=>f!==fn)},
  };
  const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000003',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail}));
  window.addEventListener('eip6963:requestProvider',announce); announce();
})()`

// ── Chrome over CDP (Node's own WebSocket) ──────────────────────────────────
fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
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
let seq = 0
const pending = new Map()
const pageErrors = []
const submits = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
    return
  }
  if (d.method === 'Runtime.bindingCalled' && d.params.name === '__cwSign') {
    const { id: reqId, method, params } = JSON.parse(d.params.payload)
    void signerRequest(method, params)
      .then((result) => send('Runtime.evaluate', { expression: `window.__cwResolve(${JSON.stringify(reqId)}, ${JSON.stringify(result ?? null)}, null)` }, d.sessionId))
      .catch((e) => send('Runtime.evaluate', { expression: `window.__cwResolve(${JSON.stringify(reqId)}, null, ${JSON.stringify(String(e.message))}, ${Number(e.code) || -32603})` }, d.sessionId))
    return
  }
  if (d.method === 'Network.responseReceived' && /\/api\/cow\/submit/.test(d.params.response.url)) submits.push(d.params.response.status)
  if (d.method === 'Runtime.exceptionThrown') pageErrors.push((d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text ?? 'exception').slice(0, 160))
}
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++seq
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params, sessionId }))
  })

const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
for (const [m, p] of [
  ['Page.enable', {}],
  ['Runtime.enable', {}],
  ['Network.enable', {}],
  ['Runtime.addBinding', { name: '__cwSign' }],
  ['Network.setExtraHTTPHeaders', { headers: HDR }],
  ['Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(account.address) }],
  ['Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{}` }],
  ['Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }],
  ['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }],
  ['Emulation.setFocusEmulationEnabled', { enabled: true }],
]) await send(m, p, sessionId)

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  return r.result?.result?.value
}
const until = async (expr, ms = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const val = await ev(expr).catch(() => null)
    if (val) return val
    await sleep(400)
  }
  return null
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(SHOTS, name)
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  console.log(`   📸 ${file}`)
}
const ask = async (text) => {
  const focused = await ev(`(() => { const t = [...document.querySelectorAll('textarea')].find((e) => /^Ask /.test(e.placeholder || '')); if (!t) return false; t.focus(); return document.activeElement === t })()`)
  if (!focused) return false
  await send('Input.insertText', { text }, sessionId)
  await sleep(200)
  return ev(`(() => { const b = document.querySelector('button[aria-label="Send"]'); if (!b || b.disabled) return false; b.click(); return true })()`)
}
const SIGN_BTN = `[...document.querySelectorAll('button[title^="Sign this CoW order"]')].pop()`
const ERR = `document.querySelectorAll('[data-order-error]')[document.querySelectorAll('[data-order-error]').length - 1]?.textContent ?? ''`

try {
  console.log(`   wallet ${account.address} (fresh, unfunded)`)
  await send('Page.navigate', { url: `${BASE}/chat` }, sessionId)
  const ready = await until(`[...document.querySelectorAll('textarea')].some((e) => /^Ask /.test(e.placeholder || '')) && location.pathname.startsWith('/chat') ? 'ready' : null`, 30000)
  check('the chat opens with the mock wallet connected', !!ready, ready ? '' : await ev('location.href'))

  // ── A: the wallet signs; CoW refuses ───────────────────────────────────
  check('the sentence is sent', !!(await ask(ASK)))
  const card = await until(`${SIGN_BTN} ? 'card' : null`, 45000)
  check('the chat builds a CoW limit order card for the sentence', !!card, card ? '' : (await ev('document.body.innerText')).slice(-400))
  if (card) {
    mode = 'sign'
    await ev(`${SIGN_BTN}.click()`)
    const err = await until(`(${ERR}) || null`, 30000)
    check('the wallet was asked for one typed-data signature and gave it', signedTyped.length === 1 && signedTyped[0].primaryType === 'Order', JSON.stringify(signedTyped))
    check('the relay answered CoW\'s refusal (502)', submits.includes(502), JSON.stringify(submits))
    check('the card shows the order book\'s words with CoW\'s error type, never a wallet rejection',
      /^CoW's order book refused the signed order: the wallet doesn't hold enough/.test(err ?? '') && /InsufficientBalance/.test(err ?? '') && !/in the wallet/i.test(err ?? ''), err ?? '(no error line)')
    await shot('cow-refusal-A-order-book.png')

    // ── B: the wallet says no ────────────────────────────────────────────
    mode = 'refuse'
    const before = submits.length
    await ev(`${SIGN_BTN}.click()`)
    const err2 = await until(`(() => { const t = ${ERR}; return /in the wallet/.test(t) ? t : null })()`, 20000)
    check('a wallet "no" still reads as rejected in the wallet, names Base, and never reaches the relay',
      /^Signature rejected in the wallet\. Nothing was placed\. \(If you didn’t cancel: check the wallet is on Base\.\)$/.test(err2 ?? '') && submits.length === before, `${err2} · submits ${submits.length - before}`)
    await shot('cow-refusal-B-wallet-no.png')
  }
  check('no page exceptions', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
} finally {
  ws.close()
  chrome.kill()
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
