// scripts/drive-mobile-connect.ts — the CONNECT lane's mobile drive.
//
// What it measures (squad-mobile 2026-09-23, CONNECT lane): on a PHONE user
// agent, the tap on "MetaMask" in RainbowKit's list must bring the wallet
// app forward. The MetaMask lane on mobile is the MetaMask SDK, which asks
// for the app by navigating the page to a `metamask://…` link; Chrome names
// the two outcomes in its console —
//
//   Not allowed to launch 'metamask://…' because a user gesture is required.
//     → the launch was DROPPED (no activation left by the time it ran)
//   …the scheme does not have a registered handler → the launch was ALLOWED
//     (desktop Chrome has no MetaMask app; on a phone this is the app opening)
//
// — and lib/wallet-handoff's card must go up when the launch was dropped.
//
// Recipe: Playwright + installed Chrome, `devices['iPhone 13']` + `isMobile:
// true` (RainbowKit's isMobile() is UA-based, so the real SDK lane runs).
// `window.location` is [LegacyUnforgeable] — the console lines ARE the
// measurement. Every scenario writes a trace (JSON) and a screenshot under
// `--out` (default: the squad's gates/shots/connect dir), and prints one
// line per scenario. Exit 1 when any scenario's verdict is red.
//
//   BASE=http://localhost:3870 npx tsx scripts/drive-mobile-connect.ts
//   BASE=http://localhost:3875 npx tsx scripts/drive-mobile-connect.ts --out /tmp/pre822
//   … --only i-link          (one scenario)
//
// QA folds this into `npm run drive:mobile`; SCENARIOS is exported for that.

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readLaunchVerdict } from '../lib/mobile-wallet'

// playwright-core is NOT a dependency of this app: it resolves from the
// machine's `~/node_modules` (the resolver walks up), so a static import
// type-checks here and FAILS `next build` on Vercel ("Cannot find module
// 'playwright-core'") — that is exactly how #858's first preview deploy died.
// Same recipe as drive-onboarding.ts: require it at run time through an
// anchor outside the repo, and spell the two types we touch out locally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwPage = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwBrowser = any
const require_ = createRequire('/Users/nategeier/anchor.js')
const { chromium, devices } = require_('playwright-core') as {
  chromium: { launch(o: Record<string, unknown>): Promise<PwBrowser> }
  devices: Record<string, Record<string, unknown>>
}

const BASE = process.env.BASE ?? 'http://localhost:3870'
const argv = process.argv.slice(2)
const argOf = (k: string) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT =
  argOf('--out') ??
  process.env.DRIVE_OUT ??
  '/Users/nategeier/yeetful/squad-mobile-2026-09-23/gates/shots/connect'
const ONLY = argOf('--only')

type Line = { t: number; kind: string; text: string }

export type Trace = {
  base: string
  scenario: string
  tapAt: number | null
  lines: Line[]
  launches: { t: number; verdict: 'dropped' | 'allowed'; link: string; dtMs: number }[]
  /** RainbowKit wrote WALLETCONNECT_DEEPLINK_CHOICE after the tap = its own
   *  navigation to the wallet ran (the duplicate). */
  rkNavigated: boolean
  handoffCard: { present: boolean; title: string | null; cta: string | null; tried: boolean } | null
  rkModal: { open: boolean; text: string }
  verdict: 'green' | 'red'
  why: string
}

export type Scenario = {
  id: string
  /** What the scenario proves, one line. */
  claim: string
  /** Drive up to (and including) the MetaMask tap; return the tap time. */
  run: (page: PwPage, log: (kind: string, text: string) => void) => Promise<number>
  /** Judge the trace. */
  judge: (trace: Trace) => { ok: boolean; why: string }
  /** Context overrides (a different UA, say). */
  contextOptions?: Record<string, unknown>
}

/** X's iOS in-app browser: WebKit, no `Safari/` token, X's own suffix. */
export const X_IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.0'

const RK_METAMASK = '[data-testid="rk-wallet-option-metaMask"]'

/** Open the unified door from the /i splash and take the wallet lane into
 *  RainbowKit's list. Returns the ms timestamp of the MetaMask tap. */
async function tapMetaMaskFromILink(page: PwPage, log: (k: string, t: string) => void): Promise<number> {
  await page.goto(`${BASE}/i/buy-aapl`, { waitUntil: 'domcontentloaded' })
  const cta = page.getByRole('button', { name: /Connect & build my path/i }).first()
  await cta.waitFor({ state: 'visible', timeout: 30_000 })
  await cta.click()
  log('drive', 'door opened from the /i splash')
  const lane = page.getByRole('button', { name: /Connect a wallet/i }).first()
  await lane.waitFor({ state: 'visible', timeout: 10_000 })
  await lane.click()
  log('drive', 'wallet lane → RainbowKit list')
  const mm = page.locator(RK_METAMASK).first()
  await mm.waitFor({ state: 'visible', timeout: 15_000 })
  await waitForArm(page, log)
  const tapAt = Date.now()
  await mm.click()
  log('drive', 'tapped MetaMask')
  return tapAt
}

/** The door arms the launch on open (lib/wallet-arm): the SDK's link lands
 *  on <html data-wallet-armed> within ~1s. Wait for it unless the scenario
 *  wants the fast-tap path. */
let FAST_TAP = false
async function waitForArm(page: PwPage, log: (k: string, t: string) => void): Promise<void> {
  if (FAST_TAP) return
  const t0 = Date.now()
  const armed = await page
    .waitForSelector('html[data-wallet-armed]', { state: 'attached', timeout: 8_000 })
    .then(() => true)
    .catch(() => false)
  log('drive', armed ? `armed after ${Date.now() - t0}ms` : 'NOT armed within 8s')
}

/** The landing page's Sign in → the door → the wallet lane (connectAndSignIn,
 *  so the FIRST wallet method after connect is the SIWE personal_sign). */
async function tapMetaMaskFromLanding(page: PwPage, log: (k: string, t: string) => void): Promise<number> {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  // The phone landing has no visible Sign in in the nav (#794 finding): the
  // markets page's top strip carries the door.
  await page.goto(`${BASE}/markets`, { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /^Sign in$/i }).first()
  await signIn.waitFor({ state: 'visible', timeout: 30_000 })
  await signIn.click()
  log('drive', 'door opened from /markets')
  const lane = page.getByRole('button', { name: /Connect a wallet/i }).first()
  await lane.waitFor({ state: 'visible', timeout: 10_000 })
  await lane.click()
  log('drive', 'wallet lane → RainbowKit list')
  const mm = page.locator(RK_METAMASK).first()
  await mm.waitFor({ state: 'visible', timeout: 15_000 })
  await waitForArm(page, log)
  const tapAt = Date.now()
  await mm.click()
  log('drive', 'tapped MetaMask')
  return tapAt
}

/** The armed launch must fire inside the tap: this many ms after it at most
 *  (measured ~5–40ms; the socket-paced launch was 390–1800ms). */
export const ARMED_LAUNCH_MAX_MS = 200

function judgeLaunch(trace: Trace): { ok: boolean; why: string } {
  const first = trace.launches[0]
  if (!first) return { ok: false, why: 'no launch attempt reached the browser within the window' }
  if (!/^metamask:\/\//.test(first.link)) return { ok: false, why: `first launch was not the deep link: ${first.link.slice(0, 60)}` }
  // ONE navigator. Two attempts on one tap is the measured duplicate
  // (RainbowKit's mobile list beside the SDK's own launch): Chrome refuses
  // the second, WebKit lets it replace the first mid-flight.
  if (trace.launches.length !== 1 || trace.rkNavigated) {
    return { ok: false, why: `${trace.launches.length} launch attempts on one tap${trace.rkNavigated ? ' (RainbowKit navigated too)' : ''}` }
  }
  // Desktop Chrome has no MetaMask app, so an ALLOWED launch ends at "no
  // registered handler" — that is the phone's app opening. A DROPPED first
  // launch means the tap's activation was gone by the time the SDK asked;
  // that is only acceptable when the handoff card went up to carry the tap.
  // Armed (the door had time): the launch is the tap's own navigation.
  const armed = trace.lines.some((l) => /armed after \d+ms/.test(l.text))
  if (armed && first.dtMs > ARMED_LAUNCH_MAX_MS) return { ok: false, why: `armed, but the launch came ${first.dtMs}ms after the tap (max ${ARMED_LAUNCH_MAX_MS})` }
  const tapLine = [...trace.lines].reverse().find((l) => /\[spy\] tap rk-wallet-option-metaMask/.test(l.text))
  const activation = tapLine ? (/active=true/.test(tapLine.text) ? 'activation held' : 'NO activation at the tap') : 'activation unread'
  if (armed && tapLine && !/active=true/.test(tapLine.text)) return { ok: false, why: `armed, but the tap carried no activation (${tapLine.text})` }
  if (first.verdict === 'allowed') return { ok: true, why: `one launch, allowed, ${first.dtMs}ms after the tap${armed ? ' (armed, ' + activation + ')' : ' (socket-paced)'}` }
  if (trace.handoffCard?.present) return { ok: true, why: `launch dropped ${first.dtMs}ms after the tap, the handoff card is up` }
  return { ok: false, why: `launch dropped ${first.dtMs}ms after the tap and NO handoff card` }
}

/** The other rows on the mobile list, one fresh context each: what each
 *  navigates to (or asks the browser to launch) on its tap. Informational —
 *  its verdict is "the tap produced SOME launch or wallet navigation, or the
 *  row is absent"; the trace holds the details for the lane file. */
async function tapOtherLane(page: PwPage, log: (k: string, t: string) => void, testid: string): Promise<number> {
  await page.goto(`${BASE}/i/buy-aapl`, { waitUntil: 'domcontentloaded' })
  const cta = page.getByRole('button', { name: /Connect & build my path/i }).first()
  await cta.waitFor({ state: 'visible', timeout: 30_000 })
  await cta.click()
  const lane = page.getByRole('button', { name: /Connect a wallet/i }).first()
  await lane.waitFor({ state: 'visible', timeout: 10_000 })
  await lane.click()
  const rows = await page.locator('[data-testid^="rk-wallet-option-"]').evaluateAll((els: Element[]) => els.map((e: Element) => e.getAttribute('data-testid')))
  log('rk-rows', rows.join(' '))
  const row = page.locator(`[data-testid="rk-wallet-option-${testid}"]`).first()
  await row.waitFor({ state: 'visible', timeout: 15_000 })
  const tapAt = Date.now()
  await row.click()
  log('drive', `tapped ${testid}`)
  return tapAt
}

function judgeOtherLane(trace: Trace): { ok: boolean; why: string } {
  const after = trace.lines.filter((l) => trace.tapAt !== null && l.t >= trace.tapAt)
  const navs = after.filter((l) => l.kind === 'navigated' || /\[spy\] a\.click|\[spy\] setItem WALLETCONNECT_DEEPLINK_CHOICE/.test(l.text)).map((l) => l.text.slice(0, 100))
  const launches = trace.launches.map((l) => `${l.verdict} +${l.dtMs}ms ${l.link.slice(0, 60)}`)
  return { ok: true, why: `launches=[${launches.join(' | ')}] navs=[${navs.join(' | ')}]` }
}

export const SCENARIOS: Scenario[] = [
  ...(['coinbase', 'rainbow', 'walletConnect'] as const).map((id) => ({
    id: `lane-${id}`,
    claim: `what the ${id} row on the mobile list does on its tap (informational)`,
    run: (page: PwPage, log: (k: string, t: string) => void) => tapOtherLane(page, log, id),
    judge: judgeOtherLane,
  })),
  {
    id: 'i-link',
    claim: 'the /i splash → door → MetaMask tap asks the browser for the wallet app',
    run: tapMetaMaskFromILink,
    judge: judgeLaunch,
  },
  {
    id: 'i-link-fast-tap',
    claim: 'a tap that lands before the arm does still gets the SDK’s own (socket-paced) launch, once',
    run: async (page, log) => {
      FAST_TAP = true
      try {
        return await tapMetaMaskFromILink(page, log)
      } finally {
        FAST_TAP = false
      }
    },
    judge: judgeLaunch,
  },
  {
    id: 'i-link-returning',
    claim: 'a returning visitor (the SDK has a persisted channel) still gets a launch on the tap',
    run: async (page, log) => {
      await tapMetaMaskFromILink(page, log)
      await page.waitForTimeout(6_000)
      log('drive', 'first attempt done; reloading with the SDK channel persisted')
      const keys = await page.evaluate(() => Object.keys(localStorage))
      log('storage', keys.join(' '))
      return tapMetaMaskFromILink(page, log)
    },
    judge: judgeLaunch,
  },
  {
    id: 'i-link-in-x',
    claim: 'inside X’s in-app browser the card stops asking for a tap and says how to leave for Safari',
    contextOptions: { userAgent: X_IOS_UA },
    run: tapMetaMaskFromILink,
    judge: (trace) => {
      const c = trace.handoffCard
      if (!c?.present) return { ok: false, why: 'no card' }
      if (!/can't open MetaMask/.test(c.title ?? '')) return { ok: false, why: `card title: ${c.title}` }
      if (!/Copy this page/.test(c.cta ?? '')) return { ok: false, why: `card cta: ${c.cta}` }
      if (trace.launches.length > 1 || trace.rkNavigated) return { ok: false, why: `${trace.launches.length} launch attempts` }
      return { ok: true, why: `escape card up: "${c.title}" / "${c.cta}"` }
    },
  },
  {
    id: 'sign-in',
    claim: 'the sign-in door (connect then SIWE) → MetaMask tap asks the browser for the wallet app',
    run: tapMetaMaskFromLanding,
    judge: judgeLaunch,
  },
]

async function runScenario(s: Scenario, browser: PwBrowser): Promise<Trace> {
  const context = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true, ...(s.contextOptions ?? {}) })
  const page = await context.newPage()
  // Spies that tell the two navigators apart without touching
  // window.location (unforgeable): RainbowKit writes its deep-link choice to
  // localStorage right BEFORE its own `location.href =`; lib/wallet-handoff
  // registers a `pagehide` listener right AFTER ours. Each spy also prints
  // whether the page still holds a transient user activation.
  // (Passed as a STRING: tsx injects a `__name` helper into a function
  // literal handed to addInitScript, and the spy dies before it runs.)
  await page.addInitScript(`(() => {
    const act = () => {
      const ua = navigator.userActivation
      return ua ? 'active=' + ua.isActive + ' been=' + ua.hasBeenActive : 'activation=?'
    }
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (/DEEPLINK|rk-|sdk|mmsdk|\\.sdk-comm/i.test(k)) console.log('[spy] setItem ' + k + ' ' + act())
      return setItem.call(this, k, v)
    }
    const add = window.addEventListener.bind(window)
    window.addEventListener = (type, ...rest) => {
      if (type === 'pagehide') console.log('[spy] pagehide listener (wallet-handoff watch) ' + act())
      return add(type, ...rest)
    }
    // The tap itself, stamped INSIDE the page in the capture phase (this
    // listener is registered before the app's, so it runs first): the launch
    // offset is measured from here, and the activation read here is the one
    // the app's synchronous navigation runs under.
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest('[data-testid="rk-wallet-option-metaMask"]')
      if (el) console.log('[spy] tap rk-wallet-option-metaMask ' + act())
    }, true)
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      console.log('[spy] a.click ' + this.href.slice(0, 80) + ' target=' + this.target + ' ' + act())
      return click.call(this)
    }
    console.log('[spy] armed')
  })()`)
  const t0 = Date.now()
  const lines: Line[] = []
  const log = (kind: string, text: string) => lines.push({ t: Date.now() - t0, kind, text })
  page.on('console', (m: { type(): string; text(): string }) => log(`console.${m.type()}`, m.text()))
  page.on('pageerror', (e: unknown) => log('pageerror', String(e)))
  page.on('framenavigated', (f: { url(): string }) => {
    if (f === page.mainFrame()) log('navigated', f.url())
  })
  page.on('request', (r: { url(): string; method(): string }) => {
    const u = r.url()
    if (/metamask\.app\.link|metamask\.io|metamask-sdk|cx\.metamask/i.test(u)) log('request', `${r.method()} ${u.slice(0, 160)}`)
  })
  let tapAt: number | null = null
  let failure: string | null = null
  try {
    tapAt = await s.run(page, log)
    // The window: the SDK's socket ack + the launch + the handoff card's
    // settle timer (1200ms) all fit inside it.
    await page.waitForTimeout(8_000)
  } catch (e) {
    failure = String(e).slice(0, 300)
    log('drive.error', failure)
  }
  // Prefer the page's own stamp of the tap (the spy's capture-phase click);
  // Playwright's pre-click timestamp includes its own dispatch latency.
  const spyTap = [...lines].reverse().find((l) => /\[spy\] tap rk-wallet-option-metaMask/.test(l.text))
  const tapT = spyTap ? spyTap.t : tapAt ? tapAt - t0 : -1
  const after = lines.filter((l) => l.t >= tapT)
  const launches = after
    .filter((l) => l.kind.startsWith('console'))
    .flatMap((l) => {
      const v = readLaunchVerdict(l.text)
      return v ? [{ t: l.t, verdict: v.verdict, link: v.link, dtMs: l.t - tapT }] : []
    })
  const rkNavigated = after.some((l) => /\[spy\] setItem WALLETCONNECT_DEEPLINK_CHOICE/.test(l.text))
  const handoffCard = await page
    .evaluate(() => {
      const el = document.querySelector('[data-wallet-handoff]')
      if (!el) return { present: false, title: null, cta: null, tried: false }
      const title = el.querySelector('h2')?.textContent ?? null
      const cta = el.querySelector('button.btn')?.textContent ?? null
      return { present: true, title, cta, tried: /Still waiting/.test(title ?? '') }
    })
    .catch(() => null)
  const rkModal = await page
    .evaluate(() => {
      const el = document.querySelector('[data-rk] [role="dialog"], [data-rk] [role="document"]')
      return { open: !!el, text: (el?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 240) }
    })
    .catch(() => ({ open: false, text: '' }))
  mkdirSync(OUT, { recursive: true })
  await page.mouse.move(1, 1).catch(() => {})
  await page.screenshot({ path: join(OUT, `${s.id}.png`), fullPage: false }).catch(() => {})
  const partial: Trace = { base: BASE, scenario: s.id, tapAt: tapAt ? tapAt - t0 : null, lines, launches, rkNavigated, handoffCard, rkModal, verdict: 'red', why: '' }
  const j = failure ? { ok: false, why: failure } : s.judge(partial)
  const trace: Trace = { ...partial, verdict: j.ok ? 'green' : 'red', why: j.why }
  writeFileSync(join(OUT, `${s.id}.trace.json`), JSON.stringify(trace, null, 2))
  await context.close()
  return trace
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  let red = 0
  try {
    for (const s of SCENARIOS) {
      if (ONLY && s.id !== ONLY) continue
      const trace = await runScenario(s, browser)
      if (trace.verdict === 'red') red++
      const mark = trace.verdict === 'green' ? 'PASS' : 'FAIL'
      console.log(`${mark} ${s.id}: ${trace.why}`)
      for (const l of trace.launches) console.log(`     launch ${l.verdict} +${l.dtMs}ms ${l.link.slice(0, 90)}`)
      console.log(`     card=${trace.handoffCard?.present ? `"${trace.handoffCard.title}"` : 'none'} rk=${trace.rkModal.open ? trace.rkModal.text.slice(0, 80) : 'closed'}`)
    }
  } finally {
    await browser.close()
  }
  process.exit(red ? 1 : 0)
}

if (process.argv[1] && /drive-mobile-connect/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
