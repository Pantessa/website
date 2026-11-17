// THE APPS PAGE ON A PHONE, DRIVEN (squad apps-page, PHONE lane,
// 2026-11-17): headless Chrome over CDP (the same scaffolding as
// scripts/apps-page-shot.mjs: the .env.local burner's SIWE cookie + a
// watch-only EIP-6963 wallet on the same address; every request carries
// `x-yf-internal-run: 1`; a watch-only wallet cannot sign, nothing here can
// move money). For one, two and five apps at 390x844 and 375x812 it asserts:
//   · the APPS screen is the page (data-apps-phone), the frame never scrolls
//     the document and nothing overflows sideways;
//   · the ask bar is fully on screen, above the tab bar, and below the
//     screen's scroller (never over content) at the scroller's top AND
//     after scrolling it to the bottom;
//   · every button on the screen is at least 44px tall;
//   · page → ask → the conversation shows the turn → APPS tab → the page
//     again (once per viewport).
// Usage: BASE=http://localhost:4715 node scripts/apps-phone-drive.mjs [--shots=/abs/dir]
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
const PROFILE = `/tmp/claude-apps-phone-drive-${PORT}`
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


const SHOTS = arg('shots')
const CASES = [
  { name: '1app', apps: 'uniswap-free' },
  { name: '2apps', apps: 'uniswap-free,snapshot-free' },
  { name: '5apps', apps: 'uniswap-free,snapshot-free,hyperliquid-free,aave-free,lido-free' },
]
const VIEWPORTS = [
  [390, 844],
  [375, 812],
]
const ASK = 'What is my biggest position?'

for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: HDR })).status < 500) break
  } catch {
    /* not up yet */
  }
  await sleep(500)
}
const account = privateKeyToAccount(burnerKey())
const address = account.address
const session = await signIn(account)

fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
}
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

  for (const [W, H] of VIEWPORTS) {
    for (const c of CASES) {
      const label = `${c.name} @${W}x${H}`
      const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
      const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
      await send('Page.enable', {}, sessionId)
      await send('Runtime.enable', {}, sessionId)
      await send('Network.enable', {}, sessionId)
      await send('Network.setExtraHTTPHeaders', { headers: HDR }, sessionId)
      await send('Network.setCookie', { name: 'yf_session', value: session, url: BASE }, sessionId)
      await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(address) }, sessionId)
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }, sessionId)
      await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
      const ev = async (s) => {
        const r = await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)
        return r.result?.result?.value
      }
      const shot = async (what) => {
        if (!SHOTS || SHOTS === true) return
        const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
        fs.writeFileSync(`${SHOTS}/phone-${c.name}-${W}-${what}.png`, Buffer.from(s.result.data, 'base64'))
      }
      await send('Page.navigate', { url: `${BASE}/chat?tab=mcps&mcps=${c.apps}` }, sessionId)
      // Wait for the page's content (or its empty state) rather than a fixed time.
      for (let i = 0; i < 60; i++) {
        const ready = await ev(`!!document.querySelector('[data-apps-phone] .apg-head') && !document.querySelector('[data-apps-phone] .apgm-inner > [class*="loader"], [data-apps-phone] [data-chat-loader]') && (document.querySelectorAll('[data-apps-phone] [data-apps-section], [data-apps-phone] [data-apps-line]').length > 0)`)
        if (ready) break
        await sleep(500)
      }
      await sleep(1500)

      const measure = `(() => {
        const rect = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) } }
        const panel = document.querySelector('[data-apps-phone]')
        const scroller = panel && panel.querySelector('[data-app-scroll]')
        const bar = rect(document.querySelector('[data-apps-askbar]'))
        const tab = rect(document.querySelector('[data-spine-bar]'))
        const small = panel ? [...panel.querySelectorAll('button, a.apg-btn, [role="button"]')].filter((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && b.height < 43.5 }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.className || '').trim().slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px') : []
        return {
          screen: document.querySelector('main[data-phone-screen]')?.getAttribute('data-phone-screen') ?? null,
          page: !!panel, layout: panel?.getAttribute('data-layout') ?? null,
          sections: panel ? panel.querySelectorAll('[data-apps-section]').length : 0,
          lines: panel ? panel.querySelectorAll('[data-apps-line]').length : 0,
          docScroll: document.documentElement.scrollHeight - innerHeight,
          docOverflowX: document.documentElement.scrollWidth - innerWidth,
          panelOverflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
          scroller: scroller ? { ...rect(scroller), top0: Math.round(scroller.scrollTop), max: scroller.scrollHeight - scroller.clientHeight } : null,
          bar, tab, vh: innerHeight, vw: innerWidth, small,
        }
      })()`
      const barOk = (m) => !!m.bar && m.bar.top >= 0 && m.bar.bottom <= m.vh && m.bar.left >= 0 && m.bar.right <= m.vw && (!m.tab || m.bar.bottom <= m.tab.top + 1) && (!m.scroller || m.scroller.bottom <= m.bar.top + 1)

      const m0 = JSON.parse(await ev(`JSON.stringify(${measure})`))
      check(`${label}: the APPS screen is the page`, m0.screen === 'apps' && m0.page, JSON.stringify({ screen: m0.screen, page: m0.page }))
      const want = c.name === '1app' ? 'full' : c.name === '2apps' ? 'stack' : 'lines'
      check(`${label}: layout is ${want}`, m0.layout === want, `layout=${m0.layout} sections=${m0.sections} lines=${m0.lines}`)
      check(`${label}: the document does not scroll`, m0.docScroll <= 0, `by ${m0.docScroll}px`)
      check(`${label}: nothing overflows sideways`, m0.docOverflowX <= 0 && (m0.panelOverflowX ?? 0) <= 0, `doc ${m0.docOverflowX} scroller ${m0.panelOverflowX}`)
      check(`${label}: ask bar on screen above the tab bar, scroller above it (top)`, barOk(m0), JSON.stringify({ bar: m0.bar, tab: m0.tab, scroller: m0.scroller }))
      check(`${label}: every button is at least 44px tall`, m0.small.length === 0, m0.small.join(' | '))
      await shot('top')

      await ev(`(() => { const s = document.querySelector('[data-apps-phone] [data-app-scroll]'); if (s) s.scrollTop = s.scrollHeight })()`)
      await sleep(600)
      const m1 = JSON.parse(await ev(`JSON.stringify(${measure})`))
      check(`${label}: ask bar still on screen after scrolling to the bottom`, barOk(m1) && (m1.scroller.max <= 0 || m1.scroller.top0 > 0), JSON.stringify({ bar: m1.bar, scrolled: m1.scroller?.top0, max: m1.scroller?.max }))
      check(`${label}: the document still does not scroll`, m1.docScroll <= 0)
      await shot('bottom')

      // The round trip, once per viewport (it runs a real chat turn).
      if (c.name === '2apps') {
        const before = m1.scroller?.top0 ?? 0
        // First an EMPTY submit: it only opens the conversation (no turn), and
        // the APPS tab must bring the same page back at once, where it was.
        const appsTab = `(() => { const b = document.querySelector('[data-spine-bar] [aria-label="APPS"]') || [...document.querySelectorAll('[data-spine-bar] a, [data-spine-bar] button')].find((e) => /APPS/.test(e.textContent || '')); b && b.click() })()`
        await ev(`document.querySelector('[data-apps-ask-send]').click()`)
        await sleep(800)
        const emptyScreen = await ev(`document.querySelector('main[data-phone-screen]')?.getAttribute('data-phone-screen')`)
        check(`${label}: an empty bar opens the conversation`, emptyScreen === 'chat', `screen=${emptyScreen}`)
        await ev(appsTab)
        await sleep(400)
        const mb = JSON.parse(await ev(`JSON.stringify(${measure})`))
        check(`${label}: the APPS tab brings the same page back at once, at the scroll it left`, mb.screen === 'apps' && mb.layout === 'stack' && mb.sections === 2 && Math.abs((mb.scroller?.top0 ?? 0) - before) <= 4, `screen ${mb.screen} sections ${mb.sections} before ${before} after ${mb.scroller?.top0}`)
        const chipsOf = `[...document.querySelectorAll('[data-apps-phone] [data-apps-chip][aria-pressed="true"]')].map((e) => e.getAttribute('data-apps-chip')).join(',')`
        const setBefore = await ev(chipsOf)
        await ev(`(() => { const t = document.querySelector('[data-apps-ask-input]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(t, ${JSON.stringify(ASK)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        await sleep(200)
        await ev(`document.querySelector('[data-apps-ask-send]').click()`)
        let inThread = false
        let screen = null
        for (let i = 0; i < 30 && !inThread; i++) {
          await sleep(500)
          screen = await ev(`document.querySelector('main[data-phone-screen]')?.getAttribute('data-phone-screen')`)
          inThread = await ev(`(() => { const s = document.querySelector('main[data-phone-screen="chat"] [data-app-scroll]'); return !!s && s.textContent.includes(${JSON.stringify(ASK)}) })()`)
        }
        check(`${label}: a send from the bar opens the conversation`, screen === 'chat', `screen=${screen}`)
        check(`${label}: the user's ask is in the thread`, inThread)
        await sleep(2500)
        await shot('chat')
        await ev(`(() => { const b = document.querySelector('[data-spine-bar] [aria-label="APPS"]') || [...document.querySelectorAll('[data-spine-bar] a, [data-spine-bar] button')].find((e) => /APPS/.test(e.textContent || '')); b && b.click() })()`)
        await sleep(1500)
        const m2 = JSON.parse(await ev(`JSON.stringify(${measure})`))
        const setAfter = await ev(chipsOf)
        // The chat may turn on an app the ask needs (the planner's own rule):
        // then the page has a different set, and its layout and scroll follow.
        const sameSet = setAfter === setBefore
        check(`${label}: the APPS tab brings the page back`, m2.screen === 'apps' && m2.page && (!sameSet || m2.layout === 'stack'), JSON.stringify({ screen: m2.screen, layout: m2.layout, setBefore, setAfter }))
        if (sameSet) check(`${label}: back at once (no second scan) and at the scroll it left`, m2.sections === 2 && Math.abs((m2.scroller?.top0 ?? 0) - before) <= 4, `sections ${m2.sections} before ${before} after ${m2.scroller?.top0}`)
        else console.log(`   (the chat turned on more apps: ${setBefore} -> ${setAfter}; the scroll check is skipped)`)
        await shot('back')
      }

      const errors = events.filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? e.params.exceptionDetails?.text)
      check(`${label}: no page errors`, errors.length === 0, errors.join(' | '))
      await send('Target.closeTarget', { targetId })
    }
  }
  ws.close()
} finally {
  chrome.kill()
  await new Promise((r) => chrome.once('exit', r))
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
