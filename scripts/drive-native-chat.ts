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
]

type Opened = { ctx: Pw; page: Pw; errs: string[]; chatPosts: number; jobGets: number }

async function open(browser: Pw, devices: Pw, c: Ctx): Promise<Opened> {
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
  await ctx.addInitScript(MOCK_WALLET)
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
    const body = /fund|job|then/i.test(msg) ? JOB_REPLY : SWAP_REPLY
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  })
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
  const thread = () => document.querySelector('main [data-app-scroll]') || document.querySelector('main .overflow-y-auto')
  const ta = () => document.querySelector('main textarea') || document.querySelector('textarea')
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

/** Where the composer sits once a 300px keyboard is up (visualViewport shrunk
 *  the way iOS Safari shrinks it). Returns the composer pill's bottom and the
 *  visible bottom. */
async function keyboardPass(page: Pw) {
  await page.locator('main textarea').first().focus().catch(() => {})
  await page.evaluate(`(() => {
    const vv = window.visualViewport
    if (!vv) return
    const h = innerHeight - ${KB}
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h })
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
    vv.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })()`)
  await page.waitForTimeout(450)
  const r = await page.evaluate(`(() => {
    ${HELPERS}
    const t = ta()
    const pill = t ? t.parentElement.getBoundingClientRect() : null
    const b = bar()
    return {
      visibleBottom: innerHeight - ${KB},
      pillBottom: pill ? Math.round(pill.bottom) : null,
      barVisible: !!b && visible(b) && b.getBoundingClientRect().top < innerHeight,
      htmlKeyboard: document.documentElement.getAttribute('data-keyboard'),
      kbInset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim(),
    }
  })()`)
  // Keyboard down again.
  await page.evaluate(`(() => {
    const vv = window.visualViewport
    if (!vv) return
    delete vv.height
    delete vv.offsetTop
    vv.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })()`)
  await page.waitForTimeout(300)
  const after = await page.evaluate(`(() => { ${HELPERS} const t = ta(); const pill = t ? t.parentElement.getBoundingClientRect() : null; return { pillBottom: pill ? Math.round(pill.bottom) : null, htmlKeyboard: document.documentElement.getAttribute('data-keyboard') } })()`)
  return { up: r, down: after }
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
    add(`${c.id}/topbar-title`, !!empty.title && empty.title.w >= 72, empty.title ? `"${empty.title.text}" ${empty.title.w}px wide` : 'no title')
  }
  add(`${c.id}/composer-16px`, !!empty.composer && empty.composer.fontSize >= 16, `textarea ${empty.composer?.fontSize}px`)
  add(`${c.id}/send-44`, !!empty.send && empty.send.w >= 44 && empty.send.h >= 44, `send ${empty.send?.w}×${empty.send?.h}`)
  if (phone && empty.bar) add(`${c.id}/composer-above-bar`, !!empty.composerPill && empty.composerPill.b <= empty.bar.y + 1, `composer bottom ${empty.composerPill?.b} · bar top ${empty.bar.y}`)
  add(`${c.id}/no-h-scroll`, empty.doc.overflowX <= 0, `${empty.doc.overflowX}px`)
  add(`${c.id}/one-app-scroller`, empty.appScroll === 1 && empty.threadIsAppScroll, `${empty.appScroll} [data-app-scroll], thread carries it: ${empty.threadIsAppScroll}`)

  // ── the Chats door does not pop a drawer ──
  if (phone && c.height > 500) {
    const chatsDoor = page.locator('[data-chat-topbar] button:has-text("Chats"), [data-chat-topbar] a:has-text("Chats")').first()
    if ((await chatsDoor.count()) > 0) {
      await chatsDoor.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
      const s = await measureSurface(page)
      add(`${c.id}/chats-door-no-drawer`, !s.drawerOpen && s.phoneScreen === 'history', `phoneScreen ${s.phoneScreen}, drawer ${s.drawerOpen ? 'OPEN' : 'closed'}`)
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
    add(`${c.id}/composer-rides-keyboard`, kb.up.pillBottom !== null && Math.abs(kb.up.pillBottom - kb.up.visibleBottom) <= 24 && kb.up.pillBottom <= kb.up.visibleBottom + 1, `composer bottom ${kb.up.pillBottom} vs keyboard top ${kb.up.visibleBottom} (html[data-keyboard]=${kb.up.htmlKeyboard}, --kb-inset=${kb.up.kbInset || '∅'})`)
    add(`${c.id}/composer-returns`, kb.down.pillBottom !== null && kb.down.pillBottom > (kb.up.pillBottom ?? 0) + 100, `after the keyboard: composer bottom ${kb.down.pillBottom}`)
    await shot(page, `${c.id}-keyboard`)
  }

  // ── overlays ──
  if (!SKIP.includes('overlays') && c.height > 500) {
    // The mint-in-place modal, from the user bubble's mint verb.
    const mint = await overlayPass(page, `${c.id}-overlay-mint`, async () => {
      await page.locator('button[aria-label="Create an intent link from this ask"]').first().click({ timeout: 3000, force: true }).catch(() => {})
    }, '[role="dialog"][aria-label="Mint an intent link"], [data-sheet="mint-link"] [role="dialog"]')
    note(`${c.id}/overlay-mint`, mint)
    add(`${c.id}/mint-sheet`, !!mint.opened && mint.sheet === 'mint-link' && !!mint.scrimCloses && !!mint.escCloses && !!mint.backCloses, JSON.stringify(mint))
    // The chart overlay, from a typed chart ask (the client intercept — no turn burned).
    const before = o.chatPosts
    const chart = await overlayPass(page, `${c.id}-overlay-chart`, async () => {
      await typeAndSend(page, 'show me the ETH chart')
    }, '[role="dialog"][aria-label$="live chart"]')
    note(`${c.id}/overlay-chart`, chart)
    add(`${c.id}/chart-sheet`, !!chart.opened && chart.sheet === 'chart' && !!chart.scrimCloses && !!chart.escCloses && !!chart.backCloses, JSON.stringify(chart))
    add(`${c.id}/chart-no-turn`, o.chatPosts === before, `${o.chatPosts - before} POST(s) for the chart ask`)
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
    if ((await o.page.locator('[role="dialog"][aria-label="Request an MCP"]').count()) === 0) await reopen()
  }, '[role="dialog"][aria-label="Request an MCP"]')
  note(`${c.id}/overlay-addmcp`, r)
  add(`${c.id}/addmcp-sheet`, !!r.opened && r.sheet === 'add-mcp' && !!r.scrimCloses && !!r.escCloses && !!r.backCloses, JSON.stringify(r))
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
    await shot(page, `${c.id}-i-runtime`)
  }
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
    const tb = document.querySelector('main > div > div.border-b')
    const phoneBar = document.querySelector('[data-chat-topbar]')
    const workingSet = document.querySelector('main button[title^="Your working set"]')
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
    if (!SKIP.includes('chat')) await chatPass(b, devices, c)
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
