#!/usr/bin/env tsx
/**
 * Mobile links drive — the intent-link path on a PHONE, measured.
 *
 * The LINKS lane of the mobile-onboarding squad (2026-09-23). A stranger opens
 * `/i/<slug>` from a tweet or a DM on their phone — often inside an in-app
 * browser (X, LinkedIn, a bare WKWebView), often with no wallet installed.
 * This drive walks that path with Playwright + the installed Chrome at 375px:
 *
 *   splash → the unified door → the wallet sheet → the MetaMask tap (the SDK
 *   lane: measured by Chrome's own console words) → and, with a mock wallet
 *   attached, the ask running in place → chips → the sign card → the refusal
 *   → a RELOAD (what an in-app browser does when the visitor comes back from
 *   the wallet app) → whether the ask re-fires.
 *
 * Every state is screenshotted (--shots=<dir>) and every measurement lands in
 * <dir>/summary.json, so a finding is a number, never a feeling.
 *
 * Usage:
 *   BASE=http://localhost:3872 npx tsx scripts/drive-mobile-links.ts
 *   BASE=… npx tsx scripts/drive-mobile-links.ts --only=splash --shots=/tmp/shots
 *
 * Read-only: the mock wallet refuses every transaction and every order; the
 * only signature it ever produces is nothing. Every request wears
 * `x-yf-internal-run: 1` (lib/value-origin) and `x-yf-no-ask-log: 1`.
 *
 * QA imports MOBILE_LINK_SCENARIOS + MOBILE_UAS from here (drive:mobile).
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { HOUSE_LINKS } from '../lib/house-links'
import { inAppBrowserOf } from '../lib/inapp-browser'

const BASE = process.env.BASE ?? 'http://localhost:3872'
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? ''
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? ''

/** The house burner (read-only here; the mock refuses every signature). */
const BURNER = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'

// ── the user agents a link opens in ────────────────────────────────────────
// Real strings, as the apps send them. `expect` is what lib/inapp-browser must
// say about each — the drive pins the table against the live module too.
export const MOBILE_UAS: Record<string, { ua: string; label: string; expect: { inApp: boolean; canLaunchApps: boolean } }> = {
  'ios-safari': {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    label: 'iPhone Safari',
    expect: { inApp: false, canLaunchApps: true },
  },
  'ios-x': {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone',
    label: 'X for iPhone (in-app)',
    expect: { inApp: true, canLaunchApps: false },
  },
  'ios-linkedin': {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.1',
    label: 'LinkedIn for iPhone (in-app)',
    expect: { inApp: true, canLaunchApps: false },
  },
  'ios-webview': {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    label: 'bare WKWebView (iMessage preview, an unnamed app)',
    expect: { inApp: true, canLaunchApps: false },
  },
  'android-fb': {
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/475.0.0.0;]',
    label: 'Facebook for Android (WebView)',
    expect: { inApp: true, canLaunchApps: false },
  },
  'android-chrome': {
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    label: 'Android Chrome',
    expect: { inApp: false, canLaunchApps: true },
  },
  'ios-metamask': {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MetaMaskMobile',
    label: "MetaMask's own in-app browser",
    expect: { inApp: true, canLaunchApps: true },
  },
}

/** Every scenario this drive runs, by id — QA's drive:mobile lists them. */
export const MOBILE_LINK_SCENARIOS: Array<{ id: string; what: string }> = [
  { id: 'detector', what: 'lib/inapp-browser agrees with the UA table above' },
  { id: 'splash', what: 'every house link + a mosaic + a branded creator link at 375, dark + light: the door is in the viewport, no overflow, no console error' },
  { id: 'door', what: 'the splash CTA opens the UNIFIED door (wallet lead, Google, email), on the iPhone Safari UA and every in-app UA' },
  { id: 'sheet', what: 'the wallet lane opens RainbowKit\'s phone sheet; the MetaMask tap is measured by Chrome\'s own launch words' },
  { id: 'runtime', what: 'with a wallet attached the ask runs in place at 375: composer, chips, the sign card, the refusal state, the beacon order' },
  { id: 'return', what: 'a return from the wallet app: visibilitychange never re-fires the ask; a RELOAD is measured (does the ask re-fire? does the thread survive?)' },
  { id: 'storefront', what: '/l/<handle> and /p/<slug> at 375: no overflow, the chips route into /i and /chat' },
]

// ── the mock wallet (desktop semantics: an injected EIP-6963 provider) ─────
const MOCK_WALLET = `(() => {
  const ADDR = '__ADDR__'
  const provider = {
    isMetaMask: false,
    _chainId: '0x2105',
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ADDR]
        case 'eth_chainId':
          return provider._chainId
        case 'wallet_switchEthereumChain':
          provider._chainId = params[0].chainId
          return null
        case 'wallet_addEthereumChain':
          return null
        case 'personal_sign':
        case 'eth_signTypedData_v4':
        case 'eth_sendTransaction':
          window.__mockRefused = (window.__mockRefused || 0) + 1
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        default:
          return null
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

// playwright-core is NOT a dependency of this app (see drive-onboarding.ts):
// it resolves from the developer's global install, and its types stay out of
// `next build`. The handful of shapes this walk calls are spelled out here.
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

function want(id: string) {
  return !ONLY || ONLY.split(',').includes(id)
}

async function shot(page: Pw, name: string) {
  if (!SHOTS) return
  await page.mouse.move(0, 0).catch(() => {})
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch((e: Error) => console.log(`  (shot ${name} failed: ${e.message})`))
}

/** The environment's noise, not findings (same list as drive-onboarding). */
function realErrors(errs: string[]) {
  return errs.filter(
    (e) =>
      !/favicon|ERR_|net::|Download the React|401|Failed to load resource/i.test(e) &&
      !/api\.cdp\.coinbase\.com|Access to XMLHttpRequest|has been blocked by CORS/i.test(e),
  )
}

type Opened = { ctx: Pw; page: Pw; errs: string[]; console: string[]; posts: string[]; beacons: string[]; chatPosts: number }

async function open(browser: Pw, devices: Pw, o: { ua: keyof typeof MOBILE_UAS; theme: 'dark' | 'light'; wallet?: string }): Promise<Opened> {
  const base = devices['iPhone 13']
  const ctx = await browser.newContext({
    ...base,
    userAgent: MOBILE_UAS[o.ua].ua,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: o.theme,
    extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
  })
  if (o.wallet) {
    await ctx.addInitScript(MOCK_WALLET.replace('__ADDR__', o.wallet))
    await ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"injected"') } catch {}`)
  }
  const page = await ctx.newPage()
  const out: Opened = { ctx, page, errs: [], console: [], posts: [], beacons: [], chatPosts: 0 }
  page.on('console', (m: Pw) => {
    out.console.push(`${m.type()}: ${m.text()}`)
    if (m.type() === 'error') out.errs.push(m.text())
  })
  page.on('pageerror', (e: unknown) => out.errs.push(String(e)))
  page.on('request', (r: Pw) => {
    if (r.method() !== 'POST') return
    const url: string = r.url()
    if (url.includes('/api/intent-links/') && url.endsWith('/events')) {
      try {
        out.beacons.push(String(JSON.parse(r.postData() ?? '{}').kind))
      } catch {
        out.beacons.push('?')
      }
    }
    if (/\/api\/chat(\?|$)/.test(url)) out.chatPosts++
    out.posts.push(url.replace(BASE, ''))
  })
  return out
}

async function overflowOf(page: Pw): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/** Where a control sits relative to the 812px viewport: visible without a
 *  scroll, or how far below the fold its top is. */
async function placeOf(page: Pw, selector: string): Promise<{ found: boolean; top: number; bottom: number; inView: boolean }> {
  const loc = page.locator(selector).first()
  if ((await loc.count()) === 0) return { found: false, top: -1, bottom: -1, inView: false }
  const box = await loc.boundingBox().catch(() => null)
  if (!box) return { found: true, top: -1, bottom: -1, inView: false }
  const top = Math.round(box.y)
  const bottom = Math.round(box.y + box.height)
  return { found: true, top, bottom, inView: top >= 0 && bottom <= 812 }
}

const SPLASH_CTA = 'button:has-text("Connect & build my path")'
const DOOR_LANE = 'button:has-text("Connect a wallet")'

/** The three lanes of the unified door, read from the page. */
async function doorLanes(page: Pw): Promise<{ wallet: boolean; google: boolean; email: boolean; title: string; panel: { top: number; bottom: number } | null }> {
  return page.evaluate(() => {
    const dialog = document.querySelector('.ca__panel') as HTMLElement | null
    const text = (dialog?.innerText ?? '').toLowerCase()
    const r = dialog?.getBoundingClientRect()
    return {
      wallet: /connect a wallet/.test(text),
      google: /google/.test(text),
      email: !!dialog?.querySelector('input[type="email"]'),
      title: dialog?.querySelector('.ca__title')?.textContent?.trim() ?? '',
      panel: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
    }
  })
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

  // ── detector ─────────────────────────────────────────────────────────────
  if (want('detector')) {
    console.log('\n═══ detector ═══')
    for (const [id, row] of Object.entries(MOBILE_UAS)) {
      const got = inAppBrowserOf(row.ua)
      add(`detector/${id}`, got.inApp === row.expect.inApp && got.canLaunchApps === row.expect.canLaunchApps, `${row.label} → inApp=${got.inApp} vendor=${got.vendor} canLaunchApps=${got.canLaunchApps}`)
    }
  }

  // ── splash: every house link + mosaic + branded, dark + light ────────────
  const LINKS: Array<{ slug: string; ask: string; kind: string }> = [
    ...HOUSE_LINKS.map((h) => ({ slug: h.slug, ask: h.ask, kind: 'house' })),
    { slug: 'pmezgbu8', ask: 'tile my wallet', kind: 'mosaic' },
    { slug: 'mlbrand01', ask: 'Buy $10 of AAPL', kind: 'branded' },
  ]
  if (want('splash')) {
    console.log('\n═══ splash (375, iPhone Safari UA) ═══')
    for (const theme of ['dark', 'light'] as const) {
      for (const link of LINKS) {
        const o = await open(browser, devices, { ua: 'ios-safari', theme })
        const res = await o.page.goto(`${BASE}/i/${link.slug}`, { waitUntil: 'domcontentloaded' })
        await o.page.waitForTimeout(2500)
        const id = `splash/${link.slug}/${theme}`
        if (res?.status() !== 200) {
          add(id, false, `HTTP ${res?.status()}`)
          await o.ctx.close()
          continue
        }
        const cta = await placeOf(o.page, SPLASH_CTA)
        const ctaCount = await o.page.locator(SPLASH_CTA).count()
        const overflow = await overflowOf(o.page)
        const askShown = (await o.page.locator('h1').innerText().catch(() => '')).includes(link.ask.slice(0, 16))
        const errs = realErrors(o.errs)
        await shot(o.page, `${id.replace(/\//g, '-')}`)
        add(id, ctaCount === 1 && cta.inView && overflow <= 1 && askShown && errs.length === 0, `cta ${ctaCount ? `top ${cta.top}px${cta.inView ? ' (in view)' : ' (BELOW THE FOLD)'}` : 'MISSING'}, overflow ${overflow}px, ask ${askShown ? 'shown' : 'MISSING'}${errs.length ? `, console: ${errs[0].slice(0, 120)}` : ''}`)
        // The first-paint hold: how long until the door is a button.
        if (theme === 'dark' && link.kind === 'house') {
          const beacons = o.beacons.join(',')
          note(`${id}/beacons`, beacons || 'none')
        }
        await o.ctx.close()
      }
    }
  }

  // ── door: the splash CTA opens the unified door — on every UA ────────────
  if (want('door')) {
    console.log('\n═══ door (375, every UA) ═══')
    for (const ua of Object.keys(MOBILE_UAS) as Array<keyof typeof MOBILE_UAS>) {
      const o = await open(browser, devices, { ua, theme: 'dark' })
      await o.page.goto(`${BASE}/i/buy-aapl`, { waitUntil: 'domcontentloaded' })
      await o.page.waitForTimeout(2500)
      const id = `door/${ua}`
      const ctaCount = await o.page.locator(SPLASH_CTA).count()
      if (!ctaCount) {
        add(id, false, 'no splash CTA')
        await o.ctx.close()
        continue
      }
      await o.page.locator(SPLASH_CTA).first().click({ timeout: 4000 }).catch(() => {})
      await o.page.waitForTimeout(1500)
      const lanes = await doorLanes(o.page)
      const overflow = await overflowOf(o.page)
      // What the splash says about THIS browser (the in-app line, if any).
      const inAppLine = await o.page.locator('[data-inapp-browser]').count()
      const bodyText: string = await o.page.locator('body').innerText()
      const escapeHint = /open (this |the )?(page |link )?in (safari|chrome|browser|your browser)/i.test(bodyText)
      await shot(o.page, `${id.replace(/\//g, '-')}`)
      add(id, lanes.wallet && lanes.google && lanes.email && overflow <= 1, `title "${lanes.title}", lanes wallet=${lanes.wallet} google=${lanes.google} email=${lanes.email}, panel ${lanes.panel ? `${lanes.panel.top}→${lanes.panel.bottom}px` : 'MISSING'}, overflow ${overflow}px, in-app line ${inAppLine ? 'shown' : 'none'}, escape hint ${escapeHint ? 'shown' : 'none'}`)
      // The escape line shows EXACTLY where a wallet app can't be launched
      // (lib/inapp-browser) — never on Safari / Chrome / a wallet's browser.
      const wantEscape = !MOBILE_UAS[ua].expect.canLaunchApps
      add(`${id}/escape-line`, (inAppLine > 0) === wantEscape && escapeHint === wantEscape, wantEscape ? (inAppLine ? 'the splash says how to leave for the real browser' : 'NO ESCAPE LINE — the wallet tap will stall here') : inAppLine ? 'an escape line on a browser that launches apps' : 'no escape line (right)')
      const noWalletLane = await o.page.locator('[data-no-wallet-lane]').count()
      add(`${id}/no-wallet-lane`, noWalletLane === 1, `${noWalletLane} "no wallet on this phone" line(s) under the CTA`)
      summary[`${id}/escapeHint`] = escapeHint
      summary[`${id}/inAppLine`] = inAppLine > 0
      await o.ctx.close()
    }
  }

  // ── sheet: the wallet lane → RainbowKit's phone sheet → the MetaMask tap ─
  if (want('sheet')) {
    console.log('\n═══ sheet (375, iPhone Safari UA, no wallet installed) ═══')
    const o = await open(browser, devices, { ua: 'ios-safari', theme: 'dark' })
    await o.page.goto(`${BASE}/i/buy-aapl`, { waitUntil: 'domcontentloaded' })
    await o.page.waitForTimeout(2500)
    await o.page.locator(SPLASH_CTA).first().click({ timeout: 4000 }).catch(() => {})
    await o.page.waitForTimeout(1200)
    const lane = o.page.locator(DOOR_LANE).first()
    add('sheet/door-lane', (await lane.count()) > 0, 'the unified door carries the wallet lane')
    await lane.click({ timeout: 4000 }).catch(() => {})
    await o.page.waitForTimeout(2500)
    const sheet = await o.page.evaluate(() => {
      const dlg = document.querySelector('[data-rk] [role="dialog"]') as HTMLElement | null
      if (!dlg) return null
      const r = dlg.getBoundingClientRect()
      const wallets = Array.from(dlg.querySelectorAll('[data-testid^="rk-wallet-option-"]')).map((b) => (b as HTMLElement).getAttribute('data-testid')?.replace('rk-wallet-option-', ''))
      const z = getComputedStyle(dlg.closest('[data-rk] > div') as HTMLElement).zIndex
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), wallets, z, text: dlg.innerText.slice(0, 300) }
    })
    await shot(o.page, 'sheet-ios-safari-wallets')
    add('sheet/opens', !!sheet, sheet ? `sheet ${sheet.top}→${sheet.bottom}px (h ${sheet.height}), wallets [${sheet.wallets.join(', ')}], z ${sheet.z}` : 'RainbowKit sheet did not open')
    if (sheet) {
      const mm = o.page.locator('[data-testid="rk-wallet-option-metaMask"]').first()
      if ((await mm.count()) === 0) add('sheet/metamask-entry', false, 'no MetaMask entry in the sheet')
      else {
        const before = o.console.length
        await mm.click({ timeout: 4000 }).catch(() => {})
        await o.page.waitForTimeout(4000)
        const launch = o.console.slice(before).filter((l) => /metamask|launch|registered handler|user gesture/i.test(l))
        const refused = launch.some((l) => /Not allowed to launch/i.test(l))
        const noHandler = launch.some((l) => /does not have a registered handler|scheme does not have/i.test(l))
        const handoff = await o.page.evaluate(() => {
          const el = document.querySelector('[data-wallet-handoff]') as HTMLElement | null
          return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 200) : null
        })
        const status = await o.page.evaluate(() => (document.querySelector('[data-rk] [role="dialog"]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').slice(0, 240) ?? '')
        await shot(o.page, 'sheet-ios-safari-metamask-tap')
        note('sheet/metamask-tap/console', launch.join(' | ').slice(0, 400) || 'no launch line in the console')
        note('sheet/metamask-tap/status', status)
        add('sheet/metamask-tap', refused || noHandler || !!handoff, `launch ${refused ? 'REFUSED (no user gesture)' : noHandler ? 'allowed, no app on this machine' : 'not seen'}; handoff card ${handoff ? `"${handoff}"` : 'none'}`)
        summary['sheet/metamask-tap'] = { refused, noHandler, handoff, status, launch }
      }
    }
    await o.ctx.close()
  }

  // ── runtime: with a wallet attached, the ask runs at 375 ────────────────
  if (want('runtime') || want('return')) {
    console.log('\n═══ runtime (375, iPhone Safari UA, mock wallet = the burner) ═══')
    const o = await open(browser, devices, { ua: 'ios-safari', theme: 'dark', wallet: BURNER })
    await o.page.goto(`${BASE}/i/bridge-usdc`, { waitUntil: 'domcontentloaded' })
    await o.page.waitForTimeout(5000)
    const splashGone = async () => (await o.page.locator(SPLASH_CTA).count()) === 0
    for (let tries = 0; tries < 3 && !(await splashGone()); tries++) {
      await o.page.locator(SPLASH_CTA).first().click({ timeout: 4000 }).catch(() => {})
      await o.page.waitForTimeout(1200)
      const lane = o.page.locator(DOOR_LANE).first()
      if ((await lane.count()) > 0) {
        await lane.click({ timeout: 4000 }).catch(() => {})
        await o.page.waitForTimeout(2000)
        await shot(o.page, 'runtime-sheet-with-installed-wallet')
      }
      // On a phone UA RainbowKit lists an injected provider as "Browser Wallet"
      // (rk-wallet-option-injected), never by its EIP-6963 rdns.
      const pick = o.page.locator('[data-testid="rk-wallet-option-injected"], [data-testid="rk-wallet-option-io.pantessa.drive"], button:has-text("Drive Wallet")').first()
      if ((await pick.count()) > 0) {
        await pick.click({ timeout: 4000 }).catch(() => {})
        await o.page.waitForTimeout(4000)
      }
      if (await splashGone()) break
      await o.page.keyboard.press('Escape').catch(() => {})
      await o.page.waitForTimeout(800)
    }
    const connected = await splashGone()
    add('runtime/connected', connected, connected ? 'the runtime took over' : 'SKIPPED — the mock wallet did not attach (harness limitation)')
    if (connected) {
      // The ask runs itself. Wait for the turn: a sign card (bridge-usdc from
      // the burner's Base USDC builds a guarded NEAR deposit) or a refusal.
      await o.page.waitForTimeout(3000)
      await shot(o.page, 'runtime-0-thread-loading')
      const signBtn = o.page.locator('button:has-text("Sign & send"), button:has-text("Sign and send"), button:has-text("Sign & send deposit"), button:has-text("Sign order")').first()
      await signBtn.waitFor({ state: 'attached', timeout: 45_000 }).catch(() => {})
      await o.page.waitForTimeout(800)
      const text: string = await o.page.locator('body').innerText()
      const hasSign = (await signBtn.count()) > 0
      const overflow = await overflowOf(o.page)
      const composer = await placeOf(o.page, 'textarea')
      const signPlace = hasSign ? await signBtn.evaluate((el: HTMLElement) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight, h: Math.round(r.height) } }) : null
      await shot(o.page, 'runtime-1-built')
      add('runtime/ask-ran', o.chatPosts >= 1 && /just enough|all my|sign|review|step|swap|deposit|nothing to sign|top up/i.test(text), `${o.chatPosts} POST /api/chat, sign card ${hasSign ? `at ${signPlace?.top}→${signPlace?.bottom}px (${signPlace?.inView ? 'in view' : 'OFF SCREEN'}, ${signPlace?.h}px tall)` : 'none'}, composer ${composer.found ? `top ${composer.top}px` : 'MISSING'}, overflow ${overflow}px`)
      note('runtime/beacons', o.beacons.join(' → ') || 'none')
      add('runtime/beacon-order', o.beacons[0] === 'open' && o.beacons[1] === 'connect' && (!hasSign || o.beacons.includes('built')), `beacons: ${o.beacons.join(' → ')}`)
      const errs = realErrors(o.errs)
      add('runtime/console', errs.length === 0, errs[0]?.slice(0, 160) ?? 'clean')
      if (hasSign) {
        await signBtn.click({ timeout: 4000 }).catch(() => {})
        await o.page.waitForTimeout(3500)
        const after: string = await o.page.locator('body').innerText()
        const refusedCount: number = await o.page.evaluate(() => (window as unknown as { __mockRefused?: number }).__mockRefused ?? 0)
        const refusalCopy = /rejected|declined|refused|didn.t sign|cancel/i.test(after)
        await shot(o.page, 'runtime-2-wallet-refused')
        add('runtime/refusal-state', refusedCount >= 1 && refusalCopy, `wallet asked ${refusedCount}×, page ${refusalCopy ? 'names the refusal' : 'says nothing about the refusal'}`)
        const retry = await o.page.locator('button:has-text("Sign & send"), button:has-text("Try again"), button:has-text("Retry")').count()
        add('runtime/refusal-way-forward', retry > 0, `${retry} retry control(s) after the refusal`)
      }
      // Where the keep bar / share sit is post-signature — those states need a
      // real signature; recorded as owed under R2 in LINKS.md.

      if (want('return')) {
        console.log('\n═══ return (the visitor comes back from the wallet app) ═══')
        // 1. The app-switch that did NOT reload the page: visibility only.
        const postsBefore = o.chatPosts
        const beaconsBefore = o.beacons.length
        // tsx injects `__name` into functions handed to evaluate — strings only.
        await o.page.evaluate(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden' } }); Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true } }); document.dispatchEvent(new Event('visibilitychange'))`)
        await o.page.waitForTimeout(1500)
        await o.page.evaluate(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible' } }); Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false } }); document.dispatchEvent(new Event('visibilitychange'))`)
        await o.page.waitForTimeout(4000)
        add('return/visibility-no-refire', o.chatPosts === postsBefore && o.beacons.length === beaconsBefore, `${o.chatPosts - postsBefore} new POST /api/chat, ${o.beacons.length - beaconsBefore} new beacon(s) after hide→show`)
        await shot(o.page, 'return-1-after-visibility')

        // 2. The app-switch that DID reload the page (iOS evicts background
        //    tabs; in-app browsers reload on return). The mock wallet is
        //    remembered, so the runtime auto-starts.
        o.chatPosts = 0
        o.beacons.length = 0
        await o.page.reload({ waitUntil: 'domcontentloaded' })
        await o.page.waitForTimeout(12_000)
        const bodyAfter: string = await o.page.locator('body').innerText()
        const threadSurvived = /sign & send|sign and send|deposit|just enough|all my/i.test(bodyAfter) && o.chatPosts === 0
        await shot(o.page, 'return-2-after-reload')
        note('return/reload', `${o.chatPosts} POST /api/chat after reload, beacons ${o.beacons.join(' → ') || 'none'}, thread ${threadSurvived ? 'survived' : 'GONE'}`)
        add('return/reload-no-refire', o.chatPosts === 0, `after a reload the ask ${o.chatPosts ? `RE-FIRED (${o.chatPosts} POST /api/chat — a second build for an ask the wallet may already have signed)` : 'did not re-fire'}; beacons ${o.beacons.join(' → ') || 'none'}`)
        const holdCard = await o.page.locator('[data-link-return="hold"]').count()
        const holdChips = await o.page.locator('[data-link-return-done], [data-link-return-again]').count()
        add('return/reload-holds-with-a-card', holdCard === 1 && holdChips === 2, `${holdCard} came-back card(s), ${holdChips} chip(s)`)
        add('return/reload-beacons-once', !o.beacons.includes('open') && !o.beacons.includes('connect'), `once-only beacons after the reload: ${o.beacons.filter((b) => b === 'open' || b === 'connect').join(',') || 'none (right)'}`)
        summary['return/reload'] = { chatPosts: o.chatPosts, beacons: [...o.beacons], threadSurvived, holdCard, holdChips }
        // The chip that SENDS: "it didn't — build it again" runs the ask once.
        if (holdCard === 1) {
          const before = o.chatPosts
          await o.page.locator('[data-link-return-again]').first().click({ timeout: 4000 }).catch(() => {})
          await o.page.waitForTimeout(6000)
          add('return/again-chip-sends', o.chatPosts === before + 1 && (await o.page.locator('[data-link-return]').count()) === 0, `${o.chatPosts - before} POST /api/chat after the chip; card ${(await o.page.locator('[data-link-return]').count()) ? 'still up' : 'gone'}`)
          await shot(o.page, 'return-3-again-chip')
        }
      }
    }
    await o.ctx.close()
  }

  // ── storefront + shared chat at 375 ─────────────────────────────────────
  if (want('storefront')) {
    console.log('\n═══ storefront (/l, /p at 375) ═══')
    for (const theme of ['dark', 'light'] as const) {
      const o = await open(browser, devices, { ua: 'ios-safari', theme })
      const res = await o.page.goto(`${BASE}/l/mobilelinks`, { waitUntil: 'domcontentloaded' })
      await o.page.waitForTimeout(2000)
      const overflow = await overflowOf(o.page)
      const chips = await o.page.locator('a[href^="/i/"]').count()
      const errs = realErrors(o.errs)
      await shot(o.page, `storefront-l-${theme}`)
      add(`storefront/l/${theme}`, res?.status() === 200 && overflow <= 1 && chips >= 1 && errs.length === 0, `HTTP ${res?.status()}, overflow ${overflow}px, ${chips} link chip(s) into /i${errs.length ? `, console: ${errs[0].slice(0, 100)}` : ''}`)
      await o.ctx.close()
    }
    {
      const o = await open(browser, devices, { ua: 'ios-safari', theme: 'dark' })
      const slug = process.env.SHARED_CHAT_SLUG ?? ''
      if (!slug) add('storefront/p', true, 'SKIPPED — set SHARED_CHAT_SLUG to a public /p slug on this DB')
      else {
        const res = await o.page.goto(`${BASE}/p/${slug}`, { waitUntil: 'domcontentloaded' })
        await o.page.waitForTimeout(2000)
        const overflow = await overflowOf(o.page)
        const handoff = await o.page.locator('a[href*="/chat"], button:has-text("Try"), a:has-text("Try")').count()
        const errs = realErrors(o.errs)
        await shot(o.page, 'storefront-p-dark')
        add('storefront/p', res?.status() === 200 && overflow <= 1 && handoff >= 1 && errs.length === 0, `HTTP ${res?.status()}, overflow ${overflow}px, ${handoff} handoff control(s)${errs.length ? `, console: ${errs[0].slice(0, 100)}` : ''}`)
      }
      await o.ctx.close()
    }
  }

  await browser.close()
  const bad = findings.filter((f) => !f.ok).length
  if (SHOTS) writeFileSync(`${SHOTS}/summary.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), findings, summary }, null, 2))
  console.log(`\n${bad === 0 ? '✅ mobile links drive clean' : `❌ ${bad} finding(s)`} · ${findings.length - bad} clean\n`)
  process.exit(bad === 0 ? 0 : 1)
}

// Only drive when run directly — QA imports the scenario table.
if (process.argv[1] && /drive-mobile-links/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
