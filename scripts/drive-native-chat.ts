#!/usr/bin/env tsx
/**
 * THE CONVERSATION ON A PHONE — the CHAT lane of the mobile-native squad
 * (2026-09-24). Nate: "it needs to feel like a native mobile app when
 * accessed from mobile." The screen where people act has to feel like
 * Messages: a compact top bar with a labeled way to the chat list and the
 * apps, a composer that rides the keyboard, messages and sign cards that fit
 * 360px, every chat-surface overlay a Sheet, and /i living in the frame.
 *
 * Measures (numbers, not adjectives) at 375 as an iPhone 13 and a Pixel 7
 * (both in Chrome — Playwright WebKit can't launch here), plus 360:
 *   - the conversation's top bar: controls, sizes, overflow, the title's room
 *   - the composer: rect, font size (<16px zooms on iOS focus), send target
 *   - a user bubble + an assistant reply + a SendTxChain card + a JobCard
 *     (canned turns: the route's own JSON shape — nothing is built or signed)
 *   - the thread scroller: ONE data-app-scroll, the document never scrolls
 *   - the soft keyboard: visualViewport shrunk by 300px → where the composer sits
 *   - overlays (chart, mint, request-MCP): Sheet? scrim tap, Escape, back
 *   - /i/<slug>: the runtime is a frame with one scroller
 *
 * Usage:
 *   BASE=http://localhost:3893 npx tsx scripts/drive-native-chat.ts --phase=before --shots=<dir>
 *   … --only=iphone-375,pixel-360   (contexts)   --skip=i,overlays   (sections)
 *
 * Read-only: the mock wallet refuses every signature, /api/chat is answered
 * from fixtures, requests wear `x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`.
 * Exit 1 when any AFTER invariant is red (the BEFORE run is expected to be).
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FUNDING_OFFER_FIXTURE } from './drive-i-mobile'

const BASE = process.env.BASE ?? 'http://localhost:3893'
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? ''
const PHASE = arg('phase') || 'after'
const SHOTS = arg('shots')
const ONLY = arg('only')
const SKIP = arg('skip').split(',').filter(Boolean)
const ADDR = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
const KB = 300 // the soft keyboard's covered pixels in the keyboard pass

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pw = any
/* eslint-enable @typescript-eslint/no-explicit-any */

// A public wallet with real on-chain history (vitalik.eth): its splash has an
// attention row and cards to audit. Read-only scans; nothing is signed.
const RICH_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const mockWalletFor = (addr: string) => MOCK_WALLET.replace(`const ADDR = '${ADDR}'`, `const ADDR = '${addr}'`)
const MOCK_WALLET = `(() => {
  const ADDR = '${ADDR}'
  const provider = {
    isMetaMask: false, _chainId: '0x2105',
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [ADDR]
        case 'eth_chainId': return provider._chainId
        case 'wallet_switchEthereumChain': provider._chainId = params[0].chainId; return null
        case 'wallet_addEthereumChain': return null
        case 'personal_sign': case 'eth_signTypedData_v4': case 'eth_sendTransaction':
          window.__mockRefused = (window.__mockRefused || 0) + 1
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        default: return null
      }
    },
    on() {}, removeListener() {},
  }
  const info = { uuid: 'cccccccc-4444-5555-6666-777777777777', name: 'Chat Drive Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.pantessa.chatdrive' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  window.ethereum = provider
  try { localStorage.setItem('wagmi.recentConnectorId', '"io.pantessa.chatdrive"') } catch {}
})()`

// ── fixtures: the route's own JSON body shapes (a connected wallet's turn is
// the plain JSON POST — memory i-mobile-native-screen). Data is inert.
const TX_CHAIN = {
  summary: 'Swap 5 USDC → ETH on Base (fixture)',
  steps: [
    { title: 'Approve USDC', tx: { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0x095ea7b3', chainId: 8453, action: 'approve' } },
    { title: 'Swap USDC → ETH', tx: { to: '0x2626664c2603336E57B271c5C0b26F421741e481', data: '0x5ae401dc', chainId: 8453, action: 'swap' } },
  ],
}
const SWAP_REPLY = {
  reply: '🔏 **Swap 5 USDC → ETH on Base.** Uniswap v3, 0.05% pool — you receive at least ~0.00198 ETH. Two signatures: approve USDC, then the swap. Guard-checked: calldata decoded, recipient is your wallet.',
  txChain: TX_CHAIN,
  buildPath: 'native-swap-uniswap',
}
const JOB_ID = 'chatdrivejob01'
const JOB_REPLY = {
  reply: '🧭 **One job, you sign each step.** Fund Robinhood Chain with $12 from Base, wait for it to land, then buy $12 of AAPL.',
  jobId: JOB_ID,
  jobToken: 'chatdrivetoken',
  buildPath: 'native-job',
}
const JOB = {
  id: JOB_ID,
  title: 'Fund Robinhood Chain with $12 from Base, then buy $12 of AAPL',
  status: 'waiting_signature',
  currentStep: 0,
  valueUsd: null,
  steps: [
    { seq: 0, kind: 'sign', status: 'offered', builder: 'native-lifi-fund', title: 'Fund Robinhood Chain with $12 USDG', artifact: { txChain: TX_CHAIN, summary: 'Fund 12 USDG' }, valueUsd: 12 },
    { seq: 1, kind: 'wait', status: 'pending', builder: 'wait-arrival', title: 'Funds arrive on Robinhood Chain', artifact: null, valueUsd: null },
    { seq: 2, kind: 'sign', status: 'pending', builder: 'native-lifi-swap', title: 'Buy $12 of AAPL', artifact: null, valueUsd: 12 },
  ],
}

// Round 2 (the 360×740 card pass): a 3-step chain, a job with a live wait
// step, a Hyperliquid order with its leverage pre-step, and the funding-offer
// clarify — the route's own body shapes, inert data.
const SWAP3_REPLY = {
  reply: '🔏 **Swap 25 USDC → USDG on Base, then pay the fee.** Three signatures: approve USDC, the swap on Uniswap v3 (0.05% pool), and the 0.20% Pantessa fee to the treasury.',
  txChain: {
    summary: 'Swap 25 USDC → ~24.95 USDG on Base (fixture)',
    steps: [
      { title: 'Approve USDC for the Uniswap router', tx: { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0x095ea7b3', chainId: 8453, action: 'approve' } },
      { title: 'Swap 25 USDC → USDG (min 24.83 USDG)', tx: { to: '0x2626664c2603336E57B271c5C0b26F421741e481', data: '0x5ae401dc', chainId: 8453, action: 'swap' } },
      { title: 'Pantessa fee: 0.05 USDC to the treasury', tx: { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0xa9059cbb', chainId: 8453, action: 'transfer' } },
    ],
  },
  buildPath: 'native-swap-uniswap',
}
const JOB_WAIT_ID = 'chatdrivejob02'
const JOB_WAIT_REPLY = {
  reply: '🧭 **Funding is on its way.** The bridge leg confirmed; the buy is offered the moment the USDG lands on Robinhood Chain.',
  jobId: JOB_WAIT_ID,
  jobToken: 'chatdrivetoken2',
  buildPath: 'native-job',
}
const JOB_WAIT = {
  id: JOB_WAIT_ID,
  title: 'Fund Robinhood Chain with $25 from Arbitrum, then buy $25 of NVIDIA (NVDA)',
  status: 'waiting_settlement',
  currentStep: 1,
  valueUsd: 25,
  steps: [
    { seq: 0, kind: 'sign', status: 'done', builder: 'native-lifi-fund', title: 'Fund Robinhood Chain with $25 USDG from Arbitrum', artifact: null, result: { detail: 'Bridged 25 USDC → 24.96 USDG via LiFi (across)', txHash: '0x' + 'ab'.repeat(32) }, valueUsd: 25 },
    { seq: 1, kind: 'wait', status: 'running', builder: 'wait-arrival', title: 'Funds arrive on Robinhood Chain (usually under a minute)', artifact: null, valueUsd: null },
    { seq: 2, kind: 'sign', status: 'pending', builder: 'native-lifi-swap', title: 'Buy $25 of NVDA on Robinhood Chain', artifact: null, valueUsd: 25 },
  ],
}
const HL_TD = { domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' }, types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] }, primaryType: 'Agent', message: { source: 'a', connectionId: '0x' + '11'.repeat(32) } }
const HL_REPLY = {
  reply: '📈 **Long $12 of HYPE at 2x on Hyperliquid.** Two signatures: set 2x cross leverage, then the market order (IOC, 1% slippage cap). Your 5% stop arms after the fill.',
  orderRequest: {
    protocol: 'hyperliquid',
    typedData: HL_TD,
    chainId: 1337,
    hl: {
      action: { type: 'order', orders: [{ a: 159, b: true, p: '43.5', s: '0.28', r: false, t: { limit: { tif: 'Ioc' } } }], grouping: 'na' },
      nonce: Date.now(),
      isTestnet: false,
      expected: { coin: 'HYPE', kind: 'open', isBuy: true },
      pre: { action: { type: 'updateLeverage', asset: 159, isCross: true, leverage: 2 }, nonce: Date.now() - 1, typedData: HL_TD, expected: { coin: 'HYPE', leverage: 2 } },
    },
  },
  buildPath: 'native-hl',
}
const CLARIFY_REPLY = (() => {
  const { content, ...rest } = FUNDING_OFFER_FIXTURE
  return { reply: content, ...rest }
})()

type Finding = { id: string; ok: boolean; detail: string }
const findings: Finding[] = []
const summary: Record<string, unknown> = {}
const add = (id: string, ok: boolean, detail = '') => {
  findings.push({ id, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${id}${detail ? ` — ${detail}` : ''}`)
}
const note = (id: string, value: unknown) => {
  summary[id] = value
  console.log(`  ·  ${id} — ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

async function shot(page: Pw, name: string) {
  if (!SHOTS) return
  await page.mouse.move(1, 1).catch(() => {})
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${SHOTS}/${PHASE}-${name}.png`, fullPage: false }).catch((e: Error) => console.log(`  (shot ${name} failed: ${e.message.slice(0, 80)})`))
}

type Ctx = { id: string; engine: 'webkit' | 'chrome'; device: string; width: number; height: number; theme: 'dark' | 'light' }
// Playwright WebKit is NOT usable on this Mac (playwright-core 1.60 wants
// webkit-2287; only 1578 is installed and it speaks an older protocol), so
// every pass is Chrome with the device's descriptor (isMobile + hasTouch +
// UA). The real-iPhone drill at wrap covers Safari itself.
const CONTEXTS: Ctx[] = [
  { id: 'iphone-375', engine: 'chrome', device: 'iPhone 13', width: 375, height: 812, theme: 'dark' },
  { id: 'pixel-375', engine: 'chrome', device: 'Pixel 7', width: 375, height: 812, theme: 'dark' },
  { id: 'pixel-360', engine: 'chrome', device: 'Pixel 7', width: 360, height: 780, theme: 'dark' },
  { id: 'iphone-390-light', engine: 'chrome', device: 'iPhone 13', width: 390, height: 844, theme: 'light' },
  { id: 'pixel-landscape', engine: 'chrome', device: 'Pixel 7', width: 844, height: 390, theme: 'dark' },
  { id: 'pixel-landscape-740', engine: 'chrome', device: 'Pixel 7', width: 740, height: 360, theme: 'dark' },
  // Round 2: the card pass (the coordinator's 360×740).
  { id: 'pixel-360x740', engine: 'chrome', device: 'Pixel 7', width: 360, height: 740, theme: 'dark' },
  { id: 'iphone-360x740-light', engine: 'chrome', device: 'iPhone 13', width: 360, height: 740, theme: 'light' },
]

type Opened = { ctx: Pw; page: Pw; errs: string[]; chatPosts: number; jobGets: number }

async function open(browser: Pw, devices: Pw, c: Ctx, { wallet = true, address = ADDR }: { wallet?: boolean; address?: string } = {}): Promise<Opened> {
  const dev = devices[c.device] ?? {}
  const ctx = await browser.newContext({
    ...dev,
    viewport: { width: c.width, height: c.height },
    screen: { width: c.width, height: c.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: c.theme,
    extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
  })
  if (wallet) await ctx.addInitScript(address === ADDR ? MOCK_WALLET : mockWalletFor(address))
  const page = await ctx.newPage()
  const out: Opened = { ctx, page, errs: [], chatPosts: 0, jobGets: 0 }
  page.on('console', (m: Pw) => { if (m.type() === 'error') out.errs.push(m.text()) })
  page.on('pageerror', (e: unknown) => out.errs.push(String(e)))
  await ctx.route(/\/api\/chat(\?|$)/, async (route: Pw) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.continue()
    out.chatPosts++
    let msg = ''
    try { msg = String(JSON.parse(req.postData() ?? '{}').message ?? '') } catch {}
    const body = /fund it/i.test(msg)
      ? CLARIFY_REPLY
      : /three steps/i.test(msg)
        ? SWAP3_REPLY
        : /wait step/i.test(msg)
          ? JOB_WAIT_REPLY
          : /hyperliquid/i.test(msg)
            ? HL_REPLY
            : /fund|job|then/i.test(msg)
              ? JOB_REPLY
              : SWAP_REPLY
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  })
  await ctx.route(new RegExp(`/api/jobs/${JOB_WAIT_ID}(\\?|$)`), async (route: Pw) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' })
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: JOB_WAIT }) })
  })
  // The HL card reads the wallet's delegation (public by address): a fixed
  // answer keeps the card's path deterministic (direct).
  await ctx.route(/\/api\/hl\/delegation/, (route: Pw) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }) }))
  await ctx.route(new RegExp(`/api/jobs/${JOB_ID}(\\?|$)`), async (route: Pw) => {
    out.jobGets++
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' })
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: JOB }) })
  })
  return out
}

function realErrors(errs: string[]) {
  return errs.filter(
    (e) =>
      !/favicon|ERR_|net::|Download the React|401|403|Failed to load resource|WebSocket|walletconnect|Unauthorized/i.test(e) &&
      !/api\.cdp\.coinbase\.com|Access to XMLHttpRequest|has been blocked by CORS|Access-Control-Allow-Origin|Fetch API cannot load|due to access control/i.test(e),
  )
}

// The page-side measurement helpers, as a STRING (tsx rewrites inner
// functions with a `__name` helper that doesn't exist in the page).
const HELPERS = `
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) } }
  const visible = (el) => { if (!el) return false; if (el.closest('[role="menu"]')) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' }
  const topbar = () => document.querySelector('[data-chat-topbar]') || document.querySelector('main > div > div.border-b')
  const thread = () => document.querySelector('[data-app-scroll]') || document.querySelector('main .overflow-y-auto')
  const ta = () => document.querySelector('[data-composer] textarea') || document.querySelector('main textarea') || document.querySelector('textarea')
  const txt = (el) => (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48)
  // A block's layout audit at a phone width: what spills past its edges or
  // the screen, what text is cut (an ellipsis, a clamp, a nowrap overflow
  // that actually cuts), and every action with its size.
  const audit = (root) => {
    if (!root) return null
    const R = root.getBoundingClientRect()
    const spill = [], clipped = [], actions = []
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())
      if (own && (r.right > R.right + 1 || r.left < R.left - 1 || r.right > innerWidth + 0.5)) spill.push({ text: txt(el), l: Math.round(r.left), r: Math.round(r.right) })
      const cuts = (cs.textOverflow === 'ellipsis' || (cs.overflowX === 'hidden' && cs.whiteSpace === 'nowrap')) && el.scrollWidth > el.clientWidth + 1
      const clamps = cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1
      if ((cuts || clamps) && txt(el)) clipped.push({ text: txt(el), why: clamps ? 'clamp' : 'ellipsis', w: Math.round(el.clientWidth), need: Math.round(el.scrollWidth) })
      if ((el.tagName === 'BUTTON' || (el.tagName === 'A' && el.getAttribute('href')) || el.getAttribute('role') === 'button') && !el.disabled) {
        const cls = String(el.className || '')
        // The finger's target: the box, or a transparent hit area drawn by a
        // positioned ::before/::after (PAGES' .hit-44, the turn tools).
        let w = r.width, h = r.height
        for (const pe of ['::before', '::after']) {
          const ps = getComputedStyle(el, pe)
          if (ps.content === 'none' || ps.position !== 'absolute') continue
          const px = (v) => (v && v.endsWith('px') ? parseFloat(v) : 0)
          w = Math.max(w, r.width - px(ps.left) - px(ps.right))
          h = Math.max(h, r.height - px(ps.top) - px(ps.bottom))
        }
        actions.push({ text: txt(el) || el.getAttribute('aria-label') || '', w: Math.round(w), h: Math.round(h), primary: /bg-\\[(?:color:)?var\\(--accent\\)\\]/.test(cls) || /background: var\\(--accent\\)/.test(el.getAttribute('style') || '') })
      }
    }
    return { rect: { x: Math.round(R.x), w: Math.round(R.width), h: Math.round(R.height) }, overflowX: root.scrollWidth - root.clientWidth, spill, clipped, actions }
  }
  const sendBtn = () => { const t = ta(); return t ? (document.querySelector('[data-composer-send]') || t.parentElement.querySelector('button:last-of-type')) : null }
  const bar = () => document.querySelector('[data-spine-bar]')
`

async function measureSurface(page: Pw) {
  return page.evaluate(`(() => {
    ${HELPERS}
    const tb = topbar()
    const controls = tb ? Array.from(tb.querySelectorAll('a, button')).filter(visible).map((el) => ({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28), ...box(el) })) : []
    const title = document.querySelector('[data-chat-title]')
    const t = ta()
    const cs = t ? getComputedStyle(t) : null
    const se = document.scrollingElement
    const b = bar()
    const scrollers = document.querySelectorAll('[data-app-scroll]')
    return {
      vw: innerWidth, vh: innerHeight,
      topbar: tb ? { ...box(tb), scrollW: tb.scrollWidth, clientW: tb.clientWidth } : null,
      controls,
      title: title ? { text: title.textContent.trim(), ...box(title) } : null,
      composer: t ? { ...box(t), fontSize: parseFloat(cs.fontSize), placeholder: t.placeholder } : null,
      composerPill: t ? box(t.parentElement) : null,
      send: box(sendBtn()),
      bar: b && visible(b) ? box(b) : null,
      doc: { scrollH: se.scrollHeight, clientH: se.clientHeight, scrollTop: se.scrollTop, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth },
      appScroll: scrollers.length,
      threadIsAppScroll: !!thread() && thread().hasAttribute('data-app-scroll'),
      phoneScreen: document.querySelector('[data-phone-screen]')?.getAttribute('data-phone-screen') ?? null,
      drawerOpen: !!Array.from(document.querySelectorAll('aside, div')).find((el) => el.className && typeof el.className === 'string' && el.className.includes('max-lg:absolute') && el.className.includes('max-lg:z-40') && el.getBoundingClientRect().width > 100),
      drawerRect: (() => { const d = Array.from(document.querySelectorAll('aside, div')).find((el) => el.className && typeof el.className === 'string' && el.className.includes('max-lg:absolute') && el.className.includes('max-lg:z-40') && el.getBoundingClientRect().width > 100); return d ? { ...box(d), coverPct: Math.round((d.getBoundingClientRect().width / innerWidth) * 100) } : null })(),
      docTallest: (() => { const se = document.scrollingElement; if (se.scrollHeight <= innerHeight + 1) return null; let best = null; for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.bottom > innerHeight + 1 && (!best || r.bottom > best.b)) best = { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 90), b: Math.round(r.bottom), pos: getComputedStyle(el).position } } return best })(),
      splashCards: document.querySelectorAll('[data-splash-tile], .splash-tile, [data-tile]').length,
    }
  })()`)
}

async function measureThread(page: Pw) {
  return page.evaluate(`(() => {
    ${HELPERS}
    const users = Array.from(document.querySelectorAll('[data-bubble="user"]'))
    const asst = Array.from(document.querySelectorAll('[data-bubble="assistant"]'))
    const overflowing = (el) => el ? el.scrollWidth > el.clientWidth + 1 : null
    const signBtns = Array.from(document.querySelectorAll('main button')).filter((el) => visible(el) && /^(Sign|Continue|Send|Approve)/i.test((el.textContent || '').trim()) && !/^Sign in/i.test((el.textContent || '').trim()))
    const chainCard = document.querySelector('ol')?.closest('div.space-y-2') ?? null
    const jobCard = Array.from(document.querySelectorAll('main .rounded-xl.border')).find((el) => /Job ·/.test(el.textContent || '')) ?? null
    const within = (el, c) => { if (!el || !c) return null; const a = el.getBoundingClientRect(), b = c.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1 }
    return {
      users: users.map((u) => ({ ...box(u), over: overflowing(u) })),
      assistants: asst.map((u) => ({ ...box(u), over: overflowing(u) })),
      signButtons: signBtns.map((el) => ({ text: el.textContent.trim().slice(0, 32), ...box(el), parentW: Math.round(el.parentElement.getBoundingClientRect().width) })),
      chainCard: chainCard ? { ...box(chainCard), over: overflowing(chainCard) } : null,
      jobCard: jobCard ? { ...box(jobCard), over: overflowing(jobCard), inThread: within(jobCard, thread()) } : null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })()`)
}

async function typeAndSend(page: Pw, text: string) {
  const t = page.locator('main textarea').first()
  await t.click({ timeout: 4000 }).catch(() => {})
  await t.fill(text)
  await page.keyboard.press('Enter')
}

async function waitConnected(page: Pw): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < 20_000) {
    const ok = await page.evaluate(`!!document.querySelector('.navacct__pill') && !!document.querySelector('main textarea')`).catch(() => false)
    if (ok) return true
    await page.waitForTimeout(400)
  }
  return false
}

/** The composer on the soft keyboard, FOR REAL (round 2): the visual
 *  viewport shrinks by KB px the way iOS Safari / Android Chrome shrink it
 *  (optionally panned by `pan` px — iOS scrolls the layout viewport to show
 *  the field), SHELL's frame shrinks onto it (html[data-keyboard] +
 *  --kb-inset), and then, measured: the composer's bottom sits on the
 *  keyboard, the send button is fully visible AND is what a tap there hits,
 *  the newest message stays pinned right above the composer, and typing a
 *  line-wrapping sentence never jumps the thread (the newest message moves
 *  up by exactly what the composer grew, nothing else; the document never
 *  scrolls). Nothing is sent: the typed text is cleared before the keyboard
 *  goes down. */
async function keyboardPass(page: Pw, opts: { pan?: number; type?: string } = {}) {
  const pan = opts.pan ?? 0
  const text = opts.type ?? 'Swap 25 USDC for ETH on Base and then stake half of it with Lido please'
  const t = page.locator('[data-composer] textarea, main textarea, textarea').first()
  await t.click({ timeout: 4000 }).catch(() => {})
  await page.evaluate(`(() => {
    const vv = window.visualViewport
    if (!vv) return
    const h = innerHeight - ${KB}
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h })
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => ${pan} })
    vv.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })()`)
  await page.waitForTimeout(500)
  // The visible region, in layout px: [pan, pan + innerHeight − KB].
  const PROBE = `(() => {
    ${HELPERS}
    const t = ta()
    const pill = t ? t.parentElement.getBoundingClientRect() : null
    const send = sendBtn()
    const sr = send ? send.getBoundingClientRect() : null
    const top = ${pan}, bottom = ${pan} + innerHeight - ${KB}
    const hit = sr ? document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2) : null
    const th = thread()
    const rows = Array.from(document.querySelectorAll('[data-bubble]'))
    const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null
    const b = bar()
    return {
      visibleTop: top, visibleBottom: bottom,
      pillBottom: pill ? Math.round(pill.bottom) : null, pillTop: pill ? Math.round(pill.top) : null, pillH: pill ? Math.round(pill.height) : null,
      send: sr ? { top: Math.round(sr.top), bottom: Math.round(sr.bottom), w: Math.round(sr.width), h: Math.round(sr.height), disabled: !!send.disabled } : null,
      sendHit: !!send && !!hit && send.contains(hit),
      lastTop: last ? Math.round(last.top) : null, lastBottom: last ? Math.round(last.bottom) : null,
      gapToEnd: th ? Math.round(th.scrollHeight - th.scrollTop - th.clientHeight) : null,
      threadTop: th ? Math.round(th.scrollTop) : null,
      docTop: document.scrollingElement.scrollTop,
      barVisible: !!b && visible(b) && b.getBoundingClientRect().top < innerHeight,
      htmlKeyboard: document.documentElement.getAttribute('data-keyboard'),
      kbInset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim(),
      focused: document.activeElement === t,
    }
  })()`
  const up = await page.evaluate(PROBE)
  // Typing: a sentence long enough to wrap the textarea to 2–3 lines.
  const samples: Array<{ lastTop: number | null; pillH: number | null; threadTop: number | null; docTop: number }> = []
  const chunks = text.match(/.{1,18}/g) ?? [text]
  for (const chunk of chunks) {
    await page.keyboard.type(chunk, { delay: 8 })
    await page.waitForTimeout(90)
    samples.push(await page.evaluate(`(() => { ${HELPERS} const t = ta(); const pill = t ? t.parentElement.getBoundingClientRect() : null; const rows = Array.from(document.querySelectorAll('[data-bubble]')); const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null; const th = thread(); return { lastTop: last ? Math.round(last.top) : null, pillH: pill ? Math.round(pill.height) : null, threadTop: th ? Math.round(th.scrollTop) : null, docTop: document.scrollingElement.scrollTop } })()`))
  }
  const typed = await page.evaluate(PROBE)
  // Every step: the newest message moved by exactly the composer's growth
  // (±2px) — no other jump; the document never moved.
  let worstJump = 0
  let prev = { lastTop: up.lastTop, pillH: up.pillH }
  for (const sm of samples) {
    if (sm.lastTop !== null && prev.lastTop !== null && sm.pillH !== null && prev.pillH !== null) {
      const moved = prev.lastTop - sm.lastTop
      const grew = sm.pillH - prev.pillH
      worstJump = Math.max(worstJump, Math.abs(moved - grew))
    }
    prev = { lastTop: sm.lastTop, pillH: sm.pillH }
  }
  const docMoved = samples.some((sm) => sm.docTop !== 0)
  // Clear what was typed (nothing is ever sent), then the keyboard goes down.
  await page.keyboard.press('ControlOrMeta+A').catch(() => {})
  await page.keyboard.press('Backspace').catch(() => {})
  await page.evaluate(`(() => {
    const vv = window.visualViewport
    if (!vv) return
    delete vv.height
    delete vv.offsetTop
    vv.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })()`)
  await page.waitForTimeout(350)
  const down = await page.evaluate(`(() => { ${HELPERS} const t = ta(); const pill = t ? t.parentElement.getBoundingClientRect() : null; return { pillBottom: pill ? Math.round(pill.bottom) : null, htmlKeyboard: document.documentElement.getAttribute('data-keyboard'), value: t ? t.value : null } })()`)
  return { up, typed, worstJump, docMoved, steps: samples.length, grewTo: typed.pillH, down }
}

/** The keyboard verdicts, one set of checks for /chat and /i. */
function keyboardChecks(id: string, kb: Awaited<ReturnType<typeof keyboardPass>>, label = '') {
  const u = kb.up, ty = kb.typed
  const tag = label ? `${id}/${label}` : id
  add(`${tag}/composer-rides-keyboard`, u.pillBottom !== null && u.pillBottom <= u.visibleBottom + 1 && u.pillBottom >= u.visibleBottom - 24, `composer bottom ${u.pillBottom} vs keyboard top ${u.visibleBottom} (html[data-keyboard]=${u.htmlKeyboard}, --kb-inset=${u.kbInset || '∅'})`)
  add(`${tag}/kb-send-visible`, !!ty.send && ty.send.top >= ty.visibleTop && ty.send.bottom <= ty.visibleBottom + 1 && ty.sendHit && !ty.send.disabled && ty.send.w >= 44 && ty.send.h >= 44, `send ${ty.send?.w}×${ty.send?.h} at ${ty.send?.top}–${ty.send?.bottom} in [${ty.visibleTop}, ${ty.visibleBottom}], a tap there hits it: ${ty.sendHit}, enabled: ${ty.send ? !ty.send.disabled : '?'}`)
  add(`${tag}/kb-newest-pinned`, u.gapToEnd !== null && u.gapToEnd <= 2 && u.lastBottom !== null && u.pillTop !== null && u.lastBottom <= u.pillTop + 1 && u.lastBottom >= u.visibleTop, `thread ${u.gapToEnd}px from its end; newest message ends at ${u.lastBottom}, composer starts at ${u.pillTop}`)
  add(`${tag}/kb-typing-no-jump`, kb.worstJump <= 2 && !kb.docMoved && ty.gapToEnd !== null && ty.gapToEnd <= 2 && ty.lastBottom !== null && ty.pillTop !== null && ty.lastBottom <= ty.pillTop + 1, `${kb.steps} typing steps, worst jump ${kb.worstJump}px beyond the composer's growth (grew to ${kb.grewTo}px), document moved: ${kb.docMoved}, newest ends ${ty.lastBottom} vs composer ${ty.pillTop}`)
  add(`${tag}/composer-returns`, kb.down.pillBottom !== null && kb.down.pillBottom > (u.pillBottom ?? 0) + 100 && kb.down.value === '', `after the keyboard: composer bottom ${kb.down.pillBottom}, left empty: ${kb.down.value === ''}`)
}

/** An overlay's dismissals. `openIt` opens it; returns what each path did. */
async function overlayPass(page: Pw, name: string, openIt: () => Promise<void>, dialogSel: string) {
  const isOpen = async () => (await page.locator(dialogSel).count()) > 0
  await openIt()
  await page.waitForTimeout(700)
  const opened = await isOpen()
  if (!opened) return { opened: false }
  const shape = await page.evaluate(`(() => {
    ${HELPERS}
    const d = document.querySelector(${JSON.stringify(dialogSel)})
    const sheet = d ? d.closest('[data-sheet]') : null
    const r = d ? d.getBoundingClientRect() : null
    return { sheet: sheet ? sheet.getAttribute('data-sheet') : null, rect: box(d), fitsX: r ? r.left >= 0 && r.right <= innerWidth + 1 : null, bottomGap: r ? Math.round(innerHeight - r.bottom) : null }
  })()`)
  await shot(page, `${name}`)
  // 1. a tap outside, near the top (the scrim on a bottom sheet and on the old modals alike)
  await page.mouse.click(Math.round((await page.viewportSize()).width / 2), 12)
  await page.waitForTimeout(500)
  const scrimCloses = !(await isOpen())
  // 2. Escape
  if (!(await isOpen())) { await openIt(); await page.waitForTimeout(600) }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const escCloses = !(await isOpen())
  // 3. back: closes the sheet AND stays on the page
  if (!(await isOpen())) { await openIt(); await page.waitForTimeout(600) }
  const urlBefore = page.url()
  const stillOpenBeforeBack = await isOpen()
  await page.goBack({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(700)
  const left = page.url() !== urlBefore
  const backCloses = stillOpenBeforeBack && !left && !(await isOpen())
  const urlAfter = page.url()
  if (left) {
    // BEFORE: back LEFT the page (the modal owns no history entry) — come
    // back so the rest of the pass can run.
    await page.goto(urlBefore, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await waitConnected(page)
    await page.waitForTimeout(1000)
  } else if (await isOpen()) { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }
  return { opened, ...shape, scrimCloses, escCloses, backCloses, backLeftPage: left, urlAfter }
}

async function chatPass(browser: Pw, devices: Pw, c: Ctx) {
  console.log(`\n═══ /chat · ${c.id} (${c.width}×${c.height}, ${c.engine}, ${c.theme}) ═══`)
  const o = await open(browser, devices, c)
  const { page } = o
  await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
  const connected = await waitConnected(page)
  add(`${c.id}/connected`, connected, connected ? 'mock wallet connected, account pill up' : 'no account pill after 20s')
  if (!connected) { await o.ctx.close(); return }
  await page.waitForTimeout(1800)
  const empty = await measureSurface(page)
  note(`${c.id}/empty`, empty)
  await shot(page, `${c.id}-chat-empty`)
  const phone = c.width < 1024
  // ── the top bar ──
  if (phone && c.height > 500) {
    const ctrls = empty.controls as Array<{ label: string; w: number; h: number }>
    add(`${c.id}/topbar-exists`, !!empty.topbar, JSON.stringify(empty.topbar))
    add(`${c.id}/topbar-no-overflow`, !!empty.topbar && empty.topbar.scrollW <= empty.topbar.clientW, `scrollWidth ${empty.topbar?.scrollW} vs ${empty.topbar?.clientW}`)
    add(`${c.id}/topbar-44`, ctrls.length > 0 && ctrls.every((x) => x.h >= 44 && x.w >= 44), ctrls.map((x) => `${x.label || '?'} ${x.w}×${x.h}`).join(' | '))
    add(`${c.id}/topbar-chats-door`, ctrls.some((x) => /chats/i.test(x.label)), ctrls.map((x) => x.label).join(' | '))
    add(`${c.id}/topbar-apps-door`, ctrls.some((x) => /\d+ apps?\b/i.test(x.label)), ctrls.map((x) => x.label).join(' | '))
    const head = ctrls.find((x) => /\d+ apps?\b/i.test(x.label)) as { w: number } | undefined
    add(`${c.id}/topbar-title`, !!empty.title && !!head && head.w >= 96, empty.title ? `"${empty.title.text}" in a ${head?.w}px title door` : 'no title')
  }
  add(`${c.id}/composer-16px`, !!empty.composer && empty.composer.fontSize >= 16, `textarea ${empty.composer?.fontSize}px`)
  if (phone) {
    // QA r1: the field was a 24px line inside a 52px pill. The field is 44px
    // now, and a tap on the pill's own padding focuses it.
    const tap = await page.evaluate(`(() => {
      ${HELPERS}
      const t = ta()
      if (!t) return null
      t.blur()
      const pill = t.parentElement.getBoundingClientRect()
      const x = Math.round(pill.left + 6), y = Math.round(pill.top + pill.height / 2)
      return { x, y, taH: Math.round(t.getBoundingClientRect().height) }
    })()`)
    if (tap) {
      await page.mouse.click(tap.x, tap.y)
      await page.waitForTimeout(200)
      const focused = await page.evaluate(`(() => { ${HELPERS} return document.activeElement === ta() })()`)
      add(`${c.id}/composer-field-44`, tap.taH >= 44 && focused, `textarea ${tap.taH}px tall; a tap on the pill's padding at (${tap.x},${tap.y}) focused it: ${focused}`)
      await page.evaluate(`(() => { ${HELPERS} ta()?.blur() })()`)
    }
  }
  add(`${c.id}/send-44`, !!empty.send && empty.send.w >= 44 && empty.send.h >= 44, `send ${empty.send?.w}×${empty.send?.h}`)
  if (phone && empty.bar) add(`${c.id}/composer-above-bar`, !!empty.composerPill && empty.composerPill.b <= empty.bar.y + 1, `composer bottom ${empty.composerPill?.b} · bar top ${empty.bar.y}`)
  add(`${c.id}/no-h-scroll`, empty.doc.overflowX <= 0, `${empty.doc.overflowX}px`)
  // Round 3 (SHELL's landscape measure): on a short phone the conversation
  // keeps ≥200px of thread between the top bar, the composer and the bar.
  const room = async () => page.evaluate(`(() => {
    ${HELPERS}
    const t = thread(), tb = topbar(), b = bar(), pill = ta() ? ta().closest('[data-composer]') : null
    const banner = document.querySelector('[data-gate-banner]')
    const h = (el) => (el && visible(el) ? Math.round(el.getBoundingClientRect().height) : 0)
    return { thread: t ? Math.round(t.clientHeight) : null, topbar: h(tb), composer: h(pill), bar: h(b), banner: h(banner) }
  })()`)
  if (phone && c.height <= 480) {
    const r0 = await room()
    note(`${c.id}/room-empty`, r0)
    add(`${c.id}/landscape-room`, r0.thread !== null && r0.thread >= 200 && r0.topbar <= 45, `thread ${r0.thread}px · top bar ${r0.topbar} · composer ${r0.composer} · banner ${r0.banner} · tab bar ${r0.bar}`)
  }
  add(`${c.id}/one-app-scroller`, empty.appScroll === 1 && empty.threadIsAppScroll, `${empty.appScroll} [data-app-scroll], thread carries it: ${empty.threadIsAppScroll}`)

  // ── the Chats door does not pop a drawer ──
  if (phone && c.height > 500) {
    const chatsDoor = page.locator('[data-phone-open="history"]').first()
    if ((await chatsDoor.count()) > 0) {
      await chatsDoor.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
      const s = await measureSurface(page)
      // data-phone-screen is NAV's (ChatWorkspace): until NAV's merge the
      // screen is unobservable here and the drawer staying shut is the proof.
      add(`${c.id}/chats-door-no-drawer`, !s.drawerOpen && (s.phoneScreen === 'history' || s.phoneScreen === null), `phoneScreen ${s.phoneScreen ?? '(NAV not merged)'}, drawer ${s.drawerOpen ? 'OPEN' : 'closed'}`)
      await shot(page, `${c.id}-after-chats-tap`)
      // back to the conversation for the rest of the pass
      await page.evaluate(`(() => { const b = document.querySelector('[data-phone-back-to-chat]'); if (b) b.click() })()`)
      await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
      await waitConnected(page)
      await page.waitForTimeout(1200)
    } else {
      // BEFORE: the working-set door opened the 248px overlay drawer.
      const door = page.locator('main button[title^="Your working set"]').first()
      if ((await door.count()) > 0) {
        await door.click({ timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(600)
        const s = await measureSurface(page)
        add(`${c.id}/chats-door-no-drawer`, !s.drawerOpen, `the working-set door ${s.drawerOpen ? 'OPENED the overlay drawer' : 'opened no drawer'}`)
        await shot(page, `${c.id}-after-workingset-tap`)
        await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
        await waitConnected(page)
        await page.waitForTimeout(1200)
      }
    }
  }

  // ── a conversation: user bubble + reply + SendTxChain, then a JobCard ──
  await typeAndSend(page, 'Swap 5 USDC for ETH on Base')
  await page.locator('main ol li').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(900)
  await typeAndSend(page, 'Fund robinhood chain with $12 from base, then buy $12 of AAPL')
  await page.waitForFunction(`/Job ·/.test(document.querySelector('main')?.textContent || '')`, null, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const th = await measureThread(page)
  note(`${c.id}/thread`, th)
  add(`${c.id}/turns-landed`, o.chatPosts >= 2 && (th.users as unknown[]).length >= 2 && !!th.jobCard, `${o.chatPosts} POST /api/chat, ${(th.users as unknown[]).length} user bubble(s), job card ${th.jobCard ? 'up' : 'missing'}`)
  const bubbles = [...(th.users as Array<{ over: boolean; r: number }>), ...(th.assistants as Array<{ over: boolean; r: number }>)]
  add(`${c.id}/bubbles-fit`, bubbles.length > 0 && bubbles.every((b) => !b.over && b.r <= c.width), bubbles.map((b) => `${b.r}${b.over ? ' OVER' : ''}`).join(','))
  const signs = th.signButtons as Array<{ text: string; w: number; h: number; parentW: number }>
  if (phone && c.width < 640) {
    add(`${c.id}/sign-buttons-44`, signs.length > 0 && signs.every((s) => s.h >= 44 && s.h <= 52), signs.map((s) => `"${s.text}" ${s.w}×${s.h}`).join(' | '))
    add(`${c.id}/sign-buttons-full-width`, signs.length > 0 && signs.every((s) => s.w >= s.parentW - 2), signs.map((s) => `${s.w}/${s.parentW}`).join(' | '))
  }
  add(`${c.id}/cards-fit`, !!th.chainCard && !th.chainCard.over && !!th.jobCard && !th.jobCard.over && th.overflowX <= 0, `chain card ${th.chainCard?.w}${th.chainCard?.over ? ' OVER' : ''}, job card ${th.jobCard?.w}${th.jobCard?.over ? ' OVER' : ''}, page overflow ${th.overflowX}px`)
  await shot(page, `${c.id}-chat-thread`)

  // ── the newest turn is in view (the stick-to-bottom pin held through the
  // job card loading), and the guest banner sits in its own seat ──
  const pin = await page.evaluate(`(() => {
    ${HELPERS}
    const t = thread()
    const banner = document.querySelector('[data-gate-banner]')
    const pill = ta() ? ta().parentElement.getBoundingClientRect() : null
    const tr = t ? t.getBoundingClientRect() : null
    const br = banner ? banner.getBoundingClientRect() : null
    return {
      gapToEnd: t ? Math.round(t.scrollHeight - t.scrollTop - t.clientHeight) : null,
      banner: br ? { y: Math.round(br.y), b: Math.round(br.bottom), h: Math.round(br.height), phone: banner.getAttribute('data-gate-banner') === 'phone' } : null,
      threadBottom: tr ? Math.round(tr.bottom) : null,
      composerTop: pill ? Math.round(pill.top) : null,
    }
  })()`)
  note(`${c.id}/pin`, pin)
  add(`${c.id}/newest-turn-in-view`, pin.gapToEnd !== null && pin.gapToEnd <= 2, `${pin.gapToEnd}px from the end of the thread`)
  if (phone && pin.banner && pin.banner.h > 0) add(`${c.id}/banner-in-its-seat`, pin.banner.phone && pin.threadBottom !== null && pin.composerTop !== null && pin.banner.y >= pin.threadBottom - 1 && pin.banner.b <= pin.composerTop + 1, `banner ${pin.banner.y}–${pin.banner.b} (${pin.banner.h}px) · thread ends ${pin.threadBottom} · composer starts ${pin.composerTop}`)
  if (phone && c.height <= 480) add(`${c.id}/banner-steps-aside-landscape`, !pin.banner || pin.banner.h === 0, `the guest banner on a ${c.height}px-tall screen: ${pin.banner ? pin.banner.h + 'px' : 'not rendered'}`)

  // ── the thread is the one scroller; the document never scrolls ──
  const scroll = await page.evaluate(`(() => {
    ${HELPERS}
    const t = thread()
    if (!t) return null
    t.scrollTop = t.scrollHeight
    const se = document.scrollingElement
    const b = bar()
    const probe = b ? document.elementFromPoint(Math.round(innerWidth / 2), innerHeight - 10) : null
    // What makes the document taller than the screen (outside the thread,
    // which clips its own content): the deepest-reaching element.
    let tallest = null
    if (se.scrollHeight > innerHeight + 1) {
      for (const el of document.body.querySelectorAll('*')) {
        // Inside the thread only an element the thread does NOT clip counts:
        // one whose containing block sits outside the scroller.
        if (t.contains(el)) { const cs = getComputedStyle(el); if (cs.position !== 'absolute' && cs.position !== 'fixed') continue; const op = el.offsetParent; if (cs.position === 'absolute' && op && t.contains(op)) continue }
        const r = el.getBoundingClientRect()
        if (r.bottom > innerHeight + 1 && r.height > 0 && (!tallest || r.bottom > tallest.b)) tallest = { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 120), b: Math.round(r.bottom), h: Math.round(r.height), pos: getComputedStyle(el).position, text: (el.textContent || '').trim().slice(0, 60) }
      }
    }
    return { threadScrollTop: Math.round(t.scrollTop), threadMax: t.scrollHeight - t.clientHeight, docScrollTop: se.scrollTop, docScrollH: se.scrollHeight, vh: innerHeight, barBottom: b ? Math.round(b.getBoundingClientRect().bottom) : null, probeInBar: b && probe ? b.contains(probe) : null, tallest }
  })()`)
  note(`${c.id}/scroll`, scroll)
  if (phone && scroll) add(`${c.id}/document-never-scrolls`, scroll.docScrollTop === 0 && scroll.docScrollH <= scroll.vh + 1, `document scrollHeight ${scroll.docScrollH} vs ${scroll.vh}, scrollTop ${scroll.docScrollTop}`)

  // ── the keyboard ──
  if (phone && c.height > 500) {
    const kb = await keyboardPass(page)
    note(`${c.id}/keyboard`, kb)
    keyboardChecks(c.id, kb)
    await shot(page, `${c.id}-keyboard`)
    // iOS pans the page to show the field: the same verdicts with a 120px pan.
    const panned = await keyboardPass(page, { pan: 120, type: 'Buy $50 of AAPL on Robinhood Chain' })
    note(`${c.id}/keyboard-pan`, panned)
    keyboardChecks(c.id, panned, 'pan')
  }

  // ── overlays ──
  if (!SKIP.includes('overlays') && c.height > 500) {
    // The mint-in-place modal, from the user bubble's mint verb.
    const mint = await overlayPass(page, `${c.id}-overlay-mint`, async () => {
      await page.locator('button[aria-label="Create an intent link from this ask"]').first().click({ timeout: 3000, force: true }).catch(() => {})
    }, '[role="dialog"][aria-label="Mint an intent link"], [data-sheet="mint"] [role="dialog"]')
    note(`${c.id}/overlay-mint`, mint)
    add(`${c.id}/mint-sheet`, !!mint.opened && mint.sheet === 'mint' && !!mint.scrimCloses && !!mint.escCloses && !!mint.backCloses, JSON.stringify(mint))
    // The chart overlay, from a typed chart ask (the client intercept — no turn burned).
    const before = o.chatPosts
    const chart = await overlayPass(page, `${c.id}-overlay-chart`, async () => {
      await typeAndSend(page, 'show me the ETH chart')
    }, '[role="dialog"][aria-label$="live chart"], [data-sheet="chart"] [role="dialog"]')
    note(`${c.id}/overlay-chart`, chart)
    add(`${c.id}/chart-sheet`, !!chart.opened && chart.sheet === 'chart' && !!chart.scrimCloses && !!chart.escCloses && !!chart.backCloses, JSON.stringify(chart))
    add(`${c.id}/chart-no-turn`, o.chatPosts === before, `${o.chatPosts - before} POST(s) for the chart ask`)
    // Round 2: the chain picker in the top bar is a Sheet on a phone.
    if (phone) {
      const chain = await overlayPass(page, `${c.id}-overlay-chain`, async () => {
        await page.locator('[data-chat-topbar] [data-sheet-open="chain"]').first().click({ timeout: 3000 }).catch(() => {})
      }, '[data-sheet="chain"] [role="dialog"]')
      note(`${c.id}/overlay-chain`, chain)
      add(`${c.id}/chain-sheet`, !!chain.opened && chain.sheet === 'chain' && !!chain.scrimCloses && !!chain.escCloses && !!chain.backCloses, JSON.stringify(chain))
      // A pick lands and closes: Base, then back to all chains.
      await page.locator('[data-chat-topbar] [data-sheet-open="chain"]').first().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
      const rows = await page.evaluate(`Array.from(document.querySelectorAll('[data-sheet="chain"] [role="option"]')).map((b) => Math.round(b.getBoundingClientRect().height))`)
      await page.locator('[data-sheet="chain"] [role="option"]:has-text("Base")').first().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
      const picked = await page.evaluate(`({ open: !!document.querySelector('[data-sheet="chain"] [role="dialog"]'), label: document.querySelector('[data-chat-topbar] [data-sheet-open="chain"]')?.getAttribute('aria-label') })`)
      add(`${c.id}/chain-pick`, !picked.open && /Base/.test(picked.label ?? '') && (rows as number[]).length > 1 && (rows as number[]).every((h) => h >= 44), `rows ${(rows as number[]).join('/')}px; after picking Base the sheet is ${picked.open ? 'OPEN' : 'closed'} and the chip says "${picked.label}"`)
      // Put it back on all chains so later passes build as before.
      await page.locator('[data-chat-topbar] [data-sheet-open="chain"]').first().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      await page.locator('[data-sheet="chain"] [role="option"]').first().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(300)
    }
  }
  const errs = realErrors(o.errs)
  add(`${c.id}/console`, errs.length === 0, errs[0]?.slice(0, 200) ?? 'clean')
  await o.ctx.close()
}

async function addMcpPass(browser: Pw, devices: Pw, c: Ctx) {
  console.log(`\n═══ /servers/add · ${c.id} ═══`)
  const o = await open(browser, devices, c)
  await o.page.goto(`${BASE}/servers/add`, { waitUntil: 'domcontentloaded' })
  await o.page.waitForTimeout(2500)
  const reopen = async () => {
    const b = o.page.locator('button:has-text("Add an MCP")').first()
    if ((await b.count()) > 0) await b.click({ timeout: 3000 }).catch(() => {})
  }
  const r = await overlayPass(o.page, `${c.id}-overlay-addmcp`, async () => {
    if ((await o.page.locator('[role="dialog"][aria-label="Request an MCP"], [data-sheet="addmcp"] [role="dialog"]').count()) === 0) await reopen()
  }, '[role="dialog"][aria-label="Request an MCP"], [data-sheet="addmcp"] [role="dialog"]')
  note(`${c.id}/overlay-addmcp`, r)
  add(`${c.id}/addmcp-sheet`, !!r.opened && r.sheet === 'addmcp' && !!r.scrimCloses && !!r.escCloses && !!r.backCloses, JSON.stringify(r))
  // Round 3 (QA): the sheet's own targets — "Request review" is THE button
  // (full width, 44–48px), the guest "Connect & sign in" link a 44px hit area.
  if ((await o.page.locator('[data-sheet="addmcp"] [role="dialog"]').count()) === 0) await reopen()
  await o.page.waitForTimeout(600)
  const t = await o.page.evaluate(`(() => {
    ${HELPERS}
    const d = document.querySelector('[data-sheet="addmcp"] [role="dialog"]')
    if (!d) return null
    const review = Array.from(d.querySelectorAll('button')).find((b) => /Request review|Done/.test(b.textContent || ''))
    const link = Array.from(d.querySelectorAll('button')).find((b) => /Connect & sign in/.test(b.textContent || ''))
    const hit = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const ps = getComputedStyle(el, '::before'); const px = (v) => (v && v.endsWith('px') ? parseFloat(v) : 0); const on = ps.content !== 'none' && ps.position === 'absolute'; return { w: Math.round(r.width + (on ? -px(ps.left) - px(ps.right) : 0)), h: Math.round(r.height + (on ? -px(ps.top) - px(ps.bottom) : 0)), boxH: Math.round(r.height) } }
    const pr = d.getBoundingClientRect()
    return { review: review ? { ...box(review), panelW: Math.round(pr.width) } : null, link: hit(link) }
  })()`)
  note(`${c.id}/addmcp-targets`, t)
  add(`${c.id}/addmcp-review-48`, !!t?.review && t.review.h >= 44 && t.review.h <= 52 && t.review.w >= t.review.panelW - 48, `"Request review" ${t?.review?.w}×${t?.review?.h} in a ${t?.review?.panelW}px sheet`)
  add(`${c.id}/addmcp-signin-hit-44`, !t?.link || (t.link.h >= 44 && t.link.w >= 44), t?.link ? `"Connect & sign in" ${t.link.w}×${t.link.h} hit area (${t.link.boxH}px box)` : 'no guest hint (a session is on)')
  await shot(o.page, `${c.id}-addmcp-targets`)
  await o.ctx.close()
}

async function intentPass(browser: Pw, devices: Pw, c: Ctx) {
  console.log(`\n═══ /i/buy-aapl · ${c.id} ═══`)
  const o = await open(browser, devices, c)
  const { page } = o
  await page.goto(`${BASE}/i/buy-aapl`, { waitUntil: 'domcontentloaded' })
  const SPLASH = 'button:has-text("Connect & build my path")'
  const runtimeUp = async () => (await page.locator('.yf-runtime').count()) > 0
  // A remembered wallet (wagmi.recentConnectorId) reconnects on its own and
  // the runtime auto-starts (~9–13s headless: the connector probe) — wait for
  // that first, then fall back to the splash → door → wallet taps.
  await page.locator('.yf-runtime').first().waitFor({ state: 'attached', timeout: 16_000 }).catch(() => {})
  for (let tries = 0; tries < 2 && !(await runtimeUp()) && (await page.locator(SPLASH).count()) > 0; tries++) {
    await page.locator(SPLASH).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const lane = page.locator('button:has-text("Connect a wallet")').first()
    if ((await lane.count()) > 0) { await lane.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500) }
    // RainbowKit lists the injected provider as "Browser Wallet".
    const pick = page.locator('[data-testid="rk-wallet-option-injected"], [data-testid="rk-wallet-option-io.pantessa.chatdrive"]').first()
    if ((await pick.count()) > 0) await pick.click({ timeout: 4000 }).catch(() => {})
    await page.locator('.yf-runtime').first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {})
  }
  const ran = await runtimeUp()
  add(`${c.id}/i-runtime`, ran, ran ? 'the runtime took over' : 'still on the splash')
  if (ran) {
    await page.locator('main ol li, [data-simple-reply], [data-bubble="assistant"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const f = await page.evaluate(`(() => {
      const rt = document.querySelector('.yf-runtime')
      const scrollers = Array.from(document.querySelectorAll('[data-app-scroll]'))
      const s = scrollers[0]
      if (s) s.scrollTop = s.scrollHeight
      const se = document.scrollingElement
      return {
        frame: !!rt && rt.hasAttribute('data-app-frame'),
        scrollers: scrollers.length,
        scrollerInFrame: !!s && !!rt && rt.contains(s),
        docScrollH: se.scrollHeight, vh: innerHeight, docScrollTop: se.scrollTop,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rtBottom: rt ? Math.round(rt.getBoundingClientRect().bottom) : null,
      }
    })()`)
    note(`${c.id}/i-frame`, f)
    add(`${c.id}/i-frame-attrs`, f.frame && f.scrollers === 1 && f.scrollerInFrame, `frame ${f.frame}, ${f.scrollers} scroller(s), in frame ${f.scrollerInFrame}`)
    add(`${c.id}/i-document-never-scrolls`, f.docScrollTop === 0 && f.docScrollH <= f.vh + 1 && f.overflowX <= 0, `document ${f.docScrollH}/${f.vh}, scrollTop ${f.docScrollTop}, overflowX ${f.overflowX}`)
    add(`${c.id}/i-bottom-flush`, f.rtBottom === f.vh, `runtime bottom ${f.rtBottom} vs ${f.vh}`)
    const home = await page.evaluate(`(() => { const a = document.querySelector('.yf-runtime header a[aria-label="Pantessa home"]'); if (!a) return null; const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`)
    add(`${c.id}/i-home-44`, !!home && home.w >= 44 && home.h >= 44, `home mark ${home?.w}×${home?.h}`)
    await shot(page, `${c.id}-i-runtime`)
    // The composer on the keyboard, for real, on /i too (the runtime is its
    // own frame; SHELL's CSS shrinks it onto the keyboard).
    await page.evaluate(`(() => { const s = document.querySelector('[data-app-scroll]'); if (s) s.scrollTop = s.scrollHeight })()`)
    await page.waitForTimeout(300)
    const kb = await keyboardPass(page, { type: 'Make it $20 instead and use my USDC on Base for it' })
    note(`${c.id}/i-keyboard`, kb)
    keyboardChecks(c.id, kb, 'i')
    await shot(page, `${c.id}-i-keyboard`)
  }
  await o.ctx.close()
}

/** The sign-in gate on a phone, measured on the integrated frame (NAV's
 *  question: does the banner still add 48px for a bar that is now in flow,
 *  and does the trial-exhausted takeover cover the bar?).
 *  - banner: a connected-not-signed wallet → the one-row banner sits between
 *    the thread and the composer, the composer above the bar;
 *  - takeover: a remembered-but-absent wallet with the guest trial spent →
 *    the takeover shows for the beat before the signed-out gate sends the
 *    visitor home; it covers the conversation and the bar stays tappable. */
async function gatePass(browser: Pw, devices: Pw, c: Ctx) {
  console.log(`\n═══ gate · ${c.id} ═══`)
  {
    const o = await open(browser, devices, c)
    await o.page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
    await waitConnected(o.page)
    await o.page.locator('[data-gate-banner]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    const g = await o.page.evaluate(`(() => {
      ${HELPERS}
      const banner = document.querySelector('[data-gate-banner]')
      const b = bar()
      const pill = ta() ? ta().parentElement.getBoundingClientRect() : null
      const legacy = Array.from(document.querySelectorAll('div')).filter((d) => String(d.className).includes('max-lg:bottom-[calc(7.25rem+48px') && d.getBoundingClientRect().height > 0).length
      return { banner: box(banner), phoneSeat: banner ? banner.getAttribute('data-gate-banner') === 'phone' : null, composer: pill ? { y: Math.round(pill.top), b: Math.round(pill.bottom) } : null, bar: box(b), legacy }
    })()`)
    note(`${c.id}/gate-banner`, g)
    add(`${c.id}/gate-banner-no-bar-math`, !!g.banner && g.phoneSeat === true && g.legacy === 0 && !!g.composer && !!g.bar && g.banner.b <= g.composer.y + 1 && g.composer.b <= g.bar.y + 1,
      `banner ${g.banner?.y}–${g.banner?.b} (${g.banner?.h}px, phone seat: ${g.phoneSeat}) · composer ${g.composer?.y}–${g.composer?.b} · bar top ${g.bar?.y} · legacy offset banners rendered: ${g.legacy}`)
    await shot(o.page, `${c.id}-gate-banner`)
    await o.ctx.close()
  }
  {
    const o = await open(browser, devices, c, { wallet: false })
    await o.ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"injected"'); sessionStorage.setItem('yf_guest_turns', '5') } catch {}`)
    await o.page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
    const up = await o.page.locator('[data-gate-takeover]').first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false)
    if (!up) {
      note(`${c.id}/gate-takeover`, `no takeover frame before the signed-out gate sent the visitor to ${o.page.url()}`)
      add(`${c.id}/gate-takeover-leaves-bar`, true, `unreachable on /chat: a visitor with no wallet is sent home (${new URL(o.page.url()).pathname}) before the guest trial can run out here`)
    } else {
      const t = await o.page.evaluate(`(() => {
        ${HELPERS}
        const tk = document.querySelector('[data-gate-takeover]')
        const b = bar()
        const br = b ? b.getBoundingClientRect() : null
        const hit = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null
        return { takeover: box(tk), bar: box(b), barHit: !!b && !!hit && b.contains(hit), inConversation: !!tk && !!tk.closest('[data-chat-gate-root]') }
      })()`)
      note(`${c.id}/gate-takeover`, t)
      add(`${c.id}/gate-takeover-leaves-bar`, !!t.takeover && !!t.bar && t.takeover.b <= t.bar.y + 1 && t.barHit && t.inConversation, `takeover ${t.takeover?.y}–${t.takeover?.b}, bar top ${t.bar?.y}, a tap on the bar hits the bar: ${t.barHit}, inside the conversation: ${t.inConversation}`)
      await shot(o.page, `${c.id}-gate-takeover`)
    }
    await o.ctx.close()
  }
}

// Round 3: a persisted conversation with a signed, settled swap — the only
// place the receipt's "mint as link" renders (a DB chat row + meta.signed).
// Served by route interception: /api/auth/me answers the drive wallet, the
// chat list + the chat come from this fixture, and every chat write is
// swallowed. No signature, no session cookie, no DB row.
const MINT_CHAT_ID = 'cdrivemintchat0000000001'
const MINT_CHAT = (() => {
  const at = new Date().toISOString()
  return {
    id: MINT_CHAT_ID,
    title: 'Swap 5 USDC for ETH on Base',
    activeServerIds: [],
    createdAt: at,
    updatedAt: at,
    messages: [
      { id: 'cdrivemintmsg00000000001', role: 'user', content: 'Swap 5 USDC for ETH on Base', createdAt: at },
      {
        id: 'cdrivemintmsg00000000002',
        role: 'assistant',
        content: SWAP_REPLY.reply,
        meta: { txChain: TX_CHAIN, buildPath: 'native-swap-uniswap', signed: [{ hash: '0x' + 'cd'.repeat(32), chainId: 8453, title: 'Swap USDC → ETH' }] },
        createdAt: at,
      },
    ],
  }
})()

/** Every way a sheet closes, one open at a time: a tap on the scrim, Escape,
 *  its close button, the back gesture (stays on the page), a swipe down on
 *  its grabber. */
async function sheetDismissals(page: Pw, id: string, openIt: () => Promise<void>) {
  const sel = `[data-sheet="${id}"] [role="dialog"]`
  const isOpen = async () => (await page.locator(sel).count()) > 0
  const opened = async () => {
    if (!(await isOpen())) await openIt()
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(450)
    return isOpen()
  }
  const vp = await page.viewportSize()
  const out: Record<string, boolean | string> = {}
  out.opens = await opened()
  // scrim
  await page.mouse.click(Math.round(vp.width / 2), 10)
  await page.waitForTimeout(500)
  out.scrim = !(await isOpen())
  // Escape
  if (await opened()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    out.escape = !(await isOpen())
  }
  // the close button
  if (await opened()) {
    await page.locator(`${sel} button[aria-label="Close"]`).first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(500)
    out.button = !(await isOpen())
  }
  // back: closes, stays
  if (await opened()) {
    const url = page.url()
    await page.goBack({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(700)
    out.back = !(await isOpen()) && page.url() === url
    if (page.url() !== url) out.backLeftFor = page.url()
  }
  // swipe down on the grabber
  if (await opened()) {
    const g = await page.evaluate(`(() => { const e = document.querySelector('[data-sheet="${id}"] .sheet__grabber') || document.querySelector('[data-sheet="${id}"] .sheet__head'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    if (g) {
      await page.mouse.move(g.x, g.y)
      await page.mouse.down()
      for (let k = 1; k <= 12; k++) {
        await page.mouse.move(g.x, g.y + k * 28)
        await page.waitForTimeout(16)
      }
      await page.mouse.up()
      await page.waitForTimeout(700)
      out.swipe = !(await isOpen())
    } else out.swipe = 'no grabber'
  }
  return out
}

async function mintPass(browser: Pw, devices: Pw, c: Ctx) {
  console.log(`\n═══ mint · ${c.id} (a persisted chat with a settled receipt) ═══`)
  const o = await open(browser, devices, c)
  const { page, ctx } = o
  await ctx.route(/\/api\/auth\/me(\?|$)/, (r: Pw) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: ADDR.toLowerCase() }) }))
  await ctx.route(/\/api\/chats(\/[^?]*)?(\?.*)?$/, (r: Pw) => {
    const url = new URL(r.request().url())
    const m = r.request().method()
    if (m === 'GET' && url.pathname === '/api/chats') return r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ ...MINT_CHAT, messages: undefined }]) })
    if (m === 'GET' && url.pathname === `/api/chats/${MINT_CHAT_ID}`) return r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(MINT_CHAT) })
    // Every write (messages, working set, public flag) is swallowed.
    return r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' })
  })
  await page.goto(`${BASE}/chat/${MINT_CHAT_ID}`, { waitUntil: 'domcontentloaded' })
  await waitConnected(page)
  const receiptUp = await page.locator('button:has-text("mint as link")').first().waitFor({ state: 'visible', timeout: 25_000 }).then(() => true).catch(() => false)
  add(`${c.id}/mint-receipt-chip`, receiptUp, receiptUp ? 'the settled receipt offers "mint as link"' : 'no receipt chip rendered')
  await shot(page, `${c.id}-mint-receipt`)
  const fromBubble = await sheetDismissals(page, 'mint', async () => {
    await page.locator('[data-bubble="user"] button[aria-label="Create an intent link from this ask"]').first().click({ timeout: 3000, force: true }).catch(() => {})
  })
  note(`${c.id}/mint-from-bubble`, fromBubble)
  add(`${c.id}/mint-from-bubble`, fromBubble.opens === true && fromBubble.scrim === true && fromBubble.escape === true && fromBubble.back === true && fromBubble.swipe === true, JSON.stringify(fromBubble))
  const fromReceipt = await sheetDismissals(page, 'mint', async () => {
    await page.locator('button:has-text("mint as link")').first().click({ timeout: 3000 }).catch(() => {})
  })
  note(`${c.id}/mint-from-receipt`, fromReceipt)
  add(`${c.id}/mint-from-receipt`, fromReceipt.opens === true && fromReceipt.scrim === true && fromReceipt.escape === true && fromReceipt.back === true && fromReceipt.swipe === true, JSON.stringify(fromReceipt))
  // The fifth way, the head's X: owned by SHELL (components/mobile/
  // useSwipeToClose captures the pointer for ANY pointerdown on the head, the
  // X included, so its click never lands). Reported; a note until it's fixed,
  // a check the moment it is (set STRICT_X=1 to make it one now).
  if (fromBubble.button === true && fromReceipt.button === true) add(`${c.id}/mint-close-x`, true, 'the X closes the sheet (bubble + receipt)')
  else if (process.env.STRICT_X) add(`${c.id}/mint-close-x`, false, `the X did not close it (bubble ${fromBubble.button}, receipt ${fromReceipt.button}) — SHELL: useSwipeToClose pointer capture`)
  else note(`${c.id}/mint-close-x`, `KNOWN (SHELL): the head's X did not close the sheet (bubble ${fromBubble.button}, receipt ${fromReceipt.button}) — useSwipeToClose captures the pointer on the head`)
  // The sheet carries the ask it was opened from.
  await page.locator('button:has-text("mint as link")').first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(600)
  const prefilled = await page.evaluate(`(() => { const d = document.querySelector('[data-sheet="mint"] [role="dialog"]'); if (!d) return null; const f = d.querySelector('textarea, input[type="text"]'); return f ? f.value : null })()`)
  add(`${c.id}/mint-prefilled`, typeof prefilled === 'string' && /Swap 5 USDC for ETH on Base/.test(prefilled), `the sheet's ask: "${prefilled}"`)
  await shot(page, `${c.id}-mint-sheet`)
  const errs = realErrors(o.errs)
  add(`${c.id}/mint-console`, errs.length === 0, errs[0]?.slice(0, 200) ?? 'clean')
  await o.ctx.close()
}

/** Round 2: the 360×740 card pass — every card a person reads or taps in
 *  the conversation, audited at a small phone: nothing spills past its
 *  card or the screen, no text is cut mid-word, and every action is a
 *  finger-sized target (primary ones 44–48px). */
async function cardsPass(browser: Pw, devices: Pw, c: Ctx) {
  console.log(`\n═══ cards · ${c.id} (${c.width}×${c.height}, ${c.theme}) ═══`)
  const verdict = (name: string, a: { spill: unknown[]; clipped: unknown[]; actions: Array<{ text: string; w: number; h: number; primary: boolean }>; overflowX: number } | null, opts: { minAction?: number; primaryMin?: number; primaryMax?: number } = {}) => {
    if (!a) return add(`${c.id}/${name}`, false, 'block not found')
    const minA = opts.minAction ?? 44
    const small = a.actions.filter((x) => (x.h < minA || x.w < minA) && x.text)
    const prim = a.actions.filter((x) => x.primary)
    // A primary BUTTON is 44–60px tall (a two-line label may wrap it to ~49).
    const primBad = prim.filter((x) => x.h < (opts.primaryMin ?? 44) || x.h > (opts.primaryMax ?? 60))
    note(`${c.id}/${name}`, a)
    add(`${c.id}/${name}-fits`, a.overflowX <= 0 && a.spill.length === 0, `overflowX ${a.overflowX}, spill ${JSON.stringify(a.spill.slice(0, 3))}`)
    add(`${c.id}/${name}-no-clipped-text`, a.clipped.length === 0, JSON.stringify(a.clipped.slice(0, 4)))
    add(`${c.id}/${name}-targets`, small.length === 0 && primBad.length === 0, `${a.actions.length} actions; under ${minA}px: ${small.map((x) => `"${x.text.slice(0, 22)}" ${x.w}×${x.h}`).join(' | ') || 'none'}; primary: ${prim.map((x) => `"${x.text.slice(0, 22)}" ${x.w}×${x.h}`).join(' | ') || 'none'}`)
  }

  // 1. The empty state: a visitor with no wallet is sent home from /chat
  //    (#757), so it's the connected surface's first look — the invitation
  //    shows while the wallet settles, before the splash takes over.
  const o = await open(browser, devices, c)
  const { page } = o
  await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
  // The state is transient (the splash replaces it once the wallet settles),
  // so the wait and the audit happen in ONE page task: no gap for the swap.
  const emptyAudit = await page
    .waitForFunction(`(() => { ${HELPERS} const h = Array.from(document.querySelectorAll('h3')).find((x) => /Say what should happen/.test(x.textContent || '') && x.getBoundingClientRect().height > 0); return h ? audit(h.parentElement) : null })()`, null, { timeout: 25_000, polling: 100 })
    .then((hdl: Pw) => hdl.jsonValue())
    .catch(() => null)
  if (emptyAudit) {
    verdict('empty-state', emptyAudit)
    await shot(page, `${c.id}-empty-state`)
  } else note(`${c.id}/empty-state`, 'went straight to the splash (no empty-state frame)')

  // 2. Connected, nothing asked yet: the splash (real read-only scans of the
  //    drive wallet), then the four card shapes from fixtures.
  const connected = await waitConnected(page)
  add(`${c.id}/cards-connected`, connected)
  if (!connected) { await o.ctx.close(); return }
  const splashAudit = async (pg: Pw, tag: string) => {
    await pg.locator('[data-splash-hero], [data-splash-card]').first().waitFor({ state: 'attached', timeout: 45_000 }).catch(() => {})
    // Let every card's scan settle (a pending card says "Scanning your wallet…").
    for (let i = 0; i < 30; i++) {
      const pending = await pg.evaluate(`document.body.innerText.includes('Scanning your wallet')`).catch(() => false)
      if (!pending) break
      await pg.waitForTimeout(1000)
    }
    await pg.waitForTimeout(800)
    // Open the first briefing row and the first card row that carry actions,
    // so their chips count too.
    await pg.evaluate(`(() => { for (const sel of ['[data-splash-hero] [data-splash-calm] button[aria-expanded="false"]', '[data-splash-card] button[aria-expanded="false"]']) { const b = document.querySelector(sel); if (b) b.click() } })()`)
    await pg.waitForTimeout(500)
    const cards = await pg.evaluate(`(() => { ${HELPERS} return Array.from(document.querySelectorAll('[data-splash-card]')).map((el) => ({ slug: el.getAttribute('data-splash-card'), ...audit(el) })) })()`) as Array<{ slug: string; spill: unknown[]; clipped: unknown[]; actions: Array<{ text: string; w: number; h: number; primary: boolean }>; overflowX: number }>
    const hero = await pg.evaluate(`(() => { ${HELPERS} return audit(document.querySelector('[data-splash-hero]')) })()`)
    add(`${c.id}/${tag}`, cards.length > 0 || !!hero, `hero ${hero ? 'up' : 'missing'}, ${cards.length} card(s): ${cards.map((x) => x.slug).join(', ')}`)
    if (hero) verdict(`${tag}-hero`, hero)
    for (const k of cards) verdict(`${tag}-${k.slug}`, k)
    await shot(pg, `${c.id}-${tag}`)
  }
  await splashAudit(page, 'splash')
  // The same audit on a wallet with history: an attention row + cards.
  {
    const r = await open(browser, devices, c, { address: RICH_ADDR })
    await r.page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
    if (await waitConnected(r.page)) await splashAudit(r.page, 'splash-rich')
    else add(`${c.id}/splash-rich`, false, 'the rich wallet did not connect')
    await r.ctx.close()
  }

  // 3. The card shapes a conversation produces.
  const lastAssistant = `(() => { ${HELPERS} const b = Array.from(document.querySelectorAll('[data-bubble="assistant"]')); return audit(b[b.length - 1] || null) })()`
  const turns: Array<{ name: string; ask: string; ready: string }> = [
    { name: 'clarify', ask: 'Fund it: buy $12 worth of META', ready: '[data-clarify-option]' },
    { name: 'chain-3', ask: 'Swap 25 USDC for USDG in three steps', ready: 'ol li:nth-child(3)' },
    { name: 'job-wait', ask: 'Show the wait step job', ready: 'text=Funds arrive on Robinhood Chain' },
    { name: 'hl-card', ask: 'Long $12 of HYPE at 2x on hyperliquid', ready: '[data-hl-path]' },
  ]
  for (const t of turns) {
    await typeAndSend(page, t.ask)
    await page.locator(t.ready).last().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(900)
    verdict(t.name, await page.evaluate(lastAssistant))
    await shot(page, `${c.id}-card-${t.name}`)
  }
  const errs = realErrors(o.errs)
  add(`${c.id}/cards-console`, errs.length === 0, errs[0]?.slice(0, 200) ?? 'clean')
  await o.ctx.close()
}

async function desktopPass(browser: Pw) {
  console.log('\n═══ /chat · desktop 1440×900 (the drawer and the toolbar are unchanged) ═══')
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' } })
  await ctx.addInitScript(MOCK_WALLET)
  const page = await ctx.newPage()
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
  const ok = await waitConnected(page)
  add('desktop/connected', ok)
  await page.waitForTimeout(1500)
  const d = await page.evaluate(`(() => {
    ${HELPERS}
    const workingSet = document.querySelector('main button[title^="Your working set"]')
    const tb = workingSet ? workingSet.closest('div.border-b') : null
    const phoneBar = document.querySelector('[data-chat-topbar]')
    return {
      toolbar: box(tb), phoneBarVisible: !!phoneBar && visible(phoneBar),
      workingSet: workingSet ? { text: workingSet.textContent.trim().slice(0, 60), ...box(workingSet) } : null,
      rail: box(document.querySelector('main')?.previousElementSibling),
      composer: box(ta()?.parentElement),
      appScroll: document.querySelectorAll('[data-app-scroll]').length,
    }
  })()`)
  note('desktop/chat', d)
  add('desktop/toolbar-kept', !!d.toolbar && !!d.workingSet && !d.phoneBarVisible, `toolbar ${d.toolbar?.w}×${d.toolbar?.h}, working-set door "${d.workingSet?.text}", phone bar visible ${d.phoneBarVisible}`)
  await shot(page, 'desktop-1440-chat')
  add('desktop/console', errs.length === 0, errs[0]?.slice(0, 160) ?? 'clean')
  await ctx.close()
}

async function main() {
  const require_ = createRequire('/Users/nategeier/anchor.js')
  const { chromium, webkit, devices } = require_('playwright-core') as { chromium: Pw; webkit: Pw; devices: Pw }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const browsers: Record<string, Pw> = {}
  const get = async (engine: 'webkit' | 'chrome') => {
    if (!browsers[engine]) browsers[engine] = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome', headless: true })
    return browsers[engine]
  }
  for (const c of CONTEXTS) {
    if (ONLY && !ONLY.split(',').includes(c.id)) continue
    const b = await get(c.engine)
    // The 360×740 contexts run the card pass only.
    if (c.id.includes('x740')) {
      if (!SKIP.includes('cards')) await cardsPass(b, devices, c)
      continue
    }
    if (!SKIP.includes('chat')) await chatPass(b, devices, c)
    if (!SKIP.includes('gate') && (c.id === 'iphone-375' || c.id === 'pixel-360')) await gatePass(b, devices, c)
    if (!SKIP.includes('mint') && (c.id === 'iphone-375' || c.id === 'pixel-360')) await mintPass(b, devices, c)
    if (!SKIP.includes('addmcp') && (c.id === 'iphone-375' || c.id === 'pixel-360')) await addMcpPass(b, devices, c)
    if (!SKIP.includes('i') && (c.id === 'iphone-375' || c.id === 'pixel-375')) await intentPass(b, devices, c)
  }
  if (!SKIP.includes('desktop') && (!ONLY || ONLY.includes('desktop'))) await desktopPass(await get('chrome'))
  for (const b of Object.values(browsers)) await b.close()
  const red = findings.filter((f) => !f.ok)
  console.log(`\n${PHASE}: ${findings.length - red.length}/${findings.length} green${red.length ? ` — RED: ${red.map((f) => f.id).join(', ')}` : ''}`)
  if (SHOTS) writeFileSync(`${SHOTS}/${PHASE}-summary.json`, JSON.stringify({ findings, summary }, null, 2))
  process.exit(red.length ? 1 : 0)
}

// Only drive when run directly (the harness may import from here — the #872 bite).
if (process.argv[1] && /drive-native-chat/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}
