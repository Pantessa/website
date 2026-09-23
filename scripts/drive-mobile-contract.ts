/**
 * THE SCENARIO CONTRACT for `npm run drive:mobile` (mobile-onboarding squad,
 * 2026-09-23). Owned by the QA lane; imported by every lane's
 * `scripts/drive-mobile-<lane>.ts`.
 *
 * A lane writes scenarios and exports them. It never launches a browser, never
 * opens a context, never parses argv, never decides an exit code — the runner
 * (`scripts/drive-mobile.ts`) owns all of that, so every lane's scenarios run
 * under one session per profile and print one comparable verdict line.
 *
 *   // scripts/drive-mobile-connect.ts
 *   import type { MobileScenario } from './drive-mobile-contract'
 *   export const scenarios: MobileScenario[] = [
 *     {
 *       id: 'connect/metamask-launch',
 *       profiles: ['iphone-dark', 'android-dark'],
 *       async run({ page, baseUrl, log, launchVerdict }) {
 *         await page.goto(`${baseUrl}/i/buy-aapl`, { waitUntil: 'domcontentloaded' })
 *         …
 *         if (launchVerdict().verdict === 'blocked-no-gesture') throw new Error('launch dropped')
 *       },
 *     },
 *   ]
 *
 * RULES
 *  - A scenario is RED when `run` THROWS. Returning normally is green. Nothing
 *    else (no return value, no assertion count) is read.
 *  - `log(line)` prints an indented note under the verdict line. Use it for the
 *    measurement that proves the verdict — a console line, a DOM read, a count.
 *    A scenario that passes without saying what it measured is a weak pin.
 *  - `profiles` defaults to `['iphone-dark']`. Declare more ONLY where the
 *    profile changes the answer (theme for layout/contrast, android for the
 *    UA lane, inapp for the webview escape) — every extra profile is another
 *    full page load.
 *  - Scenarios must be independent and order-free: the runner gives each one a
 *    FRESH context (no cookies, no localStorage, no wagmi state) and closes it
 *    after. Never rely on a previous scenario.
 *  - Read-only: no scenario signs a real transaction, moves money, or writes a
 *    row that is not stamped internal. The runner sets `x-yf-internal-run: 1`
 *    and `x-yf-no-ask-log: 1` on every same-origin request.
 *  - Keep a scenario under ~60s. The runner's per-scenario cap is 120s.
 */

// ── Playwright types, spelled out locally on purpose ───────────────────────
// `playwright-core` is NOT a dependency of this app (it resolves from the
// developer's global install). A `typeof import('playwright-core')` here
// type-checks on this Mac and fails `next build` everywhere else — that is
// exactly how it broke a Vercel deploy once. These shapes cover only what the
// drives actually call; widen them here when a lane needs more, never by
// importing the real package.
export type PwConsoleMessage = { type(): string; text(): string }
export type PwLocator = {
  first(): PwLocator
  nth(i: number): PwLocator
  locator(selector: string): PwLocator
  count(): Promise<number>
  click(opts?: { timeout?: number; force?: boolean }): Promise<void>
  tap(opts?: { timeout?: number }): Promise<void>
  isVisible(): Promise<boolean>
  isEnabled(): Promise<boolean>
  waitFor(opts?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
  innerText(): Promise<string>
  getAttribute(name: string): Promise<string | null>
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>
  screenshot(opts?: { path?: string }): Promise<unknown>
  evaluateAll<T>(fn: (els: Element[]) => T): Promise<T>
}
export type PwPage = {
  goto(url: string, opts?: { waitUntil?: 'commit' | 'domcontentloaded' | 'load' | 'networkidle'; timeout?: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  waitForFunction(fn: string, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>
  locator(selector: string): PwLocator
  evaluate<T>(fn: string | ((arg: never) => T), arg?: unknown): Promise<T>
  screenshot(opts?: { path?: string; fullPage?: boolean }): Promise<unknown>
  mouse: { move(x: number, y: number): Promise<void> }
  keyboard: { press(key: string): Promise<void>; type(text: string, opts?: { delay?: number }): Promise<void> }
  url(): string
  on(event: 'console', cb: (m: PwConsoleMessage) => void): void
  on(event: 'pageerror', cb: (e: unknown) => void): void
}
export type PwContext = {
  newPage(): Promise<PwPage>
  addInitScript(script: string): Promise<void>
  exposeFunction(name: string, fn: (...args: never[]) => unknown): Promise<void>
  route(url: string, handler: (route: never) => unknown): Promise<void>
  close(): Promise<void>
}
export type PwBrowser = {
  newContext(opts: {
    viewport: { width: number; height: number }
    userAgent?: string
    deviceScaleFactor?: number
    colorScheme?: 'dark' | 'light'
    isMobile?: boolean
    hasTouch?: boolean
    extraHTTPHeaders?: Record<string, string>
  }): Promise<PwContext>
  close(): Promise<void>
}
export type PwChromium = {
  launch(opts: { executablePath?: string; channel?: string; headless?: boolean; args?: string[] }): Promise<PwBrowser>
}

// ── Profiles ───────────────────────────────────────────────────────────────
// The UA is the load-bearing field, not the viewport: RainbowKit's `isMobile()`
// and the MetaMask SDK both branch on the UA string, so a 375px desktop UA
// runs the DESKTOP lane and proves nothing about a phone.
export type ProfileId = 'iphone-dark' | 'iphone-light' | 'android-dark' | 'inapp-dark'

export type MobileProfile = {
  id: ProfileId
  label: string
  userAgent: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  colorScheme: 'dark' | 'light'
  /** True inside a wallet's / a social app's own webview. */
  inApp: boolean
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
/** X's iOS in-app browser: an iPhone WKWebView with the app's own suffix. It
 *  has no `window.ethereum`, cannot open a second app cleanly, and is where a
 *  tweeted link lands. */
const INAPP_UA = `${IPHONE_UA} Twitter for iPhone/10.51`

export const PROFILES: Record<ProfileId, MobileProfile> = {
  'iphone-dark': {
    id: 'iphone-dark',
    label: 'iPhone 13 · dark',
    userAgent: IPHONE_UA,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    inApp: false,
  },
  'iphone-light': {
    id: 'iphone-light',
    label: 'iPhone 13 · light',
    userAgent: IPHONE_UA,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    inApp: false,
  },
  'android-dark': {
    id: 'android-dark',
    label: 'Android 360×780 · dark',
    userAgent: ANDROID_UA,
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    inApp: false,
  },
  'inapp-dark': {
    id: 'inapp-dark',
    label: 'X in-app browser (iOS) · dark',
    userAgent: INAPP_UA,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    inApp: true,
  },
}

export const ALL_PROFILES: ProfileId[] = ['iphone-dark', 'iphone-light', 'android-dark', 'inapp-dark']
export const DEFAULT_PROFILES: ProfileId[] = ['iphone-dark']

// ── The launch measurement ─────────────────────────────────────────────────
// Chrome names both halves of an app launch, and that pair IS the measurement
// (memory `mobile-wallet-app-launch`):
//   "Not allowed to launch 'metamask://…' because a user gesture is required."
//     → the navigation was REFUSED: no activation was carrying the page.
//   "Failed to launch 'metamask://…' because the scheme does not have a
//    registered handler."
//     → the navigation was ALLOWED and the app simply isn't on this machine.
//       On a real phone this is the app opening. This is the GREEN verdict.
export type LaunchVerdict = 'allowed' | 'blocked' | 'none'
export type LaunchReading = { verdict: LaunchVerdict; line: string | null; links: string[] }

const BLOCKED_RE = /not allowed to launch|because a user gesture is required/i
const ALLOWED_RE = /does not have a registered handler|failed to launch/i
const LINK_RE = /'((?:metamask|cbwallet|rainbow|phantom|trust|wc|ethereum):[^']*|https:\/\/[a-z.]*(?:metamask\.app\.link|go\.cb-w\.com|rnbwapp\.com|link\.phantom\.app)[^']*)'/gi

/** Read a launch verdict out of captured console text. BLOCKED wins: a page
 *  that was refused once and later allowed is still a page that dropped a tap. */
export function readLaunch(lines: string[]): LaunchReading {
  const links: string[] = []
  let blocked: string | null = null
  let allowed: string | null = null
  for (const raw of lines) {
    if (!/launch/i.test(raw)) continue
    for (const m of raw.matchAll(LINK_RE)) links.push(m[1])
    if (BLOCKED_RE.test(raw)) blocked ??= raw
    else if (ALLOWED_RE.test(raw)) allowed ??= raw
  }
  const uniq = [...new Set(links)]
  if (blocked) return { verdict: 'blocked', line: blocked, links: uniq }
  if (allowed) return { verdict: 'allowed', line: allowed, links: uniq }
  return { verdict: 'none', line: null, links: uniq }
}

// ── What a scenario is handed ──────────────────────────────────────────────
export type DriveCtx = {
  page: PwPage
  context: PwContext
  baseUrl: string
  profile: MobileProfile
  /** Print an indented note under this scenario's verdict line. */
  log(line: string): void
  /** Every console message this page has emitted, newest last, `type: text`. */
  consoleLines(): string[]
  /** Uncaught page errors (a non-empty list is NOT automatically red — a
   *  scenario decides). */
  pageErrors(): string[]
  /** Chrome's verdict on any app-launch navigation attempted so far. */
  launchVerdict(): LaunchReading
  /** Emulate the visitor leaving for the wallet app and coming back. */
  comeBackFromApp(hiddenMs?: number): Promise<void>
  /** `gates/shots/<lane>/` path for a screenshot; the dir exists. */
  shot(name: string): string
}

export type MobileScenario = {
  /** `<lane>/<what>`, e.g. `connect/metamask-launch`. Unique across lanes. */
  id: string
  /** Defaults to DEFAULT_PROFILES (`iphone-dark`). */
  profiles?: ProfileId[]
  /** Set to a reason string to report SKIPPED instead of running. */
  skip?: string
  run(ctx: DriveCtx): Promise<void>
}

// ── Helpers every lane may use ─────────────────────────────────────────────

/** Throw with a message — the one way a scenario goes red. */
export function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

/**
 * A mock EIP-6963 wallet, injected before any page script.
 *
 * DESKTOP SEMANTICS by construction (an injected provider): on a phone UA
 * RainbowKit lists it under "Installed" and the real MetaMask SDK lane is a
 * SEPARATE entry. Use this mock for connected-state flows (the ask runs, the
 * sign card renders, a signature is asked for); use the real SDK entry for
 * launch measurement. Never one for the other.
 *
 *  - `sendTx: 'hash'` returns a deterministic fake hash. Nothing is broadcast
 *    and no key exists; the app will not be able to verify it on chain, which
 *    is the honest end of a mock signature.
 *  - `sendTx: 'reject'` (default) throws MetaMask's 4001.
 *  - `deferMs` holds every approval-needing method that long before answering —
 *    the phone's "you left for the app" window.
 */
export function mockWalletScript(opts: {
  address: string
  chainId?: `0x${string}`
  personalSign?: 'sign' | 'reject'
  typedData?: 'sign' | 'reject'
  sendTx?: 'hash' | 'reject'
  deferMs?: number
  rdns?: string
  name?: string
}): string {
  const {
    address,
    chainId = '0x2105',
    personalSign = 'reject',
    typedData = 'reject',
    sendTx = 'reject',
    deferMs = 0,
    rdns = 'io.pantessa.drive',
    name = 'Drive Wallet',
  } = opts
  const fakeHash = '0x' + 'dd'.repeat(32)
  const reject = `throw Object.assign(new Error('User rejected the request.'), { code: 4001 })`
  const fakeSig = '0x' + '11'.repeat(64) + '1b'
  return `(() => {
  const ADDR = ${JSON.stringify(address.toLowerCase())}
  const calls = []
  window.__driveCalls = calls
  const hold = (ms) => new Promise((r) => setTimeout(r, ms))
  const provider = {
    isMetaMask: false,
    _chainId: ${JSON.stringify(chainId)},
    async request({ method, params }) {
      calls.push({ method, params, at: Date.now() })
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
          ${deferMs ? `await hold(${deferMs})` : ''}
          ${personalSign === 'sign' ? `return ${JSON.stringify(fakeSig)}` : reject}
        case 'eth_signTypedData_v4':
          ${deferMs ? `await hold(${deferMs})` : ''}
          ${typedData === 'sign' ? `return ${JSON.stringify(fakeSig)}` : reject}
        case 'eth_sendTransaction':
          ${deferMs ? `await hold(${deferMs})` : ''}
          ${sendTx === 'hash' ? `return ${JSON.stringify(fakeHash)}` : reject}
        default:
          return null
      }
    },
    on() {},
    removeListener() {},
  }
  const info = {
    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: ${JSON.stringify(name)},
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    rdns: ${JSON.stringify(rdns)},
  }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  window.ethereum = provider
})()`
}

/** Make wagmi reconnect the mock without a click (a "returning" visitor). */
export function rememberConnectorScript(rdns = 'io.pantessa.drive'): string {
  return `try { localStorage.setItem('wagmi.recentConnectorId', ${JSON.stringify(JSON.stringify(rdns))}) } catch {}`
}

/** Selectors the whole squad agrees on, so a copy change breaks ONE line. */
export const SEL = {
  /** /i splash door. */
  intentDoor: 'button:has-text("Connect & build my path"), button:has-text("Connect &amp; build my path")',
  /** The unified door's wallet lane. */
  walletLane: 'button.ca__wallet',
  /** RainbowKit's list entry for the configured MetaMask lane. */
  rkMetaMask: '[data-testid="rk-wallet-option-metaMask"]',
  /** RainbowKit's list entry for an announced EIP-6963 wallet. */
  rkInjected: '[data-testid="rk-wallet-option-io.pantessa.drive"]',
  rkModal: '[data-rk]',
} as const
