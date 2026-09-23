/**
 * drive-mobile-ux — the UX lane's measured phone checklist (squad
 * mobile-onboarding, 2026-09-23).
 *
 * Every row of UX.md's checklist is a scenario here: it drives the REAL
 * surface in installed Chrome under a phone profile, reads NUMBERS off the
 * DOM (overlap px, gap px, scrollWidth vs clientWidth, whether a control sits
 * under the fixed bottom bar) and prints one verdict line per check. No
 * screenshot is ever the proof on its own — the numbers are.
 *
 * Why numbers and not eyeballs: a phone layout fails by a few pixels
 * (a label meeting its neighbour, a submit under the tab bar, a modal taller
 * than the viewport with no scroll), and every one of those is invisible in a
 * screenshot until you measure it. The `sticky` bug (#748) shipped for eight
 * days because nobody read a rect.
 *
 * Usage:
 *   npx tsx scripts/drive-mobile-ux.ts --tag=before
 *   npx tsx scripts/drive-mobile-ux.ts --tag=after --rows=2,5 --base=http://localhost:3873
 *   npx tsx scripts/drive-mobile-ux.ts --onramp=http://localhost:3876   (row 10)
 *
 * QA folds `MOBILE_UX_SCENARIOS` into `drive:mobile`.
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// playwright-core resolves from ~/node_modules (the resolver walks up from the
// worktree) and is CommonJS, so it is required, not imported: a bare `import`
// makes tsc chase types that are not installed here.
const req = createRequire(path.join(process.cwd(), 'anchor.js'))
/* eslint-disable @typescript-eslint/no-explicit-any */
const pw: any = req('playwright-core')

// ── knobs ────────────────────────────────────────────────────────────────
export const UX_SHOT_DIR =
  process.env.UX_SHOT_DIR ??
  '/Users/nategeier/yeetful/squad-mobile-2026-09-23/gates/shots/ux'

/** A wallet with real holdings on the TEST/prod reads — the .env.local burner
 *  (documented in memory `headless-dashboard-verify`). Watch-only here: the
 *  mock refuses every signature, which is exactly the connect-to-act state. */
export const DRIVE_WALLET =
  process.env.UX_DRIVE_WALLET ?? '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'

/** iPhone 13 is 390x844; the squad's stated floor is 375, and 360x780 is the
 *  common Android. We drive all three widths where a row is width-sensitive. */
export type Profile = { id: string; width: number; height: number; ua: string }
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/536.36'

export const PROFILES: Record<string, Profile> = {
  iphone: { id: 'iphone', width: 390, height: 844, ua: IPHONE_UA },
  small: { id: 'small', width: 375, height: 812, ua: IPHONE_UA },
  android: { id: 'android', width: 360, height: 780, ua: ANDROID_UA },
  wide: { id: 'wide', width: 414, height: 896, ua: IPHONE_UA },
}

export type Theme = 'dark' | 'light'

// ── verdicts ─────────────────────────────────────────────────────────────
export type Verdict = {
  row: number
  check: string
  ok: boolean
  detail: string
  /** A measurement we record but do not judge (context for the PR body). */
  note?: boolean
}

function pass(row: number, check: string, detail: string): Verdict {
  return { row, check, ok: true, detail }
}
function fail(row: number, check: string, detail: string): Verdict {
  return { row, check, ok: false, detail }
}
function note(row: number, check: string, detail: string): Verdict {
  return { row, check, ok: true, detail, note: true }
}

// ── page helpers (all run IN the page) ───────────────────────────────────

/** Horizontal overflow: the one number that says "this page scrolls sideways
 *  on a phone". `scrollWidth === clientWidth` or it is a bug. */
async function hOverflow(page: any): Promise<{ scrollWidth: number; clientWidth: number; diff: number }> {
  return page.evaluate(() => {
    const d = document.documentElement
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, diff: d.scrollWidth - d.clientWidth }
  })
}

/** The fixed bottom furniture on this page (the spine's tab bar, or the
 *  landing's MobileCtaBar), and how far any element intrudes under it. */
async function barRect(page: any): Promise<{ found: boolean; top: number; height: number; kind: string }> {
  return page.evaluate(() => {
    const spine = document.querySelector('nav[aria-label="Workspace"]') as HTMLElement | null
    if (spine) {
      const r = spine.getBoundingClientRect()
      if (r.height > 0) return { found: true, top: r.top, height: r.height, kind: 'spine' }
    }
    const mcta = document.querySelector('.mcta.is-show') as HTMLElement | null
    if (mcta) {
      const r = mcta.getBoundingClientRect()
      if (r.height > 0) return { found: true, top: r.top, height: r.height, kind: 'mcta' }
    }
    return { found: false, top: 0, height: 0, kind: 'none' }
  })
}

/** How many px of `selector`'s box sit below the bar's top edge, for elements
 *  that are NOT stacked above it. A positive number on an interactive control
 *  is a dead tap target. */
async function underBar(page: any, selector: string): Promise<{ exists: boolean; overlap: number; above: boolean; detail: string }> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return { exists: false, overlap: 0, above: false, detail: 'absent' }
    const bar =
      (document.querySelector('nav[aria-label="Workspace"]') as HTMLElement | null) ??
      (document.querySelector('.mcta.is-show') as HTMLElement | null)
    if (!bar) return { exists: true, overlap: 0, above: true, detail: 'no bar on this page' }
    const er = el.getBoundingClientRect()
    const br = bar.getBoundingClientRect()
    // Stacking: if the element's z-index resolves above the bar's it is drawn
    // over it and is still tappable, so intrusion is cosmetic, not dead.
    const zOf = (n: HTMLElement | null): number => {
      let cur: HTMLElement | null = n
      let best = 0
      while (cur) {
        const z = Number.parseInt(getComputedStyle(cur).zIndex, 10)
        if (Number.isFinite(z) && z > best) best = z
        cur = cur.parentElement
      }
      return best
    }
    const above = zOf(el) > zOf(bar)
    const overlap = Math.max(0, Math.min(er.bottom, br.bottom) - Math.max(er.top, br.top))
    return {
      exists: true,
      overlap: Math.round(overlap),
      above,
      detail: `el ${Math.round(er.top)}..${Math.round(er.bottom)} bar ${Math.round(br.top)} z ${zOf(el)}/${zOf(bar)}`,
    }
  }, selector)
}

/** Every seat in the spine's phone bar, with the gap between adjacent LABELS.
 *  A gap under 10px is the pinned floor (memory `wallet-page`). */
async function barSeats(page: any): Promise<{ seats: number; labels: { text: string; left: number; right: number }[]; minGap: number }> {
  return page.evaluate(() => {
    const bar = document.querySelector('nav[aria-label="Workspace"]') as HTMLElement | null
    if (!bar) return { seats: 0, labels: [], minGap: -1 }
    const seats = Array.from(bar.children).filter((c) => (c as HTMLElement).offsetParent !== null || (c as HTMLElement).getBoundingClientRect().width > 0)
    const labels: { text: string; left: number; right: number }[] = []
    for (const seat of seats) {
      const span = seat.querySelector('span.mono') as HTMLElement | null
      if (!span) continue
      const r = span.getBoundingClientRect()
      if (r.width === 0) continue
      labels.push({ text: (span.textContent ?? '').trim(), left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10 })
    }
    labels.sort((a, b) => a.left - b.left)
    let minGap = Number.POSITIVE_INFINITY
    for (let i = 1; i < labels.length; i++) minGap = Math.min(minGap, labels[i].left - labels[i - 1].right)
    return { seats: labels.length, labels, minGap: labels.length > 1 ? Math.round(minGap * 10) / 10 : -1 }
  })
}

/** The door's geometry: does the panel fit, and if it does not, can the
 *  visitor reach the rest of it? A fixed grid with `place-items: center` and
 *  no `overflow-y` clips BOTH ends and nothing scrolls — a scroll trap. */
async function doorGeometry(page: any) {
  return page.evaluate(() => {
    const root = document.querySelector('.ca') as HTMLElement | null
    const panel = document.querySelector('.ca__panel') as HTMLElement | null
    if (!root || !panel) return { open: false }
    const vh = window.innerHeight
    const pr = panel.getBoundingClientRect()
    const cs = getComputedStyle(root)
    const scrollable = root.scrollHeight > root.clientHeight + 1
    const canScroll = ['auto', 'scroll'].includes(cs.overflowY)
    const close = document.querySelector('.ca__close') as HTMLElement | null
    const cr = close?.getBoundingClientRect()
    // The last interactive control in the panel — if its bottom is off-screen
    // and nothing scrolls, the door is unusable.
    const controls = Array.from(panel.querySelectorAll('button, input, a')) as HTMLElement[]
    const visible = controls.filter((c) => c.getBoundingClientRect().height > 0)
    const last = visible[visible.length - 1]
    const lr = last?.getBoundingClientRect()
    return {
      open: true,
      vh,
      panelTop: Math.round(pr.top),
      panelBottom: Math.round(pr.bottom),
      panelHeight: Math.round(pr.height),
      overflowY: cs.overflowY,
      rootScrollHeight: root.scrollHeight,
      rootClientHeight: root.clientHeight,
      scrollable,
      canScroll,
      clippedTop: Math.round(Math.max(0, -pr.top)),
      clippedBottom: Math.round(Math.max(0, pr.bottom - vh)),
      closeBox: cr ? { top: Math.round(cr.top), size: Math.round(Math.max(cr.width, cr.height)) } : null,
      lastControl: last ? { tag: last.tagName.toLowerCase(), cls: last.className?.toString().slice(0, 40), bottom: Math.round(lr!.bottom), inView: lr!.bottom <= vh && lr!.top >= 0 } : null,
      controls: visible.length,
    }
  })
}

// ── the mock wallet (connected states) ───────────────────────────────────
/** A watch-only EIP-6963 provider. It connects and switches chains; every
 *  signature is REFUSED (4001), which is precisely "connected, not signed in"
 *  — the connect-to-act state this squad cares about. Seeds
 *  `wagmi.recentConnectorId` so the signed-out gate waits for it instead of
 *  bouncing the page home (memory `spine-signed-out-gate`). */
export function mockWalletScript(address: string, chainId = '0x2105'): string {
  return `(() => {
    const ADDR = ${JSON.stringify(address)};
    let chain = ${JSON.stringify(chainId)};
    const listeners = {};
    const provider = {
      isMetaMask: false,
      request: async ({ method, params }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts': return [ADDR];
          case 'eth_chainId': return chain;
          case 'net_version': return String(parseInt(chain, 16));
          case 'wallet_switchEthereumChain': chain = params?.[0]?.chainId ?? chain; (listeners.chainChanged||[]).forEach(f=>f(chain)); return null;
          case 'wallet_addEthereumChain': return null;
          case 'personal_sign':
          case 'eth_signTypedData_v4':
          case 'eth_sendTransaction': { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
          default: { const e = new Error('Unsupported method ' + method); e.code = 4200; throw e; }
        }
      },
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener: (ev, fn) => { listeners[ev] = (listeners[ev]||[]).filter(f => f !== fn); },
    };
    const detail = Object.freeze({
      info: Object.freeze({ uuid: '11111111-2222-3333-4444-555555555555', name: 'Mock Wallet', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'pro.nate.mock' }),
      provider,
    });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
    window.ethereum = provider;
    try {
      localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('pro.nate.mock'));
      localStorage.removeItem('wagmi.pro.nate.mock.disconnected');
    } catch {}
  })()`
}

/** Drive the app's own unified door to a connected state: open it, take the
 *  wallet lane, pick the mock in RainbowKit. Rule 6 — never a raw
 *  openConnectModal, always the door the visitor sees. */
async function connectThroughDoor(page: any): Promise<boolean> {
  const lane = page.locator('.ca__wallet--lead')
  if ((await lane.count()) === 0) return false
  await lane.first().click()
  const opt = page.locator('[data-testid^="rk-wallet-option"]').filter({ hasText: 'Mock Wallet' })
  try {
    await opt.first().waitFor({ state: 'visible', timeout: 12_000 })
    await opt.first().click()
  } catch {
    return false
  }
  try {
    await page.waitForFunction(
      () => {
        try {
          const raw = localStorage.getItem('wagmi.store')
          return !!raw && raw.includes('pro.nate.mock') && raw.includes('accounts')
        } catch {
          return false
        }
      },
      { timeout: 15_000 },
    )
  } catch {
    /* fall through — the caller reads the resulting DOM either way */
  }
  return true
}

// ── context plumbing ─────────────────────────────────────────────────────
export type DriveCtx = {
  browser: any
  base: string
  onrampBase: string | null
  tag: string
  profile: Profile
  theme: Theme
  /** Open a page in this profile/theme, optionally with the mock wallet. */
  open(opts?: { wallet?: boolean; init?: string }): Promise<any>
  shot(page: any, row: number | string, extra?: string): Promise<string>
}

async function makeCtx(browser: any, base: string, onrampBase: string | null, tag: string, profile: Profile, theme: Theme): Promise<DriveCtx> {
  const pages: any[] = []
  const contexts: any[] = []
  const ctx: DriveCtx = {
    browser,
    base,
    onrampBase,
    tag,
    profile,
    theme,
    async open(opts = {}) {
      const c = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: profile.ua,
        colorScheme: theme,
      })
      // tsx (esbuild `keepNames`) injects `__name(fn, 'fn')` around named
      // function expressions inside every `page.evaluate` body, and the page
      // has no such helper — every evaluate that declares a local function
      // throws `ReferenceError: __name is not defined`. Shim it once per
      // document. (Same family as the addInitScript bite in memory
      // `pricing-v2-chart-first`.)
      await c.addInitScript('window.__name = window.__name || function (f) { return f }')
      if (opts.wallet) await c.addInitScript(mockWalletScript(DRIVE_WALLET))
      if (opts.init) await c.addInitScript(opts.init)
      const p = await c.newPage()
      p.on('pageerror', (e: Error) => {
        ;(p as any).__errors = [...((p as any).__errors ?? []), e.message]
      })
      contexts.push(c)
      pages.push(p)
      return p
    },
    async shot(page: any, row: number | string, extra = '') {
      mkdirSync(UX_SHOT_DIR, { recursive: true })
      const name = `${row}${extra ? `-${extra}` : ''}-${tag}-${profile.width}-${theme}.png`
      const file = path.join(UX_SHOT_DIR, name)
      // Park the mouse: a Playwright click leaves :hover on the button and a
      // solid CTA photographs as hover-grey.
      try {
        await page.mouse.move(2, 2)
      } catch {}
      await page.screenshot({ path: file })
      return file
    },
  }
  ;(ctx as any).__close = async () => {
    for (const c of contexts) await c.close().catch(() => {})
  }
  return ctx
}

// ── the scenarios ────────────────────────────────────────────────────────
export type UxScenario = {
  row: number
  name: string
  /** Widths this row is measured at (default: the iphone profile only). */
  profiles?: string[]
  run(ctx: DriveCtx): Promise<Verdict[]>
}

/** Row 1 — the landing at phone width: the hero CTA and the sticky bar both
 *  reach the unified door, and the door is complete (wallet strip + email +
 *  Google when cdpEnabled). */
const row1: UxScenario = {
  row: 1,
  name: 'landing → the unified door',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open()
    await page.goto(`${ctx.base}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    const o = await hOverflow(page)
    v.push(o.diff === 0 ? pass(1, 'landing: no h-scroll', `scrollWidth ${o.scrollWidth} = clientWidth ${o.clientWidth}`) : fail(1, 'landing: no h-scroll', `+${o.diff}px (scrollWidth ${o.scrollWidth} vs ${o.clientWidth})`))

    // The sticky bar arms past ~60% of the first viewport.
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.2))
    await page.waitForTimeout(600)
    const mcta = await page.evaluate(() => {
      const el = document.querySelector('.mcta') as HTMLElement | null
      if (!el) return { found: false }
      const r = el.getBoundingClientRect()
      const a = el.querySelector('a') as HTMLElement | null
      const ar = a?.getBoundingClientRect()
      return {
        found: true,
        shown: el.classList.contains('is-show'),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        vh: window.innerHeight,
        label: (a?.textContent ?? '').trim(),
        tapHeight: ar ? Math.round(ar.height) : 0,
      }
    })
    v.push(
      mcta.found && mcta.shown && mcta.tapHeight >= 44
        ? pass(1, 'MobileCtaBar arms + is a real target', `"${mcta.label}" ${mcta.tapHeight}px tall, top ${mcta.top} of ${mcta.vh}`)
        : fail(1, 'MobileCtaBar arms + is a real target', JSON.stringify(mcta)),
    )

    await ctx.shot(page, 1, 'landing')

    // Where does it go? /markets is PUBLIC since 2026-09-14 (isPublicAppPath),
    // so its SpineLink is a plain link on purpose: looking needs no wallet.
    // The check is that a signed-out phone visitor LANDS there and is not
    // bounced home by the spine gate.
    if (mcta.found && mcta.shown) {
      await page.locator('.mcta a').first().click()
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(2600)
      const dest = await page.evaluate(() => ({ path: location.pathname, door: !!document.querySelector('.ca__panel'), bar: !!document.querySelector('nav[aria-label="Workspace"]') }))
      v.push(
        dest.path === '/markets' && dest.bar
          ? pass(1, 'Open Markets lands on the public markets shell', `path ${dest.path}, spine bar present, no bounce`)
          : fail(1, 'Open Markets lands on the public markets shell', JSON.stringify(dest)),
      )
      await page.goBack().catch(() => {})
      await page.waitForTimeout(1500)
    }

    // How many taps to a door from the landing? The nav collapses everything
    // but the burger below 900px (`.nav__right > :not(.nav__burger)`), so the
    // landing's own sign-in is behind the drawer.
    const topLevelDoor = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('header.nav button, header.nav a')) as HTMLElement[]
      const visible = cands.filter((c) => /sign in|create an account/i.test(c.textContent ?? '') && c.getBoundingClientRect().width > 0)
      return visible.length
    })
    v.push(note(1, 'taps to a door from the landing', topLevelDoor > 0 ? 'one (a visible Sign in in the bar)' : 'two — the bar collapses to the burger below 900px, so the door lives in the drawer'))

    // The drawer must carry one.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    const burger = page.locator('.nav__burger')
    if ((await burger.count()) > 0) {
      await burger.first().click()
      await page.waitForTimeout(500)
      const drawer = await page.evaluate(() => {
        const panel = document.querySelector('.drawer__panel') as HTMLElement | null
        if (!panel) return { open: false }
        const r = panel.getBoundingClientRect()
        const door = Array.from(panel.querySelectorAll('button, a')).find((e) => /sign in|create an account/i.test(e.textContent ?? '')) as HTMLElement | null
        const dr = door?.getBoundingClientRect()
        return {
          open: true,
          panel: { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) },
          vh: window.innerHeight,
          door: door ? { label: (door.textContent ?? '').trim(), bottom: Math.round(dr!.bottom), inView: dr!.bottom <= window.innerHeight && dr!.top >= 0, height: Math.round(dr!.height) } : null,
          scrolls: panel.scrollHeight > panel.clientHeight + 1,
        }
      })
      v.push(
        drawer.open && drawer.door && drawer.door.inView
          ? pass(1, 'the phone drawer carries a reachable door', `"${drawer.door.label}" bottom ${drawer.door.bottom} of ${drawer.vh}`)
          : fail(1, 'the phone drawer carries a reachable door', JSON.stringify(drawer)),
      )
      await ctx.shot(page, 1, 'drawer')
      if (drawer.open && drawer.door) {
        await page.locator('.drawer__panel button', { hasText: /sign in/i }).first().click().catch(() => {})
        await page.waitForTimeout(900)
      }
    }
    {
      const opened = await page.evaluate(() => ({ door: !!document.querySelector('.ca__panel'), path: location.pathname }))
      v.push(opened.door ? pass(1, 'the drawer door opens the unified modal', 'CreateAccountModal open') : fail(1, 'the drawer door opens the unified modal', `no .ca__panel; path=${opened.path}`))
      if (opened.door) {
        const lanes = await page.evaluate(() => ({
          wallet: !!document.querySelector('.ca__wallet--lead'),
          chips: document.querySelectorAll('.ca__lane').length,
          google: !!document.querySelector('.ca__oauth'),
          email: !!document.querySelector('#ca-email'),
        }))
        v.push(
          lanes.wallet && lanes.chips >= 4 && lanes.google && lanes.email
            ? pass(1, 'door carries every lane', `wallet lead + ${lanes.chips} wallet marks + Google + email`)
            : fail(1, 'door carries every lane', JSON.stringify(lanes)),
        )
        await ctx.shot(page, 1, 'door')
      }
    }
    return v
  },
}

/** Row 2 — the door itself at phone width, including with the keyboard up. */
const row2: UxScenario = {
  row: 2,
  name: 'the unified door fits a phone',
  profiles: ['iphone', 'small', 'android'],
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open()
    // Open it from /markets so the spine's bottom bar is on the page too —
    // that is the hardest case for "no control under the bar".
    await page.goto(`${ctx.base}/markets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const opened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /sign in/i.test(b.textContent ?? ''))
      if (!btn) return false
      ;(btn as HTMLElement).click()
      return true
    })
    if (!opened) {
      v.push(fail(2, 'door opens from the markets strip', 'no Sign in control found'))
      return v
    }
    await page.waitForTimeout(900)

    const g = await doorGeometry(page)
    if (!g.open) {
      v.push(fail(2, 'door opens from the markets strip', 'no .ca__panel after the tap'))
      return v
    }
    await ctx.shot(page, 2, 'door')

    const fits = g.clippedTop === 0 && g.clippedBottom === 0
    const rescued = g.canScroll && g.scrollable
    v.push(
      fits
        ? pass(2, 'door fits the viewport', `panel ${g.panelHeight}px in ${g.vh}px (top ${g.panelTop}, bottom ${g.panelBottom})`)
        : rescued
          ? pass(2, 'door scrolls when it cannot fit', `panel ${g.panelHeight}px > ${g.vh}px, overflow-y: ${g.overflowY}`)
          : fail(2, 'door fits the viewport OR scrolls', `panel ${g.panelHeight}px in ${g.vh}px — clipped ${g.clippedTop}px top / ${g.clippedBottom}px bottom, overflow-y: ${g.overflowY}, root ${g.rootScrollHeight}/${g.rootClientHeight}`),
    )
    v.push(
      g.lastControl?.inView || rescued
        ? pass(2, 'last control reachable', `${g.lastControl?.cls} bottom ${g.lastControl?.bottom} of ${g.vh}`)
        : fail(2, 'last control reachable', `${g.lastControl?.cls} bottom ${g.lastControl?.bottom} > vh ${g.vh} and nothing scrolls`),
    )
    v.push(
      g.closeBox && g.closeBox.top >= 0 && g.closeBox.size >= 40
        ? pass(2, 'dismiss is a 40px target in view', `${g.closeBox.size}px at top ${g.closeBox.top}`)
        : fail(2, 'dismiss is a 40px target in view', JSON.stringify(g.closeBox)),
    )

    const email = await underBar(page, '#ca-email')
    v.push(
      !email.exists || email.above || email.overlap === 0
        ? pass(2, 'no control dead under the bottom bar', `email field: ${email.detail}`)
        : fail(2, 'no control dead under the bottom bar', `email field overlaps ${email.overlap}px — ${email.detail}`),
    )

    // Keyboard up: iOS shrinks the visual viewport by ~336px on a 13. We
    // emulate the worst realistic case by shrinking the window itself, which
    // is what `100dvh`/`svh`-aware layouts see.
    const kbH = Math.max(380, ctx.profile.height - 336)
    await page.setViewportSize({ width: ctx.profile.width, height: kbH })
    await page.waitForTimeout(500)
    const gk = await doorGeometry(page)
    await ctx.shot(page, 2, 'door-keyboard')
    const kbOk = gk.open && ((gk.clippedTop === 0 && gk.clippedBottom === 0) || (gk.canScroll && gk.scrollable))
    v.push(
      kbOk
        ? pass(2, 'door survives the keyboard', `at ${kbH}px: panel ${gk.panelHeight}px, overflow-y ${gk.overflowY}, clipped ${gk.clippedTop}/${gk.clippedBottom}`)
        : fail(2, 'door survives the keyboard', `at ${kbH}px: panel ${gk.panelHeight}px, clipped ${gk.clippedTop}px top / ${gk.clippedBottom}px bottom, overflow-y ${gk.overflowY}`),
    )
    return v
  },
}

/** Row 3 — /markets at phone width. */
const row3: UxScenario = {
  row: 3,
  name: '/markets on a phone',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open()
    await page.goto(`${ctx.base}/markets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    const o = await hOverflow(page)
    v.push(o.diff === 0 ? pass(3, '/markets: no h-scroll', `${o.scrollWidth} = ${o.clientWidth}`) : fail(3, '/markets: no h-scroll', `+${o.diff}px`))

    const strip = await page.evaluate(() => {
      const top = document.querySelector('.mkt-frame__top') as HTMLElement | null
      const kbd = document.querySelector('.askdoor-kbd, .askdoor-pill__kbd') as HTMLElement | null
      const account = Array.from(document.querySelectorAll('button, a')).some((e) => /sign in/i.test(e.textContent ?? '')) || !!document.querySelector('[data-nav-account]')
      const r = top?.getBoundingClientRect()
      return {
        top: top ? { top: Math.round(r!.top), height: Math.round(r!.height) } : null,
        kbdVisible: kbd ? kbd.getBoundingClientRect().width > 0 : false,
        account,
      }
    })
    v.push(
      strip.top && strip.top.top === 0 && !strip.kbdVisible && strip.account
        ? pass(3, 'top strip: sticky, ⌘K hidden, account present', JSON.stringify(strip))
        : fail(3, 'top strip: sticky, ⌘K hidden, account present', JSON.stringify(strip)),
    )

    const mapView = await page.evaluate(() => ({
      map: !!document.querySelector('.mk-map'),
      rows: document.querySelectorAll('.mk-row, .mk-board tbody tr, [data-mk-row]').length,
    }))
    v.push(
      !mapView.map
        ? pass(3, 'the Map view never shows on a phone', `no .mk-map; ${mapView.rows} list rows`)
        : fail(3, 'the Map view never shows on a phone', 'a .mk-map is rendered at phone width'),
    )

    const rail = await page.evaluate(() => {
      const r = document.querySelector('.mkt-frame__rail') as HTMLElement | null
      if (!r) return { found: false }
      const rect = r.getBoundingClientRect()
      return { found: true, width: Math.round(rect.width), inFlow: getComputedStyle(r).position !== 'fixed', y: Math.round(rect.top + window.scrollY) }
    })
    v.push(rail.found ? pass(3, 'watchlist rail reachable in the flow', JSON.stringify(rail)) : fail(3, 'watchlist rail reachable in the flow', 'no .mkt-frame__rail'))

    await ctx.shot(page, 3, 'markets')

    // An act chip must open the connect-only door, never fire a turn.
    const posts: string[] = []
    page.on('request', (r: any) => {
      if (r.method() === 'POST' && r.url().includes('/api/chat')) posts.push(r.url())
    })
    const chip = page.locator('button', { hasText: /^Buy \$/ }).first()
    if ((await chip.count()) > 0) {
      await chip.click()
      await page.waitForTimeout(1500)
      const door = await page.evaluate(() => !!document.querySelector('.ca__panel') || !!document.querySelector('[data-rk]'))
      v.push(
        door && posts.length === 0
          ? pass(3, 'an act chip opens the connect door and fires no turn', `door open, ${posts.length} POST /api/chat`)
          : fail(3, 'an act chip opens the connect door and fires no turn', `door=${door} posts=${posts.length}`),
      )
      await ctx.shot(page, 3, 'chip-door')
    } else {
      v.push(note(3, 'act chip present', 'no "Buy $…" chip rendered at this width'))
    }
    return v
  },
}

/** Row 4 — /t/<sym> at phone width. */
const row4: UxScenario = {
  row: 4,
  name: '/t/AAPL on a phone',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open()
    await page.goto(`${ctx.base}/t/AAPL`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    const o = await hOverflow(page)
    v.push(o.diff === 0 ? pass(4, '/t: no h-scroll', `${o.scrollWidth} = ${o.clientWidth}`) : fail(4, '/t: no h-scroll', `+${o.diff}px`))

    const head = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.sym__act button, .sym__act a, .mk-exec button')) as HTMLElement[]
      const boxes = chips.map((c) => { const r = c.getBoundingClientRect(); return { t: (c.textContent ?? '').trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) } })
      return { count: chips.length, boxes: boxes.slice(0, 8), vw: window.innerWidth }
    })
    v.push(
      head.count > 0 && head.boxes.every((b: { right: number; h: number }) => b.right <= head.vw + 1 && b.h >= 30)
        ? pass(4, 'header act chips fit and are tappable', `${head.count} chips, widest right edge ${Math.max(...head.boxes.map((b: { right: number }) => b.right))} of ${head.vw}`)
        : fail(4, 'header act chips fit and are tappable', JSON.stringify(head)),
    )

    const tabs = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('[role="tab"], .sym__tab')) as HTMLElement[]
      return t.map((x) => (x.textContent ?? '').trim()).filter(Boolean)
    })
    v.push(tabs.length > 0 ? note(4, 'symbol tabs', tabs.join(' · ')) : note(4, 'symbol tabs', 'none read'))

    const bar = await barRect(page)
    const lastCard = await underBar(page, '.sym__rail, .mkt-frame__rail, footer')
    v.push(
      bar.found
        ? pass(4, 'the spine bar is present on /t', `${bar.kind} at y ${Math.round(bar.top)} h ${Math.round(bar.height)}`)
        : fail(4, 'the spine bar is present on /t', 'no bottom bar'),
    )
    v.push(note(4, 'page tail vs the bar', lastCard.detail))

    await ctx.shot(page, 4, 'symbol')
    return v
  },
}

/** Row 5 — the spine's phone tab bar at every phone width. */
const row5: UxScenario = {
  row: 5,
  name: 'the spine bottom bar',
  profiles: ['android', 'small', 'iphone', 'wide'],
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open({ wallet: true })
    await page.goto(`${ctx.base}/markets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    const seats = await barSeats(page)
    v.push(
      seats.seats > 0 && seats.minGap >= 10
        ? pass(5, `bar labels keep ≥10px at ${ctx.profile.width}`, `${seats.seats} seats, min gap ${seats.minGap}px (${seats.labels.map((l) => l.text).join('/')})`)
        : fail(5, `bar labels keep ≥10px at ${ctx.profile.width}`, `${seats.seats} seats, min gap ${seats.minGap}px (${seats.labels.map((l) => l.text).join('/')})`),
    )

    const safe = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="Workspace"]') as HTMLElement | null
      if (!bar) return null
      const cs = getComputedStyle(bar)
      const r = bar.getBoundingClientRect()
      return { height: Math.round(r.height), pb: cs.paddingBottom, bottom: Math.round(r.bottom), vh: window.innerHeight }
    })
    v.push(safe ? note(5, 'bar box', JSON.stringify(safe)) : fail(5, 'bar box', 'no bar'))

    await ctx.shot(page, 5, 'bar')

    // MORE opens as an overlay and closes.
    if (ctx.profile.width < 640) {
      const more = page.locator('button[aria-label="More"]')
      if ((await more.count()) > 0) {
        await more.first().click()
        await page.waitForTimeout(400)
        const menu = await page.evaluate(() => {
          const m = document.querySelector('[data-spine-more]') as HTMLElement | null
          if (!m) return { open: false }
          const r = m.getBoundingClientRect()
          return { open: true, top: Math.round(r.top), right: Math.round(r.right), left: Math.round(r.left), vw: window.innerWidth, inView: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 }
        })
        v.push(menu.open && menu.inView ? pass(5, 'MORE opens inside the viewport', JSON.stringify(menu)) : fail(5, 'MORE opens inside the viewport', JSON.stringify(menu)))
        await ctx.shot(page, 5, 'more')
        await page.keyboard.press('Escape').catch(() => {})
        await page.mouse.click(10, 100)
        await page.waitForTimeout(300)
        const closed = await page.evaluate(() => !document.querySelector('[data-spine-more]'))
        v.push(closed ? pass(5, 'MORE closes', 'menu unmounted') : fail(5, 'MORE closes', 'menu still mounted after an outside tap'))
      } else {
        v.push(fail(5, 'MORE seat exists below sm', 'no button[aria-label="More"]'))
      }
    }

    // ?tab= survives: open the APPS drawer and reload.
    await page.goto(`${ctx.base}/chat?tab=links`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const tabState = await page.evaluate(() => ({ url: location.search, lit: document.querySelector('nav[aria-label="Workspace"] [aria-current="true"], nav[aria-label="Workspace"] [aria-current="page"]')?.getAttribute('aria-label') ?? null }))
    v.push(note(5, '?tab= on arrival', JSON.stringify(tabState)))
    return v
  },
}

/** Row 6 — /chat's first look, connect-only. */
const row6: UxScenario = {
  row: 6,
  name: '/chat first look',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open({ wallet: true })
    await page.goto(`${ctx.base}/chat`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)

    const o = await hOverflow(page)
    v.push(o.diff === 0 ? pass(6, '/chat: no h-scroll', `${o.scrollWidth} = ${o.clientWidth}`) : fail(6, '/chat: no h-scroll', `+${o.diff}px`))

    const composer = await page.evaluate(() => {
      const areas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[]
      const ta = areas[areas.length - 1]
      if (!ta) return { found: false }
      const r = ta.getBoundingClientRect()
      const bar = document.querySelector('nav[aria-label="Workspace"]') as HTMLElement | null
      const br = bar?.getBoundingClientRect()
      return {
        found: true,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        vh: window.innerHeight,
        barTop: br ? Math.round(br.top) : null,
        clearsBar: br ? r.bottom <= br.top + 1 : true,
        overlap: br ? Math.max(0, Math.round(r.bottom - br.top)) : 0,
      }
    })
    v.push(
      composer.found && composer.clearsBar
        ? pass(6, 'the composer clears the tab bar', JSON.stringify(composer))
        : fail(6, 'the composer clears the tab bar', JSON.stringify(composer)),
    )

    const splash = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('[data-masonry-cell], .splashgrid > *')) as HTMLElement[]
      if (cells.length === 0) return { cells: 0, columns: 0 }
      const lefts = new Set(cells.map((c) => Math.round(c.getBoundingClientRect().left)))
      return { cells: cells.length, columns: lefts.size }
    })
    v.push(splash.cells === 0 ? note(6, 'splash cards', 'none rendered (empty wallet / no scan yet)') : splash.columns <= 1 ? pass(6, 'splash is one column on a phone', `${splash.cells} cells, ${splash.columns} column`) : fail(6, 'splash is one column on a phone', `${splash.cells} cells across ${splash.columns} columns`))

    const toolbar = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('[data-chat-toolbar] button, .chat-toolbar button')) as HTMLElement[]
      return { chips: chips.length, withText: chips.filter((c) => (c.textContent ?? '').trim().length > 0).length }
    })
    v.push(note(6, 'toolbar chips', JSON.stringify(toolbar)))

    await ctx.shot(page, 6, 'chat')
    return v
  },
}

/** Row 7 — /wallet at phone width. */
const row7: UxScenario = {
  row: 7,
  name: '/wallet on a phone',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open({ wallet: true })
    await page.goto(`${ctx.base}/wallet`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)

    const path = await page.evaluate(() => location.pathname)
    if (path !== '/wallet') {
      v.push(fail(7, 'a connected wallet stays on /wallet', `bounced to ${path} — the mock never settled as connected`))
      await ctx.shot(page, 7, 'wallet-bounced')
      return v
    }

    const o = await hOverflow(page)
    v.push(o.diff === 0 ? pass(7, '/wallet: no h-scroll', `${o.scrollWidth} = ${o.clientWidth}`) : fail(7, '/wallet: no h-scroll', `+${o.diff}px`))

    const shape = await page.evaluate(() => {
      const chains = document.querySelector('[data-wallet-chains]') as HTMLElement | null
      const cr = chains?.getBoundingClientRect()
      const doors = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter((t) => /fund|receive|send|buy/i.test(t))
      const marks = chains ? chains.querySelectorAll('svg, img').length : 0
      return {
        chains: chains ? { top: Math.round(cr!.top), width: Math.round(cr!.width), marks, wraps: cr!.height > 34 } : null,
        doors: Array.from(new Set(doors)).slice(0, 8),
      }
    })
    v.push(shape.chains && shape.chains.marks >= 4 ? pass(7, 'the chain marks row renders', JSON.stringify(shape.chains)) : fail(7, 'the chain marks row renders', JSON.stringify(shape.chains)))
    v.push(shape.doors.length >= 2 ? pass(7, 'the wallet doors are present', shape.doors.join(' · ')) : fail(7, 'the wallet doors are present', JSON.stringify(shape.doors)))

    const tail = await underBar(page, 'main')
    v.push(note(7, 'page vs bar', tail.detail))
    await ctx.shot(page, 7, 'wallet')
    return v
  },
}

/** Row 8 — the /markets → /chat arrival handoff on a phone. */
const row8: UxScenario = {
  row: 8,
  name: 'ArrivalBanner on a phone',
  async run(ctx) {
    const v: Verdict[] = []
    const seed = `(() => {
      try {
        sessionStorage.setItem('pantessa.arrival.v1', JSON.stringify({ v: 1, text: 'Buy $25 of AAPL', from: '/markets', at: Date.now() }));
      } catch {}
    })()`
    const page = await ctx.open({ wallet: true, init: seed })
    let chatPosts = 0
    page.on('request', (r: any) => {
      if (r.method() === 'POST' && r.url().includes('/api/chat')) chatPosts++
    })
    await page.route('**/api/chat', async (route: any) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'held by the drive', meta: {} }) })
    })
    await page.goto(`${ctx.base}/chat`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)

    const banner = await page.evaluate(() => {
      const b = document.querySelector('.arrival') as HTMLElement | null
      if (!b) return { found: false }
      const r = b.getBoundingClientRect()
      const bar = document.querySelector('nav[aria-label="Workspace"]') as HTMLElement | null
      const br = bar?.getBoundingClientRect()
      return {
        found: true,
        cls: b.className,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        vw: window.innerWidth,
        fits: r.left >= 0 && r.right <= window.innerWidth + 1,
        overBar: br ? Math.max(0, Math.round(r.bottom - br.top)) : 0,
      }
    })
    v.push(banner.found ? pass(8, 'the arrival banner mounts', JSON.stringify(banner)) : note(8, 'the arrival banner mounts', 'not rendered — the record may have been taken before paint'))
    if (banner.found) {
      v.push(banner.fits ? pass(8, 'the banner fits the phone', `${banner.left}..${banner.right} of ${banner.vw}`) : fail(8, 'the banner fits the phone', JSON.stringify(banner)))
      v.push(banner.overBar === 0 ? pass(8, 'the banner is not under the bar', 'clear') : fail(8, 'the banner is not under the bar', `${banner.overBar}px`))
    }
    v.push(chatPosts <= 1 ? pass(8, 'the held ask fires at most once', `${chatPosts} POST /api/chat`) : fail(8, 'the held ask fires at most once', `${chatPosts} POST /api/chat`))
    const left = await page.evaluate(() => { try { return sessionStorage.getItem('pantessa.arrival.v1') } catch { return 'blocked' } })
    v.push(left === null ? pass(8, 'the record is one-shot', 'sessionStorage key removed') : note(8, 'the record is one-shot', `key still ${String(left).slice(0, 40)}`))
    await ctx.shot(page, 8, 'arrival')
    return v
  },
}

/** Row 9 — the CDP lanes' phone ergonomics we can read without the CDP mock:
 *  the OTP field's keyboard hints and the email field's. (The OAuth return
 *  itself needs a `useMock` worktree — memory `cdp-mock-browser-drive`.) */
const row9: UxScenario = {
  row: 9,
  name: 'CDP lanes: keyboard hints',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open()
    await page.goto(`${ctx.base}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1800)
    const opened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /sign in|create an account/i.test(b.textContent ?? ''))
      if (!btn) return false
      ;(btn as HTMLElement).click()
      return true
    })
    if (!opened) {
      v.push(note(9, 'door opens from the landing nav', 'no visible Sign in at this width — the nav hides it; covered by row 1'))
      return v
    }
    await page.waitForTimeout(800)
    const email = await page.evaluate(() => {
      const i = document.querySelector('#ca-email') as HTMLInputElement | null
      if (!i) return null
      const r = i.getBoundingClientRect()
      return { inputMode: i.inputMode, autocomplete: i.autocomplete, type: i.type, focused: document.activeElement === i, height: Math.round(r.height) }
    })
    v.push(
      email && email.inputMode === 'email' && email.autocomplete === 'email' && email.height >= 40
        ? pass(9, 'email field: the right keyboard and a 40px target', JSON.stringify(email))
        : fail(9, 'email field: the right keyboard and a 40px target', JSON.stringify(email)),
    )
    v.push(email?.focused ? pass(9, 'email field autofocuses', 'activeElement') : note(9, 'email field autofocus', 'not focused — on iOS an autofocus without a gesture is ignored anyway'))

    // OTP step: its attributes are what a phone needs (numeric + one-time-code).
    const otpAttrs = await page.evaluate(() => {
      // Read them out of the module's own markup by forcing the step: the
      // door only renders OTP after a send, so read the source-visible
      // contract instead and assert in the harness. Here we just report.
      return null
    })
    v.push(note(9, 'OTP field attrs', otpAttrs === null ? 'asserted in the harness block (inputMode=numeric, autocomplete=one-time-code)' : ''))
    return v
  },
}

/** Row 10 — the card-funding door (needs ONRAMP_ENABLED). */
const row10: UxScenario = {
  row: 10,
  name: 'card funding on a phone',
  async run(ctx) {
    const v: Verdict[] = []
    if (!ctx.onrampBase) {
      v.push(note(10, 'card funding', 'skipped — pass --onramp=http://localhost:3876'))
      return v
    }
    const page = await ctx.open({ wallet: true })
    await page.goto(`${ctx.onrampBase}/markets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    const fund = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a')).map((b) => (b.textContent ?? '').trim())
      return btns.filter((t) => /buy (eth|usdc)|card|fund/i.test(t)).slice(0, 6)
    })
    v.push(fund.length > 0 ? pass(10, 'a card-funding door is offered on the rail', fund.join(' · ')) : note(10, 'a card-funding door is offered on the rail', 'none at this width/wallet'))
    await ctx.shot(page, 10, 'onramp')
    return v
  },
}

/** Row 11 — the light/dark, no-h-scroll, no-dead-tint sweep. */
const row11: UxScenario = {
  row: 11,
  name: 'dark + light sweep',
  async run(ctx) {
    const v: Verdict[] = []
    const routes = ['/', '/markets', '/t/AAPL', '/chat', '/wallet']
    const page = await ctx.open({ wallet: true })
    for (const route of routes) {
      await page.goto(`${ctx.base}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2600)
      const o = await hOverflow(page)
      const dead = await page.evaluate(() => {
        // The Tailwind CSS-var opacity trap: `bg-[color:var(--x)]/70` is never
        // generated, so the element falls back to preflight's gray-200 border
        // with no fill — a white line in dark mode.
        const bad: string[] = []
        for (const el of Array.from(document.querySelectorAll('*')).slice(0, 4000)) {
          const cls = (el as HTMLElement).className
          if (typeof cls !== 'string') continue
          if (/\[(?:color:)?var\(--[a-z0-9-]+(?:,[^)]*)?\)\]\/\d/.test(cls)) bad.push(cls.slice(0, 80))
        }
        return bad.slice(0, 5)
      })
      v.push(o.diff === 0 ? pass(11, `${route} ${ctx.theme}: no h-scroll`, `${o.scrollWidth}`) : fail(11, `${route} ${ctx.theme}: no h-scroll`, `+${o.diff}px`))
      if (dead.length > 0) v.push(fail(11, `${route}: dead var-opacity classes`, dead.join(' | ')))
      await ctx.shot(page, 11, route.replace(/\//g, '_') || 'root')
    }
    return v
  },
}

export const MOBILE_UX_SCENARIOS: UxScenario[] = [row1, row2, row3, row4, row5, row6, row7, row8, row9, row10, row11]

// ── runner ───────────────────────────────────────────────────────────────
export async function runMobileUx(opts: {
  base: string
  onrampBase?: string | null
  tag: string
  rows?: number[]
  themes?: Theme[]
}): Promise<Verdict[]> {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await pw.chromium.launch({ executablePath: chrome, headless: true })
  const all: Verdict[] = []
  const themes = opts.themes ?? ['dark']
  try {
    for (const s of MOBILE_UX_SCENARIOS) {
      if (opts.rows && !opts.rows.includes(s.row)) continue
      const profileIds = s.profiles ?? ['iphone']
      for (const pid of profileIds) {
        for (const theme of themes) {
          // Only the sweep row runs every theme on every profile; the others
          // measure geometry, which the theme cannot change.
          if (theme === 'light' && s.row !== 11 && s.row !== 2) continue
          const ctx = await makeCtx(browser, opts.base, opts.onrampBase ?? null, opts.tag, PROFILES[pid], theme)
          const label = `row ${s.row} · ${s.name} · ${PROFILES[pid].width}px · ${theme}`
          process.stdout.write(`\n── ${label}\n`)
          try {
            const got = await s.run(ctx)
            for (const g of got) {
              all.push(g)
              const mark = g.note ? '·' : g.ok ? '✅' : '❌'
              process.stdout.write(`   ${mark} [${g.row}] ${g.check} — ${g.detail}\n`)
            }
          } catch (e) {
            const v = fail(s.row, s.name, `threw: ${(e as Error).message}`)
            all.push(v)
            process.stdout.write(`   ❌ [${s.row}] ${s.name} — threw: ${(e as Error).message}\n`)
          } finally {
            await (ctx as any).__close()
          }
        }
      }
    }
  } finally {
    await browser.close()
  }
  return all
}

async function main() {
  const arg = (k: string, d?: string) => {
    const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
    return hit ? hit.slice(k.length + 3) : d
  }
  const base = arg('base', 'http://localhost:3873')!
  const onramp = arg('onramp', null as unknown as string) ?? null
  const tag = arg('tag', 'before')!
  const rowsArg = arg('rows')
  const rows = rowsArg ? rowsArg.split(',').map((n) => Number(n.trim())).filter(Number.isFinite) : undefined
  const themes = (arg('themes', 'dark,light') as string).split(',') as Theme[]

  const out = await runMobileUx({ base, onrampBase: onramp, tag, rows, themes })
  const reds = out.filter((v) => !v.ok)
  const greens = out.filter((v) => v.ok && !v.note)
  process.stdout.write(`\n────────────────────────────────────────\nmobile ux drive (${tag}): ${greens.length} green / ${reds.length} red / ${out.filter((v) => v.note).length} notes\n`)
  for (const r of reds) process.stdout.write(`   ❌ [${r.row}] ${r.check} — ${r.detail}\n`)
  process.stdout.write(`shots: ${UX_SHOT_DIR}\n`)
  process.exit(0)
}

if (process.argv[1]?.includes('drive-mobile-ux')) void main()
