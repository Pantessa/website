#!/usr/bin/env tsx
/**
 * /i on a PHONE — the link landing measured as a native screen.
 *
 * Nate's 2026-09-23 screenshot: the funding-offer turn on `/i/<slug>` at
 * 390px read as a cramped desktop page — a 48px text gutter, a paragraph
 * of holdings, chip labels cut mid-sentence, a placeholder clipped at
 * "tweak the". This drive opens the runtime at 375px (iPhone 13, Chrome +
 * Playwright, mock EIP-6963 wallet), lands the SAME turn from a canned
 * fixture (the route's own reply shape, byte-for-byte the screenshot's
 * copy) so the state is deterministic, and measures what a native screen
 * has to get right: the gutter, the tap targets, the type size, the
 * placeholder, the header. One live pass (the burner on /i/buy-aapl)
 * proves the fixture is the route's real shape.
 *
 * Usage:
 *   BASE=http://localhost:3835 npx tsx scripts/drive-i-mobile.ts --shots=/tmp/shots
 *   … --only=fixture,live
 *
 * Read-only: the mock wallet refuses every signature; requests wear
 * `x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3835'
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? ''
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? ''
const BURNER = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** The screenshot's turn, in the route's own shape (app/api/chat/route.ts,
 *  the `advice.kind === 'chips'` branch): one paragraph + a clarify. */
export const FUNDING_OFFER_FIXTURE = {
  content:
    "🌉 **We can make this happen.** You're holding **~$4 of USDT on Ethereum, ~$3 of DAI on Base, ~$1806 of ETH on Optimism, ~$1150 of ETH on Ethereum, ~$227 of ETH on Base, ~$26 of ETH on Arbitrum** — this buy needs ~$12 of USDG on Robinhood Chain and you're at ~$1.27 there, so I'll convert some of it and buy the META — all in one job you sign step by step, funds arriving on Robinhood Chain in seconds.",
  clarify: {
    question: 'Fund it from another chain?',
    options: [
      { label: 'Just enough (~$11.5 from Ethereum)', resume: 'Fund robinhood chain with $11.5 from ethereum, then buy $12 of META' },
      { label: 'Use Optimism instead (~$11.5)', resume: 'Fund robinhood chain with $11.5 from optimism, then buy $12 of META' },
    ],
  },
  buildPath: 'native-lifi-fund-offer',
}

const MOCK_WALLET = `(() => {
  const ADDR = '__ADDR__'
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
  const info = { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Drive Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.pantessa.drive' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  window.ethereum = provider
})()`

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pw = any
/* eslint-enable @typescript-eslint/no-explicit-any */

type Finding = { id: string; ok: boolean; detail: string }
const findings: Finding[] = []
const summary: Record<string, unknown> = {}
const add = (id: string, ok: boolean, detail = '') => {
  findings.push({ id, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${id}${detail ? ` — ${detail}` : ''}`)
}
const note = (id: string, detail: string) => {
  console.log(`  ·  ${id} — ${detail}`)
  summary[id] = detail
}
const want = (id: string) => !ONLY || ONLY.split(',').includes(id)

async function shot(page: Pw, name: string) {
  if (!SHOTS) return
  await page.mouse.move(0, 0).catch(() => {})
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch((e: Error) => console.log(`  (shot ${name} failed: ${e.message})`))
}

function realErrors(errs: string[]) {
  return errs.filter(
    (e) =>
      !/favicon|ERR_|net::|Download the React|401|Failed to load resource/i.test(e) &&
      !/api\.cdp\.coinbase\.com|Access to XMLHttpRequest|has been blocked by CORS/i.test(e),
  )
}

type Opened = { ctx: Pw; page: Pw; errs: string[]; chatPosts: number }

async function open(browser: Pw, devices: Pw, theme: 'dark' | 'light', fixture: boolean): Promise<Opened> {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: IPHONE_UA,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: theme,
    extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
  })
  await ctx.addInitScript(MOCK_WALLET.replace('__ADDR__', BURNER))
  await ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"injected"') } catch {}`)
  const page = await ctx.newPage()
  const out: Opened = { ctx, page, errs: [], chatPosts: 0 }
  page.on('console', (m: Pw) => { if (m.type() === 'error') out.errs.push(m.text()) })
  page.on('pageerror', (e: unknown) => out.errs.push(String(e)))
  if (fixture) {
    await ctx.route(/\/api\/chat(\?|$)/, async (route: Pw) => {
      out.chatPosts++
      // A connected wallet's turn on /i is the plain JSON POST (the SSE
      // stream is the auto-router's lane) — the route's own body shape.
      const { content, ...rest } = FUNDING_OFFER_FIXTURE
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reply: content, ...rest }) })
    })
  } else {
    page.on('request', (r: Pw) => { if (r.method() === 'POST' && /\/api\/chat(\?|$)/.test(r.url())) out.chatPosts++ })
  }
  return out
}

const SPLASH_CTA = 'button:has-text("Connect & build my path")'
const DOOR_LANE = 'button:has-text("Connect a wallet")'
const CHIP = '[data-clarify-option], button[title^="Fund "], button[title^="fund "]'

async function overflowOf(page: Pw): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/** Splash → door → the mock wallet → the runtime takes over. */
async function connect(o: Opened, slug: string): Promise<boolean> {
  await o.page.goto(`${BASE}/i/${slug}`, { waitUntil: 'domcontentloaded' })
  await o.page.waitForTimeout(4000)
  const splashGone = async () => (await o.page.locator(SPLASH_CTA).count()) === 0
  for (let tries = 0; tries < 3 && !(await splashGone()); tries++) {
    await o.page.locator(SPLASH_CTA).first().click({ timeout: 4000 }).catch(() => {})
    await o.page.waitForTimeout(1200)
    const lane = o.page.locator(DOOR_LANE).first()
    if ((await lane.count()) > 0) {
      await lane.click({ timeout: 4000 }).catch(() => {})
      await o.page.waitForTimeout(2000)
    }
    const pick = o.page.locator('[data-testid="rk-wallet-option-injected"], [data-testid="rk-wallet-option-io.pantessa.drive"], button:has-text("Drive Wallet")').first()
    if ((await pick.count()) > 0) {
      await pick.click({ timeout: 4000 }).catch(() => {})
      await o.page.waitForTimeout(4000)
    }
    if (await splashGone()) break
    await o.page.keyboard.press('Escape').catch(() => {})
    await o.page.waitForTimeout(800)
  }
  return splashGone()
}

/** What a native screen has to get right, as numbers. */
type Measured = {
  text: { x: number; y: number; w: number; h: number } | null
  fontSize: number | null
  chips: Array<{ x: number; y: number; w: number; h: number; clipped: boolean }>
  badge: boolean
  placeholder: string
  placeholderFits: boolean | null
  composer: { w: number } | null
  send: { w: number; h: number } | null
  ask: { w: number; h: number } | null
  askClipped: boolean | null
  askLines: number | null
  pill: { w: number; h: number } | null
  header: { h: number } | null
  holdingsFold: boolean
  vw: number
}

async function measure(page: Pw): Promise<Measured> {
  // Passed as a STRING: tsx rewrites inner functions with a `__name` helper
  // that does not exist inside the page (memory pricing-v2-chart-first).
  return page.evaluate(`(() => {
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const textNode = document.querySelector('[data-simple-funding], [data-simple-reply], [data-bubble="assistant"] .chat-md, .chat-md')
    const text = box(textNode)
    const fontSize = textNode ? parseFloat(getComputedStyle(textNode.querySelector('p') ?? textNode).fontSize) : null
    const chips = Array.from(document.querySelectorAll('[data-clarify-option], button[title^="Fund "], button[title^="fund "]')).map((c) => Object.assign(box(c), { clipped: Array.from(c.querySelectorAll('span')).some((s) => getComputedStyle(s).textOverflow === 'ellipsis' && s.scrollWidth > s.clientWidth + 1) }))
    const badge = document.querySelector('[data-best-guess]')
    const ta = document.querySelector('textarea')
    let placeholderFits = null
    let placeholder = ''
    if (ta) {
      const cs = getComputedStyle(ta)
      const c = document.createElement('canvas').getContext('2d')
      c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
      placeholder = ta.placeholder
      placeholderFits = c.measureText(ta.placeholder).width <= ta.clientWidth
    }
    const send = ta && ta.parentElement ? ta.parentElement.querySelector('button:last-of-type') : null
    const askEl = document.querySelector('[data-runtime-ask]') || document.querySelector('header p[style*="serif"]')
    const askClipped = askEl ? getComputedStyle(askEl).whiteSpace === 'nowrap' && askEl.scrollWidth > askEl.clientWidth + 1 : null
    const pill = document.querySelector('.navacct__pill')
    const header = document.querySelector('header')
    return {
      text, fontSize, chips, badge: !!badge, placeholder, placeholderFits,
      composer: box(ta), send: box(send), ask: box(askEl), askClipped,
      askLines: askEl ? Math.round(askEl.getBoundingClientRect().height / parseFloat(getComputedStyle(askEl).lineHeight)) : null,
      pill: box(pill), header: box(header),
      holdingsFold: !!document.querySelector('[data-holdings-fold]'),
      vw: window.innerWidth,
    }
  })()`)
}

async function main() {
  const require_ = createRequire('/Users/nategeier/anchor.js')
  const { chromium, devices } = require_('playwright-core') as { chromium: Pw; devices: Pw }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--force-device-scale-factor=2'],
  })

  // ── fixture: the screenshot's turn, both themes ──────────────────────────
  if (want('fixture')) {
    for (const theme of ['dark', 'light'] as const) {
      console.log(`\n═══ fixture · ${theme} (375, iPhone Safari UA, the funding-offer turn from a canned reply) ═══`)
      const o = await open(browser, devices, theme, true)
      await shot(o.page, `splash-${theme}`).then(() => {})
      const connected = await connect(o, 'buy-aapl')
      add(`fixture/${theme}/connected`, connected, connected ? 'the runtime took over' : 'the mock wallet did not attach')
      if (connected) {
        await o.page.locator(CHIP).first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {})
        await o.page.waitForTimeout(900)
        const m = await measure(o.page)
        summary[`fixture/${theme}`] = m
        await shot(o.page, `runtime-chips-${theme}`)
        const overflow = await overflowOf(o.page)
        add(`fixture/${theme}/no-h-scroll`, overflow === 0, `${overflow}px`)
        add(`fixture/${theme}/turn-landed`, o.chatPosts >= 1 && m.chips.length === 2, `${o.chatPosts} POST /api/chat, ${m.chips.length} option card(s)`)
        add(`fixture/${theme}/text-gutter`, !!m.text && m.text.x <= 20 && m.text.x >= 14, `reply text starts at x=${m.text?.x}px (want the 16px gutter)`)
        add(`fixture/${theme}/text-size`, m.fontSize !== null && m.fontSize >= 15, `reply body ${m.fontSize}px`)
        add(`fixture/${theme}/holdings-folded`, m.holdingsFold, m.holdingsFold ? 'the holdings list sits behind one tap' : 'the holdings print as a paragraph')
        add(`fixture/${theme}/chips-tappable`, m.chips.length > 0 && m.chips.every((c) => c.h >= 56 && c.w >= 300 && !c.clipped), m.chips.map((c) => `${c.w}×${c.h}${c.clipped ? ' CLIPPED' : ''}`).join(', '))
        add(`fixture/${theme}/best-guess-badge`, m.badge, m.badge ? 'a pill, not an inline dash' : 'no badge')
        add(`fixture/${theme}/placeholder-fits`, m.placeholderFits === true, `"${m.placeholder}" ${m.placeholderFits ? 'fits' : 'CLIPS'} a ${m.composer?.w}px field`)
        add(`fixture/${theme}/send-target`, !!m.send && m.send.w >= 44 && m.send.h >= 44, `send ${m.send?.w}×${m.send?.h}`)
        add(`fixture/${theme}/ask-not-cut`, m.askClipped === false, `ask box ${m.ask?.w}×${m.ask?.h}, ${m.askLines} line(s)${m.askClipped ? ', CUT mid-word' : ''}`)
        add(`fixture/${theme}/pill-compact`, !!m.pill && m.pill.w <= 140 && m.pill.h >= 32, `account pill ${m.pill?.w}×${m.pill?.h}`)
        add(`fixture/${theme}/header-height`, !!m.header && m.header.h <= 96, `header ${m.header?.h}px tall`)
        // Tap the first option: the resume is sent (one more POST) — the chip contract.
        await o.page.locator(CHIP).first().click({ timeout: 4000 }).catch(() => {})
        await o.page.waitForTimeout(1500)
        add(`fixture/${theme}/chip-sends`, o.chatPosts >= 2, `${o.chatPosts} POST /api/chat after the tap`)
        await o.page.locator('textarea').first().click({ timeout: 3000 }).catch(() => {})
        await o.page.waitForTimeout(500)
        await shot(o.page, `composer-focus-${theme}`)
        const errs = realErrors(o.errs)
        add(`fixture/${theme}/console`, errs.length === 0, errs[0]?.slice(0, 160) ?? 'clean')
      }
      await o.ctx.close()
    }
  }

  // ── desktop: the same turn at 1280 keeps the bubble, the pill and the tail ──
  // The phone rules are fenced below sm; /i on a laptop must not lose its card.
  if (want('desktop')) {
    console.log('\n═══ desktop (1280×800, dark, the fixture turn) ═══')
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' } })
    await ctx.addInitScript(MOCK_WALLET.replace('__ADDR__', BURNER))
    await ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"injected"') } catch {}`)
    await ctx.route(/\/api\/chat(\?|$)/, async (route: Pw) => {
      const { content, ...rest } = FUNDING_OFFER_FIXTURE
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reply: content, ...rest }) })
    })
    const page = await ctx.newPage()
    const o: Opened = { ctx, page, errs: [], chatPosts: 0 }
    page.on('pageerror', (e: unknown) => o.errs.push(String(e)))
    const connected = await connect(o, 'buy-aapl')
    add('desktop/connected', connected)
    if (connected) {
      await page.locator(CHIP).first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(900)
      const d = await page.evaluate(`(() => {
        const b = document.querySelector('[data-bubble="assistant"]')
        const cs = b ? getComputedStyle(b) : null
        const pill = document.querySelector('.navacct__pill')
        const chev = document.querySelector('.navacct__chev')
        const eyebrow = document.querySelector('header p.mono')
        const tools = Array.from(document.querySelectorAll('[data-turn-tools]')).map((t) => getComputedStyle(t).display)
        const chips = Array.from(document.querySelectorAll('[data-clarify-option]')).map((c) => Math.round(c.getBoundingClientRect().width))
        return {
          bubbleBg: cs ? cs.backgroundColor : null, bubblePadL: cs ? cs.paddingLeft : null,
          pillW: pill ? Math.round(pill.getBoundingClientRect().width) : null, chev: chev ? getComputedStyle(chev).display : null,
          eyebrow: eyebrow ? eyebrow.textContent : null, tools, chips, badge: !!document.querySelector('[data-best-guess]'),
          fold: !!document.querySelector('[data-holdings-fold]'),
        }
      })()`)
      summary.desktop = d
      await shot(page, 'desktop-chips-dark')
      add('desktop/bubble-kept', d.bubbleBg !== 'rgba(0, 0, 0, 0)' && d.bubblePadL === '16px', `assistant bubble bg ${d.bubbleBg}, padding-left ${d.bubblePadL}`)
      add('desktop/pill-full', d.chev !== 'none' && (d.pillW ?? 0) > 100, `pill ${d.pillW}px wide, chevron ${d.chev}`)
      add('desktop/eyebrow-full', typeof d.eyebrow === 'string' && /your wallet signs|powered by Pantessa/.test(d.eyebrow), `"${d.eyebrow}"`)
      add('desktop/turn-tools-kept', d.tools.length > 0 && d.tools.every((t: string) => t !== 'none'), `${d.tools.length} tool(s): ${d.tools.join(', ')}`)
      add('desktop/cards-shared', d.chips.length === 2 && d.badge && d.fold, `${d.chips.length} option cards ${d.chips.join('/')}px, badge ${d.badge}, fold ${d.fold}`)
      add('desktop/console', o.errs.length === 0, o.errs[0]?.slice(0, 160) ?? 'clean')
    }
    await ctx.close()
  }

  // ── live: the burner on /i/buy-aapl, the route's real reply ──────────────
  if (want('live')) {
    console.log('\n═══ live (375, dark, the burner on /i/buy-aapl) ═══')
    const o = await open(browser, devices, 'dark', false)
    const connected = await connect(o, 'buy-aapl')
    add('live/connected', connected)
    if (connected) {
      await o.page.locator(`${CHIP}, button:has-text("Sign & send"), [data-simple-reply]`).first().waitFor({ state: 'attached', timeout: 60_000 }).catch(() => {})
      await o.page.waitForTimeout(1200)
      const m = await measure(o.page)
      summary.live = m
      await shot(o.page, 'live-buy-aapl-dark')
      const text: string = await o.page.locator('body').innerText()
      note('live/reply', text.replace(/\s+/g, ' ').slice(0, 400))
      add('live/no-h-scroll', (await overflowOf(o.page)) === 0)
      add('live/text-gutter', !!m.text && m.text.x <= 20, `x=${m.text?.x}px`)
      const errs = realErrors(o.errs)
      add('live/console', errs.length === 0, errs[0]?.slice(0, 160) ?? 'clean')
    }
    await o.ctx.close()
  }

  await browser.close()
  const red = findings.filter((f) => !f.ok)
  console.log(`\n${findings.length - red.length}/${findings.length} green${red.length ? ` — RED: ${red.map((f) => f.id).join(', ')}` : ''}`)
  if (SHOTS) writeFileSync(`${SHOTS}/summary.json`, JSON.stringify({ findings, summary }, null, 2))
  process.exit(red.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
