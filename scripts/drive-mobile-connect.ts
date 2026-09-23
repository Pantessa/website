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

import pw from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium, devices } = pw

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

export const LAUNCH_DROPPED = /Not allowed to launch '([^']+)'.*user gesture is required/
export const LAUNCH_ALLOWED = /Failed to launch '([^']+)'.*does not have a registered handler/

type Line = { t: number; kind: string; text: string }

export type Trace = {
  base: string
  scenario: string
  tapAt: number | null
  lines: Line[]
  launches: { t: number; verdict: 'dropped' | 'allowed'; link: string; dtMs: number }[]
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
  run: (page: pw.Page, log: (kind: string, text: string) => void) => Promise<number>
  /** Judge the trace. */
  judge: (trace: Trace) => { ok: boolean; why: string }
}

const RK_METAMASK = '[data-testid="rk-wallet-option-metaMask"]'

/** Open the unified door from the /i splash and take the wallet lane into
 *  RainbowKit's list. Returns the ms timestamp of the MetaMask tap. */
async function tapMetaMaskFromILink(page: pw.Page, log: (k: string, t: string) => void): Promise<number> {
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
  const tapAt = Date.now()
  await mm.click()
  log('drive', 'tapped MetaMask')
  return tapAt
}

/** The landing page's Sign in → the door → the wallet lane (connectAndSignIn,
 *  so the FIRST wallet method after connect is the SIWE personal_sign). */
async function tapMetaMaskFromLanding(page: pw.Page, log: (k: string, t: string) => void): Promise<number> {
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
  const tapAt = Date.now()
  await mm.click()
  log('drive', 'tapped MetaMask')
  return tapAt
}

function judgeLaunch(trace: Trace): { ok: boolean; why: string } {
  const first = trace.launches[0]
  if (!first) return { ok: false, why: 'no launch attempt reached the browser within the window' }
  if (!/^metamask:\/\//.test(first.link)) return { ok: false, why: `first launch was not the deep link: ${first.link.slice(0, 60)}` }
  // Desktop Chrome has no MetaMask app, so an ALLOWED launch ends at "no
  // registered handler" — that is the phone's app opening. A DROPPED first
  // launch means the tap's activation was gone by the time the SDK asked;
  // that is only acceptable when the handoff card went up to carry the tap.
  if (first.verdict === 'allowed') return { ok: true, why: `launch allowed ${first.dtMs}ms after the tap` }
  if (trace.handoffCard?.present) return { ok: true, why: `launch dropped ${first.dtMs}ms after the tap, the handoff card is up` }
  return { ok: false, why: `launch dropped ${first.dtMs}ms after the tap and NO handoff card` }
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'i-link',
    claim: 'the /i splash → door → MetaMask tap asks the browser for the wallet app',
    run: tapMetaMaskFromILink,
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
    id: 'sign-in',
    claim: 'the sign-in door (connect then SIWE) → MetaMask tap asks the browser for the wallet app',
    run: tapMetaMaskFromLanding,
    judge: judgeLaunch,
  },
]

async function runScenario(s: Scenario, browser: pw.Browser): Promise<Trace> {
  const context = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true })
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
  page.on('console', (m) => log(`console.${m.type()}`, m.text()))
  page.on('pageerror', (e) => log('pageerror', String(e)))
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log('navigated', f.url())
  })
  page.on('request', (r) => {
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
  const launches = lines
    .filter((l) => l.kind.startsWith('console'))
    .flatMap((l) => {
      const d = LAUNCH_DROPPED.exec(l.text)
      if (d) return [{ t: l.t, verdict: 'dropped' as const, link: d[1], dtMs: tapAt ? l.t - (tapAt - t0) : -1 }]
      const a = LAUNCH_ALLOWED.exec(l.text)
      if (a) return [{ t: l.t, verdict: 'allowed' as const, link: a[1], dtMs: tapAt ? l.t - (tapAt - t0) : -1 }]
      return []
    })
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
  const partial: Trace = { base: BASE, scenario: s.id, tapAt: tapAt ? tapAt - t0 : null, lines, launches, handoffCard, rkModal, verdict: 'red', why: '' }
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
