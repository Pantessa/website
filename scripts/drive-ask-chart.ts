#!/usr/bin/env tsx
/**
 * Ask the chart — the symbol page's conversation, driven in a real browser.
 *
 * Nate, 2026-09-24, on /t/TSLA: the panel printed `{"kind":"answer",…}}` as
 * its reply, and "should we integrate our system here as well to be able to
 * make transactions as they talk?" This drive opens /t/ETH (Chrome +
 * Playwright, a mock EIP-6963 wallet on the burner address, the server under
 * test on `MK2_AI_MOCK=1`) and walks the conversation:
 *   · a model answer closed with `}}` prints as prose (the prod bug)
 *   · a typed trade BUILDS in the order ticket beside the panel — one real
 *     POST /api/chat, the page never navigates
 *   · "make it $6" reads the conversation → the model's reading is printed
 *     and it builds too
 *   · a reply the model routes to the ticket ("relay") reaches /api/chat as
 *     the user's own words
 *   · a drawing still lands on the chart; ⌘K and the pill dock in the panel
 *     (no sheet); "New order" clears the ticket
 *   · a phone pass (375, light): the pill unfolds the panel, the ticket
 *     stacks under the talk, nothing scrolls sideways
 *   · a visitor with no wallet: a trade opens the connect door, no turn fires
 *
 * Usage:
 *   BASE=http://localhost:3871 npx tsx scripts/drive-ask-chart.ts --shots=/tmp/shots
 *   … --only=desktop,phone,stranger
 *
 * Read-only: the mock wallet refuses every signature; requests wear
 * `x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3871'
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? ''
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? ''
const BURNER = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const HEADERS = { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' }

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

let failed = 0
const add = (id: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? '✅' : '❌'} ${id}${detail ? ` — ${detail}` : ''}`)
}
const want = (id: string) => !ONLY || ONLY.split(',').includes(id)

async function shot(page: Pw, name: string) {
  if (!SHOTS) return
  await page.mouse.move(0, 0).catch(() => {})
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch((e: Error) => console.log(`  (shot ${name} failed: ${e.message})`))
}

function realErrors(errs: string[]) {
  return errs.filter(
    (e) =>
      !/favicon|ERR_|net::|Download the React|401|403|Failed to load resource/i.test(e) &&
      !/api\.cdp\.coinbase\.com|Access to XMLHttpRequest|has been blocked by CORS|WalletConnect|Lit is in dev mode/i.test(e),
  )
}

type Opened = { ctx: Pw; page: Pw; errs: string[]; chatBodies: string[]; scenario: { next: string | null } }

async function open(browser: Pw, devices: Pw, o: { theme: 'dark' | 'light'; phone?: boolean; wallet: boolean }): Promise<Opened> {
  const ctx = await browser.newContext({
    ...(o.phone ? { ...devices['iPhone 13'], userAgent: IPHONE_UA, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
    deviceScaleFactor: 2,
    colorScheme: o.theme,
    extraHTTPHeaders: HEADERS,
  })
  if (o.wallet) {
    await ctx.addInitScript(MOCK_WALLET.replace('__ADDR__', BURNER))
    await ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"injected"') } catch {}`)
  }
  // A fresh browser: the ask dock opens on a desktop, folds on a phone.
  await ctx.addInitScript(`try { localStorage.removeItem('pantessa.markets.askchart') } catch {}`)
  const page = await ctx.newPage()
  const out: Opened = { ctx, page, errs: [], chatBodies: [], scenario: { next: null } }
  page.on('console', (m: Pw) => {
    if (m.type() === 'error') out.errs.push(m.text())
  })
  page.on('pageerror', (e: unknown) => out.errs.push(String(e)))
  page.on('request', (r: Pw) => {
    if (r.method() === 'POST' && /\/api\/chat(\?|$)/.test(r.url())) out.chatBodies.push(r.postData() ?? '')
  })
  // The mock model's scenario for the NEXT chart-lane ask (one shot).
  await ctx.route(/\/api\/markets\/ask(\?|$)/, async (route: Pw) => {
    const s = out.scenario.next
    out.scenario.next = null
    await route.continue({ headers: { ...route.request().headers(), ...(s ? { 'x-mk2-mock-scenario': s } : {}) } })
  })
  return out
}

const PANEL = 'section.mk-ai--ask'
const INPUT = `${PANEL} .mk-ai__input`

async function say(o: Opened, text: string, scenario?: string) {
  o.scenario.next = scenario ?? null
  const input = o.page.locator(INPUT)
  await input.waitFor({ state: 'visible', timeout: 20_000 })
  await o.page.waitForFunction((sel: string) => !(document.querySelector(sel) as HTMLInputElement | null)?.disabled, INPUT, { timeout: 30_000 })
  await input.fill(text)
  await input.press('Enter')
  // The turn row lands, then the chart lane answers (busy clears).
  await o.page.waitForFunction((sel: string) => document.querySelector(sel)?.getAttribute('data-busy') === '0', PANEL, { timeout: 30_000 })
}

const lastTurn = (o: Opened) =>
  o.page.evaluate(`(() => {
    const turns = [...document.querySelectorAll('${PANEL} .mk-ask__turn:not(.mk-ask__turn--wait)')]
    const t = turns[turns.length - 1]
    if (!t) return null
    const run = t.querySelector('.mk-ask__run')
    return {
      n: turns.length,
      you: t.querySelector('.mk-ask__you')?.textContent ?? '',
      kind: t.getAttribute('data-kind'),
      text: [...t.querySelectorAll('.mk-ai__p')].map((p) => p.textContent).join(' '),
      reading: t.querySelector('.mk-ask__reading')?.textContent ?? null,
      run: run ? { status: run.getAttribute('data-status'), ask: run.querySelector('.mk-ask__run-ask')?.textContent ?? '' } : null,
      relayed: !!t.querySelector('.mk-ask__relay'),
    }
  })()`)

async function waitRunSettles(o: Opened, ms = 60_000) {
  await o.page
    .waitForFunction(
      (sel: string) => {
        const runs = [...document.querySelectorAll(sel)]
        const r = runs[runs.length - 1]
        const s = r?.getAttribute('data-status')
        return !!s && s !== 'building' && s !== 'held'
      },
      `${PANEL} .mk-ask__run`,
      { timeout: ms },
    )
    .catch(() => {})
}

async function overflowOf(page: Pw): Promise<number> {
  return page.evaluate('Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)')
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

  // ── desktop · dark · a connected wallet ─────────────────────────────────
  if (want('desktop')) {
    console.log('\n═══ desktop (1440×900, dark, mock wallet on the burner) ═══')
    const o = await open(browser, devices, { theme: 'dark', wallet: true })
    await o.page.goto(`${BASE}/t/ETH`, { waitUntil: 'domcontentloaded' })
    await o.page.locator(`${PANEL}`).waitFor({ state: 'visible', timeout: 30_000 })
    await o.page.locator('.sym__chart canvas').first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {})
    await o.page.waitForTimeout(2500) // wagmi restores the mock wallet
    const startUrl = o.page.url()

    await say(o, 'Does this look right?', 'double-brace')
    let t = await lastTurn(o)
    add('desktop/json-bug', !!t && t.kind === 'answer' && !/[{}]|"kind"/.test(t.text) && /frame a wide range/.test(t.text), t?.text.slice(0, 120))

    const before = o.chatBodies.length
    await say(o, 'buy $5 of ETH')
    await o.page.locator(`${PANEL} .mk-ask__ticket`).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await waitRunSettles(o)
    t = await lastTurn(o)
    const firstBody = o.chatBodies[before] ?? ''
    add('desktop/typed-builds-here', o.chatBodies.length === before + 1 && /buy \$5 of ETH/i.test(firstBody) && o.page.url() === startUrl, `${o.chatBodies.length - before} POST /api/chat (${firstBody.slice(0, 80)}) · url ${o.page.url() === startUrl ? 'unchanged' : o.page.url()}`)
    add('desktop/ticket-has-the-wallet', /"walletAddress":"0x5eaabd731d2bc0490c2d47e41858e9b0629455a0"/i.test(firstBody), 'the turn carries the connected address (a send while wagmi restores is held, not sent bare)')
    add('desktop/run-row', !!t?.run && /^buy \$5 of ETH$/i.test(t.run.ask) && !!t.run.status && t.run.status !== 'building' && t.reading === null, `run ${JSON.stringify(t?.run)}`)
    const ticket = await o.page.evaluate(`(() => {
      const tk = document.querySelector('${PANEL} .mk-ask__ticket')
      const talk = document.querySelector('${PANEL} .mk-ask__talk')
      if (!tk || !talk) return null
      const a = tk.getBoundingClientRect(), b = talk.getBoundingClientRect()
      return {
        beside: a.left > b.right - 4,
        composers: document.querySelectorAll('${PANEL} textarea').length,
        userBubble: [...tk.querySelectorAll('*')].some((n) => n.childElementCount === 0 && /buy \\$5 of ETH/i.test(n.textContent || '')),
        cards: tk.querySelectorAll('button').length,
        pill: tk.querySelector('.mk-ask__pill')?.textContent ?? '',
      }
    })()`)
    add('desktop/ticket-beside', !!ticket?.beside && ticket.composers === 0 && ticket.userBubble, JSON.stringify(ticket))
    await shot(o.page, 'desktop-dark-ticket')
    const pillLive = await o.page.evaluate(`(() => { const p = document.querySelector('[data-ask-door="pill"]'); return p ? getComputedStyle(p).display : 'absent' })()`)
    add('desktop/one-composer', pillLive === 'none' || pillLive === 'absent', `floating pill while the ticket is live: ${pillLive}`)

    const b2 = o.chatBodies.length
    await say(o, 'make it $6')
    await waitRunSettles(o)
    t = await lastTurn(o)
    add('desktop/amend-reads-the-conversation', !!t?.reading && /Buy \$6 of ETH/.test(t.reading) && t.run?.ask === 'Buy $6 of ETH' && o.chatBodies.length === b2 + 1 && (o.chatBodies[b2] ?? '').includes('Buy $6 of ETH'), `reading "${t?.reading}" · ${o.chatBodies.length - b2} POST`)

    const b3 = o.chatBodies.length
    await say(o, 'hmm whichever is cheaper', 'relay')
    await o.page.waitForTimeout(800)
    t = await lastTurn(o)
    add('desktop/relay-own-words', !!t?.relayed && o.chatBodies.length === b3 + 1 && (o.chatBodies[b3] ?? '').includes('hmm whichever is cheaper'), `${o.chatBodies.length - b3} POST · relayed ${t?.relayed}`)
    await waitRunSettles(o)

    const last = Number(await o.page.evaluate(`fetch('/api/charts/candles?symbol=ETH&tf=1h').then(r => r.json()).then(j => j.candles.at(-1).c)`))
    const level = Number((last * 0.95).toFixed(2))
    await say(o, `draw a line at ${level}`)
    t = await lastTurn(o)
    add('desktop/draw-still-draws', t?.kind === 'chart' && /LINE/.test(await o.page.locator(`${PANEL} .mk-ask__turn`).last().innerText()), `kind ${t?.kind}`)

    await o.page.locator(`${PANEL} .mk-ask__ticket-acts button`).first().click({ timeout: 4000 }).catch(() => {})
    await o.page.waitForTimeout(400)
    const cleared = await o.page.evaluate(`({ ticket: !!document.querySelector('${PANEL} .mk-ask__ticket'), cleared: [...document.querySelectorAll('${PANEL} .mk-ask__run')].filter((r) => r.getAttribute('data-status') === 'closed').length })`)
    add('desktop/new-order', !cleared.ticket && cleared.cleared >= 2, JSON.stringify(cleared))
    // ⌘K and the pill dock in the panel: focus, no sheet. (A live ticket
    // hides the pill — it would sit on top of the ticket — so after New.)
    // (Blur without a click: (5,5) is the spine's home mark.)
    await o.page.evaluate('document.activeElement && document.activeElement.blur()')
    await o.page.keyboard.press('Meta+k')
    await o.page.waitForTimeout(500)
    const k = await o.page.evaluate(`({ sheet: !!document.querySelector('[data-ask-door="sheet"]'), focused: document.activeElement?.classList.contains('mk-ai__input') ?? false })`)
    add('desktop/cmd-k-docks', !k.sheet && k.focused, JSON.stringify(k))
    const pill = o.page.locator('[data-ask-door="pill"]')
    if (await pill.count()) {
      await o.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
      await o.page.waitForTimeout(300)
      await pill.click({ timeout: 4000 }).catch(() => {})
      await o.page.waitForTimeout(900)
      const p = await o.page.evaluate(`(() => { const r = document.querySelector('${PANEL}').getBoundingClientRect(); return { sheet: !!document.querySelector('[data-ask-door="sheet"]'), inView: r.bottom > 0 && r.top < innerHeight } })()`)
      add('desktop/pill-docks', !p.sheet && p.inView, JSON.stringify(p))
    } else add('desktop/pill-docks', false, 'no pill on /t/ETH')

    add('desktop/no-h-scroll', (await overflowOf(o.page)) === 0, `${await overflowOf(o.page)}px`)
    const errs = realErrors(o.errs)
    add('desktop/console', errs.length === 0, errs[0]?.slice(0, 200) ?? 'clean')
    await o.ctx.close()
  }

  // ── phone · light ────────────────────────────────────────────────────────
  if (want('phone')) {
    console.log('\n═══ phone (375, light, iPhone UA, mock wallet) ═══')
    const o = await open(browser, devices, { theme: 'light', phone: true, wallet: true })
    await o.page.goto(`${BASE}/t/ETH`, { waitUntil: 'domcontentloaded' })
    await o.page.locator('section.mk-askdock').waitFor({ state: 'attached', timeout: 30_000 })
    await o.page.waitForTimeout(2500)
    const folded = await o.page.evaluate(`document.querySelector('section.mk-askdock')?.getAttribute('data-askchart')`)
    const pill = o.page.locator('[data-ask-door="pill"]')
    await pill.click({ timeout: 6000 }).catch(() => {})
    await o.page.locator(INPUT).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    const unfolded = await o.page.evaluate(`({ open: document.querySelector('section.mk-askdock')?.getAttribute('data-askchart'), sheet: !!document.querySelector('[data-ask-door="sheet"]') })`)
    add('phone/pill-unfolds-panel', folded === 'closed' && unfolded.open === 'open' && !unfolded.sheet, `folded=${folded} → ${JSON.stringify(unfolded)}`)
    await say(o, 'buy $5 of ETH')
    await o.page.locator(`${PANEL} .mk-ask__ticket`).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await waitRunSettles(o)
    await o.page.waitForTimeout(600)
    const lay = await o.page.evaluate(`(() => {
      const tk = document.querySelector('${PANEL} .mk-ask__ticket')?.getBoundingClientRect()
      const talk = document.querySelector('${PANEL} .mk-ask__talk')?.getBoundingClientRect()
      return tk && talk ? { stacked: tk.top >= talk.bottom - 2, w: Math.round(tk.width), inView: tk.top < innerHeight && tk.bottom > 0 } : null
    })()`)
    add('phone/ticket-stacks', !!lay?.stacked && lay.w <= 375, JSON.stringify(lay))
    add('phone/no-h-scroll', (await overflowOf(o.page)) === 0, `${await overflowOf(o.page)}px`)
    await o.page.locator(`${PANEL} .mk-ask__ticket`).scrollIntoViewIfNeeded().catch(() => {})
    await shot(o.page, 'phone-light-ticket')
    const errs = realErrors(o.errs)
    add('phone/console', errs.length === 0, errs[0]?.slice(0, 200) ?? 'clean')
    await o.ctx.close()
  }

  // ── "Open in the app" carries the ticket's thread to /chat ──────────────
  if (want('handoff')) {
    console.log('\n═══ handoff (1440, dark, mock wallet): the ticket opens in the app ═══')
    const o = await open(browser, devices, { theme: 'dark', wallet: true })
    await o.page.goto(`${BASE}/t/ETH`, { waitUntil: 'domcontentloaded' })
    await o.page.locator(PANEL).waitFor({ state: 'visible', timeout: 30_000 })
    await o.page.waitForTimeout(2500)
    await say(o, 'buy $5 of ETH')
    await waitRunSettles(o)
    await o.page.locator(`${PANEL} .mk-ask__ticket-acts a`).first().click({ timeout: 6000 }).catch(() => {})
    await o.page.waitForURL(/\/chat/, { timeout: 15_000 }).catch(() => {})
    await o.page.waitForTimeout(2500)
    const h = await o.page.evaluate(`({ url: location.pathname, thread: document.body.innerText.includes('buy $5 of ETH'), posts: 0 })`)
    add('handoff/thread-follows', /^\/chat/.test(h.url) && h.thread && o.chatBodies.length === 1, `${h.url} · thread ${h.thread ? 'carried' : 'LOST'} · ${o.chatBodies.length} POST /api/chat (no re-run)`)
    await o.ctx.close()
  }

  // ── a visitor with no wallet ─────────────────────────────────────────────
  if (want('stranger')) {
    console.log('\n═══ stranger (1440, dark, no wallet) ═══')
    const o = await open(browser, devices, { theme: 'dark', wallet: false })
    await o.page.goto(`${BASE}/t/ETH`, { waitUntil: 'domcontentloaded' })
    await o.page.locator(PANEL).waitFor({ state: 'visible', timeout: 30_000 })
    await o.page.waitForTimeout(2000)
    await say(o, 'buy $5 of ETH')
    await o.page.waitForTimeout(1500)
    const s = await o.page.evaluate(`({
      held: document.querySelector('${PANEL} .mk-ask__run')?.getAttribute('data-status') ?? null,
      ticket: !!document.querySelector('${PANEL} .mk-ask__ticket'),
      door: !!document.querySelector('[role="dialog"]'),
    })`)
    add('stranger/door-not-turn', s.held === 'held' && !s.ticket && s.door && o.chatBodies.length === 0, `${JSON.stringify(s)} · ${o.chatBodies.length} POST /api/chat`)
    await shot(o.page, 'stranger-door')
    await o.ctx.close()
  }

  await browser.close()
  console.log(failed ? `\n${failed} failed` : '\nall green')
  process.exit(failed ? 1 : 0)
}

// Never run when a harness imports this file for a constant.
if (process.argv[1] && /drive-ask-chart/.test(process.argv[1])) void main()
