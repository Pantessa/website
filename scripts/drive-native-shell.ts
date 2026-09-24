#!/usr/bin/env tsx
/**
 * The SHELL lane's structural proof (squad mobile-native, 2026-09-24).
 *
 * Invariant 1: on a phone the spine's tab bar never moves, because the
 * document never scrolls. Playwright's WebKit and Chrome cannot collapse a
 * Safari toolbar or raise a soft keyboard, so the proof is STRUCTURAL:
 *
 *   - `document.scrollingElement.scrollHeight <= innerHeight + 1`
 *   - after scrolling the frame's ONE scroller to its top, middle and end,
 *     `scrollingElement.scrollTop === 0` and the bar's rect bottom is the
 *     viewport bottom, `elementFromPoint(x, innerHeight − 10)` is in the bar,
 *     `scrollWidth === clientWidth`, and the scroller's last row clears the bar
 *   - the sticky strips inside the scroller still stick (rect top after a scroll)
 *   - at 1440 and 1024 the rects of the spine column, the frame and the rails
 *     are byte-identical to the BEFORE baseline
 *
 * Usage (a `next start` on BASE, never the dev server):
 *   BASE=http://localhost:3891 npx tsx scripts/drive-native-shell.ts --mode=before --out=<baseline.json>
 *   BASE=http://localhost:3891 npx tsx scripts/drive-native-shell.ts --mode=after --baseline=<baseline.json> [--shots=<dir>]
 *   … [--only=markets,t,wallet,dashboard] [--engines=webkit,chrome] [--no-desktop]
 *
 * `before` RECORDS (the document's scroll, where the bar sits, the desktop
 * rects) and never fails; `after` ASSERTS the invariant and diffs the desktop
 * rects against the baseline. Read-only: every same-origin request wears
 * `x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`, the mock wallet refuses
 * every signature except SIWE (a session cookie is the only way onto
 * /dashboard, and a SIWE signature moves no money).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { burnerAddress, envLocal, mockWalletScript, rememberConnectorScript, signSiweWithBurner } from './drive-mobile-contract'

const BASE = process.env.BASE ?? 'http://localhost:3891'
const ARGS = process.argv.slice(2)
const arg = (name: string) => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
const MODE = (arg('mode') || 'after') as 'before' | 'after'
const OUT = arg('out')
const BASELINE = arg('baseline')
/** --just-inputs: only the input-size read per surface (no frame probe). */
const JUST_INPUTS = ARGS.includes('--just-inputs')
const SHOTS = arg('shots')
const ONLY = arg('only') ? arg('only').split(',') : []
const ENGINES = arg('engines') ? arg('engines').split(',') : ['webkit', 'chrome']
const DESKTOP = !ARGS.includes('--no-desktop')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pw = any
const require = createRequire('/Users/nategeier/anchor.js')
const pw = require('playwright-core')
const { webkit, chromium, devices } = pw
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

type Surface = { id: string; path: string; frame: string; scroller: string; sticky: string | null; needsSession: boolean; needsWallet: boolean }
const SURFACES: Surface[] = [
  { id: 'markets', path: '/markets', frame: '.mkt-shell', scroller: '.mkt-frame', sticky: '.mkt-frame__top', needsSession: false, needsWallet: false },
  { id: 't', path: '/t/AAPL', frame: '.mkt-shell', scroller: '.mkt-frame', sticky: '.mkt-frame__top', needsSession: false, needsWallet: false },
  { id: 'wallet', path: '/wallet', frame: '[data-shell="wallet"]', scroller: '[data-shell="wallet"] > [data-app-scroll]', sticky: null, needsSession: false, needsWallet: true },
  // The dashboard's phone section bar (.dashnav__bar) was never sticky on main
  // (F2: it sits in a block its own height) — PAGES' fix; not asserted here.
  { id: 'dashboard', path: '/dashboard', frame: '.dashshell', scroller: '.dash', sticky: null, needsSession: true, needsWallet: true },
]

type Profile = { id: string; engine: 'webkit' | 'chrome'; device: string; viewport?: { width: number; height: number }; phone: boolean }
// WebKit: playwright-core 1.60 wants webkit-2287; only webkit-1578 is cached
// on this Mac and its protocol no longer matches (Emulation.setOrientation-
// Override / Page.overrideUserPreference missing — measured 2026-09-24). The
// webkit profiles SKIP with a note until `npx playwright install webkit` runs
// (a ~90 MB download, an owner step); the iPhone-UA Chrome profile stands in
// for the engine-agnostic structural proof meanwhile.
const PROFILES: Profile[] = [
  { id: 'webkit-iphone13-390', engine: 'webkit', device: 'iPhone 13', phone: true },
  { id: 'webkit-375', engine: 'webkit', device: 'iPhone 13', viewport: { width: 375, height: 812 }, phone: true },
  { id: 'chrome-iphone13-ua-390', engine: 'chrome', device: 'iPhone 13', viewport: { width: 390, height: 664 }, phone: true },
  { id: 'chrome-iphone-ua-375', engine: 'chrome', device: 'iPhone 13', viewport: { width: 375, height: 812 }, phone: true },
  { id: 'chrome-pixel7-412', engine: 'chrome', device: 'Pixel 7', phone: true },
  { id: 'chrome-360', engine: 'chrome', device: 'Pixel 7', viewport: { width: 360, height: 780 }, phone: true },
  { id: 'chrome-1440', engine: 'chrome', device: '', viewport: { width: 1440, height: 900 }, phone: false },
  { id: 'chrome-1024', engine: 'chrome', device: '', viewport: { width: 1024, height: 768 }, phone: false },
]

type Verdict = { profile: string; surface: string; name: string; ok: boolean; detail: string }
const verdicts: Verdict[] = []
const record: Record<string, unknown> = {}
function note(profile: string, surface: string, name: string, ok: boolean, detail = '') {
  verdicts.push({ profile, surface, name, ok, detail })
  const mark = MODE === 'before' ? '·' : ok ? '✅' : '❌'
  console.log(`${mark} [${profile}] ${surface} — ${name}${detail ? ` — ${detail}` : ''}`)
}

async function siweCookie(): Promise<string> {
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[0]).find(Boolean)
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const { createSiweMessage } = await import('viem/siwe')
  const address = (await burnerAddress()) as `0x${string}`
  const message = createSiweMessage({ address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await signSiweWithBurner(message)
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = (res.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
  if (!session) throw new Error(`SIWE failed (${res.status})`)
  return session
}

/** The page-side probe. Runs inside the browser: no closures over node. */
const PROBE = `(async (args) => {
  const { frameSel, scrollerSel, stickySel, positions } = args
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top * 100) / 100, bottom: Math.round(r.bottom * 100) / 100, left: Math.round(r.left * 100) / 100, right: Math.round(r.right * 100) / 100, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 } }
  const se = document.scrollingElement
  const bar = document.querySelector('[data-spine-bar]')
  const frame = document.querySelector('[data-app-frame]') || document.querySelector(frameSel)
  const scroller = document.querySelector('[data-app-scroll]') || document.querySelector(scrollerSel)
  const sticky = stickySel ? document.querySelector(stickySel) : null
  const pill = document.querySelector('.askdoor-pill')
  const out = {
    innerHeight: innerHeight, innerWidth: innerWidth,
    docScrollHeight: se.scrollHeight, docClientHeight: se.clientHeight, docScrollWidth: se.scrollWidth, docClientWidth: se.clientWidth,
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY, bodyOverflowY: getComputedStyle(document.body).overflowY,
    frameAttr: !!document.querySelector('[data-app-frame]'), scrollAttr: !!document.querySelector('[data-app-scroll]'),
    barFound: !!bar, barParentIsFrame: !!bar && !!frame && bar.parentElement === frame, barPosition: bar ? getComputedStyle(bar).position : null,
    barRectAtTop: rect(bar), frameRect: rect(frame), scrollerRect: rect(scroller), pillRect: rect(pill),
    scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : null,
    scrollerScrollHeight: scroller ? scroller.scrollHeight : null, scrollerClientHeight: scroller ? scroller.clientHeight : null,
    scrollerScrollWidth: scroller ? scroller.scrollWidth : null, scrollerClientWidth: scroller ? scroller.clientWidth : null,
    steps: [],
    docScrollTest: null,
  }
  // BEFORE-style: try to scroll the DOCUMENT and see if it moves. A first
  // reading that moves gets a second try after a beat: a section landing in
  // that very frame can read as document overflow for one layout.
  const docTest = async () => {
    window.scrollTo(0, 700); await raf()
    const t = { asked: 700, scrollY: Math.round(window.scrollY), docScrollHeight: se.scrollHeight, barBottom: bar ? rect(bar).bottom : null, stickyTop: sticky ? rect(sticky).top : null, atBottom: (() => { const el = document.elementFromPoint(Math.round(innerWidth / 2), innerHeight - 10); return el ? (el.closest('[data-spine-bar]') ? 'bar' : (el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''))) : null })() }
    window.scrollTo(0, 0); await raf()
    return t
  }
  out.docScrollTest = await docTest()
  if (out.docScrollTest.scrollY !== 0) { await new Promise((r) => setTimeout(r, 900)); out.docScrollTest = { ...(await docTest()), retried: true }; out.docScrollHeight = se.scrollHeight }
  if (scroller && (getComputedStyle(scroller).overflowY === 'auto' || getComputedStyle(scroller).overflowY === 'scroll')) {
    for (const p of positions) {
      let max = scroller.scrollHeight - scroller.clientHeight
      let target = p === 'top' ? 0 : p === 'mid' ? Math.round(max / 2) : max
      scroller.scrollTop = target; await raf()
      if (p === 'end') { for (let i = 0; i < 4 && scroller.scrollHeight - scroller.clientHeight !== max; i++) { max = scroller.scrollHeight - scroller.clientHeight; target = max; scroller.scrollTop = target; await raf(); await new Promise((r) => setTimeout(r, 150)) } }
      const at = document.elementFromPoint(Math.round(innerWidth / 2), innerHeight - 10)
      const last = scroller.lastElementChild
      out.steps.push({
        pos: p, target, scrollTop: scroller.scrollTop, docScrollTop: se.scrollTop, scrollY: Math.round(window.scrollY),
        barRect: rect(bar), scrollerRect: rect(scroller), stickyTop: sticky ? rect(sticky).top : null,
        atBottom: at ? (at.closest('[data-spine-bar]') ? 'bar' : at.tagName) : null,
        docScrollWidth: se.scrollWidth, docClientWidth: se.clientWidth, scrollerScrollWidth: scroller.scrollWidth, scrollerClientWidth: scroller.clientWidth,
        lastChildBottom: last ? rect(last).bottom : null, reachedEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      })
    }
    scroller.scrollTop = 0; await raf()
  }
  return out
})`

const DESKTOP_PROBE = `(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const se = document.scrollingElement
  return {
    spine: rect('aside[aria-label="Workspace"]'), bar: rect('[data-spine-bar]'), barDisplay: (() => { const b = document.querySelector('[data-spine-bar]'); return b ? getComputedStyle(b).display : null })(),
    mktShell: rect('.mkt-shell'), mktFrame: rect('.mkt-frame'), mktTop: rect('.mkt-frame__top'), mktRail: rect('.mkt-frame__rail'), mktBar: rect('.mkt-frame__bar'), mktMain: rect('.mkt-frame__main'), sym: rect('.sym'),
    walletShell: rect('[data-shell="wallet"]'), walletMain: rect('[data-shell="wallet"] main'),
    dashshell: rect('.dashshell'), dash: rect('.dash'), dashRail: rect('.dash__rail'), dashMain: rect('.dash__main'), dashask: rect('.dashask'),
    docScrollHeight: se.scrollHeight, innerHeight, htmlOverflowY: getComputedStyle(document.documentElement).overflowY, bodyOverflowY: getComputedStyle(document.body).overflowY,
    frameAttr: !!document.querySelector('[data-app-frame]'), scrollerOverflowY: (() => { const s = document.querySelector('[data-app-scroll]'); return s ? getComputedStyle(s).overflowY : null })(),
  }
})`

async function settle(page: Pw, surface: Surface) {
  // Hydration + the first data paint. Markets: the boards; /t: the chart
  // canvas; /wallet: the details or the door; /dashboard: the main column.
  const sel = surface.id === 't' ? '.sym__chart canvas, .sym' : surface.id === 'wallet' ? '[data-wallet-door], [data-wallet-chains], [data-shell="wallet"] main h1' : surface.id === 'dashboard' ? '.dash__main' : '.mk-board, .mkt-frame__data'
  await page.waitForSelector(sel, { timeout: 45_000 }).catch(() => {})
  // The dashboard and the wallet keep landing sections after first paint
  // (activity, links, the feed): a measurement taken mid-landing reads a
  // stale scrollHeight. Wait for the network to go quiet, then a beat.
  if (surface.id === 'dashboard' || surface.id === 'wallet') await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(surface.id === 'markets' || surface.id === 't' ? 2500 : 2200)
}

async function runProfile(profile: Profile, session: string | null, burner: string) {
  const isWebkit = profile.engine === 'webkit'
  let browser: Pw
  try {
    browser = isWebkit ? await webkit.launch() : await chromium.launch({ executablePath: CHROME, headless: true })
  } catch (e) {
    note(profile.id, '*', `skipped: ${profile.engine} could not launch (${String(e).split('\n')[0].slice(0, 90)})`, true)
    return
  }
  try {
    for (const surface of SURFACES) {
      if (ONLY.length && !ONLY.includes(surface.id)) continue
      if (surface.needsSession && !session) {
        note(profile.id, surface.id, 'skipped: no session cookie', MODE === 'before')
        continue
      }
      const { defaultBrowserType: _dbt, ...dev } = profile.device ? devices[profile.device] : { defaultBrowserType: undefined }
      void _dbt
      const ctx: Pw = await browser.newContext({
        ...dev,
        ...(profile.viewport ? { viewport: profile.viewport } : {}),
        ...(profile.phone ? {} : { isMobile: false, hasTouch: false, deviceScaleFactor: 1 }),
        colorScheme: 'dark',
        extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
      })
      const errs: string[] = []
      try {
        if (surface.needsWallet) {
          await ctx.exposeFunction('__driveSignSiwe', (raw: string) => signSiweWithBurner(raw))
          await ctx.addInitScript(mockWalletScript({ address: burner, siweBridge: true }))
          await ctx.addInitScript(rememberConnectorScript())
        }
        if (surface.needsSession && session) await ctx.addCookies([{ name: 'yf_session', value: session, domain: new URL(BASE).hostname, path: '/' }])
        const page: Pw = await ctx.newPage()
        page.on('pageerror', (e: unknown) => errs.push(String(e)))
        page.on('console', (m: Pw) => {
          if (m.type() === 'error' && !/favicon|401|403|429|Failed to load resource|net::|ERR_|CORS|api\.cdp\.coinbase|walletconnect|WebSocket|hydrat/i.test(m.text())) errs.push(m.text())
        })
        await page.goto(`${BASE}${surface.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await settle(page, surface)
        if (surface.needsSession) {
          const onDash = await page.evaluate(`location.pathname`)
          if (!String(onDash).startsWith('/dashboard')) {
            note(profile.id, surface.id, 'signed-in dashboard rendered (the gate did not bounce)', false, `landed on ${onDash}`)
            continue
          }
        }
        const key = `${profile.id}:${surface.id}`
        if (profile.phone && JUST_INPUTS) {
          record[key] = {}
          const READ = `(() => Array.from(document.querySelectorAll('[data-app-frame] input, [data-app-frame] textarea, [data-app-frame] select')).filter((el) => !['checkbox','radio','range','file','color','hidden'].includes(el.type || '')).map((el) => ({ label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.tagName.toLowerCase()).slice(0, 40), fontSize: getComputedStyle(el).fontSize, rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })() })))()`
          const TOGGLE = `((on) => { let hit = 0; for (const ss of Array.from(document.styleSheets)) { let rules; try { rules = ss.cssRules } catch { continue } for (const r of Array.from(rules)) { const walk = (rule) => { if (rule.cssRules) Array.from(rule.cssRules).forEach(walk); if (rule.selectorText && /\\[data-app-frame\\] input/.test(rule.selectorText) && rule.style && (on || rule.style.fontSize)) { hit++; if (on) rule.style.setProperty('font-size', 'max(16px, 1em)'); else rule.style.removeProperty('font-size') } }; walk(r) } } return hit })`
          const hit = (await page.evaluate(`(${TOGGLE})(false)`)) as number
          const before = (await page.evaluate(READ)) as { label: string; fontSize: string; rect: number[] }[]
          await page.evaluate(`(${TOGGLE})(true)`)
          const after = (await page.evaluate(READ)) as { label: string; fontSize: string; rect: number[] }[]
          const moved = after.map((i, n) => { const b = before[n]; return b && (b.rect[0] !== i.rect[0] || b.rect[1] !== i.rect[1] || b.fontSize !== i.fontSize) ? `${i.label}: ${b.fontSize} ${b.rect[0]}×${b.rect[1]} → ${i.fontSize} ${i.rect[0]}×${i.rect[1]}` : null }).filter(Boolean)
          note(profile.id, surface.id, `inputs (rule ${hit > 0 ? 'found' : 'MISSING'}): ${after.length}; changed by the ≥16px rule: ${moved.length}`, hit > 0, moved.join(' · ') || after.map((i) => `${i.label} ${i.fontSize} ${i.rect[0]}×${i.rect[1]}`).join(' · '))
          continue
        }
        if (profile.phone) {
          const m = (await page.evaluate(`(${PROBE})(${JSON.stringify({ frameSel: surface.frame, scrollerSel: surface.scroller, stickySel: surface.sticky, positions: ['top', 'mid', 'end'] })})`)) as Record<string, unknown> & { steps: Record<string, unknown>[]; docScrollTest: Record<string, unknown> }
          record[key] = m
          const ih = m.innerHeight as number
          const docScrolls = (m.docScrollHeight as number) > ih + 1
          const dt = m.docScrollTest
          if (MODE === 'before') {
            note(profile.id, surface.id, `document ${m.docScrollHeight}px tall in a ${ih}px viewport → scrolls ${docScrolls ? 'YES' : 'no'}; after scrollTo(0,700) scrollY=${dt.scrollY}, bar bottom ${dt.barBottom} (viewport ${ih}), under the bar's spot: ${dt.atBottom}, sticky top ${dt.stickyTop}`, true)
          } else {
            note(profile.id, surface.id, 'the document never scrolls (scrollHeight ≤ innerHeight + 1)', !docScrolls, `${m.docScrollHeight} vs ${ih}`)
            note(profile.id, surface.id, 'scrollTo(0, 700) on the window moves nothing', dt.scrollY === 0, `scrollY ${dt.scrollY}`)
            note(profile.id, surface.id, 'the frame + scroller attributes are present and the scroller scrolls', !!m.frameAttr && !!m.scrollAttr && (m.scrollerOverflowY === 'auto' || m.scrollerOverflowY === 'scroll'), `overflow-y ${m.scrollerOverflowY}`)
            note(profile.id, surface.id, 'the bar is a direct child of the frame, in flow (static), not fixed', !!m.barParentIsFrame && m.barPosition === 'static', `parent-is-frame ${m.barParentIsFrame}, position ${m.barPosition}`)
            note(profile.id, surface.id, 'no horizontal scroll on the document or the scroller', m.docScrollWidth === m.docClientWidth && m.scrollerScrollWidth === m.scrollerClientWidth, `doc ${m.docScrollWidth}/${m.docClientWidth}, scroller ${m.scrollerScrollWidth}/${m.scrollerClientWidth}`)
            const steps = m.steps
            note(profile.id, surface.id, 'the scroller has content to scroll (top/mid/end are three positions)', steps.length === 3 && (steps[2].target as number) > 0, steps.map((s) => `${s.pos}@${s.scrollTop}`).join(' '))
            for (const s of steps) {
              const br = s.barRect as { top: number; bottom: number } | null
              const sr = s.scrollerRect as { bottom: number } | null
              note(profile.id, surface.id, `at ${s.pos}: the document stays at 0 and the bar's bottom is the viewport bottom`, s.docScrollTop === 0 && s.scrollY === 0 && !!br && Math.abs(br.bottom - ih) <= 1, `doc ${s.docScrollTop}, bar bottom ${br?.bottom} vs ${ih}`)
              note(profile.id, surface.id, `at ${s.pos}: elementFromPoint(x, innerHeight − 10) is the bar`, s.atBottom === 'bar', String(s.atBottom))
              note(profile.id, surface.id, `at ${s.pos}: the scroller ends where the bar begins (nothing scrolls under it)`, !!br && !!sr && sr.bottom <= br.top + 1, `scroller bottom ${sr?.bottom}, bar top ${br?.top}`)
              if (surface.sticky) note(profile.id, surface.id, `at ${s.pos}: the sticky strip ${surface.sticky} sticks to the scroller's top`, s.stickyTop !== null && Math.abs((s.stickyTop as number) - (m.scrollerRect as { top: number }).top) <= 1, `top ${s.stickyTop} vs scroller top ${(m.scrollerRect as { top: number }).top}`)
            }
            const end = steps[2]
            if (end) note(profile.id, surface.id, 'at end: the last row is fully above the bar (reachedEnd + lastChild bottom ≤ bar top)', !!end.reachedEnd && (end.lastChildBottom as number) <= ((end.barRect as { top: number }).top + 1), `last ${end.lastChildBottom}, bar top ${(end.barRect as { top: number }).top}`)
            const pr = m.pillRect as { bottom: number } | null
            const br0 = m.barRectAtTop as { top: number } | null
            if (pr && br0) note(profile.id, surface.id, 'the ask pill floats above the bar, never over it', pr.bottom <= br0.top + 1, `pill bottom ${pr.bottom}, bar top ${br0.top}`)
          }
          // Inputs: every text field inside the frame, its font size (iOS zooms
          // under 16px). The BEFORE size is read on this same build with the
          // frame's own ≥16px rule switched OFF (a same-origin stylesheet rule
          // can be edited in place), then the rule goes back on and the AFTER
          // size is read, so the drive lists exactly which boxes the rule grew.
          const READ_INPUTS = `(() => Array.from(document.querySelectorAll('[data-app-frame] input, [data-app-frame] textarea, [data-app-frame] select')).filter((el) => !['checkbox','radio','range','file','color','hidden'].includes(el.type || '')).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type || '', label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '').slice(0, 40), fontSize: getComputedStyle(el).fontSize, rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })() })))()`
          const TOGGLE_RULE = `((on) => { let hit = 0; for (const ss of Array.from(document.styleSheets)) { let rules; try { rules = ss.cssRules } catch { continue } for (const r of Array.from(rules)) { const walk = (rule) => { if (rule.cssRules) Array.from(rule.cssRules).forEach(walk); if (rule.selectorText && /\\[data-app-frame\\] input/.test(rule.selectorText) && rule.style && (on || rule.style.fontSize)) { hit++; if (on) rule.style.setProperty('font-size', 'max(16px, 1em)'); else rule.style.removeProperty('font-size') } }; walk(r) } } return hit })`
          type InputRead = { tag: string; type: string; label: string; fontSize: string; rect: number[] }
          const ruleOff = (await page.evaluate(`(${TOGGLE_RULE})(false)`)) as number
          const inputsBefore = (await page.evaluate(READ_INPUTS)) as InputRead[]
          await page.evaluate(`(${TOGGLE_RULE})(true)`)
          const inputs = (await page.evaluate(READ_INPUTS)) as InputRead[]
          ;(record[key] as Record<string, unknown>).inputs = inputs
          ;(record[key] as Record<string, unknown>).inputsBefore = inputsBefore
          if (MODE === 'before') note(profile.id, surface.id, `inputs: ${inputs.length} (${inputs.map((i) => `${i.label || i.tag} ${i.fontSize} ${i.rect[2]}×${i.rect[3]}`).join(' · ')})`, true)
          else {
            const small = inputs.filter((i) => parseFloat(i.fontSize) < 16)
            note(profile.id, surface.id, 'every text input inside the frame is ≥16px (no iOS focus zoom)', small.length === 0, small.map((i) => `${i.label || i.tag} ${i.fontSize}`).join(' · ') || `${inputs.length} inputs`)
            const moved = inputs.map((i, n) => { const b = inputsBefore[n]; return b && (b.rect[2] !== i.rect[2] || b.rect[3] !== i.rect[3] || b.fontSize !== i.fontSize) ? `${i.label || i.tag}: ${b.fontSize} ${b.rect[2]}×${b.rect[3]} → ${i.fontSize} ${i.rect[2]}×${i.rect[3]}` : null }).filter(Boolean)
            note(profile.id, surface.id, `inputs the ≥16px rule changed (rule found ${ruleOff > 0 ? 'yes' : 'NO'}; listed, not failed): ${moved.length}`, ruleOff > 0, moved.join(' · ') || 'none moved')
          }
          if (MODE === 'after' && surface.id === 't') {
            // MARKETS' fence: the scroller and every ancestor up to the frame must
            // not become a containing block for fixed descendants (`.tchart--expanded`
            // is `position: fixed; inset: 0` inside .mkt-frame) — no transform,
            // filter, backdrop-filter, perspective, contain, container-type or
            // will-change:transform on that chain; and the nearest scrolling
            // ancestor of the sticky tab strip is the frame's scroller.
            const cb = (await page.evaluate(`(() => {
              const chart = document.querySelector('.tchart') || document.querySelector('.sym')
              const frame = document.querySelector('[data-app-frame]')
              const bad = []
              let el = chart ? chart.parentElement : null
              while (el && el !== frame.parentElement) {
                const c = getComputedStyle(el)
                const hits = []
                if (c.transform !== 'none') hits.push('transform')
                if (c.filter !== 'none') hits.push('filter')
                if ((c.backdropFilter || 'none') !== 'none') hits.push('backdrop-filter')
                if (c.perspective !== 'none') hits.push('perspective')
                if (c.contain !== 'none') hits.push('contain:' + c.contain)
                if ((c.containerType || 'normal') !== 'normal') hits.push('container-type:' + c.containerType)
                if (/transform|filter|perspective/.test(c.willChange)) hits.push('will-change:' + c.willChange)
                if (hits.length) bad.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.')) + '[' + hits.join(',') + ']')
                el = el.parentElement
              }
              const tabs = document.querySelector('.sym__tabs')
              let sc = tabs ? tabs.parentElement : null
              while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if (o === 'auto' || o === 'scroll') break; sc = sc.parentElement }
              return { chart: !!chart, bad, tabsScroller: sc ? (sc.hasAttribute('data-app-scroll') ? 'frame-scroller' : sc.tagName + '.' + String(sc.className).slice(0, 30)) : null }
            })()`)) as { chart: boolean; bad: string[]; tabsScroller: string | null }
            note(profile.id, surface.id, 'no containing block between .tchart and the frame (the full-screen chart stays fixed to the viewport): no transform/filter/backdrop-filter/perspective/contain/container-type/will-change on the chain', cb.chart && cb.bad.length === 0, cb.bad.join(' ') || 'clean chain')
            note(profile.id, surface.id, 'the sticky .sym__tabs strip\'s nearest scrolling ancestor is the frame\'s scroller (.mkt-frame)', cb.tabsScroller === 'frame-scroller', String(cb.tabsScroller))
          }
          if (MODE === 'after' && surface.id === 'markets') {
            // theme-color follows the SITE theme, both directions.
            const tc = (await page.evaluate(`(async () => {
              const wait = () => new Promise((r) => setTimeout(r, 60))
              const meta = () => { const m = document.querySelector('meta[name="theme-color"]:not([media])'); return m ? [m.getAttribute('content'), m === document.head.firstElementChild] : null }
              const norm = (c) => { c = c.trim().toLowerCase(); return /^#[0-9a-f]{3}$/.test(c) ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c }
              const bg = () => norm(getComputedStyle(document.documentElement).getPropertyValue('--bg'))
              const out = { start: meta(), startBg: bg() }
              // The way ThemeToggle flips: the stored choice first, then the attribute (the bootstrap's observer re-derives from storage/OS).
              localStorage.setItem('yf-theme', 'light'); document.documentElement.dataset.theme = 'light'; await wait(); out.light = meta(); out.lightBg = bg()
              localStorage.setItem('yf-theme', 'dark'); document.documentElement.dataset.theme = 'dark'; await wait(); out.dark = meta(); out.darkBg = bg()
              localStorage.removeItem('yf-theme')
              return out
            })()`)) as { start: [string, boolean] | null; light: [string, boolean] | null; dark: [string, boolean] | null; lightBg: string; darkBg: string }
            note(profile.id, surface.id, 'theme-color follows data-theme both ways and matches --bg (light #fdfdfc, dark #000000), and the media-less meta is first in <head>', !!tc.light && !!tc.dark && tc.light[0] === '#fdfdfc' && tc.dark[0] === '#000000' && tc.light[1] && tc.dark[1] && tc.lightBg === '#fdfdfc' && tc.darkBg === '#000000' && tc.light[0] === tc.lightBg && tc.dark[0] === tc.darkBg, JSON.stringify(tc))
            // The keyboard contract: a pretend keyboard (visualViewport shrunk by
            // 312px) sets html[data-keyboard] + --kb-inset, shrinks the frame onto
            // it, hides the bar; closing it restores everything.
            const kb = (await page.evaluate(`(async () => {
              const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
              const vv = window.visualViewport
              const H = innerHeight
              const frame = document.querySelector('[data-app-frame]')
              const bar = document.querySelector('[data-spine-bar]')
              const rect = (el) => Math.round(el.getBoundingClientRect().bottom)
              const before = { kb: document.documentElement.hasAttribute('data-keyboard'), frameBottom: rect(frame), barDisplay: getComputedStyle(bar).display }
              Object.defineProperty(vv, 'height', { configurable: true, get: () => H - 312 })
              Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
              vv.dispatchEvent(new Event('resize')); await raf(); await new Promise((r) => setTimeout(r, 80)); await raf()
              const up = { kb: document.documentElement.getAttribute('data-keyboard'), inset: document.documentElement.style.getPropertyValue('--kb-inset'), frameBottom: rect(frame), barDisplay: getComputedStyle(bar).display }
              Object.defineProperty(vv, 'height', { configurable: true, get: () => H })
              vv.dispatchEvent(new Event('resize')); await raf(); await new Promise((r) => setTimeout(r, 400)); await raf()
              const down = { kb: document.documentElement.hasAttribute('data-keyboard'), inset: document.documentElement.style.getPropertyValue('--kb-inset'), frameBottom: rect(frame), barDisplay: getComputedStyle(bar).display }
              return { H, before, up, down }
            })()`)) as { H: number; before: { kb: boolean; frameBottom: number; barDisplay: string }; up: { kb: string | null; inset: string; frameBottom: number; barDisplay: string }; down: { kb: boolean; inset: string; frameBottom: number; barDisplay: string } }
            note(profile.id, surface.id, 'keyboard up (visualViewport −312px): html[data-keyboard]=1, --kb-inset 312px, the frame bottom sits on the keyboard (innerHeight − 312) and the bar is display:none', kb.up.kb === '1' && kb.up.inset === '312px' && kb.up.frameBottom === kb.H - 312 && kb.up.barDisplay === 'none', JSON.stringify(kb.up))
            note(profile.id, surface.id, 'keyboard down: the attribute clears, the inset is 0, the frame and the bar are back', !kb.down.kb && kb.down.inset === '0px' && kb.down.frameBottom === kb.H && kb.down.barDisplay !== 'none' && kb.before.frameBottom === kb.H, JSON.stringify(kb.down))
            // Route scroll memory: scroll the markets frame, push to /t/AAPL
            // (lands at the top), go back (restores), then a same-segment push
            // /t/AAPL → /t/TSLA lands at the top even though the DOM is reused.
            const mem = (await page.evaluate(`(async () => {
              const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
              const sc = () => document.querySelector('[data-app-scroll]')
              sc().scrollTop = 900; await raf(); await new Promise((r) => setTimeout(r, 120))
              return { marketsTop: sc().scrollTop, key: sessionStorage.getItem('pantessa.scroll.v1:/markets') }
            })()`)) as { marketsTop: number; key: string | null }
            note(profile.id, surface.id, 'scroll memory: a scroll of the markets frame is remembered per path (sessionStorage pantessa.scroll.v1:/markets)', mem.marketsTop === 900 && mem.key === '900', JSON.stringify(mem))
            await page.evaluate(`(() => { const a = document.querySelector('a[href="/t/AAPL"]'); if (a) a.click() })()`)
            await page.waitForURL(/\/t\/AAPL/, { timeout: 30_000 }).catch(() => {})
            await page.waitForSelector('.sym', { timeout: 30_000 }).catch(() => {})
            await page.waitForTimeout(1200)
            const onT = (await page.evaluate(`(() => ({ path: location.pathname, top: (document.querySelector('[data-app-scroll]') || {}).scrollTop }))()`)) as { path: string; top: number }
            note(profile.id, surface.id, 'scroll memory: a push to /t/AAPL lands at the top of the new screen', onT.path === '/t/AAPL' && onT.top === 0, JSON.stringify(onT))
            await page.evaluate(`(() => { document.querySelector('[data-app-scroll]').scrollTop = 500 })()`)
            await page.waitForTimeout(250)
            await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
            await page.waitForURL(/\/markets/, { timeout: 30_000 }).catch(() => {})
            await page.waitForTimeout(1500)
            const back = (await page.evaluate(`(() => ({ path: location.pathname, top: (document.querySelector('[data-app-scroll]') || {}).scrollTop, doc: document.scrollingElement.scrollTop }))()`)) as { path: string; top: number; doc: number }
            note(profile.id, surface.id, 'scroll memory: back to /markets restores the remembered 900px (±4), the document still at 0', back.path === '/markets' && Math.abs(back.top - 900) <= 4 && back.doc === 0, JSON.stringify(back))
            await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {})
            await page.waitForURL(/\/t\/AAPL/, { timeout: 30_000 }).catch(() => {})
            await page.waitForTimeout(1500)
            const fwd = (await page.evaluate(`(() => ({ path: location.pathname, top: (document.querySelector('[data-app-scroll]') || {}).scrollTop }))()`)) as { path: string; top: number }
            // Restored to 500, then Chrome's scroll anchoring keeps the same CONTENT in view while the header above it grows as the symbol's data lands (measured +37…+91 across widths) — that is the native behaviour, so the pin is "restored, not reset".
            note(profile.id, surface.id, 'scroll memory: forward to /t/AAPL restores its 500px (≥496; scroll anchoring may add the header growth, ≤+160)', fwd.path === '/t/AAPL' && fwd.top >= 496 && fwd.top <= 660, JSON.stringify(fwd))
            await page.evaluate(`(() => { document.querySelector('[data-app-scroll]').scrollTop = 700 })()`)
            await page.waitForTimeout(200)
            await page.evaluate(`(() => { const a = document.createElement('a'); a.href = '/t/TSLA'; a.textContent = 'x'; document.body.appendChild(a); a.click() })()`)
            await page.waitForURL(/\/t\/TSLA/, { timeout: 30_000 }).catch(() => {})
            await page.waitForTimeout(1500)
            const tsla = (await page.evaluate(`(() => ({ path: location.pathname, top: (document.querySelector('[data-app-scroll]') || {}).scrollTop }))()`)) as { path: string; top: number }
            note(profile.id, surface.id, 'scroll memory: a same-segment push /t/AAPL → /t/TSLA (the DOM is reused) still lands at the top', tsla.path === '/t/TSLA' && tsla.top === 0, JSON.stringify(tsla))
          }
          if (SHOTS) {
            mkdirSync(SHOTS, { recursive: true })
            await page.mouse.move(0, 0).catch(() => {})
            await page.screenshot({ path: join(SHOTS, `${MODE}-${profile.id}-${surface.id}.png`), clip: { x: 0, y: 0, width: m.innerWidth as number, height: ih } }).catch(() => {})
          }
        } else {
          const d = (await page.evaluate(`(${DESKTOP_PROBE})()`)) as Record<string, unknown>
          record[key] = d
          if (MODE === 'before') {
            note(profile.id, surface.id, `desktop rects recorded: spine ${JSON.stringify(d.spine)} frame ${JSON.stringify(d.mktFrame ?? d.walletShell ?? d.dashshell)} rail ${JSON.stringify(d.mktRail ?? d.dashRail)} docScrollHeight ${d.docScrollHeight}`, true)
          } else {
            const base = BASELINE ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Record<string, unknown>>)[key] : null
            if (!base) note(profile.id, surface.id, 'desktop baseline present', false, 'no baseline entry')
            else {
              // Viewport-bound boxes compare as full rects; content-driven boxes
              // compare x / y / width only — their HEIGHT follows live data (the
              // trending strip, the wallet's feed, the dashboard's activity) and
              // moved by 16 … 1,300px between two runs of the same build.
              const full = ['spine', 'bar', 'barDisplay', 'mktTop', 'mktRail', 'mktBar', 'dashRail', 'htmlOverflowY', 'bodyOverflowY']
              const xyw = ['mktShell', 'mktFrame', 'mktMain', 'sym', 'walletShell', 'walletMain', 'dashshell', 'dash', 'dashMain']
              const head = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v.slice(0, 3)) : JSON.stringify(v))
              const diffs = [
                ...full.filter((k) => JSON.stringify(base[k]) !== JSON.stringify(d[k])).map((k) => `${k}: ${JSON.stringify(base[k])} → ${JSON.stringify(d[k])}`),
                ...xyw.filter((k) => head(base[k]) !== head(d[k])).map((k) => `${k} (x,y,w): ${head(base[k])} → ${head(d[k])}`),
              ]
              note(profile.id, surface.id, 'desktop rects identical to the BEFORE baseline (spine, bar, rails, overflow as full rects; the frame, main and shell as x/y/width — heights follow live data)', diffs.length === 0, diffs.join('; ') || 'identical')
              note(profile.id, surface.id, 'desktop: the frame CSS is inert at lg+ (the scroller\'s overflow-y stays visible)', d.scrollerOverflowY === 'visible', `${d.scrollerOverflowY}; doc ${base.docScrollHeight} → ${d.docScrollHeight} in a ${d.innerHeight} viewport`)
            }
          }
        }
        if (MODE === 'after') note(profile.id, surface.id, 'no page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
      } finally {
        await ctx.close().catch(() => {})
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

async function main() {
  const burner = await burnerAddress()
  let session: string | null = null
  if (!ONLY.length || ONLY.includes('dashboard')) {
    try {
      session = await siweCookie()
    } catch (e) {
      console.log(`(no dashboard session: ${String(e)})`)
    }
  }
  if (!envLocal('PRIVATE_KEY')) console.log('(no PRIVATE_KEY: wallet surfaces run as a stranger)')
  for (const p of PROFILES) {
    if (!ENGINES.includes(p.engine)) continue
    if (!p.phone && !DESKTOP) continue
    await runProfile(p, session, burner)
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(record, null, 2))
    console.log(`\nrecorded → ${OUT}`)
  }
  const fails = verdicts.filter((v) => !v.ok)
  console.log(`\n${verdicts.length - fails.length} ok / ${fails.length} failed (${MODE})`)
  process.exit(MODE === 'after' && fails.length ? 1 : 0)
}

if (process.argv[1] && /drive-native-shell/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
