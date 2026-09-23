// scripts/drive-mobile-sign.ts — the round trip a signature makes on a phone,
// driven for real (mobile-onboarding squad 2026-09-23, SIGN lane).
//
//   BASE=http://localhost:3871 npx tsx scripts/drive-mobile-sign.ts
//
// Playwright + the installed Chrome, iPhone 13 UA + isMobile (RainbowKit's
// isMobile() is UA-based, so the phone code paths run). A mock EIP-6963
// wallet (desktop semantics: injected, connected on load through
// wagmi.recentConnectorId) stands in for the wallet APP so the connected-state
// flows can be driven: `/api/chat` is answered with a canned two-step chain
// (approve → swap) and the chain's JSON-RPC reads with canned receipts, so
// nothing real is quoted, signed or sent. The mock's eth_sendTransaction can
// RESOLVE (a hash) or HANG (the app never answered — the SDK socket died).
//
// Scenarios (exported for QA's drive:mobile):
//   phone-chain-taps     step 2 of a chain is a TAP on a phone (no mount-time
//                        request), labeled "Sign step 2 of 2 — …", and survives
//                        a hide → show round trip between the steps.
//   phone-return-reopen  a request the visitor came back to with nothing
//                        settled shows the reopen line after RETURN_WAIT_MS —
//                        and the wallet was asked exactly ONCE (no re-send).
//   desktop-auto-fire    the platform gate discriminates: on a desktop step 2
//                        still fires on mount (popup follows popup).
//   phone-reload-signed  the way back was a RELOAD (LINKS's finding): a card
//                        re-rendered for a tx an earlier visit SIGNED shows the
//                        resume line and asks the wallet 0 times; "Sign again
//                        anyway" is the explicit way through.
//   phone-reload-asked   same, for a tx an earlier visit ASKED and never heard
//                        back while the wallet's nonce moved on → maybe-broadcast.
//   phone-job-return     a REAL two-leg job on the TEST DB (the real /api/chat
//                        compiles "swap 5 USDC for ETH on base, then swap 3 USDC
//                        for ETH on base" for the 0x1111… harness wallet; the
//                        runner OFFERS leg 0 as a real guarded approve → swap
//                        chain): the JobCard renders it, a hide → show round
//                        trip re-reads the job at once, leg 0's step 1 is a
//                        labeled tap, and after its (canned) receipt step 2 is
//                        a TAP too — the wallet asked once, the real
//                        POST /api/tx/refresh re-quoted step 2 in between. The
//                        job is canceled after. Nothing is signed for real.
//
// Against main, phone-chain-taps FAILS (step 2 fires on mount: the mock's
// send count reaches 2 with no tap) — that is the measurement.

import { createRequire } from 'node:module'
import { signOutcomeKey } from '../lib/sign-round-trip'

const BASE = process.env.BASE ?? 'http://localhost:3871'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WALLET = '0x1111111111111111111111111111111111111111'
const HASH = `0x${'ab'.repeat(32)}`

// ── Playwright's types, spelled out locally (playwright-core is not a dep;
// a `typeof import(…)` would break `next build` off this machine).
type PwLocator = {
  first(): PwLocator
  locator(selector: string, opts?: { hasText?: string | RegExp }): PwLocator
  count(): Promise<number>
  click(opts?: { timeout?: number }): Promise<void>
  fill(text: string): Promise<void>
  waitFor(opts?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
  innerText(): Promise<string>
  isEnabled(): Promise<boolean>
  getAttribute(name: string): Promise<string | null>
  last(): PwLocator
}
type PwRoute = {
  request(): { method(): string; postData(): string | null; url(): string }
  fulfill(r: { status?: number; contentType?: string; body: string; headers?: Record<string, string> }): Promise<void>
  continue(): Promise<void>
}
type PwPage = {
  goto(url: string, opts?: { waitUntil?: 'commit' | 'domcontentloaded' | 'load' | 'networkidle' }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string, opts?: { hasText?: string | RegExp }): PwLocator
  evaluate<T>(fn: (...a: never[]) => T, arg?: unknown): Promise<T>
  route(url: string, handler: (route: PwRoute) => Promise<void> | void): Promise<void>
  keyboard: { press(key: string): Promise<void> }
  on(event: 'console', cb: (m: { type(): string; text(): string }) => void): void
  on(event: 'pageerror', cb: (e: unknown) => void): void
  on(event: 'request', cb: (r: { url(): string; method(): string }) => void): void
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>
  mouse: { move(x: number, y: number): Promise<void> }
}
type PwContext = {
  newPage(): Promise<PwPage>
  addInitScript(script: string): Promise<void>
  close(): Promise<void>
}
type PwBrowser = {
  newContext(opts: Record<string, unknown>): Promise<PwContext>
  close(): Promise<void>
}
type PwChromium = { launch(opts: { executablePath?: string; headless?: boolean; channel?: string; args?: string[] }): Promise<PwBrowser> }

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

// ── The mock wallet: injected, EIP-6963, connected on load. eth_sendTransaction
// obeys window.__sendMode ('resolve' | 'hang') and counts every ask.
const MOCK_WALLET = `(() => {
  window.__sendMode = window.__sendMode || 'resolve'
  window.__sends = 0
  window.__switches = 0
  const provider = {
    _chainId: '0x2105',
    isMetaMask: false,
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return ['${WALLET}']
        case 'eth_chainId':
          return provider._chainId
        case 'wallet_switchEthereumChain':
          window.__switches += 1
          provider._chainId = params[0].chainId
          return null
        case 'wallet_addEthereumChain':
          return null
        case 'personal_sign':
        case 'eth_signTypedData_v4':
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        case 'eth_sendTransaction': {
          window.__sends += 1
          if (window.__sendMode === 'hang') return new Promise(() => {})
          await new Promise((r) => setTimeout(r, 300))
          return '${HASH}'
        }
        default:
          return null
      }
    },
    on() {}, removeListener() {},
  }
  const info = { uuid: 'ssssssss-1111-2222-3333-444444444444', name: 'Sign Drive Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.pantessa.signdrive' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  window.ethereum = provider
  try { localStorage.setItem('wagmi.recentConnectorId', '"io.pantessa.signdrive"') } catch {}
})()`

// ── The canned chain: approve → swap on Base. Data is inert; nothing signs it.
const CHAIN = {
  summary: 'Swap 5 USDC → ETH on Base (fixture)',
  steps: [
    { title: 'Approve USDC', tx: { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0x095ea7b3', chainId: 8453, action: 'approve' } },
    { title: 'Swap USDC → ETH', tx: { to: '0x2626664c2603336E57B271c5C0b26F421741e481', data: '0x5ae401dc', chainId: 8453, action: 'swap' } },
  ],
}
// The connected lane (activeServers set, no autoRouter) reads ONE JSON body;
// the SSE frame shape is the auto-router lane's.
const REPLY = JSON.stringify({ reply: '🔏 Built the swap (fixture).', txChain: CHAIN, buildPath: 'native-swap-uniswap' })

/** Answer the wallet chains' JSON-RPC from a canned Base: chain id, blocks,
 *  the fixture hash's receipt (success). Everything else passes through. */
const ANSWERED = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_estimateGas'])
async function cannedRpc(route: PwRoute) {
  const req = route.request()
  const body = req.postData() ?? ''
  if (req.method() !== 'POST' || !body.includes('"jsonrpc"') || req.url().startsWith(BASE)) return route.continue()
  let calls: Array<{ id: number; method: string; params?: unknown[] }>
  try {
    const parsed = JSON.parse(body) as unknown
    calls = Array.isArray(parsed) ? (parsed as typeof calls) : [parsed as (typeof calls)[number]]
  } catch {
    return route.continue()
  }
  const block = '0x' + (20_000_000 + Math.floor(Date.now() / 2000)).toString(16)
  const answer = (c: { id: number; method: string; params?: unknown[] }) => {
    const result = (() => {
      switch (c.method) {
        case 'eth_chainId': return '0x2105'
        case 'eth_blockNumber': return block
        case 'eth_getTransactionReceipt':
          return { transactionHash: HASH, blockNumber: block, blockHash: `0x${'cd'.repeat(32)}`, status: '0x1', from: WALLET, to: CHAIN.steps[0].tx.to, gasUsed: '0x5208', cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [], logsBloom: `0x${'0'.repeat(512)}`, transactionIndex: '0x0', type: '0x2' }
        case 'eth_getTransactionByHash':
          return { hash: HASH, blockNumber: block, blockHash: `0x${'cd'.repeat(32)}`, from: WALLET, to: CHAIN.steps[0].tx.to, nonce: '0x1', value: '0x0', gas: '0x5208', input: '0x', transactionIndex: '0x0', type: '0x2', chainId: '0x2105', v: '0x0', r: '0x0', s: '0x0' }
        case 'eth_getBlockByNumber':
          return { number: block, hash: `0x${'cd'.repeat(32)}`, timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16), transactions: [], baseFeePerGas: '0x1' }
        case 'eth_getTransactionCount': return '0x1'
        case 'eth_estimateGas': return '0x5208'
        default: return null
      }
    })()
    return result === null ? { jsonrpc: '2.0', id: c.id, error: { code: -32601, message: 'fixture: not answered' } } : { jsonrpc: '2.0', id: c.id, result }
  }
  if (calls.some((c) => !ANSWERED.has(c.method))) return route.continue()
  const out = calls.map(answer)
  if (process.env.DEBUG_RPC) console.log('  rpc', req.url().slice(0, 40), calls.map((c) => c.method).join(','))
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(JSON.parse(body)) ? out : out[0]) })
}

/** Emulate the visitor leaving for the wallet app and coming back, from
 *  INSIDE the page (a page.evaluate carries a user gesture of its own — the
 *  events must be the page's, not the driver's). */
const ROUND_TRIP = (awayMs: number) => `(() => {
  const set = (v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  set('hidden')
  setTimeout(() => { set('visible'); window.dispatchEvent(new Event('pageshow')) }, ${awayMs})
})()`

async function openChatWithChain(ctx: PwContext, sendMode: 'resolve' | 'hang', seed?: string) {
  await ctx.addInitScript(`window.__sendMode = '${sendMode}'`)
  if (seed) await ctx.addInitScript(seed)
  await ctx.addInitScript(MOCK_WALLET)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // Playwright tries the LAST registered route first: the catch-all RPC
  // handler goes in before the chat fixture, or it swallows /api/chat.
  await page.route('**/*', cannedRpc)
  await page.route('**/api/chat', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: REPLY }))
  await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
  // Connected on load (recentConnectorId): the composer takes the ask.
  const box = page.locator('textarea').last()
  await box.waitFor({ state: 'visible', timeout: 30_000 })
  // wagmi's reconnect takes seconds headless; while it is `reconnecting`,
  // useAccount already knows the connector's NAME but isConnected is false —
  // a tap then reads "Connect your wallet first." Wait for the address.
  await page.locator(`text=/0x11…1111/`).first().waitFor({ state: 'visible', timeout: 45_000 })
  await page.waitForTimeout(800)
  await box.fill('swap 5 usdc for eth on base')
  await page.keyboard.press('Enter')
  const step1 = page.locator('button', { hasText: /Sign step 1 of 2|Sign & send approve/ }).first()
  return { page, errors, step1 }
}

export const SCENARIOS = ['phone-chain-taps', 'phone-return-reopen', 'desktop-auto-fire', 'phone-reload-signed', 'phone-reload-asked', 'phone-job-return'] as const

export async function runScenario(browser: PwBrowser, name: (typeof SCENARIOS)[number], devices: Record<string, Record<string, unknown>>, shotsDir: string) {
  console.log(`\n— ${name}`)
  const phone = name.startsWith('phone')
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'], isMobile: true, hasTouch: true, colorScheme: 'dark' } : { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  try {
    if (name === 'phone-chain-taps' || name === 'desktop-auto-fire') {
      const { page, errors, step1 } = await openChatWithChain(ctx, 'resolve')
      const stepBtn = page.locator('button', { hasText: /Sign step 1 of 2 — Approve USDC|Sign & send approve/ }).first()
      try {
        await stepBtn.waitFor({ state: 'visible', timeout: 30_000 })
      } catch (e) {
        // Say what the page showed instead — a drive that times out silently teaches nothing.
        const text = await page.evaluate(() => document.body.innerText.slice(-1500))
        await page.screenshot({ path: `${shotsDir}/${name}-timeout.png`, fullPage: true })
        console.log('  page text tail:\n' + text)
        throw e
      }
      const label1 = await stepBtn.innerText()
      // On MAIN the attribute does not exist: read it without waiting, so the
      // same scenario measures main (the check reads red, the sends count below
      // is the number that matters there).
      const nextEl = page.locator('[data-chain-next]').first()
      const next = (await nextEl.count()) ? await nextEl.getAttribute('data-chain-next') : null
      if (phone) {
        check('phone: step 1 is labeled as a step of the chain ("Sign step 1 of 2 — Approve USDC")', /Sign step 1 of 2 — Approve USDC/.test(label1), label1)
        check('phone: the card says the next step opens on the TAP (data-chain-next=tap)', next === 'tap', String(next))
      } else {
        check('desktop: step 1 keeps its plain label ("Sign & send approve")', /Sign & send approve/.test(label1), label1)
        check('desktop: the card says the next step opens on its own (data-chain-next=auto)', next === 'auto', String(next))
      }
      await page.mouse.move(0, 0)
      await page.screenshot({ path: `${shotsDir}/${name}-1-offered.png` })
      await stepBtn.click()
      if (process.env.DEBUG_RPC) {
        await page.waitForTimeout(3000)
        console.log('  after click: sends=' + (await page.evaluate(() => (window as unknown as { __sends: number }).__sends)) + ' text=' + (await page.evaluate(() => document.body.innerText.slice(-400)).then((t) => t.replace(/\n/g, ' | '))))
      }
      // Step 1 confirms off the canned receipt; step 2 mounts.
      const step2 = page.locator('button', { hasText: /Sign step 2 of 2 — Swap USDC → ETH|Sign & send swap|Confirm in your wallet/ }).first()
      await step2.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(2500)
      const sends = await page.evaluate(() => (window as unknown as { __sends: number }).__sends)
      if (phone) {
        check('phone: after step 1 confirms, the wallet was asked ONCE — step 2 did NOT fire on mount', sends === 1, `sends=${sends}`)
        const label2 = await step2.innerText()
        check('phone: step 2 is a tappable, enabled button ("Sign step 2 of 2 — Swap USDC → ETH")', /Sign step 2 of 2 — Swap USDC → ETH/.test(label2) && (await step2.isEnabled()), label2)
        // The visitor leaves for the wallet app and comes back between the steps.
        await page.evaluate(new Function(ROUND_TRIP(3000)) as () => void)
        await page.waitForTimeout(3600)
        const sendsAfterTrip = await page.evaluate(() => (window as unknown as { __sends: number }).__sends)
        const label2b = await step2.innerText()
        check('phone: a hide → 3s → show round trip between the steps changes nothing — still one ask, the step 2 button still there and enabled', sendsAfterTrip === 1 && /Sign step 2 of 2/.test(label2b) && (await step2.isEnabled()), `sends=${sendsAfterTrip} label=${label2b}`)
        await page.mouse.move(0, 0)
        await page.screenshot({ path: `${shotsDir}/${name}-2-step2-armed.png` })
        await step2.click()
      } else {
        check('desktop: step 2 fired on mount (popup follows popup) — the wallet was asked twice with one tap', sends === 2, `sends=${sends}`)
      }
      const done = page.locator('text=/All 2 steps confirmed/').first()
      await done.waitFor({ state: 'visible', timeout: 60_000 })
      const sendsEnd = await page.evaluate(() => (window as unknown as { __sends: number }).__sends)
      check(`${phone ? 'phone' : 'desktop'}: the chain completes — "All 2 steps confirmed", exactly 2 asks in total`, sendsEnd === 2, `sends=${sendsEnd}`)
      check(`${phone ? 'phone' : 'desktop'}: no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200))
      await page.mouse.move(0, 0)
      await page.screenshot({ path: `${shotsDir}/${name}-3-done.png` })
      void step1
    }
    if (name === 'phone-return-reopen') {
      const { page, errors, step1 } = await openChatWithChain(ctx, 'hang')
      await step1.waitFor({ state: 'visible', timeout: 30_000 })
      await step1.click()
      const waiting = page.locator('button', { hasText: /Confirm in your wallet/ }).first()
      await waiting.waitFor({ state: 'visible', timeout: 10_000 })
      check('phone: the tap asks the wallet and the button reads "Confirm in your wallet…" (disabled) while the app has it', !(await waiting.isEnabled()))
      check('phone: no reopen control before the round trip', (await page.locator('[data-sign-return]').count()) === 0)
      // The app never answers; the visitor comes back.
      await page.evaluate(new Function(ROUND_TRIP(2000)) as () => void)
      await page.waitForTimeout(2500)
      check('phone: right after coming back the page still waits (no control inside RETURN_WAIT_MS)', (await page.locator('[data-sign-return]').count()) === 0)
      const reopen = page.locator('[data-sign-return="offer-reopen"]').first()
      await reopen.waitFor({ state: 'visible', timeout: 15_000 })
      const words = await reopen.innerText()
      check('phone: after RETURN_WAIT_MS the reopen line is up — "queued there", "nothing is sent twice"', /queued there/.test(words) && /nothing is sent twice/.test(words), words)
      const sends = await page.evaluate(() => (window as unknown as { __sends: number }).__sends)
      check('phone: the wallet was asked exactly ONCE — the page never re-sent the request', sends === 1, `sends=${sends}`)
      check('phone: the injected mock is not the MetaMask SDK lane, so the control is words only (no Open MetaMask button for a wallet the holder cannot reopen)', (await reopen.locator('button').count()) === 0)
      check('phone: no page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
      await page.mouse.move(0, 0)
      await page.screenshot({ path: `${shotsDir}/${name}-reopen.png` })
    }
    if (name === 'phone-reload-signed' || name === 'phone-reload-asked') {
      // An earlier visit's outcome for step 1's exact tx, as the reload finds it.
      const key = signOutcomeKey({ wallet: WALLET, chainId: 8453, to: CHAIN.steps[0].tx.to, data: CHAIN.steps[0].tx.data })
      const record = name === 'phone-reload-signed'
        ? { v: 1, key, state: 'settled', askedAt: Date.now() - 60_000, settledAt: Date.now() - 50_000, hash: HASH }
        : { v: 1, key, state: 'asked', askedAt: Date.now() - 60_000, nonceAtAsk: 0 } // the canned nonce reads 0x1 → advanced
      const { page, errors } = await openChatWithChain(ctx, 'resolve', `try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(record))}) } catch {}`)
      const want = name === 'phone-reload-signed' ? 'signed' : 'maybe-broadcast'
      const resume = page.locator(`[data-sign-resume="${want}"]`).first()
      await resume.waitFor({ state: 'visible', timeout: 30_000 })
      const words = await resume.innerText()
      check(`phone: the reloaded card finds the earlier outcome and shows the ${want} line instead of the button`, want === 'signed' ? /You signed this earlier/.test(words) : /went out after that/.test(words), words)
      check('phone: the wallet was asked 0 times — nothing re-offered on its own', (await page.evaluate(() => (window as unknown as { __sends: number }).__sends)) === 0)
      check('phone: no plain step-1 button beside the resume line', (await page.locator('button', { hasText: /Sign step 1 of 2/ }).count()) === 0)
      await page.mouse.move(0, 0)
      await page.screenshot({ path: `${shotsDir}/${name}.png` })
      await resume.locator('button', { hasText: /Sign again anyway/ }).first().click()
      const btn = page.locator('button', { hasText: /Sign step 1 of 2 — Approve USDC/ }).first()
      await btn.waitFor({ state: 'visible', timeout: 10_000 })
      check('phone: "Sign again anyway" is the explicit way through — the plain button returns, the record is cleared', (await btn.isEnabled()) && (await page.evaluate((k) => localStorage.getItem(k as string), key)) === null)
      check('phone: no page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
    }
    if (name === 'phone-job-return') {
      await ctx.addInitScript(MOCK_WALLET)
      const page = await ctx.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const jobGets: string[] = []
      page.on('request', (r) => { if (/\/api\/jobs\/[^/?]+(\?|$)/.test(r.url()) && r.method() === 'GET') jobGets.push(r.url()) })
      await page.route('**/*', cannedRpc)
      await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
      const box = page.locator('textarea').last()
      await box.waitFor({ state: 'visible', timeout: 30_000 })
      await page.locator(`text=/0x11…1111/`).first().waitFor({ state: 'visible', timeout: 45_000 })
      await page.waitForTimeout(800)
      await box.fill('swap 5 USDC for ETH on base, then swap 3 USDC for ETH on base')
      await page.keyboard.press('Enter')
      // The real route compiles the job; the card polls it.
      const card = page.locator('text=/Job · \\d\\/2/i').first()
      await card.waitFor({ state: 'visible', timeout: 90_000 })
      await page.waitForTimeout(1500)
      const jobId = jobGets.map((u) => u.match(/\/api\/jobs\/([^/?]+)/)?.[1]).find(Boolean) ?? null
      check('phone: the real route compiled a 2-leg job on the TEST DB and the JobCard polls it', !!jobId && /Job · \d\/2/i.test(await card.innerText()), `job=${jobId}`)
      const before = jobGets.length
      await page.evaluate(new Function(ROUND_TRIP(1500)) as () => void)
      await page.waitForTimeout(2200)
      const extra = jobGets.length - before
      check('phone: coming back from the app re-reads the job at once (≥1 GET inside the 4s poll gap)', extra >= 1, `gets=${extra}`)
      // Leg 0 is a real guarded approve → swap chain inside the JobCard: on a
      // phone its steps are taps, and step 2 (re-quoted for real by
      // POST /api/tx/refresh after the canned approve receipt) never fires on
      // mount.
      const step1 = page.locator('button', { hasText: /Sign step 1 of 2 — Approve/ }).first()
      check('phone: the job\'s offered leg is a labeled step-1 tap ("Sign step 1 of 2 — Approve …") inside the JobCard', (await step1.count()) === 1 && (await step1.isEnabled()))
      await step1.click()
      const step2 = page.locator('button', { hasText: /Sign step 2 of 2 — Swap/ }).first()
      await step2.waitFor({ state: 'visible', timeout: 90_000 })
      await page.waitForTimeout(2000)
      const sends = await page.evaluate(() => (window as unknown as { __sends: number }).__sends)
      check('phone: after the approve\'s receipt, the REAL re-quoted step 2 is a tap, the wallet asked exactly once', sends === 1 && (await step2.isEnabled()), `sends=${sends}`)
      check('phone: no page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
      await page.mouse.move(0, 0)
      await page.screenshot({ path: `${shotsDir}/${name}.png` })
      if (jobId) await fetch(`${BASE}/api/jobs/${jobId}${(jobGets.find((u) => u.includes(jobId)) ?? '').replace(/^.*\?t=/, '?t=').startsWith('?t=') ? (jobGets.find((u) => u.includes(jobId)) ?? '').slice((jobGets.find((u) => u.includes(jobId)) ?? '').indexOf('?t=')) : ''}`, { method: 'DELETE', headers: { 'x-yf-internal-run': '1' } }).catch(() => {})
    }
  } finally {
    await ctx.close()
  }
}

async function main() {
  const require_ = createRequire('/Users/nategeier/anchor.js')
  const { chromium, devices } = require_('playwright-core') as { chromium: PwChromium; devices: Record<string, Record<string, unknown>> }
  const shotsDir = process.env.SHOTS ?? '/tmp'
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  try {
    const only = process.env.SCENARIO
    for (const s of SCENARIOS) {
      if (only && s !== only) continue
      await runScenario(browser, s, devices, shotsDir)
    }
  } finally {
    await browser.close()
  }
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

if (process.argv[1] && /drive-mobile-sign/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
