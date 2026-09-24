/**
 * drive-native-nav — the NAV lane's measured phone tab bar (squad
 * mobile-native, 2026-09-24; NAV.md rows 1 and 10).
 *
 * Drives the REAL app in installed Chrome under phone profiles and reads
 * NUMBERS off the DOM for every seat tap: what opened (an overlay's rect and
 * the % of the viewport it covers), whether a scrim exists, what a tap
 * outside does, which seat is lit, and the URL. Run it on main for the BEFORE
 * and on the branch for the AFTER; the same rows print both.
 *
 * Usage:
 *   npx tsx scripts/drive-native-nav.ts --tag=before --base=http://localhost:3892
 *   npx tsx scripts/drive-native-nav.ts --tag=after --base=http://localhost:3892 --rows=before,after,desktop
 *
 * Rows: `before` = the measurement matrix (runs on both trees), `after` = the
 * branch's contract (lit seat, screens, sheet, URL, history), `desktop` = the
 * 1440 drawer unchanged. QA folds `NATIVE_NAV_SCENARIOS` into `drive:native`.
 *
 * Money safety: the mock wallet refuses every signature; no chat turn is sent.
 */

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// playwright-core resolves from ~/node_modules (the resolver walks up from
// the worktree) and is CommonJS: require it, never a static import (a bare
// import type-checks here and kills the Vercel build — squad 09-23).
const req = createRequire(path.join(process.cwd(), 'anchor.js'))
/* eslint-disable @typescript-eslint/no-explicit-any */
const pw: any = req('playwright-core')

export const NAV_SHOT_DIR = process.env.NAV_SHOT_DIR ?? '/Users/nategeier/yeetful/squad-native-2026-09-24/gates/shots/nav'

/** Watch-only: the mock refuses every signature (connect-to-act is enough
 *  for /chat — a signed-out visitor is sent home by the spine). */
export const DRIVE_WALLET = process.env.NAV_DRIVE_WALLET ?? '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'

export type Profile = { id: string; device: string; width: number; height: number }
export const PROFILES: Record<string, Profile> = {
  // Playwright's iPhone 13 descriptor in Chrome: 390×844, iOS UA, touch.
  // WebKit itself cannot launch on this Mac (playwright-core 1.60 expects
  // webkit-2287; only webkit-1578 is installed and hangs under the 1.60
  // driver), so iOS-shaped runs are Chrome wearing the iPhone descriptor.
  iphone: { id: 'iphone', device: 'iPhone 13', width: 390, height: 844 },
  // The squad's stated floor.
  small: { id: 'small', device: 'iPhone 13', width: 375, height: 812 },
  pixel: { id: 'pixel', device: 'Pixel 7', width: 412, height: 915 },
}

export type Verdict = { row: string; check: string; ok: boolean; detail: string; note?: boolean }
const pass = (row: string, check: string, detail: string): Verdict => ({ row, check, ok: true, detail })
const fail = (row: string, check: string, detail: string): Verdict => ({ row, check, ok: false, detail })
const note = (row: string, check: string, detail: string): Verdict => ({ row, check, ok: true, detail, note: true })

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

// ── in-page readers ──────────────────────────────────────────────────────

/** Everything the bar says right now. */
type BarRead = {
  url: string
  seats: string[]
  lit: string[]
  bar: { top: number; bottom: number; height: number; innerHeight: number } | null
  /** The phone overlay drawer (main's ChatRail posture below lg). */
  drawer: { x: number; y: number; w: number; h: number; pct: number } | null
  /** The phone screen panel (the branch's [data-phone-panel]). */
  screen: { name: string; x: number; y: number; w: number; h: number; pct: number } | null
  /** What /chat's main area says it shows (main[data-phone-screen]). */
  mainScreen: string | null
  /** The MORE popover (main) or the MORE sheet (branch). */
  more: 'popover' | 'sheet' | null
  scrim: boolean
  /** Which element a tap on the right side of the screen would land on. */
  outsideHits: string
  appScrollTop: number | null
  docScrollTop: number
  docScrollable: boolean
}

async function readBar(page: any): Promise<BarRead> {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pctOf = (r: DOMRect) => Math.round(((Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))) / (vw * vh)) * 100)
    const bar = document.querySelector('nav[data-spine-bar]') as HTMLElement | null
    const seatEls = bar ? Array.from(bar.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]')) : []
    const seats = seatEls.map((s) => s.getAttribute('aria-label') ?? '?')
    const lit = seatEls
      .filter((s) => s.getAttribute('aria-pressed') === 'true' || s.getAttribute('aria-current') === 'page' || !!s.querySelector('[aria-hidden][class*="--accent"]'))
      .map((s) => s.getAttribute('aria-label') ?? '?')
    const br = bar?.getBoundingClientRect()
    const drawerEl = Array.from(document.querySelectorAll<HTMLElement>('aside')).find((a) => /max-lg:absolute/.test(a.className) && a.getBoundingClientRect().width > 8) ?? null
    const dr = drawerEl?.getBoundingClientRect()
    const screenEl = document.querySelector('[data-phone-panel]') as HTMLElement | null
    const sr = screenEl?.getBoundingClientRect()
    const more = document.querySelector('[data-spine-more]') ? 'popover' : document.querySelector('.sheet[data-sheet="more"]') ? 'sheet' : null
    const scrim = !!document.querySelector('.sheet__scrim')
    const hit = document.elementFromPoint(Math.round(vw * 0.9), Math.round(vh * 0.5)) as HTMLElement | null
    const describe = (el: HTMLElement | null) => {
      if (!el) return 'nothing'
      const tag = el.tagName.toLowerCase()
      const id = el.getAttribute('data-phone-panel') ? `[data-phone-panel=${el.getAttribute('data-phone-panel')}]` : el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''
      const inDrawer = drawerEl?.contains(el) ? ' (in drawer)' : ''
      const inScreen = screenEl?.contains(el) ? ' (in screen)' : ''
      const inScrim = el.classList.contains('sheet__scrim') ? ' (scrim)' : ''
      return `${tag}${id}${inDrawer}${inScreen}${inScrim}`.slice(0, 80)
    }
    const scroller = document.querySelector('[data-app-scroll]') as HTMLElement | null
    const se = document.scrollingElement as HTMLElement
    return {
      url: location.pathname + location.search,
      seats,
      lit,
      bar: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom), height: Math.round(br.height), innerHeight: vh } : null,
      drawer: dr ? { x: Math.round(dr.left), y: Math.round(dr.top), w: Math.round(dr.width), h: Math.round(dr.height), pct: pctOf(dr) } : null,
      screen: sr && screenEl ? { name: screenEl.getAttribute('data-phone-panel') ?? '?', x: Math.round(sr.left), y: Math.round(sr.top), w: Math.round(sr.width), h: Math.round(sr.height), pct: pctOf(sr) } : null,
      mainScreen: (document.querySelector('main[data-phone-screen]') as HTMLElement | null)?.getAttribute('data-phone-screen') ?? null,
      more,
      scrim,
      outsideHits: describe(hit),
      appScrollTop: scroller ? scroller.scrollTop : null,
      docScrollTop: se.scrollTop,
      docScrollable: se.scrollHeight > vh + 1,
    }
  })
}

async function tapSeat(page: any, label: string): Promise<boolean> {
  const seat = page.locator(`nav[data-spine-bar] [aria-label="${label}"]`).first()
  if ((await seat.count()) === 0) return false
  if (!(await seat.isVisible())) return false
  await seat.tap()
  return true
}

/** A tap on the right side of the screen, outside any 248px drawer and any
 *  bottom sheet's panel (the branch's sheet panel is at the bottom; the point
 *  sits at 50% height, above an auto-sized MORE sheet). */
async function tapOutside(page: any): Promise<void> {
  const { x, y } = await page.evaluate(() => ({ x: Math.round(window.innerWidth * 0.9), y: Math.round(window.innerHeight * 0.4) }))
  await page.touchscreen.tap(x, y)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── contexts ─────────────────────────────────────────────────────────────
export type DriveCtx = {
  browser: any
  base: string
  tag: string
  profile: Profile
  theme: 'dark' | 'light'
  open(opts?: { wallet?: boolean; desktop?: boolean }): Promise<any>
  shot(page: any, name: string): Promise<string>
  close(): Promise<void>
}

export async function makeCtx(browser: any, base: string, tag: string, profile: Profile, theme: 'dark' | 'light'): Promise<DriveCtx> {
  const contexts: any[] = []
  return {
    browser,
    base,
    tag,
    profile,
    theme,
    async open(opts = {}) {
      const c = await browser.newContext(
        opts.desktop
          ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme }
          : { ...pw.devices[profile.device], viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: 2, colorScheme: theme },
      )
      // tsx injects `__name(fn)` into evaluate bodies; the page has no such helper.
      await c.addInitScript('window.__name = window.__name || function (f) { return f }')
      if (opts.wallet !== false) await c.addInitScript(mockWalletScript(DRIVE_WALLET))
      const p = await c.newPage()
      p.on('pageerror', (e: Error) => {
        ;(p as any).__errors = [...((p as any).__errors ?? []), e.message]
      })
      contexts.push(c)
      return p
    },
    async shot(page, name) {
      mkdirSync(NAV_SHOT_DIR, { recursive: true })
      const file = path.join(NAV_SHOT_DIR, `${name}-${tag}-${profile.id}-${theme}.png`)
      try {
        await page.mouse.move(2, 2)
      } catch {}
      await page.screenshot({ path: file })
      return file
    },
    async close() {
      for (const c of contexts) await c.close().catch(() => {})
    },
  }
}

/** Open /chat with the mock wallet connected: the spine sends a signed-out
 *  visitor home, and wagmi restores the remembered mock in ~1–9s. */
async function openChat(ctx: DriveCtx, href = '/chat'): Promise<any> {
  const page = await ctx.open()
  await page.goto(`${ctx.base}${href}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('nav[data-spine-bar]'), { timeout: 15_000 }).catch(() => {})
  // Hold for the wallet restore (the gate bounces only settled strangers).
  await page.waitForFunction(() => location.pathname.startsWith('/chat'), { timeout: 2_000 }).catch(() => {})
  await wait(2_500)
  return page
}

// ── rows ─────────────────────────────────────────────────────────────────
export type NavScenario = { row: string; name: string; run(ctx: DriveCtx): Promise<Verdict[]> }

const PHONE_SEATS = ['APPS', 'JOBS', 'LINKS', 'CHATS', 'More'] as const

/** The measurement matrix (NAV.md row 1 / row 10): every seat on /chat and
 *  from /markets. Notes, not verdicts — the numbers ARE the finding. */
const rowMatrix: NavScenario = {
  row: 'matrix',
  name: 'every seat, on /chat and from /markets',
  async run(ctx) {
    const v: Verdict[] = []
    // Resting state in a conversation.
    {
      const page = await openChat(ctx)
      const r0 = await readBar(page)
      v.push(note('matrix', `/chat at rest: lit=[${r0.lit.join(',')}] url=${r0.url} drawer=${r0.drawer ? `${r0.drawer.w}×${r0.drawer.h} ${r0.drawer.pct}%` : 'none'} screen=${r0.screen ? r0.screen.name : 'none'} docScrollable=${r0.docScrollable} bar=${r0.bar ? `${r0.bar.bottom}/${r0.bar.innerHeight}` : 'none'}`, 'measured'))
      if (r0.url.startsWith('/chat')) v.push(pass('matrix', 'the mock wallet keeps /chat open (no signed-out bounce)', r0.url))
      else v.push(fail('matrix', 'the mock wallet keeps /chat open (no signed-out bounce)', r0.url))
      await ctx.shot(page, 'chat-rest')
      for (const seat of PHONE_SEATS) {
        const ok = await tapSeat(page, seat)
        if (!ok) {
          v.push(note('matrix', `${seat} on /chat: seat not on this bar`, 'skipped'))
          continue
        }
        await wait(700)
        const r = await readBar(page)
        const overlay = r.drawer ? `drawer ${r.drawer.x},${r.drawer.y} ${r.drawer.w}×${r.drawer.h} = ${r.drawer.pct}% of the screen` : r.screen ? `screen ${r.screen.name} ${r.screen.w}×${r.screen.h} = ${r.screen.pct}%` : r.more ? `MORE ${r.more}` : 'nothing'
        v.push(note('matrix', `${seat} on /chat → ${overlay}; scrim=${r.scrim}; lit=[${r.lit.join(',')}]; url=${r.url}; outside tap lands on ${r.outsideHits}`, 'measured'))
        await ctx.shot(page, `chat-tap-${seat.toLowerCase()}`)
        // Tap outside and read again.
        await tapOutside(page)
        await wait(600)
        const r2 = await readBar(page)
        const after = r2.drawer ? `drawer still ${r2.drawer.pct}%` : r2.screen ? `screen ${r2.screen.name} still up (a place, not a pop-up)` : r2.more ? `MORE ${r2.more} still open` : 'closed / nothing open'
        v.push(note('matrix', `${seat} on /chat, then a tap outside → ${after}; lit=[${r2.lit.join(',')}]; url=${r2.url}`, 'measured'))
        // Reset to the conversation for the next seat, the way a visitor
        // would: on main by collapsing the drawer, on the branch via CHATS.
        await page.keyboard.press('Escape').catch(() => {})
        const collapse = page.locator('button[aria-label="Collapse the drawer"]').first()
        if ((await collapse.count()) > 0 && (await collapse.isVisible().catch(() => false))) await collapse.tap()
        const rr = await readBar(page)
        if (rr.screen && rr.screen.name !== 'chat') {
          await tapSeat(page, 'CHATS')
          await wait(400)
          const r3 = await readBar(page)
          if (r3.screen && r3.screen.name === 'history') await tapSeat(page, 'CHATS')
        }
        await wait(400)
      }
    }
    // From /markets: each seat navigates in.
    for (const seat of ['APPS', 'JOBS', 'LINKS', 'CHATS'] as const) {
      const page = await ctx.open()
      await page.goto(`${ctx.base}/markets`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => !!document.querySelector('nav[data-spine-bar]'), { timeout: 15_000 }).catch(() => {})
      await wait(2_000)
      const ok = await tapSeat(page, seat)
      if (!ok) {
        v.push(note('matrix', `${seat} from /markets: seat not on this bar`, 'skipped'))
        continue
      }
      await page.waitForFunction(() => location.pathname.startsWith('/chat'), { timeout: 10_000 }).catch(() => {})
      await wait(2_500)
      const r = await readBar(page)
      const overlay = r.drawer ? `drawer ${r.drawer.w}×${r.drawer.h} = ${r.drawer.pct}%` : r.screen ? `screen ${r.screen.name} = ${r.screen.pct}%` : 'nothing'
      v.push(note('matrix', `${seat} from /markets → url=${r.url}; ${overlay}; scrim=${r.scrim}; lit=[${r.lit.join(',')}]`, 'measured'))
      await ctx.shot(page, `markets-tap-${seat.toLowerCase()}`)
    }
    return v
  },
}

/** The branch's contract: NAV.md rows 2–9 as verdicts. */
const rowContract: NavScenario = {
  row: 'contract',
  name: 'a tab is a place: screens, lit seat, sheet, URL, history',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await openChat(ctx)
    const r0 = await readBar(page)
    v.push(r0.lit.length === 1 && r0.lit[0] === 'CHATS' ? pass('contract', 'in a conversation the CHATS seat is lit', r0.lit.join(',')) : fail('contract', 'in a conversation the CHATS seat is lit', `lit=[${r0.lit.join(',')}]`))
    v.push(r0.mainScreen === 'chat' ? pass('contract', 'the main area names its screen in the conversation (main[data-phone-screen="chat"])', String(r0.mainScreen)) : fail('contract', 'the main area names its screen in the conversation (main[data-phone-screen="chat"])', String(r0.mainScreen)))
    v.push(r0.drawer === null && r0.screen === null ? pass('contract', 'at rest nothing covers the conversation', 'no drawer, no screen') : fail('contract', 'at rest nothing covers the conversation', JSON.stringify({ drawer: r0.drawer, screen: r0.screen })))
    v.push(r0.bar && r0.bar.height >= 44 ? pass('contract', 'the bar is ≥44px tall', `${r0.bar.height}px`) : fail('contract', 'the bar is ≥44px tall', JSON.stringify(r0.bar)))
    // Inside SHELL's frame the bar is the frame's last row: flush with the
    // viewport's bottom, nothing under it, the composer above it, and the
    // document itself never scrolls.
    const frame = await page.evaluate(() => {
      const bar = document.querySelector('nav[data-spine-bar]') as HTMLElement | null
      const br = bar?.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 10)
      const composer = document.querySelector('main textarea') as HTMLElement | null
      const cr = composer?.getBoundingClientRect()
      const se = document.scrollingElement as HTMLElement
      return {
        framed: !!document.querySelector('[data-app-frame]'),
        barBottom: br ? Math.round(br.bottom) : -1,
        innerHeight: window.innerHeight,
        barPosition: bar ? getComputedStyle(bar).position : '',
        hitInBar: !!bar && !!hit && bar.contains(hit),
        composerBottom: cr ? Math.round(cr.bottom) : -1,
        barTop: br ? Math.round(br.top) : -1,
        docScrollHeight: se.scrollHeight,
      }
    })
    v.push(frame.framed && frame.barBottom === frame.innerHeight && frame.hitInBar ? pass('contract', 'frame: the bar is flush with the viewport bottom and owns the bottom pixels', `bar bottom ${frame.barBottom}/${frame.innerHeight}, position ${frame.barPosition}`) : fail('contract', 'frame: the bar is flush with the viewport bottom and owns the bottom pixels', JSON.stringify(frame)))
    v.push(frame.composerBottom > 0 && frame.composerBottom <= frame.barTop ? pass('contract', 'frame: the composer sits above the bar (no hand reserve needed)', `composer bottom ${frame.composerBottom} ≤ bar top ${frame.barTop}`) : fail('contract', 'frame: the composer sits above the bar (no hand reserve needed)', JSON.stringify(frame)))
    v.push(frame.docScrollHeight <= frame.innerHeight + 1 ? pass('contract', 'frame: the document never scrolls on /chat', `${frame.docScrollHeight} ≤ ${frame.innerHeight}`) : fail('contract', 'frame: the document never scrolls on /chat', JSON.stringify(frame)))
    const seatSizes: Array<{ label: string; w: number; h: number; font: number }> = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('nav[data-spine-bar] a[aria-label], nav[data-spine-bar] button[aria-label]'))
        .filter((s) => s.getBoundingClientRect().width > 0)
        .map((s) => {
          const r = s.getBoundingClientRect()
          const label = s.querySelector('span.mono') as HTMLElement | null
          return { label: s.getAttribute('aria-label') ?? '?', w: Math.round(r.width), h: Math.round(r.height), font: label ? parseFloat(getComputedStyle(label).fontSize) : 0 }
        }),
    )
    const small = seatSizes.filter((s) => s.w < 44 || s.h < 44)
    v.push(small.length === 0 ? pass('contract', 'every seat is a ≥44px target', seatSizes.map((s) => `${s.label} ${s.w}×${s.h}`).join(' ')) : fail('contract', 'every seat is a ≥44px target', small.map((s) => `${s.label} ${s.w}×${s.h}`).join(' ')))
    const tinyLabel = seatSizes.filter((s) => s.font > 0 && s.font < 10)
    v.push(tinyLabel.length === 0 ? pass('contract', 'labels are ≥10px', `${seatSizes[0]?.font}px`) : fail('contract', 'labels are ≥10px', tinyLabel.map((s) => `${s.label} ${s.font}px`).join(' ')))

    // APPS → the APPS screen, full width, lit, URL names it, no scrim.
    await tapSeat(page, 'APPS')
    await wait(600)
    const rA = await readBar(page)
    v.push(rA.screen?.name === 'apps' && rA.screen.w >= ctx.profile.width - 1 ? pass('contract', 'APPS is a full-width screen', `${rA.screen.w}×${rA.screen.h} = ${rA.screen.pct}%`) : fail('contract', 'APPS is a full-width screen', JSON.stringify(rA.screen)))
    v.push(rA.lit.join(',') === 'APPS' ? pass('contract', 'APPS lights its seat', rA.lit.join(',')) : fail('contract', 'APPS lights its seat', `lit=[${rA.lit.join(',')}]`))
    v.push(rA.mainScreen === 'apps' ? pass('contract', 'the main area names the APPS screen (main[data-phone-screen="apps"])', String(rA.mainScreen)) : fail('contract', 'the main area names the APPS screen (main[data-phone-screen="apps"])', String(rA.mainScreen)))
    v.push(/tab=mcps/.test(rA.url) ? pass('contract', 'the URL names the APPS screen (?tab=mcps)', rA.url) : fail('contract', 'the URL names the APPS screen (?tab=mcps)', rA.url))
    v.push(!rA.scrim && !rA.drawer ? pass('contract', 'no scrim, no drawer: a place, not a pop-up', 'ok') : fail('contract', 'no scrim, no drawer: a place, not a pop-up', JSON.stringify({ scrim: rA.scrim, drawer: rA.drawer })))
    await ctx.shot(page, 'screen-apps')
    // The apps list is there.
    const appsRows = await page.locator('[data-phone-panel="apps"] [role="button"]').count()
    v.push(appsRows > 0 ? pass('contract', 'the APPS screen lists the MCPs', `${appsRows} rows`) : fail('contract', 'the APPS screen lists the MCPs', `${appsRows} rows`))
    // Tap the lit seat at the top → stays, scrolls to top (scroll first).
    const scrolled = await page.evaluate(() => {
      const s = document.querySelector('[data-app-scroll]') as HTMLElement | null
      if (!s) return -1
      s.scrollTop = 400
      return s.scrollTop
    })
    await tapSeat(page, 'APPS')
    await wait(900)
    const rA2 = await readBar(page)
    v.push(rA2.screen?.name === 'apps' ? pass('contract', 'tapping the lit APPS seat stays on APPS', rA2.screen.name) : fail('contract', 'tapping the lit APPS seat stays on APPS', JSON.stringify(rA2.screen)))
    v.push(scrolled <= 0 || (rA2.appScrollTop ?? 1) === 0 ? pass('contract', 'tapping the lit seat scrolls its screen to the top', `scrolled ${scrolled} → ${rA2.appScrollTop}`) : fail('contract', 'tapping the lit seat scrolls its screen to the top', `scrolled ${scrolled} → ${rA2.appScrollTop}`))

    // The scroller handover (round 2): exactly ONE [data-app-scroll] at every
    // step, the thread's in the conversation and the screen's while one
    // shows, and the thread keeps its scroll position across a visit.
    const scrollers = () =>
      page.evaluate(() => {
        const all = Array.from(document.querySelectorAll<HTMLElement>('[data-app-scroll]'))
        const el = all[0]
        const owner = !el ? 'none' : el.closest('[data-phone-panel]') ? `panel:${el.closest('[data-phone-panel]')!.getAttribute('data-phone-panel')}` : el.closest('main') ? 'thread' : 'other'
        return { count: all.length, owner, scrollTop: el ? el.scrollTop : -1, scrollable: el ? el.scrollHeight > el.clientHeight + 1 : false }
      })
    await tapSeat(page, 'CHATS')
    await wait(500)
    const s0 = await scrollers()
    v.push(s0.count === 1 && s0.owner === 'thread' ? pass('contract', 'handover: in the conversation the thread is the ONE [data-app-scroll]', JSON.stringify(s0)) : fail('contract', 'handover: in the conversation the thread is the ONE [data-app-scroll]', JSON.stringify(s0)))
    const threadLeft = await page.evaluate(() => {
      const t = document.querySelector('[data-app-scroll]') as HTMLElement | null
      if (!t || t.scrollHeight <= t.clientHeight + 1) return -1
      t.scrollTop = Math.min(160, t.scrollHeight - t.clientHeight)
      return t.scrollTop
    })
    await wait(300)
    await tapSeat(page, 'APPS')
    await wait(600)
    const s1 = await scrollers()
    v.push(s1.count === 1 && s1.owner === 'panel:apps' ? pass('contract', 'handover: on APPS the screen is the ONE [data-app-scroll] (the thread gave it up)', JSON.stringify(s1)) : fail('contract', 'handover: on APPS the screen is the ONE [data-app-scroll] (the thread gave it up)', JSON.stringify(s1)))
    await tapSeat(page, 'CHATS')
    await wait(600)
    const s2 = await scrollers()
    v.push(s2.count === 1 && s2.owner === 'thread' ? pass('contract', 'handover: back in the conversation the thread is the ONE [data-app-scroll] again', JSON.stringify(s2)) : fail('contract', 'handover: back in the conversation the thread is the ONE [data-app-scroll] again', JSON.stringify(s2)))
    if (threadLeft > 0) {
      v.push(Math.abs(s2.scrollTop - threadLeft) <= 4 ? pass('contract', 'handover: the thread keeps its scroll position across a visit to APPS', `left at ${threadLeft}, back at ${s2.scrollTop}`) : fail('contract', 'handover: the thread keeps its scroll position across a visit to APPS', `left at ${threadLeft}, back at ${s2.scrollTop}`))
    } else {
      v.push(note('contract', 'handover: the thread was not scrollable in this state (no cards yet), position retention not measured', JSON.stringify(s0)))
    }

    // The keyboard with a screen up: a field on the LINKS screen (the mint
    // composer; TEAM's mandate box as the fallback), the keyboard faked the
    // way SHELL reads it (visualViewport.height shrinks, resize fires): the
    // bar steps aside, the frame shrinks onto the keyboard, the field stays
    // visible above it.
    await tapSeat(page, 'LINKS')
    await wait(1200)
    let field = page.locator('[data-phone-panel="links"] textarea, [data-phone-panel="links"] input[type="text"], [data-phone-panel="links"] input:not([type])').first()
    let fieldWhere = 'links'
    if ((await field.count()) === 0) {
      await tapSeat(page, 'More')
      await wait(400)
      await page.locator('.sheet[data-sheet="more"] [role="menuitem"]').filter({ hasText: 'Team' }).first().tap()
      await wait(1200)
      field = page.locator('[data-phone-panel="team"] textarea').first()
      fieldWhere = 'team'
    }
    if ((await field.count()) > 0) {
      await field.first().scrollIntoViewIfNeeded()
      await field.first().focus()
      await wait(200)
      const kb = await page.evaluate(() => {
        const vv = window.visualViewport
        if (!vv) return null
        const KB = 300
        Object.defineProperty(vv, 'height', { get: () => window.innerHeight - KB, configurable: true })
        Object.defineProperty(vv, 'offsetTop', { get: () => 0, configurable: true })
        vv.dispatchEvent(new Event('resize'))
        return KB
      })
      await wait(500)
      const up = await page.evaluate(() => {
        const bar = document.querySelector('nav[data-spine-bar]') as HTMLElement | null
        const frame = document.querySelector('[data-app-frame]') as HTMLElement | null
        const active = document.activeElement as HTMLElement | null
        const ar = active?.getBoundingClientRect()
        return {
          keyboardAttr: document.documentElement.getAttribute('data-keyboard'),
          inset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim(),
          barDisplay: bar ? getComputedStyle(bar).display : 'none',
          barH: bar ? bar.getBoundingClientRect().height : 0,
          frameH: frame ? Math.round(frame.getBoundingClientRect().height) : -1,
          innerHeight: window.innerHeight,
          activeTag: active?.tagName ?? 'none',
          fieldTop: ar ? Math.round(ar.top) : -1,
          fieldBottom: ar ? Math.round(ar.bottom) : -1,
        }
      })
      const visibleAbove = up.innerHeight - (kb ?? 300)
      v.push(up.keyboardAttr === '1' && up.barDisplay === 'none' ? pass('contract', `keyboard up on the ${fieldWhere} screen: html[data-keyboard], the bar steps aside`, JSON.stringify(up)) : fail('contract', `keyboard up on the ${fieldWhere} screen: html[data-keyboard], the bar steps aside`, JSON.stringify(up)))
      v.push(up.frameH === visibleAbove ? pass('contract', 'keyboard up: the frame shrinks onto the keyboard', `frame ${up.frameH} = ${up.innerHeight} − ${kb}`) : fail('contract', 'keyboard up: the frame shrinks onto the keyboard', JSON.stringify(up)))
      v.push(up.fieldTop >= 0 && up.fieldBottom <= visibleAbove && /TEXTAREA|INPUT/.test(up.activeTag) ? pass('contract', 'keyboard up: the focused field stays visible above the keyboard', `field ${up.fieldTop}–${up.fieldBottom} within 0–${visibleAbove}`) : fail('contract', 'keyboard up: the focused field stays visible above the keyboard', JSON.stringify(up)))
      // Keyboard away: the bar comes back.
      await page.evaluate(() => {
        const vv = window.visualViewport
        if (!vv) return
        Object.defineProperty(vv, 'height', { get: () => window.innerHeight, configurable: true })
        vv.dispatchEvent(new Event('resize'))
      })
      await wait(500)
      const down = await page.evaluate(() => {
        const bar = document.querySelector('nav[data-spine-bar]') as HTMLElement | null
        return { keyboardAttr: document.documentElement.getAttribute('data-keyboard'), barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : -1, innerHeight: window.innerHeight }
      })
      v.push(down.keyboardAttr === null && down.barBottom === down.innerHeight ? pass('contract', 'keyboard away: the bar is back on the bottom', JSON.stringify(down)) : fail('contract', 'keyboard away: the bar is back on the bottom', JSON.stringify(down)))
      await page.keyboard.press('Escape').catch(() => {})
    } else {
      v.push(fail('contract', 'keyboard: a field to focus on the LINKS or TEAM screen', 'none found'))
    }
    if (fieldWhere === 'team') {
      await tapSeat(page, 'CHATS')
      await wait(400)
    }
    await tapSeat(page, 'APPS')
    await wait(600)
    // The APPS screen's "Add your own MCP" opens CHAT's Sheet by the id it
    // names (data-sheet-open="addmcp" ⇄ data-sheet="addmcp"), and a tap
    // outside closes it.
    const addBtn = page.locator('[data-phone-panel="apps"] [data-sheet-open="addmcp"]').first()
    if ((await addBtn.count()) > 0) {
      await addBtn.scrollIntoViewIfNeeded()
      await addBtn.tap()
      await wait(500)
      const sheet = await page.locator('.sheet[data-sheet="addmcp"]').count()
      v.push(sheet > 0 ? pass('contract', 'APPS: "Add your own MCP" (data-sheet-open="addmcp") opens the Sheet with that id', 'ok') : fail('contract', 'APPS: "Add your own MCP" (data-sheet-open="addmcp") opens the Sheet with that id', `${sheet} sheets`))
      await page.keyboard.press('Escape')
      await wait(500)
      v.push((await page.locator('.sheet[data-sheet="addmcp"]').count()) === 0 ? pass('contract', 'APPS: Escape closes the add-MCP sheet', 'closed') : fail('contract', 'APPS: Escape closes the add-MCP sheet', 'still open'))
    } else {
      v.push(fail('contract', 'APPS: "Add your own MCP" carries data-sheet-open="addmcp"', 'missing'))
    }
    await page.evaluate(() => {
      const s = document.querySelector('[data-app-scroll]') as HTMLElement | null
      if (s) s.scrollTop = 0
    })

    // Scroll memory: leave APPS scrolled, come back, land where you were.
    const left = await page.evaluate(() => {
      const s = document.querySelector('[data-app-scroll]') as HTMLElement | null
      if (!s) return -1
      s.scrollTop = 150
      return s.scrollTop
    })
    await tapSeat(page, 'CHATS')
    await wait(500)
    await tapSeat(page, 'APPS')
    await wait(700)
    const back = (await readBar(page)).appScrollTop ?? -1
    v.push(left <= 0 || Math.abs(back - left) <= 4 ? pass('contract', 'a screen remembers its scroll position across a leave + return', `left at ${left}, back at ${back}`) : fail('contract', 'a screen remembers its scroll position across a leave + return', `left at ${left}, back at ${back}`))
    // CHATS from APPS → back to the conversation (no history list).
    await tapSeat(page, 'CHATS')
    await wait(600)
    const rC = await readBar(page)
    v.push(rC.screen === null && rC.lit.join(',') === 'CHATS' && !/tab=/.test(rC.url) ? pass('contract', 'CHATS from APPS returns to the conversation (bare URL, CHATS lit)', rC.url) : fail('contract', 'CHATS from APPS returns to the conversation (bare URL, CHATS lit)', JSON.stringify({ screen: rC.screen, lit: rC.lit, url: rC.url })))
    // CHATS in the conversation → the chat list; again → the conversation.
    await tapSeat(page, 'CHATS')
    await wait(600)
    const rH = await readBar(page)
    v.push(rH.screen?.name === 'history' && rH.lit.join(',') === 'CHATS' && /tab=chats/.test(rH.url) ? pass('contract', 'CHATS in the conversation shows the chat list ("New chat" first), CHATS stays lit, ?tab=chats', rH.url) : fail('contract', 'CHATS in the conversation shows the chat list', JSON.stringify({ screen: rH.screen, lit: rH.lit, url: rH.url })))
    const newChatFirst = await page.evaluate(() => {
      const s = document.querySelector('[data-phone-panel="history"]')
      const first = s?.querySelector('button, [role="button"]') as HTMLElement | null
      return first?.textContent?.trim() ?? ''
    })
    v.push(/new chat/i.test(newChatFirst) ? pass('contract', 'the chat list leads with New chat', newChatFirst) : fail('contract', 'the chat list leads with New chat', newChatFirst))
    await ctx.shot(page, 'screen-history')
    await tapSeat(page, 'CHATS')
    await wait(600)
    const rC2 = await readBar(page)
    v.push(rC2.screen === null ? pass('contract', 'CHATS on the list pops back to the conversation', rC2.url) : fail('contract', 'CHATS on the list pops back to the conversation', JSON.stringify(rC2.screen)))

    // JOBS + LINKS screens.
    for (const [seat, name] of [
      ['JOBS', 'jobs'],
      ['LINKS', 'links'],
    ] as const) {
      await tapSeat(page, seat)
      await wait(900)
      const r = await readBar(page)
      v.push(r.screen?.name === name && r.lit.join(',') === seat && !r.scrim ? pass('contract', `${seat} is a full screen with its seat lit and ?tab=`, `${r.url} ${r.screen.w}×${r.screen.h}`) : fail('contract', `${seat} is a full screen with its seat lit and ?tab=`, JSON.stringify({ screen: r.screen, lit: r.lit, url: r.url, scrim: r.scrim })))
      await ctx.shot(page, `screen-${name}`)
    }
    // LINKS: the list is one labeled tap away, as a Sheet with a scrim that
    // closes on a tap outside.
    const listBtn = page.locator('[data-phone-panel="links"] button[aria-label="Your list"][data-sheet-open="links"]').first()
    if ((await listBtn.count()) > 0) {
      await listBtn.tap()
      await wait(500)
      const rS = await readBar(page)
      const sheetUp = await page.locator('.sheet[data-sheet="links"]').count()
      v.push(sheetUp > 0 && rS.scrim ? pass('contract', 'LINKS: "Your list" opens the list as a Sheet with a scrim', 'ok') : fail('contract', 'LINKS: "Your list" opens the list as a Sheet with a scrim', JSON.stringify({ sheetUp, scrim: rS.scrim })))
      await ctx.shot(page, 'sheet-links-list')
      const signInSize = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll<HTMLElement>('.sheet[data-sheet="links"] button')).find((x) => /Sign in to mint links/.test(x.textContent ?? ''))
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })
      if (signInSize) v.push(signInSize.h >= 44 ? pass('contract', 'links list sheet: "Sign in to mint links" is a ≥44px target', `${signInSize.w}×${signInSize.h}`) : fail('contract', 'links list sheet: "Sign in to mint links" is a ≥44px target', `${signInSize.w}×${signInSize.h}`))
      await tapOutside(page)
      await wait(500)
      const gone = (await page.locator('.sheet[data-sheet="links"]').count()) === 0
      v.push(gone ? pass('contract', 'LINKS list sheet: a tap outside closes it', 'closed') : fail('contract', 'LINKS list sheet: a tap outside closes it', 'still open'))
    } else {
      v.push(fail('contract', 'LINKS: "Your list" button exists on the screen', 'missing'))
    }
    // No phone overlay drawer anywhere: no aside with the overlay posture.
    const overlayAside = await page.evaluate(() => Array.from(document.querySelectorAll('aside')).filter((a) => /max-lg:absolute/.test(a.className)).length)
    v.push(overlayAside === 0 ? pass('contract', 'no overlay drawer exists below lg', '0 asides') : fail('contract', 'no overlay drawer exists below lg', `${overlayAside} asides`))

    // MORE → a Sheet: scrim, tap outside closes; Escape closes; reopen.
    if (await tapSeat(page, 'More')) {
      await wait(500)
      const rM = await readBar(page)
      v.push(rM.more === 'sheet' && rM.scrim ? pass('contract', 'MORE opens a Sheet with a scrim (no popover)', 'ok') : fail('contract', 'MORE opens a Sheet with a scrim (no popover)', JSON.stringify({ more: rM.more, scrim: rM.scrim })))
      const items = await page.locator('.sheet[data-sheet="more"] [role="menuitem"]').allTextContents()
      v.push(items.some((t: string) => /Docs/.test(t)) && items.some((t: string) => /Settings/.test(t)) ? pass('contract', 'the MORE sheet holds Docs and Settings (+ Team when the roster is on)', items.map((t: string) => t.split('\n')[0].trim()).join(' | ')) : fail('contract', 'the MORE sheet holds Docs and Settings', items.join(' | ')))
      await ctx.shot(page, 'sheet-more')
      await tapOutside(page)
      await wait(500)
      v.push((await readBar(page)).more === null ? pass('contract', 'MORE sheet: a tap outside closes it', 'closed') : fail('contract', 'MORE sheet: a tap outside closes it', 'still open'))
      await tapSeat(page, 'More')
      await wait(400)
      await page.keyboard.press('Escape')
      await wait(400)
      v.push((await readBar(page)).more === null ? pass('contract', 'MORE sheet: Escape closes it', 'closed') : fail('contract', 'MORE sheet: Escape closes it', 'still open'))
      await tapSeat(page, 'More')
      await wait(400)
      // A thumb on the MORE seat while the sheet is up lands on the scrim
      // (it covers the bar): tap the seat's coordinates, not the element.
      const moreBox = await page.locator('nav[data-spine-bar] [aria-label="More"]').first().boundingBox()
      if (moreBox) await page.touchscreen.tap(moreBox.x + moreBox.width / 2, moreBox.y + moreBox.height / 2)
      await wait(400)
      v.push((await readBar(page)).more === null ? pass('contract', 'MORE sheet: its own seat closes it', 'closed') : fail('contract', 'MORE sheet: its own seat closes it', 'still open'))
    } else {
      v.push(note('contract', 'MORE is not on this bar (≥sm)', 'skipped'))
    }

    // Reload on ?tab=jobs restores JOBS; back/forward restores the screen.
    await page.goto(`${ctx.base}/chat?tab=jobs`, { waitUntil: 'domcontentloaded' })
    await wait(2_500)
    const rR = await readBar(page)
    v.push(rR.screen?.name === 'jobs' && rR.lit.join(',') === 'JOBS' ? pass('contract', 'a reload on /chat?tab=jobs lands on the JOBS screen', rR.url) : fail('contract', 'a reload on /chat?tab=jobs lands on the JOBS screen', JSON.stringify({ screen: rR.screen, lit: rR.lit, url: rR.url })))
    // A pushed deep link then back: the previous screen returns.
    await page.evaluate(() => {
      window.history.pushState(null, '', '/chat?tab=links')
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    })
    await wait(600)
    const rP = await readBar(page)
    v.push(rP.screen?.name === 'links' ? pass('contract', 'popstate onto ?tab=links shows LINKS', rP.url) : fail('contract', 'popstate onto ?tab=links shows LINKS', JSON.stringify(rP.screen)))
    await page.goBack()
    await wait(800)
    const rB = await readBar(page)
    v.push(rB.screen?.name === 'jobs' ? pass('contract', 'back restores the JOBS screen', rB.url) : fail('contract', 'back restores the JOBS screen', JSON.stringify({ screen: rB.screen, url: rB.url })))
    // Bare /chat is the conversation even after a screen was open.
    await page.goto(`${ctx.base}/chat`, { waitUntil: 'domcontentloaded' })
    await wait(2_500)
    const rBare = await readBar(page)
    v.push(rBare.screen === null && rBare.lit.join(',') === 'CHATS' ? pass('contract', 'bare /chat is the conversation', rBare.url) : fail('contract', 'bare /chat is the conversation', JSON.stringify({ screen: rBare.screen, lit: rBare.lit })))

    // Off /chat: from /markets each seat lands IN its screen, never a drawer.
    for (const [seat, name] of [
      ['APPS', 'apps'],
      ['CHATS', 'history'],
    ] as const) {
      const p2 = await ctx.open()
      await p2.goto(`${ctx.base}/markets`, { waitUntil: 'domcontentloaded' })
      await p2.waitForFunction(() => !!document.querySelector('nav[data-spine-bar]'), { timeout: 15_000 }).catch(() => {})
      await wait(1_500)
      const rMk = await readBar(p2)
      v.push(rMk.lit.join(',') === 'MARKETS' ? pass('contract', 'on /markets the MARKETS seat is lit', rMk.lit.join(',')) : fail('contract', 'on /markets the MARKETS seat is lit', `lit=[${rMk.lit.join(',')}]`))
      await tapSeat(p2, seat)
      await p2.waitForFunction(() => location.pathname.startsWith('/chat'), { timeout: 10_000 }).catch(() => {})
      await wait(2_500)
      const r = await readBar(p2)
      v.push(r.screen?.name === name && !r.drawer ? pass('contract', `${seat} from /markets lands on the ${name} screen`, r.url) : fail('contract', `${seat} from /markets lands on the ${name} screen`, JSON.stringify({ screen: r.screen, drawer: r.drawer, url: r.url })))
    }
    const errs = (page as any).__errors ?? []
    v.push(errs.length === 0 ? pass('contract', 'no page errors', '0') : fail('contract', 'no page errors', errs.join(' | ').slice(0, 300)))
    return v
  },
}

/** The desktop drawer is byte-for-byte behaviorally unchanged at 1440. */
const rowDesktop: NavScenario = {
  row: 'desktop',
  name: '1440: the drawer behaves as on main',
  async run(ctx) {
    const v: Verdict[] = []
    const page = await ctx.open({ desktop: true })
    await page.goto(`${ctx.base}/chat`, { waitUntil: 'domcontentloaded' })
    await wait(3_000)
    const read = () =>
      page.evaluate(() => {
        const col = document.querySelector('aside[aria-label="Workspace"]') as HTMLElement | null
        const seats = col ? Array.from(col.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]')) : []
        const lit = seats.filter((s) => s.getAttribute('aria-pressed') === 'true' || s.getAttribute('aria-current') === 'page').map((s) => s.getAttribute('aria-label'))
        const drawer = Array.from(document.querySelectorAll<HTMLElement>('aside')).find((a) => a !== col && a.getBoundingClientRect().width > 8) ?? null
        const heading = drawer?.querySelector('span.mono')?.textContent?.trim() ?? ''
        const bar = document.querySelector('nav[data-spine-bar]') as HTMLElement | null
        const screen = document.querySelector('[data-phone-panel], main[data-phone-screen]')
        return { lit, drawerW: drawer ? Math.round(drawer.getBoundingClientRect().width) : 0, heading, barVisible: !!bar && bar.getBoundingClientRect().height > 0, screen: !!screen, url: location.pathname + location.search }
      })
    const r0 = await read()
    v.push(r0.drawerW === 248 && /apps/i.test(r0.heading) ? pass('desktop', 'the drawer opens on Your apps at 248px', `${r0.drawerW}px "${r0.heading}"`) : fail('desktop', 'the drawer opens on Your apps at 248px', JSON.stringify(r0)))
    v.push(!r0.barVisible && !r0.screen ? pass('desktop', 'no phone bar, no phone screen at 1440', 'ok') : fail('desktop', 'no phone bar, no phone screen at 1440', JSON.stringify(r0)))
    v.push(r0.lit.join(',') === 'APPS' ? pass('desktop', 'the APPS seat is lit while its drawer is open', r0.lit.join(',')) : fail('desktop', 'the APPS seat is lit while its drawer is open', `lit=[${r0.lit.join(',')}]`))
    const click = (label: string) => page.locator(`aside[aria-label="Workspace"] [aria-label="${label}"]`).first().click()
    await click('APPS')
    await wait(500)
    const r1 = await read()
    v.push(r1.drawerW === 0 && r1.lit.length === 0 ? pass('desktop', 'clicking the lit seat collapses the drawer', `${r1.drawerW}px`) : fail('desktop', 'clicking the lit seat collapses the drawer', JSON.stringify(r1)))
    await click('JOBS')
    await wait(500)
    const r2 = await read()
    v.push(r2.drawerW === 248 && /running work/i.test(r2.heading) && r2.lit.join(',') === 'JOBS' && /tab=jobs/.test(r2.url) ? pass('desktop', 'JOBS opens the drawer on Running work, lit, ?tab=jobs', r2.url) : fail('desktop', 'JOBS opens the drawer on Running work, lit, ?tab=jobs', JSON.stringify(r2)))
    await click('LINKS')
    await wait(800)
    const r3 = await read()
    const studio = await page.locator('main .linkstudio, main h1').filter({ hasText: /links|board/i }).count()
    v.push(r3.drawerW === 248 && /intent links/i.test(r3.heading) && /tab=links/.test(r3.url) && studio > 0 ? pass('desktop', 'LINKS opens the drawer on Intent links AND the main screen shows the links view', `${r3.url} studio=${studio}`) : fail('desktop', 'LINKS opens the drawer on Intent links AND the main screen shows the links view', JSON.stringify({ ...r3, studio })))
    await click('CHATS')
    await wait(500)
    const r4 = await read()
    v.push(r4.drawerW === 248 && /chat history/i.test(r4.heading) && /tab=chats/.test(r4.url) ? pass('desktop', 'CHATS opens the drawer on Chat history', r4.url) : fail('desktop', 'CHATS opens the drawer on Chat history', JSON.stringify(r4)))
    const errs = (page as any).__errors ?? []
    v.push(errs.length === 0 ? pass('desktop', 'no page errors', '0') : fail('desktop', 'no page errors', errs.join(' | ').slice(0, 300)))
    return v
  },
}

/** Signed out on the public /markets (no wallet, no session): every seat into
 *  the signed-in app opens the unified sign-in door AIMED at that seat's
 *  target, in both postures, and never bounces the visitor home. The
 *  desktop column and the phone bar each route through ONE openDoorFor. */
const rowDoor: NavScenario = {
  row: 'door',
  name: 'signed out on /markets: every seat into the app opens the door, aimed, in both postures',
  async run(ctx) {
    const v: Verdict[] = []
    const readDoor = (page: any) =>
      page.evaluate(() => ({
        path: location.pathname + location.search,
        door: document.querySelectorAll('[data-sheet="door"]').length,
        aim: (document.querySelector('[data-spine-door-to]') as HTMLElement | null)?.getAttribute('data-spine-door-to') ?? null,
      }))
    const openMarkets = async (desktop: boolean) => {
      const page = await ctx.open({ wallet: false, desktop })
      await page.goto(`${ctx.base}/markets`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => !!document.querySelector('nav[data-spine-bar], aside[aria-label="Workspace"]'), { timeout: 15_000 }).catch(() => {})
      // The session settles to guest and wagmi to disconnected (no remembered
      // wallet): the spine now knows this visitor is signed out.
      await wait(3_000)
      return page
    }
    const judge = (posture: string, label: string, href: string, r: { path: string; door: number; aim: string | null }) =>
      v.push(
        r.path === '/markets' && r.door > 0 && r.aim === href
          ? pass('door', `${posture}: ${label} opens the door aimed at ${href}, stays on /markets`, JSON.stringify(r))
          : fail('door', `${posture}: ${label} opens the door aimed at ${href}, stays on /markets`, JSON.stringify(r)),
      )
    // 1440: the column's seats (the desktop drawer tabs use the desktop tab
    // grammar: APPS is the default and writes a bare /chat).
    for (const [label, href] of [
      ['APPS', '/chat'],
      ['JOBS', '/chat?tab=jobs'],
      ['LINKS', '/chat?tab=links'],
      ['CHATS', '/chat?tab=chats'],
      ['WALLET', '/wallet'],
      ['Settings', '/dashboard'],
    ] as const) {
      const page = await openMarkets(true)
      await page.locator(`aside[aria-label="Workspace"] [aria-label="${label}"]`).first().click()
      await wait(900)
      judge('1440 column', label, href, await readDoor(page))
      if (label === 'APPS') await ctx.shot(page, 'door-desktop-apps')
      await page.context().close()
    }
    // 375: the bar's seats (the phone grammar names APPS explicitly).
    for (const [label, href] of [
      ['APPS', '/chat?tab=mcps'],
      ['JOBS', '/chat?tab=jobs'],
      ['LINKS', '/chat?tab=links'],
      ['CHATS', '/chat?tab=chats'],
      ['WALLET', '/wallet'],
    ] as const) {
      const page = await openMarkets(false)
      await tapSeat(page, label)
      await wait(900)
      judge(`${ctx.profile.width} bar`, label, href, await readDoor(page))
      if (label === 'APPS') await ctx.shot(page, 'door-phone-apps')
      await page.context().close()
    }
    // 375: the seats behind MORE (Settings, and Team while the roster is on).
    for (const [item, href] of [
      ['Settings', '/dashboard'],
      ['Team', '/chat?tab=team'],
    ] as const) {
      const page = await openMarkets(false)
      if (!(await tapSeat(page, 'More'))) {
        v.push(note('door', `MORE is not on this bar (≥sm) — ${item} skipped`, 'skipped'))
        await page.context().close()
        continue
      }
      await wait(500)
      const entry = page.locator('.sheet[data-sheet="more"] [role="menuitem"]').filter({ hasText: item }).first()
      if ((await entry.count()) === 0) {
        v.push(note('door', `MORE has no ${item} entry in this build`, 'skipped'))
        await page.context().close()
        continue
      }
      await entry.tap()
      await wait(900)
      const r = await readDoor(page)
      judge(`${ctx.profile.width} MORE`, item, href, r)
      await page.context().close()
    }
    return v
  },
}

export const NATIVE_NAV_SCENARIOS: NavScenario[] = [rowMatrix, rowContract, rowDesktop, rowDoor]

// ── runner ───────────────────────────────────────────────────────────────
function arg(name: string, dflt: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

export async function main(): Promise<number> {
  const base = arg('base', 'http://localhost:3892')
  const tag = arg('tag', 'run')
  const rows = arg('rows', 'matrix,contract,desktop,door').split(',')
  const profiles = arg('profiles', 'small,pixel').split(',')
  const themes = arg('themes', 'dark').split(',') as Array<'dark' | 'light'>
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await pw.chromium.launch({ executablePath: chrome, headless: true })
  const all: Array<Verdict & { profile: string; theme: string }> = []
  try {
    for (const theme of themes) {
      for (const pid of profiles) {
        const profile = PROFILES[pid]
        if (!profile) throw new Error(`unknown profile ${pid}`)
        for (const sc of NATIVE_NAV_SCENARIOS) {
          if (!rows.includes(sc.row)) continue
          if ((sc.row === 'desktop' || sc.row === 'door') && pid !== profiles[0]) continue
          const ctx = await makeCtx(browser, base, tag, profile, theme)
          console.log(`\n── ${sc.row} · ${sc.name} · ${profile.id} ${profile.width}×${profile.height} · ${theme}`)
          try {
            const verdicts = await sc.run(ctx)
            for (const vd of verdicts) {
              const mark = vd.note ? '·' : vd.ok ? '✅' : '❌'
              console.log(`${mark} ${vd.check} — ${vd.detail}`)
              all.push({ ...vd, profile: profile.id, theme })
            }
          } catch (e) {
            console.log(`❌ ${sc.row} crashed — ${(e as Error).message.split('\n')[0]}`)
            all.push({ row: sc.row, check: `${sc.row} crashed`, ok: false, detail: (e as Error).message.split('\n')[0], profile: profile.id, theme })
          } finally {
            await ctx.close()
          }
        }
      }
    }
  } finally {
    await browser.close()
  }
  const failed = all.filter((x) => !x.ok && !x.note)
  const passed = all.filter((x) => x.ok && !x.note)
  mkdirSync(NAV_SHOT_DIR, { recursive: true })
  writeFileSync(path.join(NAV_SHOT_DIR, `verdicts-${tag}.json`), JSON.stringify(all, null, 2))
  console.log(`\n${passed.length} passed / ${failed.length} failed (${all.filter((x) => x.note).length} measurements) — ${tag}`)
  return failed.length === 0 ? 0 : 1
}

// The harness may import this file for its scenarios: only run as a script.
if (process.argv[1] && /drive-native-nav\.ts$/.test(process.argv[1])) {
  main().then((code) => process.exit(code))
}
