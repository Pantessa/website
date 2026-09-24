#!/usr/bin/env tsx
/**
 * `npm run drive:native` — the mobile-native squad's ONE measure of "feels
 * native" (QA lane, 2026-09-24).
 *
 * Nate: "Let's work on making this a mobile optimized app, can see when i
 * scroll up the fixed nav at the bottom pops up. also when you click a bottom
 * nav the drawer pops out automatically but does not feel like the right
 * flow, if a nav drawer is open and a user taps outside it should close the
 * drawer, by default should be closed with easy way to access the info some
 * how … it needs to feel like a native mobile app when accessed from mobile."
 *
 * The squad's invariants (~/yeetful/squad-native-2026-09-24/README.md) turned
 * into eleven measured checks. Every row prints PASS/FAIL with the NUMBER that
 * decided it, the whole run lands as JSON + a markdown table in the squad's
 * `gates/` dir, and the exit code is 1 on any FAIL (the mobile-onboarding
 * lesson: a drive that prints ❌ and exits 0 proved nothing).
 *
 *   1 frame      on a phone every app surface is a FRAME: the document never
 *                scrolls; one inner [data-app-scroll] does (top → middle → end)
 *   2 bar        the bottom chrome sits on the viewport's bottom edge at every
 *                scroll position, a tap 10px above the edge lands in the bar,
 *                and nothing interactive sits under the bar or the Ask pill
 *   3 tabs       a tab is a PLACE: each seat, tapped on /chat and from
 *                /markets, lights itself, names itself in the URL and shows
 *                its screen — and no drawer pops out
 *   4 sheets     every secondary panel closes on a tap outside, Escape, a
 *                swipe and the back gesture (the page stays); nothing opens on
 *                its own on load
 *   5 targets    chrome controls (the bar, top bars, anything that doesn't
 *                scroll, every sheet's controls) have a ≥44×44 hit area
 *   6 inputs     every input/textarea/select is ≥16px (no iOS focus zoom)
 *   7 overflow   no horizontal scroll on the document or the scroller
 *   8 keyboard   a soft keyboard (visualViewport shrunk) sets html[data-keyboard],
 *                hides the bar, and the composer rides the keyboard; all of it
 *                resets on focusout
 *   9 themecolor <meta name=theme-color> equals --bg in the SITE theme, both ways
 *  10 manifest   served, display:standalone, 192 + 512 icons fetch 200
 *  11 desktop    at 1440 the spine, the drawer, the frame and the markets rail
 *                are where they were on main (gates/desktop-baseline.json)
 *
 * ENGINES. Chrome (installed, channel 'chrome') drives BOTH phone profiles:
 * devices['iPhone 13'] and devices['Pixel 7'] (UA, viewport, DPR, isMobile,
 * hasTouch). Playwright WebKit is SKIPPED on this Mac, by name: playwright-core
 * 1.60 expects webkit-2287, only webkit-1578 is installed, and launching 1578
 * through executablePath hangs (coordinator, 2026-09-24). An owner who runs
 * `npx playwright install webkit` gets the WebKit pass automatically.
 * Neither engine emulates Safari's collapsing toolbar or a real soft
 * keyboard: the proof is STRUCTURAL (the document never scrolls; the bar is
 * flush with the viewport at every inner scroll position; a synthetic
 * visualViewport for the keyboard). The real-phone drill is Nate's.
 *
 * SIZES. Each surface is LOADED at 375×812 and then RESIZED through 360×740,
 * 390×844, 414×896 and the landscape phone 844×390 (and back to 375×812): a
 * resize is what a rotate does, and invariant 1 says the bar survives one.
 * Light theme is loaded and measured at 375×812. Desktop is loaded at
 * 1440×900.
 *
 * SAFETY. Read-only, no money: the mock EIP-6963 wallet refuses every
 * signature and transaction; every POST /api/chat is FULFILLED from a canned
 * fixture (a drive never fires a live turn — the /i runtime auto-runs its ask
 * on connect); the dashboard's SIWE is signed by a THROWAWAY key generated in
 * node (never the funded burner); every same-origin request wears
 * `x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`.
 *
 * CONTRACT HOOKS the lanes render (the drive reads them; missing = FAIL with
 * "not present", never a crash):
 *   [data-app-frame] · [data-app-scroll] · [data-spine-bar]   (lib/phone-shell)
 *   [data-sheet="<id>"] (components/mobile/Sheet), html[data-keyboard]
 *   [data-phone-screen="chat|history|apps|jobs|links|team"] on /chat's main
 *       area below lg (NAV) — the screen a tap landed on
 *   [data-sheet-open="<id>"] on every labeled tap that opens a Sheet (all
 *       lanes) — the drive discovers and dismisses every one of them
 *   a lit seat = aria-current="page" (a link seat) or aria-pressed="true"
 *
 * Usage:
 *   BASE=http://localhost:3896 npm run drive:native
 *   … -- --quick                        (375 only, dark only, iPhone only)
 *   … -- --checks=frame,bar,overflow    (a subset)
 *   … -- --surfaces=/markets,/t/AAPL    (a subset, by path)
 *   … -- --profiles=iphone              (iphone | pixel)
 *   … -- --tag=before --write-baseline  (the BEFORE run: writes the desktop baseline)
 *   … -- --workers=3 --shots
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawn } from 'node:child_process'

// ── Playwright, resolved at RUN time (never a static import: it is not a
// dependency, and a static import breaks the Vercel build — the #858 bite).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Pw = any
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Config ─────────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2)
const flag = (name: string) => ARGS.includes(`--${name}`)
const arg = (name: string) => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
const list = (name: string) => arg(name).split(',').map((s) => s.trim()).filter(Boolean)

const BASE = (process.env.BASE ?? 'http://localhost:3896').replace(/\/$/, '')
const OUT_DIR = arg('out') || '/Users/nategeier/yeetful/squad-native-2026-09-24/gates'
const QUICK = flag('quick')
const WRITE_BASELINE = flag('write-baseline')
const SHOTS = flag('shots')
const WORKERS = Math.max(1, Number(arg('workers') || 3))
const ANCHOR = '/Users/nategeier/anchor.js'
const BASELINE_FILE = join(OUT_DIR, 'desktop-baseline.json')
/** This file's own directory (a lane drive folded in lives beside it). */
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
/** Fold this run's rows into an earlier run's table (by the tag): a subset
 *  re-run (one check, a few surfaces) replaces exactly the rows it measured
 *  and keeps the rest. */
const MERGE_INTO = arg('merge-into')
/** The funded house burner's ADDRESS, used watch-only (the mock refuses every
 *  signature; no key is in the browser) so /chat, /wallet and /markets render
 *  a wallet with real holdings. */
const WATCH_ADDRESS = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
const HOUSE_SLUG = arg('slug') || 'buy-aapl'

export const CHECKS = [
  'frame',
  'bar',
  'tabs',
  'sheets',
  'targets',
  'inputs',
  'overflow',
  'keyboard',
  'themecolor',
  'manifest',
  'desktop',
] as const
export type CheckId = (typeof CHECKS)[number]
const CHECK_FILTER = new Set<CheckId>((list('checks') as CheckId[]).filter((c) => CHECKS.includes(c)))
const wantCheck = (c: CheckId) => CHECK_FILTER.size === 0 || CHECK_FILTER.has(c)

type ProfileId = 'iphone' | 'pixel' | 'desktop'
type EngineId = 'chrome' | 'webkit'
type Theme = 'dark' | 'light'
type Auth = 'wallet' | 'siwe' | 'none'

/** The surfaces, in the squad's words. `app` = must be a frame on a phone. */
export type Surface = { path: string; kind: 'app' | 'brochure'; auth: Auth; name: string }
export const SURFACES: Surface[] = [
  { path: '/chat', kind: 'app', auth: 'wallet', name: 'chat' },
  { path: '/chat?tab=mcps', kind: 'app', auth: 'wallet', name: 'chat·apps' },
  { path: '/chat?tab=jobs', kind: 'app', auth: 'wallet', name: 'chat·jobs' },
  { path: '/chat?tab=links', kind: 'app', auth: 'wallet', name: 'chat·links' },
  { path: '/chat?tab=chats', kind: 'app', auth: 'wallet', name: 'chat·chats' },
  { path: '/markets', kind: 'app', auth: 'wallet', name: 'markets' },
  { path: '/t/AAPL', kind: 'app', auth: 'wallet', name: 't·AAPL' },
  { path: '/t/ETH', kind: 'app', auth: 'wallet', name: 't·ETH' },
  { path: '/wallet', kind: 'app', auth: 'wallet', name: 'wallet' },
  { path: '/dashboard', kind: 'app', auth: 'siwe', name: 'dashboard' },
  { path: `/i/${HOUSE_SLUG}`, kind: 'app', auth: 'wallet', name: 'i·link' },
  { path: '/', kind: 'brochure', auth: 'none', name: 'landing' },
  { path: '/pricing', kind: 'brochure', auth: 'none', name: 'pricing' },
  { path: '/docs', kind: 'brochure', auth: 'none', name: 'docs' },
]
const SURFACE_FILTER = list('surfaces')
const surfaces = SURFACES.filter((s) => !SURFACE_FILTER.length || SURFACE_FILTER.includes(s.path) || SURFACE_FILTER.includes(s.name))

type Size = { id: string; width: number; height: number }
/** Loaded at the first; the rest are reached by a resize (a rotate). */
const PHONE_SIZES: Size[] = [
  { id: '375x812', width: 375, height: 812 },
  { id: '360x740', width: 360, height: 740 },
  { id: '390x844', width: 390, height: 844 },
  { id: '414x896', width: 414, height: 896 },
  { id: '844x390', width: 844, height: 390 },
]
const DESKTOP: Size = { id: '1440x900', width: 1440, height: 900 }

// ── Results ────────────────────────────────────────────────────────────────
/** DECISION = measured, and ruled by the coordinator a call for Nate rather
 *  than a defect (e.g. the 40px landscape bar); never counted as a FAIL. */
export type State = 'PASS' | 'FAIL' | 'SKIP' | 'N/A' | 'DECISION'
export type Row = {
  check: CheckId
  engine: EngineId
  profile: ProfileId | '-'
  size: string
  theme: Theme | '-'
  surface: string
  /** What was measured (a seat, a sheet, a scroll position…). */
  item: string
  state: State
  /** The number that decided it. */
  value: string
  detail: string
}
const rows: Row[] = []
function record(r: Row) {
  rows.push(r)
  const mark = r.state === 'PASS' ? '✅' : r.state === 'FAIL' ? '❌' : r.state === 'SKIP' ? '⏭ ' : r.state === 'DECISION' ? '⚖ ' : '· '
  const where = [r.engine, r.profile, r.size, r.theme, r.surface, r.item].filter((x) => x && x !== '-').join(' ')
  console.log(`  ${mark} ${r.check.padEnd(10)} ${where} — ${r.value}${r.detail ? ` · ${r.detail}` : ''}`)
}

// ── The in-page library ────────────────────────────────────────────────────
// A plain string, injected with addInitScript into every document, so the
// probes below are one-liners (`window.__nq.frameProbe()`) and nothing is
// serialized through tsx (esbuild's keepNames `__name` wrapper throws inside
// page.evaluate — the drive-mobile-ux bite).
const PAGE_LIB = String.raw`(() => {
  if (window.__nq) return
  window.__name = window.__name || function (f) { return f }
  const SCROLL = '[data-app-scroll]', FRAME = '[data-app-frame]', BAR = '[data-spine-bar]'
  const INTERACTIVE = 'a[href],button,[role=button],[role=tab],[role=menuitem],[role=link],[role=switch],[role=checkbox],[role=radio],input:not([type=hidden]),select,textarea,summary'
  const FIELDS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]),textarea,select'
  const vis = (el) => {
    if (!el || !el.isConnected) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    let p = el.parentElement
    while (p && p !== document.body) { const s = getComputedStyle(p); if (+s.opacity < 0.05) return false; p = p.parentElement }
    return true
  }
  const R = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) })
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('name') || el.tagName.toLowerCase()) + ''
    return t.trim().replace(/\s+/g, ' ').slice(0, 34)
  }
  const isScroller = (el) => { const s = getComputedStyle(el); return s.overflowY === 'auto' || s.overflowY === 'scroll' }
  /** The part of el's box a finger can see: clipped by every overflow-clipping
   *  ancestor (up to a fixed one) and by the viewport. */
  const clipped = (el) => {
    const r = el.getBoundingClientRect()
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom
    let p = el.parentElement
    while (p && p !== document.documentElement && p !== document.body) {
      const s = getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect()
        if (s.overflowX !== 'visible') { x1 = Math.max(x1, pr.left); x2 = Math.min(x2, pr.right) }
        if (s.overflowY !== 'visible') { y1 = Math.max(y1, pr.top); y2 = Math.min(y2, pr.bottom) }
      }
      if (s.position === 'fixed') break
      p = p.parentElement
    }
    x1 = Math.max(x1, 0); y1 = Math.max(y1, 0); x2 = Math.min(x2, innerWidth); y2 = Math.min(y2, innerHeight)
    return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null
  }
  // NOT [data-rk]: RainbowKitProvider wraps the WHOLE app in a data-rk div
  // (its theme scope) — its modal is a role=dialog like any other.
  const inPopup = (el) => !!el.closest('[data-sheet],[role=dialog],[role=menu],[role=listbox]')
  /** Interactive elements whose VISIBLE box overlaps chrome's box. */
  const under = (chrome) => {
    const c = chrome.getBoundingClientRect()
    const out = []
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (chrome.contains(el) || el.contains(chrome) || inPopup(el)) continue
      const r = el.getBoundingClientRect()
      if (r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right) continue
      if (!vis(el) || getComputedStyle(el).pointerEvents === 'none') continue
      const k = clipped(el); if (!k) continue
      const ix = Math.min(k.x2, c.right) - Math.max(k.x1, c.left), iy = Math.min(k.y2, c.bottom) - Math.max(k.y1, c.top)
      if (ix > 2 && iy > 2) out.push(label(el) + ' (' + Math.round(iy) + 'px)')
    }
    return [...new Set(out)]
  }
  /** Content (any element carrying its own text) whose VISIBLE box overlaps
   *  chrome's box — README invariant 1: "nothing scrolls under it". */
  const contentUnder = (chrome) => {
    const c = chrome.getBoundingClientRect()
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      if (chrome.contains(el) || el.contains(chrome) || inPopup(el)) continue
      let text = ''
      for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue
      text = text.trim()
      if (!text) continue
      const r = el.getBoundingClientRect()
      if (r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right) continue
      if (!vis(el)) continue
      const k = clipped(el); if (!k) continue
      const ix = Math.min(k.x2, c.right) - Math.max(k.x1, c.left), iy = Math.min(k.y2, c.bottom) - Math.max(k.y1, c.top)
      if (ix > 2 && iy > 2) out.push(text.replace(/\s+/g, ' ').slice(0, 24) + ' (' + Math.round(iy) + 'px)')
    }
    return [...new Set(out)]
  }
  /** The screen's scroller: the contract's [data-app-scroll] when it scrolls;
   *  else the de-facto one (the biggest overflow-y container); else the page. */
  const screenScroller = () => {
    const tagged = [...document.querySelectorAll(SCROLL)].filter(vis)
    const t = tagged.find(isScroller)
    if (t) return { el: t, how: 'contract', tagged: tagged.length }
    let best = null, area = 0
    for (const el of document.querySelectorAll('body *')) {
      if (!isScroller(el) || inPopup(el)) continue
      if (!vis(el)) continue
      const r = el.getBoundingClientRect()
      const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
      if (a > area) { area = a; best = el }
    }
    if (best && area > innerWidth * innerHeight * 0.35) return { el: best, how: 'de-facto', tagged: tagged.length }
    return { el: document.scrollingElement, how: 'document', tagged: tagged.length }
  }
  const bottomChrome = () => {
    const out = []
    const bar = document.querySelector(BAR)
    if (bar && vis(bar)) out.push({ el: bar, kind: 'spine bar' })
    for (const el of document.querySelectorAll('body *')) {
      if (bar && (el === bar || bar.contains(el))) continue
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
      if (inPopup(el) || !vis(el)) continue
      const r = el.getBoundingClientRect()
      if (Math.abs(r.bottom - innerHeight) > 2 || r.top < innerHeight * 0.5 || r.width < innerWidth * 0.5) continue
      if (out.some((c) => c.el.contains(el))) continue
      out.push({ el, kind: (el.className + '').split(' ')[0].slice(0, 24) || el.tagName.toLowerCase() })
    }
    return out
  }
  const scrollTo = async (S, y) => {
    if (S === document.scrollingElement) window.scrollTo(0, y); else S.scrollTop = y
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 160))
  }
  window.__nq = {
    vis, R, label, clipped, under, contentUnder, screenScroller, bottomChrome,
    /** Checks 1, 2 and 7 at the top, middle and end of the screen's scroll. */
    async frameProbe() {
      const se = document.scrollingElement
      const sc = screenScroller()
      const S = sc.el
      const frames = [...document.querySelectorAll(FRAME)].filter(vis).length
      const pill = document.querySelector('[data-ask-door="pill"]')
      const out = { how: sc.how, tagged: sc.tagged, frames, vw: innerWidth, vh: innerHeight, positions: [] }
      await scrollTo(S, 0)
      const max = Math.max(0, S.scrollHeight - S.clientHeight)
      for (const [name, y] of [['top', 0], ['middle', Math.round(max / 2)], ['end', max]]) {
        await scrollTo(S, y)
        const chrome = bottomChrome().map((c) => {
          const r = c.el.getBoundingClientRect()
          const x = Math.round(innerWidth / 2)
          const hitEl = document.elementFromPoint(x, innerHeight - 10)
          return { kind: c.kind, rect: R(r), bottomGap: Math.round(innerHeight - r.bottom), hit: !!hitEl && c.el.contains(hitEl), hitWhat: hitEl ? label(hitEl) : null, under: under(c.el), contentUnder: contentUnder(c.el) }
        })
        const pillUnder = pill && vis(pill) ? contentUnder(pill) : null
        out.positions.push({
          name, y, scrollerTop: Math.round(S === se ? se.scrollTop : S.scrollTop),
          docScrollTop: Math.round(se.scrollTop), docScrollHeight: se.scrollHeight, docClientHeight: se.clientHeight,
          docOverflowX: se.scrollWidth - se.clientWidth,
          scrollerOverflowX: S === se ? 0 : S.scrollWidth - S.clientWidth,
          chrome, pill: pill && vis(pill) ? { rect: R(pill.getBoundingClientRect()), under: pillUnder } : null,
        })
      }
      await scrollTo(S, 0)
      // What makes the DOCUMENT taller than the screen (unclipped boxes past
      // the bottom edge) — the actionable half of a frame red.
      if (se.scrollHeight > innerHeight + 1) {
        const tall = []
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.bottom <= innerHeight + 1 || r.height < 1) continue
          let p = el.parentElement, clip = false
          while (p && p !== document.body) { const cs = getComputedStyle(p); if (cs.overflowY !== 'visible') { clip = true; break } p = p.parentElement }
          if (clip || !vis(el)) continue
          if (tall.some((t) => t.el.contains(el))) continue
          tall.push({ el, what: (el.tagName.toLowerCase() + '.' + (el.className + '').split(' ').slice(0, 2).join('.')).slice(0, 50) + ' ' + Math.round(r.top) + '→' + Math.round(r.bottom) + ' ' + getComputedStyle(el).position })
        }
        out.tall = tall.slice(0, 3).map((t) => t.what)
      }
      return out
    },
    /** The Ask pill over the whole scroll: every ~0.8 screen, top to end. */
    async pillSweep() {
      const pill = document.querySelector('[data-ask-door="pill"]')
      if (!pill || !vis(pill)) return null
      const S = screenScroller().el
      const max = Math.max(0, S.scrollHeight - S.clientHeight)
      const step = Math.max(200, Math.round(S.clientHeight * 0.8))
      const hits = []
      let n = 0
      for (let y = 0; ; y = Math.min(max, y + step)) {
        await scrollTo(S, y)
        n++
        // a field under the pill counts too (its placeholder is not a text node)
        if (vis(pill)) { const u = [...under(pill), ...contentUnder(pill)]; if (u.length) hits.push({ y, what: u.slice(0, 2) }) }
        if (y >= max || n >= 14) break
      }
      await scrollTo(S, 0)
      return { positions: n, covered: hits.length, first: hits[0] || null, rect: R(pill.getBoundingClientRect()) }
    },
    /** Overflow offenders: the widest things past the right edge. */
    wideOffenders() {
      const out = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.right <= innerWidth + 1 || r.width < 2) continue
        let p = el.parentElement, clippedX = false
        while (p && p !== document.body) { const s = getComputedStyle(p); if (s.overflowX !== 'visible') { clippedX = true; break } p = p.parentElement }
        if (clippedX || !vis(el)) continue
        out.push({ what: (el.tagName.toLowerCase() + '.' + (el.className + '').split(' ').slice(0, 2).join('.')).slice(0, 48), right: Math.round(r.right) })
      }
      return out.sort((a, b) => b.right - a.right).slice(0, 3)
    },
    /** Check 6: every form field's font size. */
    fields(scope) {
      const root = scope ? document.querySelector(scope) : document
      if (!root) return []
      return [...root.querySelectorAll(FIELDS)].filter(vis).map((el) => ({ what: label(el), tag: el.tagName.toLowerCase(), fs: parseFloat(getComputedStyle(el).fontSize) }))
    },
    /** A control's hit area: its box, or 21px each side of its center landing on it. */
    hit(el) {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const on = (x, y) => { if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true; const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)) }
      const okW = r.width >= 43.5 || (on(cx - 21, cy) && on(cx + 21, cy))
      const okH = r.height >= 43.5 || (on(cx, cy - 21) && on(cx, cy + 21))
      return { w: Math.round(r.width), h: Math.round(r.height), ok: okW && okH }
    },
    /** Check 5: chrome controls (the bar + everything that does not scroll with
     *  the content) vs content controls on the first screen (info only). */
    targets(scope) {
      const sc = screenScroller()
      const S = sc.el
      const root = scope ? document.querySelector(scope) : document
      if (!root) return { chrome: [], content: [] }
      const chrome = [], content = []
      const seen = new Set()
      for (const el of root.querySelectorAll(INTERACTIVE)) {
        if (!vis(el) || getComputedStyle(el).pointerEvents === 'none') continue
        if (!scope && inPopup(el)) continue
        if (el.parentElement && el.parentElement.closest(INTERACTIVE)) continue // nested: the outer control counts
        const k = clipped(el); if (!k) continue
        if (seen.has(el)) continue
        seen.add(el)
        const h = window.__nq.hit(el)
        const entry = { what: label(el), w: h.w, h: h.h, ok: h.ok, seat: !!el.closest(BAR) }
        let isChrome
        if (scope) isChrome = true
        else if (S !== document.scrollingElement) isChrome = !S.contains(el)
        else { let p = el, fixed = false; while (p && p !== document.body) { const ps = getComputedStyle(p).position; if (ps === 'fixed' || ps === 'sticky') { fixed = true; break } p = p.parentElement } isChrome = fixed }
        if (el.closest(BAR)) isChrome = true
        ;(isChrome ? chrome : content).push(entry)
      }
      return { chrome, content }
    },
    litSeats() {
      return [...document.querySelectorAll(BAR + ' a, ' + BAR + ' button')].filter(vis)
        .filter((e) => e.getAttribute('aria-current') === 'page' || e.getAttribute('aria-pressed') === 'true')
        .map((e) => e.getAttribute('aria-label') || label(e))
    },
    seats() {
      return [...document.querySelectorAll(BAR + ' a, ' + BAR + ' button')].filter(vis).map((e) => e.getAttribute('aria-label') || label(e))
    },
    screen() {
      const el = [...document.querySelectorAll('[data-phone-screen]')].find(vis)
      return el ? el.getAttribute('data-phone-screen') : null
    },
    /** Positioned panels that paint and cover a real share of the screen
     *  without being the frame or its scroller: a drawer, a popover, a sheet. */
    overlays() {
      const chain = new Set()
      for (const sel of [FRAME, SCROLL]) { for (const f of document.querySelectorAll(sel)) { let e = f; while (e) { chain.add(e); e = e.parentElement } } }
      const vw = innerWidth, vh = innerHeight, out = []
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue
        if (chain.has(el) || el.closest(BAR)) continue
        if (cs.pointerEvents === 'none' || !vis(el)) continue
        const r = el.getBoundingClientRect()
        const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        const frac = (ix * iy) / (vw * vh)
        if (frac < 0.3) continue
        const bg = cs.backgroundColor
        const paints = (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) || cs.boxShadow !== 'none' || (cs.backdropFilter && cs.backdropFilter !== 'none')
        if (!paints) continue
        if (out.some((o) => o.el.contains(el))) continue
        out.push({ el, frac, what: (el.tagName.toLowerCase() + '.' + (el.className + '').split(' ').slice(0, 3).join('.')).slice(0, 60) })
      }
      const scrim = out.some((o) => o.frac > 0.95)
      return out.map((o) => ({ what: o.what, frac: Math.round(o.frac * 100), sheet: !!o.el.closest('[data-sheet]'), scrimOnPage: scrim }))
    },
    /** The panel a tap opened: the Sheet primitive first, else a legacy dialog
     *  or menu. Tagged data-nq-panel so node can find it again. */
    openPanel() {
      for (const t of document.querySelectorAll('[data-nq-panel]')) t.removeAttribute('data-nq-panel')
      const found = []
      for (const s of document.querySelectorAll('[data-sheet]')) {
        const p = s.querySelector('[role=dialog]') || s
        if (vis(p)) found.push({ el: p, kind: 'sheet', id: s.getAttribute('data-sheet') || '', side: s.getAttribute('data-side') || 'bottom' })
      }
      for (const d of document.querySelectorAll('[role=dialog],[role=menu]')) {
        if (d.closest('[data-sheet]') || !vis(d)) continue
        const r = d.getBoundingClientRect()
        const side = Math.abs(r.bottom - innerHeight) < 4 && r.top > 40 ? 'bottom' : r.left < 4 && r.width < innerWidth - 8 ? 'left' : Math.abs(r.right - innerWidth) < 4 && r.width < innerWidth - 8 ? 'right' : 'center'
        found.push({ el: d, kind: 'legacy', id: (d.getAttribute('aria-label') || (d.getAttribute('role') + '.' + (d.className + '').split(' ')[0])).slice(0, 40), side })
      }
      if (!found.length) return null
      const f = found[0]
      f.el.setAttribute('data-nq-panel', '1')
      return { kind: f.kind, id: f.id, side: f.side, rect: R(f.el.getBoundingClientRect()), count: found.length }
    },
    panelOpen() { const p = document.querySelector('[data-nq-panel]'); return !!p && vis(p) },
    /** A point on the screen that is outside the open panel (the scrim, or
     *  the page beside a popover). */
    outsidePoint() {
      const p = document.querySelector('[data-nq-panel]')
      const cands = [[innerWidth / 2, 18], [12, 18], [innerWidth - 12, 18], [12, innerHeight / 2], [innerWidth - 12, innerHeight / 2], [innerWidth / 2, innerHeight / 3], [innerWidth / 2, innerHeight * 0.6]]
      for (const [x, y] of cands) {
        const t = document.elementFromPoint(x, y)
        if (t && !(p && (p === t || p.contains(t)))) return { x: Math.round(x), y: Math.round(y), what: label(t) }
      }
      return null
    },
    /** Where a swipe starts: the grabber, else the panel's top edge. */
    grabPoint() {
      const p = document.querySelector('[data-nq-panel]')
      if (!p) return null
      const host = p.closest('[data-sheet]') || p
      const g = host.querySelector('.sheet__grabber, [data-sheet-grabber]')
      const r = (g && vis(g) ? g : p).getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(14, r.height / 2)), side: (p.closest('[data-sheet]') || {}).getAttribute ? p.closest('[data-sheet]')?.getAttribute('data-side') || null : null, rect: R(p.getBoundingClientRect()) }
    },
    /** Normalize any CSS color to [r,g,b] through a canvas pixel (oklch and
     *  color-mix included — getComputedStyle keeps them verbatim). */
    rgb(color) {
      const c = document.createElement('canvas'); c.width = c.height = 1
      const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillStyle = color; x.fillRect(0, 0, 1, 1)
      const d = x.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2]]
    },
    themeColor() {
      const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
      const live = metas.find((m) => !m.media || matchMedia(m.media).matches)
      const bgVar = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      const probe = document.createElement('div'); probe.style.color = bgVar || 'transparent'; document.body.appendChild(probe)
      const bgColor = getComputedStyle(probe).color; probe.remove()
      return { theme: document.documentElement.dataset.theme || null, meta: live ? live.content : null, metas: metas.map((m) => (m.media ? m.media + ' ' : '') + m.content), bg: bgVar, metaRgb: live ? window.__nq.rgb(live.content) : null, bgRgb: window.__nq.rgb(bgColor) }
    },
    composer() {
      const tas = [...document.querySelectorAll('textarea')].filter(vis)
      const ta = tas[tas.length - 1]
      if (!ta) return null
      let box = ta
      for (let p = ta.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) { const s = getComputedStyle(p); if (s.borderTopWidth !== '0px' || (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)')) { box = p; break } }
      return { ta: R(ta.getBoundingClientRect()), box: R(box.getBoundingClientRect()) }
    },
  }
})()`

// ── The mock wallet ────────────────────────────────────────────────────────
function mockWallet(address: string): string {
  return `(() => {
  const ADDR = ${JSON.stringify(address.toLowerCase())}
  const provider = {
    isMetaMask: false, _chainId: '0x2105',
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [ADDR]
        case 'eth_chainId': return provider._chainId
        case 'net_version': return String(parseInt(provider._chainId, 16))
        case 'wallet_switchEthereumChain': provider._chainId = params[0].chainId; return null
        case 'wallet_addEthereumChain': return null
        case 'personal_sign': case 'eth_sign': case 'eth_signTypedData_v4': case 'eth_sendTransaction': case 'wallet_sendCalls':
          window.__nqRefused = (window.__nqRefused || 0) + 1
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
  try { localStorage.setItem('wagmi.recentConnectorId', '"io.pantessa.drive"'); localStorage.removeItem('wagmi.io.pantessa.drive.disconnected') } catch {}
})()`
}

/** The /i runtime's first turn, in the route's own reply shape — a drive never
 *  fires a live /api/chat turn. (drive-i-mobile's fixture, shortened.) */
const CHAT_FIXTURE = {
  reply:
    "🌉 **We can make this happen.** You're holding **~$4 of USDT on Ethereum, ~$227 of ETH on Base** — this buy needs ~$12 of USDG on Robinhood Chain, so I'll convert some of it and buy the AAPL, all in one job you sign step by step.",
  clarify: {
    question: 'Fund it from another chain?',
    options: [
      { label: 'Just enough (~$11.5 from Base)', resume: 'Fund robinhood chain with $11.5 from base, then buy $10 of AAPL' },
      { label: 'Use Ethereum instead (~$11.5)', resume: 'Fund robinhood chain with $11.5 from ethereum, then buy $10 of AAPL' },
    ],
  },
  buildPath: 'native-lifi-fund-offer',
}

// ── SIWE with a THROWAWAY key (never the funded burner) ───────────────────
async function throwawaySession(): Promise<{ address: string; cookie: string } | null> {
  try {
    const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts')
    const { createSiweMessage } = await import('viem/siwe')
    const account = privateKeyToAccount(generatePrivateKey())
    const nonceRes = await fetch(`${BASE}/api/auth/nonce`, { headers: { 'x-yf-internal-run': '1' } })
    const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[0]).find(Boolean)
    const { nonce } = (await nonceRes.json()) as { nonce: string }
    const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
    const signature = await account.signMessage({ message })
    const res = await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
      body: JSON.stringify({ message, signature }),
    })
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
    return cookie ? { address: account.address, cookie } : null
  } catch (e) {
    console.log(`  ·  SIWE for the dashboard failed: ${(e as Error).message.split('\n')[0]}`)
    return null
  }
}

// ── Browser plumbing ───────────────────────────────────────────────────────
type Run = { engine: EngineId; profile: ProfileId; browser: Pw; device: Record<string, unknown> }
type Opened = { ctx: Pw; page: Pw; chatPosts: number; errors: string[]; address: string | null; ready: string }

let PW: Pw = null
function pw(): Pw {
  if (!PW) PW = createRequire(ANCHOR)('playwright-core')
  return PW
}

function deviceFor(profile: ProfileId): Record<string, unknown> {
  const { devices } = pw()
  if (profile === 'desktop') return { viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
  const d = { ...(profile === 'iphone' ? devices['iPhone 13'] : devices['Pixel 7']) }
  delete (d as Record<string, unknown>).defaultBrowserType
  return d
}

/** The drive's safety net on a browser context: every POST /api/chat is
 *  FULFILLED from the fixture (a drive never fires a live turn), and every
 *  same-origin request wears x-yf-internal-run + x-yf-no-ask-log. Used for
 *  the drive's own contexts AND the lane drives it folds in. */
async function guardContext(ctx: Pw, onChatPost: () => void = () => {}, rscDelayMs = 0) {
  const origin = new URL(BASE).origin
  // Every request (a RegExp, not the '**' glob: a slash-star in code reads as a
  // comment opener to the harness's source fences).
  await ctx.route(/.*/, async (route: Pw) => {
    const req = route.request()
    let url: URL
    try {
      url = new URL(req.url())
    } catch {
      return route.continue().catch(() => {})
    }
    if (url.origin !== origin) return route.continue().catch(() => {})
    if (req.method() === 'POST' && /^\/api\/chat\/?$/.test(url.pathname)) {
      onChatPost()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHAT_FIXTURE) }).catch(() => {})
    }
    // A slow network for the App Router's RSC fetches (a client navigation):
    // the link-in-a-sheet row needs the fetch to still be in flight when the
    // sheet's deferred history pop runs.
    if (rscDelayMs && (req.headers()['rsc'] === '1' || url.searchParams.has('_rsc'))) await new Promise((r) => setTimeout(r, rscDelayMs))
    return route.continue({ headers: { ...req.headers(), 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' } }).catch(() => {})
  })
}

async function openCtx(run: Run, o: { size: Size; theme: Theme; auth: Auth; session?: { address: string; cookie: string } | null; os?: Theme; rscDelayMs?: number }): Promise<Opened> {
  const ctx = await run.browser.newContext({
    ...run.device,
    viewport: { width: o.size.width, height: o.size.height },
    colorScheme: o.os ?? o.theme,
  })
  await ctx.addInitScript(PAGE_LIB)
  // The SITE theme: the same key the footer toggle writes (components/ThemeToggle).
  await ctx.addInitScript(`try { localStorage.setItem('yf-theme', ${JSON.stringify(o.theme)}) } catch {}`)
  let address: string | null = null
  if (o.auth === 'wallet') address = WATCH_ADDRESS
  if (o.auth === 'siwe' && o.session) {
    address = o.session.address
    await ctx.addCookies([{ name: 'yf_session', value: o.session.cookie, url: BASE }])
  }
  if (address) await ctx.addInitScript(mockWallet(address))
  const opened: Opened = { ctx, page: null, chatPosts: 0, errors: [], address, ready: '' }
  await guardContext(ctx, () => (opened.chatPosts += 1), o.rscDelayMs ?? 0)
  const page = await ctx.newPage()
  page.on('pageerror', (e: unknown) => opened.errors.push(String(e).split('\n')[0].slice(0, 160)))
  opened.page = page
  return opened
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Load a surface and wait until it is the screen a visitor would see: the
 *  wallet reconnected (its address on screen), the dashboard mounted, the /i
 *  runtime answered its (fixture) turn. Never throws: `ready` says what held. */
async function load(o: Opened, s: Surface): Promise<void> {
  const { page } = o
  try {
    await page.goto(BASE + s.path, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  } catch (e) {
    o.ready = `goto failed: ${(e as Error).message.split('\n')[0].slice(0, 80)}`
    return
  }
  await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {})
  const until = Date.now() + 20_000
  // RainbowKit shows an ENS-less account as "0x5E…55a0": the first four and
  // the last four characters are on screen once the wallet reconnected.
  const prefix = o.address ? o.address.slice(0, 4).toLowerCase() : null
  const suffix = o.address ? o.address.slice(-4).toLowerCase() : null
  let ready = 'loaded'
  for (;;) {
    const st = (await page
      .evaluate(`(() => ({ t: document.body ? document.body.innerText.slice(0, 20000).toLowerCase() : '', path: location.pathname, dash: !!document.querySelector('.dash__main, .dashshell') }))()`)
      .catch(() => null)) as { t: string; path: string; dash: boolean } | null
    if (st) {
      if (s.path.startsWith('/i/')) {
        if (o.chatPosts > 0 && /we can make this happen/.test(st.t)) { ready = 'runtime answered'; break }
        if (!prefix && /connect/.test(st.t)) { ready = 'splash'; break }
      } else if (s.auth === 'siwe') {
        if (st.dash) { ready = 'dashboard'; break }
      } else if (prefix) {
        if (st.t.includes(prefix) && suffix && st.t.includes(suffix)) { ready = 'wallet on screen'; break }
      } else {
        ready = 'loaded'
        break
      }
    }
    if (Date.now() > until) { ready = `timed out waiting (${s.auth})`; break }
    await sleep(300)
  }
  await sleep(500)
  // Settle: the layout stops moving (a route's CSS chunk or a late section
  // can hold the document tall for a beat — the integrated /dashboard read
  // 1005px for ~250ms after .dash__main mounted, then 812).
  let last = '', stable = 0
  for (let i = 0; i < 12 && stable < 2; i++) {
    const h = (await page
      .evaluate(`(() => { const s = document.querySelector('[data-app-scroll]'); return document.scrollingElement.scrollHeight + ':' + (s ? s.scrollHeight : 0) })()`)
      .catch(() => '')) as string
    stable = h && h === last ? stable + 1 : 0
    last = h
    await sleep(300)
  }
  o.ready = ready
}

async function shot(o: Opened, name: string) {
  if (!SHOTS) return
  const dir = join(OUT_DIR, 'shots', 'qa', TAG)
  mkdirSync(dir, { recursive: true })
  await o.page.mouse.move(1, 1).catch(() => {})
  await o.page.screenshot({ path: join(dir, `${name.replace(/[^a-z0-9·._-]+/gi, '_')}.png`) }).catch(() => {})
}

async function evalNq<T>(page: Pw, expr: string): Promise<T | null> {
  try {
    return (await page.evaluate(expr)) as T
  } catch (e) {
    return { __error: (e as Error).message.split('\n')[0].slice(0, 140) } as unknown as T
  }
}

// ── Check 1, 2, 5, 6, 7 (+ 4's "nothing on load"): the layout pass ────────
type FrameOut = {
  tall?: string[]
  how: string
  tagged: number
  frames: number
  vw: number
  vh: number
  positions: {
    name: string
    y: number
    scrollerTop: number
    docScrollTop: number
    docScrollHeight: number
    docClientHeight: number
    docOverflowX: number
    scrollerOverflowX: number
    chrome: { kind: string; rect: { y: number; h: number; b: number }; bottomGap: number; hit: boolean; hitWhat: string | null; under: string[]; contentUnder: string[] }[]
    pill: { rect: { y: number; b: number }; under: string[] } | null
  }[]
  __error?: string
}

function base(run: Run, size: Size, theme: Theme, s: Surface) {
  return { engine: run.engine, profile: run.profile, size: size.id, theme, surface: s.path } as const
}

async function layoutAt(run: Run, o: Opened, s: Surface, size: Size, theme: Theme, first: boolean) {
  const b = base(run, size, theme, s)
  const f = await evalNq<FrameOut>(o.page, 'window.__nq.frameProbe()')
  if (!f || f.__error) {
    for (const c of ['frame', 'bar', 'overflow'] as CheckId[]) if (wantCheck(c)) record({ ...b, check: c, item: '', state: 'FAIL', value: 'probe crashed', detail: f?.__error ?? 'no result' })
    return
  }
  const pos = f.positions
  // 1 · frame
  if (wantCheck('frame')) {
    if (s.kind === 'brochure') {
      const p0 = pos[0]
      record({ ...b, check: 'frame', item: '', state: 'N/A', value: `document ${p0.docScrollHeight}/${f.vh}`, detail: 'brochure page: not framed by design (README invariant 1 lists app surfaces)' })
    } else {
      // A document that is tall only at the FIRST read and fits at the middle
      // and end reads is a load transient (a late CSS chunk; the integrated
      // /dashboard held 1005px for ~250ms) — noted, not failed.
      const tallAt = pos.filter((p) => p.docScrollHeight > f.vh + 1 || p.docScrollTop !== 0)
      const transient = tallAt.length === 1 && tallAt[0] === pos[0] && pos.length > 1
      const docScrolls = tallAt.length > 0 && !transient
      const maxDocTop = Math.max(...pos.map((p) => p.docScrollTop))
      const reasons: string[] = []
      if (docScrolls) reasons.push(`the DOCUMENT scrolls (scrollHeight ${Math.max(...pos.map((p) => p.docScrollHeight))} > innerHeight ${f.vh}; scrollTop reached ${maxDocTop}${f.tall?.length ? `; past the bottom: ${f.tall.join(', ')}` : ''})`)
      if (f.frames === 0) reasons.push('no [data-app-frame]')
      if (f.how !== 'contract') reasons.push(f.tagged ? `[data-app-scroll] ×${f.tagged} but none scrolls` : `no [data-app-scroll] (scroller: ${f.how})`)
      if (f.tagged > 1) reasons.push(`${f.tagged} [data-app-scroll] (must be ONE)`)
      record({
        ...b,
        check: 'frame',
        item: '',
        state: reasons.length ? 'FAIL' : 'PASS',
        value: `doc ${pos[pos.length - 1].docScrollHeight}/${f.vh} · top max ${maxDocTop} · scroller ${f.how}`,
        detail: [transient ? `transient: the document read ${pos[0].docScrollHeight}px at load, then ${pos[1].docScrollHeight}px` : '', ...reasons].filter(Boolean).join('; '),
      })
    }
  }
  // 2 · bar (+ the Ask pill)
  if (wantCheck('bar')) {
    const chromes = pos.flatMap((p) => p.chrome.map((c) => ({ ...c, at: p.name })))
    const tallPos = pos.filter((p) => p.docScrollHeight > f.vh + 1)
    const docScrolls = tallPos.length > 0 && !(tallPos.length === 1 && tallPos[0] === pos[0] && pos.length > 1)
    if (s.kind === 'brochure') {
      const fixedBottom = [...new Set(chromes.map((c) => c.kind))]
      const drift = docScrolls && fixedBottom.length > 0
      record({
        ...b,
        check: 'bar',
        item: 'bottom chrome',
        state: drift ? 'FAIL' : 'PASS',
        value: fixedBottom.length ? `${fixedBottom.join(', ')} fixed at the bottom · document ${docScrolls ? 'scrolls' : 'still'}` : 'no bottom chrome',
        detail: drift ? 'drift-prone: a fixed bottom bar on a document-scrolling page (the iOS 26 collapsing-toolbar bug)' : '',
      })
    } else {
      const bar = chromes.filter((c) => c.kind === 'spine bar')
      if (s.path.startsWith('/i/')) {
        const problems = chromes.filter((c) => Math.abs(c.bottomGap) > 1 || c.under.length || c.contentUnder.length)
        record({
          ...b,
          check: 'bar',
          item: 'bottom chrome',
          state: problems.length ? 'FAIL' : 'PASS',
          value: chromes.length ? `${[...new Set(chromes.map((c) => c.kind))].join(', ')} · gaps ${[...new Set(chromes.map((c) => c.bottomGap))].join('/')}` : 'no fixed bottom chrome (in-flow)',
          detail: problems.map((c) => `${c.at}: gap ${c.bottomGap}px, under it ${c.contentUnder.length}`).join('; '),
        })
      } else if (!bar.length) {
        record({ ...b, check: 'bar', item: 'spine bar', state: 'FAIL', value: 'not present', detail: 'no visible [data-spine-bar] on an app surface below lg' })
      } else {
        const reasons: string[] = []
        const gaps = bar.map((c) => c.bottomGap)
        if (gaps.some((g) => Math.abs(g) > 1)) reasons.push(`bottom gap ${gaps.join('/')}px`)
        const missed = bar.filter((c) => !c.hit)
        if (missed.length) reasons.push(`a tap 10px above the edge hit "${missed[0].hitWhat}" (${missed[0].at})`)
        const underBy = bar.filter((c) => c.contentUnder.length || c.under.length)
        if (underBy.length) reasons.push(`content under the bar: ${underBy.map((c) => `${c.at} ${c.contentUnder.length} (${c.under.length} tappable)`).join(', ')} — e.g. ${[...underBy[0].under, ...underBy[0].contentUnder].slice(0, 3).join('; ')}`)
        if (docScrolls) reasons.push('the document scrolls under a fixed bar (drifts when iOS collapses its toolbar)')
        record({
          ...b,
          check: 'bar',
          item: 'spine bar',
          state: reasons.length ? 'FAIL' : 'PASS',
          value: `bottom ${bar[0].rect.b}/${f.vh} · under it ${bar.map((c) => c.contentUnder.length).join('/')} (top/mid/end)`,
          detail: reasons.join('; '),
        })
      }
    }
  }
  // 2b · the Ask pill, on every surface that shows it (brochure pages too)
  if (wantCheck('bar')) {
    const sweep = await evalNq<{ positions: number; covered: number; first: { y: number; what: string[] } | null } | null>(o.page, 'window.__nq.pillSweep()')
    if (sweep && !(sweep as unknown as { __error?: string }).__error) {
      record({
        ...b,
        check: 'bar',
        item: 'ask pill',
        state: sweep.covered ? 'FAIL' : 'PASS',
        value: `covers content at ${sweep.covered}/${sweep.positions} scroll positions`,
        detail: sweep.first ? `e.g. at y=${sweep.first.y}: ${sweep.first.what.join('; ')}` : '',
      })
    }
  }
  // 7 · overflow
  if (wantCheck('overflow')) {
    const docX = Math.max(...pos.map((p) => p.docOverflowX))
    const scX = Math.max(...pos.map((p) => p.scrollerOverflowX))
    let offenders = ''
    if (docX > 0 || scX > 0) {
      const w = await evalNq<{ what: string; right: number }[]>(o.page, 'window.__nq.wideOffenders()')
      offenders = Array.isArray(w) ? w.map((x) => `${x.what} →${x.right}`).join(', ') : ''
    }
    record({ ...b, check: 'overflow', item: '', state: docX > 0 || scX > 0 ? 'FAIL' : 'PASS', value: `document +${docX}px · scroller +${scX}px`, detail: offenders })
  }
  // 5 · targets (chrome = verdict; content = info)
  if (wantCheck('targets')) {
    const t = await evalNq<{ chrome: { what: string; w: number; h: number; ok: boolean; seat: boolean }[]; content: { what: string; w: number; h: number; ok: boolean }[] }>(o.page, 'window.__nq.targets()')
    if (t && !(t as unknown as { __error?: string }).__error) {
      const small = t.chrome.filter((c) => !c.ok)
      const contentSmall = t.content.filter((c) => !c.ok)
      // RULING (coordinator, R1): in landscape the bar's compact seats (≥32px
      // tall — iOS's own landscape tab bar is 32pt) are a DECISION for Nate,
      // not a FAIL. Any other small chrome control still fails the row.
      const landscape = size.width > size.height
      const seatCall = small.filter((c) => landscape && c.seat && c.h >= 32)
      const rest = small.filter((c) => !seatCall.includes(c))
      record({
        ...b,
        check: 'targets',
        item: 'chrome',
        state: rest.length ? 'FAIL' : seatCall.length ? 'DECISION' : 'PASS',
        value: `${small.length}/${t.chrome.length} chrome controls under 44px${seatCall.length ? ` (${seatCall.length} landscape bar seats ${seatCall[0].w}×${seatCall[0].h}: a decision)` : ''} · content ${contentSmall.length}/${t.content.length} (info)`,
        detail: (rest.length ? rest : seatCall).slice(0, 4).map((c) => `"${c.what}" ${c.w}×${c.h}`).join(', '),
      })
    }
  }
  // 6 · inputs
  if (wantCheck('inputs')) {
    const fields = await evalNq<{ what: string; tag: string; fs: number }[]>(o.page, 'window.__nq.fields()')
    if (Array.isArray(fields)) {
      const small = fields.filter((x) => x.fs < 16)
      record({
        ...b,
        check: 'inputs',
        item: '',
        state: small.length ? 'FAIL' : fields.length ? 'PASS' : 'N/A',
        value: fields.length ? `${small.length}/${fields.length} fields under 16px` : 'no visible fields',
        detail: small.slice(0, 4).map((x) => `${x.tag} "${x.what}" ${x.fs}px`).join(', '),
      })
    }
  }
  // 4 · nothing opens on its own (only on the LOAD size, before any resize)
  if (first && wantCheck('sheets')) {
    const panel = await evalNq<{ kind: string; id: string } | null>(o.page, 'window.__nq.openPanel()')
    const ov = await evalNq<{ what: string; frac: number; sheet: boolean }[]>(o.page, 'window.__nq.overlays()')
    const partial = Array.isArray(ov) ? ov.filter((x) => x.frac < 85) : []
    const opened = (panel && !(panel as unknown as { __error?: string }).__error ? [`${panel.kind} "${panel.id}"`] : []).concat(partial.map((x) => `${x.what} ${x.frac}% of the screen`))
    record({ ...b, check: 'sheets', item: 'on load', state: opened.length ? 'FAIL' : 'PASS', value: opened.length ? `${opened.length} open on load` : 'nothing open on load', detail: opened.slice(0, 3).join('; ') })
  }
}

async function layoutJob(run: Run, s: Surface, theme: Theme, session: { address: string; cookie: string } | null) {
  const sizes = theme === 'dark' && !QUICK ? [...PHONE_SIZES, PHONE_SIZES[0]] : [PHONE_SIZES[0]]
  const o = await openCtx(run, { size: sizes[0], theme, auth: s.auth, session })
  try {
    await load(o, s)
    if (o.ready.startsWith('goto failed')) {
      record({ ...base(run, sizes[0], theme, s), check: 'frame', item: '', state: 'FAIL', value: 'surface did not load', detail: o.ready })
      return
    }
    if (/timed out/.test(o.ready)) console.log(`  ·  ${run.profile} ${theme} ${s.path}: ${o.ready} (measured anyway)`)
    const pathNow = await o.page.evaluate('location.pathname').catch(() => '')
    const want = s.path.split('?')[0]
    if (pathNow !== want) {
      record({ ...base(run, sizes[0], theme, s), check: 'frame', item: '', state: 'FAIL', value: `redirected to ${pathNow}`, detail: `asked for ${s.path} (${o.ready})` })
      return
    }
    await shot(o, `${run.profile}-${sizes[0].id}-${theme}-${s.name}`)
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i]
      if (i > 0) {
        await o.page.setViewportSize({ width: size.width, height: size.height })
        await sleep(700)
      }
      const tagged = i === sizes.length - 1 && i > 0 ? { ...size, id: `${size.id}↺` } : size
      await layoutAt(run, o, s, tagged, theme, i === 0)
      if (i > 0 && size.id === '844x390') await shot(o, `${run.profile}-${size.id}-${theme}-${s.name}`)
    }
    // Mid-scroll picture of the surfaces Nate photographed.
    if (theme === 'dark' && (s.name === 'markets' || s.name === 't·AAPL')) {
      await o.page.setViewportSize({ width: 375, height: 812 })
      await o.page.evaluate(`(async () => { const sc = window.__nq.screenScroller().el; const y = Math.round((sc.scrollHeight - sc.clientHeight) / 2); if (sc === document.scrollingElement) scrollTo(0, y); else sc.scrollTop = y; await new Promise(r => setTimeout(r, 300)) })()`).catch(() => {})
      await shot(o, `${run.profile}-375x812-${theme}-${s.name}-midscroll`)
    }
    if (o.chatPosts && !s.path.startsWith('/i/')) console.log(`  ·  ${s.path}: ${o.chatPosts} POST /api/chat (fulfilled from the fixture)`)
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

// ── Check 3 · tabs ─────────────────────────────────────────────────────────
/** D2 (README): what a tap on each seat must do below lg. `tab` is the ?tab=
 *  value the URL must carry ('' = no tab param), `screen` the
 *  [data-phone-screen] value on /chat (null = not a /chat screen). */
type Expect = { path: string; tab: string | null; screen: string | string[] | null; lit: string; sheet?: boolean }
export const D2_FROM_CHAT: Record<string, Expect> = {
  MARKETS: { path: '/markets', tab: null, screen: null, lit: 'MARKETS' },
  APPS: { path: '/chat', tab: 'mcps', screen: 'apps', lit: 'APPS' },
  JOBS: { path: '/chat', tab: 'jobs', screen: 'jobs', lit: 'JOBS' },
  LINKS: { path: '/chat', tab: 'links', screen: 'links', lit: 'LINKS' },
  WALLET: { path: '/wallet', tab: null, screen: null, lit: 'WALLET' },
  CHATS: { path: '/chat', tab: 'chats', screen: 'history', lit: 'CHATS' },
  TEAM: { path: '/chat', tab: 'team', screen: 'team', lit: 'TEAM' },
  More: { path: '/chat', tab: null, screen: null, lit: '', sheet: true },
}
export const D2_FROM_MARKETS: Record<string, Expect> = {
  MARKETS: { path: '/markets', tab: null, screen: null, lit: 'MARKETS' },
  APPS: { path: '/chat', tab: 'mcps', screen: 'apps', lit: 'APPS' },
  JOBS: { path: '/chat', tab: 'jobs', screen: 'jobs', lit: 'JOBS' },
  LINKS: { path: '/chat', tab: 'links', screen: 'links', lit: 'LINKS' },
  WALLET: { path: '/wallet', tab: null, screen: null, lit: 'WALLET' },
  CHATS: { path: '/chat', tab: 'chats', screen: 'history', lit: 'CHATS' },
  TEAM: { path: '/chat', tab: 'team', screen: 'team', lit: 'TEAM' },
  More: { path: '/markets', tab: null, screen: null, lit: '', sheet: true },
}
/** Stateful sequences (D2): the tab keeps its stack; the lit tab pops to root. */
export const D2_SEQUENCES: { name: string; taps: string[]; expect: Expect }[] = [
  { name: 'APPS → CHATS returns to the conversation', taps: ['APPS', 'CHATS'], expect: { path: '/chat', tab: '', screen: 'chat', lit: 'CHATS' } },
  { name: 'CHATS → CHATS pops back to the conversation', taps: ['CHATS', 'CHATS'], expect: { path: '/chat', tab: '', screen: 'chat', lit: 'CHATS' } },
  { name: 'LINKS → LINKS stays on LINKS (root)', taps: ['LINKS', 'LINKS'], expect: { path: '/chat', tab: 'links', screen: 'links', lit: 'LINKS' } },
]

// ── D2 as NAV built it: lib/phone-nav `phoneTap` IS the contract (coordinator,
// R1: "judge against it, not a re-derivation"). The static tables above are
// the fallback for a tree without lib/phone-nav, and test:api pins that they
// agree with phoneTap seat by seat.
type NavSurface = 'chat' | 'markets' | 'wallet' | 'dashboard'
type PhoneNavMod = {
  phoneTap(i: { surface: NavSurface; screen: string; seat: string; pathname: string }):
    | { kind: 'screen'; screen: string }
    | { kind: 'top' }
    | { kind: 'navigate'; href: string; screen: string | null }
    | { kind: 'sheet'; sheet: string }
  litSeat(surface: NavSurface, screen: string): string
  tabForScreen(screen: string): string | null
}
/** The bar's aria-labels ↔ lib/phone-nav's seat ids. */
export const SEAT_ID: Record<string, string> = { MARKETS: 'markets', APPS: 'mcps', JOBS: 'jobs', LINKS: 'links', WALLET: 'wallet', TEAM: 'team', CHATS: 'chats', DOCS: 'docs', Settings: 'settings', More: 'more' }
const SEAT_LABEL: Record<string, string> = Object.fromEntries(Object.entries(SEAT_ID).map(([k, v]) => [v, k]))
export type NavState = { surface: NavSurface; screen: string; pathname: string }
function surfaceOfPath(path: string): NavSurface | null {
  if (path === '/chat' || path.startsWith('/chat/')) return 'chat'
  if (path === '/markets' || path.startsWith('/t/')) return 'markets'
  if (path === '/wallet') return 'wallet'
  if (path.startsWith('/dashboard')) return 'dashboard'
  return null
}
/** What a tap on `seat` must produce, per phoneTap, and the state after it. */
export function expectFromPhoneTap(nav: PhoneNavMod, from: NavState, seat: string): { expect: Expect; next: NavState } {
  const a = nav.phoneTap({ surface: from.surface, screen: from.screen, seat: SEAT_ID[seat] ?? seat, pathname: from.pathname })
  if (a.kind === 'sheet') return { expect: { path: from.pathname, tab: null, screen: null, lit: '', sheet: true }, next: from }
  if (a.kind === 'top') {
    const onChat = from.surface === 'chat'
    return {
      expect: { path: from.pathname, tab: onChat ? nav.tabForScreen(from.screen) ?? '' : null, screen: onChat ? from.screen : null, lit: SEAT_LABEL[nav.litSeat(from.surface, from.screen)] ?? '' },
      next: from,
    }
  }
  if (a.kind === 'screen') {
    return {
      expect: { path: '/chat', tab: nav.tabForScreen(a.screen) ?? '', screen: a.screen, lit: SEAT_LABEL[nav.litSeat('chat', a.screen)] ?? '' },
      next: { surface: 'chat', screen: a.screen, pathname: from.pathname },
    }
  }
  const u = new URL(a.href, 'http://drive.local')
  const dest = surfaceOfPath(u.pathname)
  const screen = dest === 'chat' ? a.screen ?? 'chat' : 'chat'
  return {
    expect: {
      path: u.pathname,
      tab: dest === 'chat' ? u.searchParams.get('tab') ?? '' : null,
      screen: dest === 'chat' ? screen : null,
      lit: dest ? SEAT_LABEL[nav.litSeat(dest, screen)] ?? '' : '',
    },
    next: { surface: dest ?? from.surface, screen, pathname: u.pathname },
  }
}
let PHONE_NAV: PhoneNavMod | null | undefined
async function phoneNav(): Promise<PhoneNavMod | null> {
  if (PHONE_NAV === undefined) {
    try {
      PHONE_NAV = (await import('../lib/phone-nav')) as unknown as PhoneNavMod
    } catch {
      PHONE_NAV = null
    }
  }
  return PHONE_NAV
}
const originState = (origin: Surface): NavState => ({
  surface: origin.path.startsWith('/chat') ? 'chat' : 'markets',
  screen: 'chat',
  pathname: origin.path.split('?')[0],
})

type TapState = { url: string; path: string; tab: string | null; lit: string[]; screen: string | null; overlays: { what: string; frac: number; sheet: boolean; scrimOnPage: boolean }[]; panel: { kind: string; id: string } | null }

async function readTapState(page: Pw): Promise<TapState> {
  const st = (await page
    .evaluate(`(() => ({ url: location.pathname + location.search, path: location.pathname, tab: new URLSearchParams(location.search).get('tab'), lit: window.__nq.litSeats(), screen: window.__nq.screen(), overlays: window.__nq.overlays(), panel: window.__nq.openPanel() }))()`)
    .catch((e: Error) => ({ url: '?', path: '?', tab: null, lit: [], screen: null, overlays: [], panel: null, err: e.message }))) as TapState
  return st
}

async function tapSeat(page: Pw, seat: string): Promise<boolean> {
  const loc = page.locator(`[data-spine-bar] [aria-label="${seat}"]`).first()
  if (!(await loc.count().catch(() => 0))) return false
  if (!(await loc.isVisible().catch(() => false))) return false
  await loc.tap({ timeout: 5_000 }).catch(async () => loc.click({ timeout: 5_000 }).catch(() => {}))
  return true
}

function judgeTap(st: TapState, ex: Expect): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const drawers = st.overlays.filter((x) => x.frac < 85 && !x.sheet)
  if (drawers.length) reasons.push(`a drawer popped: ${drawers[0].what} covers ${drawers[0].frac}% ${drawers[0].scrimOnPage ? 'over a scrim' : 'with NO scrim'}`)
  if (ex.sheet) {
    if (!st.panel || st.panel.kind !== 'sheet') reasons.push(st.panel ? `opened a ${st.panel.kind} "${st.panel.id}", not the Sheet primitive` : 'no Sheet opened')
  } else if (st.panel) {
    reasons.push(`a ${st.panel.kind} "${st.panel.id}" opened on a tab tap`)
  }
  if (st.path !== ex.path) reasons.push(`path ${st.path} (want ${ex.path})`)
  if (ex.tab !== null && ex.tab !== '*') {
    if ((st.tab ?? '') !== ex.tab) reasons.push(`?tab=${st.tab ?? '∅'} (want ${ex.tab || '∅'})`)
  }
  if (ex.lit && !st.lit.includes(ex.lit)) reasons.push(`lit [${st.lit.join(',') || 'none'}] (want ${ex.lit})`)
  if (ex.screen) {
    const want = Array.isArray(ex.screen) ? ex.screen : [ex.screen]
    if (st.screen === null) reasons.push(`screen hook [data-phone-screen] not present (want ${want.join('|')})`)
    else if (!want.includes(st.screen)) reasons.push(`screen ${st.screen} (want ${want.join('|')})`)
  }
  return { ok: reasons.length === 0, reasons }
}

async function tabsJob(run: Run, origin: Surface, seat: string, exStatic: Expect) {
  const size = PHONE_SIZES[0]
  const nav = await phoneNav()
  const ex = nav ? expectFromPhoneTap(nav, originState(origin), seat).expect : exStatic
  const judge = nav ? 'phoneTap' : 'D2 table'
  const o = await openCtx(run, { size, theme: 'dark', auth: 'wallet' })
  const b = { ...base(run, size, 'dark', origin), check: 'tabs' as CheckId, item: `tap ${seat}` }
  try {
    await load(o, origin)
    const seats = (await o.page.evaluate('window.__nq.seats()').catch(() => [])) as string[]
    if (!seats.includes(seat)) {
      record({ ...b, state: seat === 'TEAM' ? 'N/A' : 'FAIL', value: 'seat not visible', detail: `bar seats: ${seats.join(' · ') || 'none'}` })
      return
    }
    await tapSeat(o.page, seat)
    const moves = ex.path !== origin.path.split('?')[0]
    await sleep(moves ? 2600 : 1400)
    if (moves) await o.page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {})
    const st = await readTapState(o.page)
    const j = judgeTap(st, ex)
    await shot(o, `${run.profile}-tabs-${origin.name}-${seat}`)
    record({ ...b, state: j.ok ? 'PASS' : 'FAIL', value: `→ ${st.url} · lit ${st.lit.join(',') || 'none'} · screen ${st.screen ?? '∅'} (vs ${judge})`, detail: j.reasons.join('; ') })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

async function tabsAtRest(run: Run) {
  const size = PHONE_SIZES[0]
  const chat = SURFACES[0]
  const o = await openCtx(run, { size, theme: 'dark', auth: 'wallet' })
  try {
    await load(o, chat)
    const st = await readTapState(o.page)
    const reasons: string[] = []
    if (!st.lit.includes('CHATS')) reasons.push(`lit [${st.lit.join(',') || 'none'}] (want CHATS: the conversation is the CHATS tab)`)
    if (st.screen === null) reasons.push('screen hook [data-phone-screen] not present (want chat)')
    else if (st.screen !== 'chat') reasons.push(`screen ${st.screen} (want chat)`)
    record({ ...base(run, size, 'dark', chat), check: 'tabs', item: 'at rest', state: reasons.length ? 'FAIL' : 'PASS', value: `lit ${st.lit.join(',') || 'none'} · screen ${st.screen ?? '∅'}`, detail: reasons.join('; ') })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

/** CHAT's conversation top bar: labeled doors into the phone screens
 *  (`data-phone-open="history" | "apps"`), judged exactly like a seat tap. */
export const TOP_BAR_DOORS: { door: string; expect: Expect }[] = [
  { door: 'history', expect: { path: '/chat', tab: 'chats', screen: 'history', lit: 'CHATS' } },
  { door: 'apps', expect: { path: '/chat', tab: 'mcps', screen: 'apps', lit: 'APPS' } },
]

async function topBarDoorJob(run: Run, d: (typeof TOP_BAR_DOORS)[number]) {
  const size = PHONE_SIZES[0]
  const chat = SURFACES[0]
  const o = await openCtx(run, { size, theme: 'dark', auth: 'wallet' })
  const b = { ...base(run, size, 'dark', chat), check: 'tabs' as CheckId, item: `top bar → ${d.door}` }
  try {
    await load(o, chat)
    const tapped = await tapFirst(o.page, [`[data-phone-open="${d.door}"]`])
    if (!tapped) {
      record({ ...b, state: 'FAIL', value: 'not present', detail: `no visible [data-phone-open="${d.door}"] in the conversation's top bar` })
      return
    }
    await sleep(1400)
    const st = await readTapState(o.page)
    const j = judgeTap(st, d.expect)
    record({ ...b, state: j.ok ? 'PASS' : 'FAIL', value: `→ ${st.url} · lit ${st.lit.join(',') || 'none'} · screen ${st.screen ?? '∅'}`, detail: j.reasons.join('; ') })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

async function tabsSequence(run: Run, seq: (typeof D2_SEQUENCES)[number]) {
  const size = PHONE_SIZES[0]
  const chat = SURFACES[0]
  const nav = await phoneNav()
  let expect = seq.expect
  if (nav) {
    let st: NavState = originState(chat)
    for (const seat of seq.taps) {
      const r = expectFromPhoneTap(nav, st, seat)
      expect = r.expect
      st = r.next
    }
  }
  const o = await openCtx(run, { size, theme: 'dark', auth: 'wallet' })
  try {
    await load(o, chat)
    for (const seat of seq.taps) {
      await tapSeat(o.page, seat)
      await sleep(1400)
    }
    const st = await readTapState(o.page)
    const j = judgeTap(st, expect)
    record({ ...base(run, size, 'dark', chat), check: 'tabs', item: seq.name, state: j.ok ? 'PASS' : 'FAIL', value: `→ ${st.url} · lit ${st.lit.join(',') || 'none'} · screen ${st.screen ?? '∅'} (vs ${nav ? 'phoneTap' : 'D2 table'})`, detail: j.reasons.join('; ') })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

// ── Check 4 · sheets ───────────────────────────────────────────────────────
type Trigger = {
  id: string
  surface: Surface
  auth: Auth
  /** Opens the panel; returns false when its trigger isn't on the page. */
  open(page: Pw): Promise<boolean>
}

async function tapFirst(page: Pw, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel)
    const n = await loc.count().catch(() => 0)
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i)
      if (await el.isVisible().catch(() => false)) {
        await el.tap({ timeout: 5_000 }).catch(async () => el.click({ timeout: 5_000 }).catch(() => {}))
        return true
      }
    }
  }
  return false
}

const S_CHAT = SURFACES.find((s) => s.path === '/chat')!
const S_MARKETS = SURFACES.find((s) => s.path === '/markets')!
const S_LANDING = SURFACES.find((s) => s.path === '/')!
const S_DASH = SURFACES.find((s) => s.path === '/dashboard')!
const S_LINKS = SURFACES.find((s) => s.path === '/chat?tab=links')!

/** The panels that exist today (legacy) and the ones the lanes promise. A
 *  lane's new Sheet with a `data-sheet-open` trigger is found on its own. */
const TRIGGERS: Trigger[] = [
  { id: 'MORE', surface: S_CHAT, auth: 'wallet', open: (p) => tapFirst(p, ['[data-sheet-open="more"]', '[data-spine-bar] [aria-label="More"]']) },
  { id: 'ask door', surface: S_MARKETS, auth: 'wallet', open: (p) => tapFirst(p, ['[data-sheet-open="ask"]', '[data-ask-door="pill"]', '[data-ask-door]']) },
  { id: 'account menu', surface: S_MARKETS, auth: 'wallet', open: (p) => tapFirst(p, ['[data-sheet-open="account"]', '.navacct__pill']) },
  {
    id: 'wallet details',
    surface: S_MARKETS,
    auth: 'wallet',
    open: async (p) => {
      if (await tapFirst(p, ['[data-sheet-open="wallet"]'])) return true
      // The item lives INSIDE the account sheet (PAGES R1: data-sheet-open="wallet").
      if (!(await tapFirst(p, ['[data-sheet-open="account"]', '.navacct__pill']))) return false
      await sleep(600)
      return tapFirst(p, ['[data-sheet-open="wallet"]', '[role=menuitem]:has-text("Wallet details")', 'button:has-text("Wallet details")', 'a:has-text("Wallet details")'])
    },
  },
  { id: 'sign-in door', surface: S_MARKETS, auth: 'none', open: (p) => tapFirst(p, ['[data-sheet-open="door"]', 'button:has-text("Sign in")', 'a:has-text("Sign in")']) },
  { id: 'brochure menu', surface: S_LANDING, auth: 'none', open: (p) => tapFirst(p, ['[data-sheet-open="nav"]', 'button[aria-label="Open menu"]']) },
  { id: 'dashboard menu', surface: S_DASH, auth: 'siwe', open: (p) => tapFirst(p, ['[data-sheet-open="dashnav"]', 'button[aria-label="Open menu"]']) },
  { id: 'links list', surface: S_LINKS, auth: 'wallet', open: (p) => tapFirst(p, ['[data-sheet-open="links"]']) },
  // (The chat list is the history SCREEN, not a Sheet — coordinator R1 ruling;
  // the tabs rows judge it. No 'chats' sheet row.)
]

async function dismissBy(o: Opened, how: 'outside' | 'escape' | 'swipe' | 'back'): Promise<{ closed: boolean; stayed: boolean; note: string }> {
  const { page } = o
  const before = (await page.evaluate('location.href').catch(() => '')) as string
  let note = ''
  if (how === 'outside') {
    const pt = (await page.evaluate('window.__nq.outsidePoint()').catch(() => null)) as { x: number; y: number; what: string } | null
    if (!pt) return { closed: false, stayed: true, note: 'no point outside the panel (it covers the whole screen)' }
    note = `tapped "${pt.what}" at ${pt.x},${pt.y}`
    await page.touchscreen.tap(pt.x, pt.y).catch(async () => page.mouse.click(pt.x, pt.y).catch(() => {}))
  } else if (how === 'escape') {
    await page.keyboard.press('Escape').catch(() => {})
  } else if (how === 'swipe') {
    const g = (await page.evaluate('window.__nq.grabPoint()').catch(() => null)) as { x: number; y: number; side: string | null; rect: { x: number; y: number; w: number; h: number } } | null
    if (!g) return { closed: false, stayed: true, note: 'no panel to swipe' }
    const side = g.side ?? (g.rect.x <= 4 && g.rect.w < 360 ? 'left' : 'bottom')
    const start = side === 'left' ? { x: Math.max(8, g.rect.x + g.rect.w - 24), y: g.rect.y + Math.round(g.rect.h / 2) } : { x: g.x, y: g.y }
    const end = side === 'left' ? { x: 4, y: start.y } : { x: start.x, y: Math.min(start.y + 320, 2000) }
    // A real touch drag first (trusted touch → pointerType 'touch'), then a
    // mouse drag (pointerType 'mouse') — a Sheet may listen to either.
    let tried = 'touch'
    try {
      const cdp = await o.ctx.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] })
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + ((end.x - start.x) * i) / 10, y: start.y + ((end.y - start.y) * i) / 10 }] })
        await sleep(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await cdp.detach().catch(() => {})
    } catch {
      tried = 'touch unavailable'
    }
    await sleep(600)
    if (await page.evaluate('window.__nq.panelOpen()').catch(() => true)) {
      tried += ' + mouse'
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(start.x + ((end.x - start.x) * i) / 10, start.y + ((end.y - start.y) * i) / 10)
        await sleep(16)
      }
      await page.mouse.up()
    }
    note = `${side} swipe (${tried})`
  } else {
    await page.evaluate('history.back()').catch(() => {})
    await sleep(900)
  }
  await sleep(650)
  const closed = !(await page.evaluate('window.__nq ? window.__nq.panelOpen() : false').catch(() => false))
  const after = (await page.evaluate('location.href').catch(() => '')) as string
  return { closed, stayed: after === before, note: note || (after !== before ? `→ ${after}` : '') }
}

async function sheetJob(run: Run, t: Trigger, session: { address: string; cookie: string } | null) {
  const size = PHONE_SIZES[0]
  const o = await openCtx(run, { size, theme: 'dark', auth: t.auth, session })
  const b = { ...base(run, size, 'dark', t.surface), check: 'sheets' as CheckId, item: t.id }
  try {
    await load(o, t.surface)
    const opened = async () => {
      const ok = await t.open(o.page)
      if (!ok) return null
      await sleep(900)
      return (await o.page.evaluate('window.__nq.openPanel()').catch(() => null)) as { kind: string; id: string; side: string; rect: { h: number } } | null
    }
    const first = await opened()
    if (!first) {
      record({ ...b, state: 'FAIL', value: 'not present', detail: `no trigger on ${t.surface.path}, or it opened nothing recognizable (${o.ready})` })
      return
    }
    await shot(o, `${run.profile}-sheet-${t.id}`)
    // Controls + fields inside the open panel (checks 5 and 6).
    if (wantCheck('targets')) {
      const tg = (await o.page.evaluate(`window.__nq.targets('[data-nq-panel]')`).catch(() => null)) as { chrome: { what: string; w: number; h: number; ok: boolean }[] } | null
      if (tg) {
        const small = tg.chrome.filter((c) => !c.ok)
        record({ ...b, check: 'targets', item: `sheet: ${t.id}`, state: small.length ? 'FAIL' : 'PASS', value: `${small.length}/${tg.chrome.length} controls under 44px`, detail: small.slice(0, 4).map((c) => `"${c.what}" ${c.w}×${c.h}`).join(', ') })
      }
    }
    if (wantCheck('inputs')) {
      const fields = (await o.page.evaluate(`window.__nq.fields('[data-nq-panel]')`).catch(() => [])) as { what: string; tag: string; fs: number }[]
      if (fields.length) {
        const small = fields.filter((x) => x.fs < 16)
        record({ ...b, check: 'inputs', item: `sheet: ${t.id}`, state: small.length ? 'FAIL' : 'PASS', value: `${small.length}/${fields.length} fields under 16px`, detail: small.slice(0, 3).map((x) => `${x.tag} "${x.what}" ${x.fs}px`).join(', ') })
      }
    }
    const results: { how: string; ok: boolean; note: string }[] = []
    for (const how of ['outside', 'escape', 'swipe', 'back'] as const) {
      if (!(await o.page.evaluate('window.__nq.panelOpen()').catch(() => false))) {
        const again = await opened()
        if (!again) {
          results.push({ how, ok: false, note: 'could not reopen' })
          continue
        }
      }
      const r = await dismissBy(o, how)
      const ok = r.closed && (how !== 'back' || r.stayed)
      results.push({ how, ok, note: !r.closed ? `stayed open${r.note ? ` (${r.note})` : ''}` : how === 'back' && !r.stayed ? `closed but LEFT the page (${r.note})` : r.note })
      if (!r.stayed && how !== 'back') {
        await load(o, t.surface)
      }
      if (!r.closed) {
        // Force it shut before the next way: Escape, its close button, a reload.
        await o.page.keyboard.press('Escape').catch(() => {})
        await sleep(300)
        if (await o.page.evaluate('window.__nq.panelOpen()').catch(() => false)) {
          await tapFirst(o.page, ['[data-nq-panel] [aria-label="Close"]', '[data-nq-panel] [aria-label="Close menu"]'])
          await sleep(400)
        }
        if (await o.page.evaluate('window.__nq.panelOpen()').catch(() => false)) await load(o, t.surface)
      }
    }
    const failed = results.filter((r) => !r.ok)
    record({
      ...b,
      state: failed.length || first.kind !== 'sheet' ? 'FAIL' : 'PASS',
      value: `${first.kind === 'sheet' ? `Sheet "${first.id}"` : `legacy ${first.id}`} · closes on ${results.filter((r) => r.ok).map((r) => r.how).join('+') || 'nothing'}`,
      detail: [first.kind !== 'sheet' ? 'not the Sheet primitive' : '', ...failed.map((r) => `${r.how}: ${r.note}`)].filter(Boolean).join('; '),
    })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

/** An in-app LINK inside a sheet navigates and LANDS (coordinator, R1→R2):
 *  the sheet's deferred history pop must neither abort the navigation nor
 *  bounce it back. RSC fetches are held 300ms so the pop races a navigation
 *  that is still in flight. */
/** The RSC hold for the sheet-link row (`--rsc-delay=0` isolates the race). */
const RSC_DELAY_MS = Number(arg('rsc-delay') || 300)
export type SheetLink = { id: string; surface: Surface; auth: Auth; sheet: string; href: string; open(page: Pw): Promise<boolean> }
export const SHEET_LINKS: SheetLink[] = [
  { id: 'MORE → Docs', surface: S_CHAT, auth: 'wallet', sheet: 'more', href: '/docs', open: (p) => tapFirst(p, ['[data-sheet-open="more"]', '[data-spine-bar] [aria-label="More"]']) },
  { id: 'MORE → Settings', surface: S_CHAT, auth: 'siwe', sheet: 'more', href: '/dashboard', open: (p) => tapFirst(p, ['[data-sheet-open="more"]', '[data-spine-bar] [aria-label="More"]']) },
  { id: 'brochure menu → Pricing', surface: S_LANDING, auth: 'none', sheet: 'nav', href: '/pricing', open: (p) => tapFirst(p, ['[data-sheet-open="nav"]', 'button[aria-label="Open menu"]']) },
  { id: 'account menu → Dashboard', surface: S_MARKETS, auth: 'siwe', sheet: 'account', href: '/dashboard', open: (p) => tapFirst(p, ['[data-sheet-open="account"]', '.navacct__pill']) },
]

async function sheetLinkJob(run: Run, c: SheetLink, session: { address: string; cookie: string } | null) {
  const size = PHONE_SIZES[0]
  const o = await openCtx(run, { size, theme: 'dark', auth: c.auth, session, rscDelayMs: RSC_DELAY_MS })
  const b = { ...base(run, size, 'dark', c.surface), check: 'sheets' as CheckId, item: `link: ${c.id}` }
  try {
    await load(o, c.surface)
    if (!(await c.open(o.page))) {
      record({ ...b, state: 'FAIL', value: 'not present', detail: `no trigger for the ${c.sheet} sheet on ${c.surface.path} (${o.ready})` })
      return
    }
    await sleep(900)
    const panel = (await o.page.evaluate('window.__nq.openPanel()').catch(() => null)) as { kind: string; id: string } | null
    const link = o.page.locator(`[data-nq-panel] a[href="${c.href}"]`).first()
    if (!panel || !(await link.count().catch(() => 0))) {
      record({ ...b, state: 'FAIL', value: 'not present', detail: panel ? `the ${panel.kind} "${panel.id}" has no a[href="${c.href}"]` : 'no panel opened' })
      return
    }
    await o.page.evaluate('window.__nqMark = 1').catch(() => {})
    // Every main-frame URL change, same-document ones included: a landing that
    // lasts 36ms (MEASURED: /docs, then a deferred history.back() popped it)
    // is invisible to a poll.
    const navTrail: string[] = []
    const onNav = (f: Pw) => {
      if (f === o.page.mainFrame()) {
        try {
          navTrail.push(new URL(f.url()).pathname)
        } catch {
          /* about:blank */
        }
      }
    }
    o.page.on('framenavigated', onNav)
    const t0 = Date.now()
    await link.tap({ timeout: 5_000 }).catch(async () => link.click({ timeout: 5_000 }).catch(() => {}))
    let landedAt = -1
    const trail: string[] = []
    while (Date.now() - t0 < 8_000) {
      const path = (await o.page.evaluate('location.pathname').catch(() => '')) as string
      if (path && trail[trail.length - 1] !== path) trail.push(path)
      if (path === c.href) {
        landedAt = Date.now() - t0
        break
      }
      await sleep(120)
    }
    // A bounce is a deferred pop that fires AFTER the landing: hold and look again.
    const bounce: string[] = []
    const holdUntil = Date.now() + 1_600
    while (landedAt >= 0 && Date.now() < holdUntil) {
      const path = (await o.page.evaluate('location.pathname').catch(() => '')) as string
      if (path && path !== c.href && !bounce.includes(path)) bounce.push(path)
      await sleep(150)
    }
    const after = (await o.page
      .evaluate(`(() => ({ path: location.pathname, soft: window.__nqMark === 1, sheetOpen: [...document.querySelectorAll('[data-sheet]')].some((s) => window.__nq && window.__nq.vis(s.querySelector('[role=dialog]') || s)) }))()`)
      .catch(() => ({ path: '?', soft: false, sheetOpen: false }))) as { path: string; soft: boolean; sheetOpen: boolean }
    o.page.off?.('framenavigated', onNav)
    const reasons: string[] = []
    const touched = navTrail.includes(c.href)
    if (landedAt < 0 && touched) reasons.push(`landed on ${c.href}, then bounced: ${navTrail.join(' → ')} — a deferred history pop undid the navigation`)
    else if (landedAt < 0) reasons.push(`never landed on ${c.href} in 8s (path trail ${trail.join(' → ')}) — the navigation was aborted`)
    if (bounce.length) reasons.push(`bounced after landing: ${c.href} → ${bounce.join(' → ')}`)
    if (after.path !== c.href && landedAt >= 0 && !bounce.length) reasons.push(`ended on ${after.path}`)
    if (after.sheetOpen) reasons.push('a sheet is still open on the destination')
    record({
      ...b,
      state: reasons.length ? 'FAIL' : 'PASS',
      value: `→ ${after.path}${landedAt >= 0 ? ` in ${landedAt}ms` : ''} · ${after.soft ? 'soft (client) navigation' : 'HARD reload'} · RSC +${RSC_DELAY_MS}ms`,
      detail: reasons.join('; '),
    })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

/** Every labeled tap a lane marked `data-sheet-open` on a surface. */
async function discoveredSheets(run: Run, s: Surface, session: { address: string; cookie: string } | null): Promise<Trigger[]> {
  const o = await openCtx(run, { size: PHONE_SIZES[0], theme: 'dark', auth: s.auth, session })
  try {
    await load(o, s)
    const ids = (await o.page.evaluate(`[...document.querySelectorAll('[data-sheet-open]')].filter(e => window.__nq.vis(e)).map(e => e.getAttribute('data-sheet-open'))`).catch(() => [])) as string[]
    return [...new Set(ids)]
      .filter((id) => !['more', 'ask', 'account', 'wallet', 'door', 'nav', 'dashnav', 'links', 'chats'].includes(id))
      .map((id) => ({ id: `${id} (discovered)`, surface: s, auth: s.auth, open: (p: Pw) => tapFirst(p, [`[data-sheet-open="${id}"]`]) }))
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

// ── Check 8 · keyboard ─────────────────────────────────────────────────────
async function keyboardJob(run: Run, s: Surface) {
  const size = PHONE_SIZES[0]
  const o = await openCtx(run, { size, theme: 'dark', auth: s.auth })
  const b = { ...base(run, size, 'dark', s), check: 'keyboard' as CheckId, item: 'composer' }
  try {
    await load(o, s)
    const ta = o.page.locator('textarea').last()
    if (!(await ta.count().catch(() => 0)) || !(await ta.isVisible().catch(() => false))) {
      record({ ...b, state: 'FAIL', value: 'no composer', detail: `no visible textarea (${o.ready})` })
      return
    }
    await ta.tap({ timeout: 5_000 }).catch(async () => ta.click({ timeout: 5_000 }).catch(() => {}))
    const KB = 336
    const up = (await o.page
      .evaluate(`(async () => {
        const vv = window.visualViewport
        const H = innerHeight
        Object.defineProperty(vv, 'height', { configurable: true, get: () => H - ${KB} })
        Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
        vv.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'))
        await new Promise(r => setTimeout(r, 450))
        const bar = document.querySelector('[data-spine-bar]')
        const br = bar ? bar.getBoundingClientRect() : null
        const barHidden = !bar || !window.__nq.vis(bar) || br.top >= innerHeight - 1 || +getComputedStyle(bar).opacity < 0.05
        return { flag: document.documentElement.hasAttribute('data-keyboard'), kbInset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim(), barHidden, hasBar: !!bar, comp: window.__nq.composer(), vvBottom: H - ${KB} }
      })()`)
      .catch((e: Error) => ({ err: e.message }))) as { flag: boolean; kbInset: string; barHidden: boolean; hasBar: boolean; comp: { box: { b: number } } | null; vvBottom: number; err?: string }
    const down = (await o.page
      .evaluate(`(async () => {
        const vv = window.visualViewport
        delete vv.height; delete vv.offsetTop
        const ta = [...document.querySelectorAll('textarea')].pop()
        if (ta) { ta.blur(); ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }
        vv.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'))
        await new Promise(r => setTimeout(r, 450))
        const bar = document.querySelector('[data-spine-bar]')
        return { flag: document.documentElement.hasAttribute('data-keyboard'), barVisible: !bar || window.__nq.vis(bar) }
      })()`)
      .catch(() => ({ flag: true, barVisible: false }))) as { flag: boolean; barVisible: boolean }
    if (up.err) {
      record({ ...b, state: 'FAIL', value: 'probe crashed', detail: up.err })
      return
    }
    const reasons: string[] = []
    if (!up.flag) reasons.push('not present: html[data-keyboard] never set')
    if (up.hasBar && !up.barHidden) reasons.push('the bar stayed up over the keyboard')
    const compBottom = up.comp?.box.b ?? -1
    const gap = up.vvBottom - compBottom
    if (compBottom < 0) reasons.push('no composer box')
    else if (gap < -2 || gap > 80) reasons.push(`composer bottom ${compBottom} vs keyboard top ${up.vvBottom} (gap ${gap}px: ${gap < 0 ? 'UNDER the keyboard' : 'floating above it'})`)
    if (down.flag) reasons.push('html[data-keyboard] stuck after focusout')
    if (!down.barVisible) reasons.push('the bar did not come back after focusout')
    record({ ...b, state: reasons.length ? 'FAIL' : 'PASS', value: `flag ${up.flag ? 'on' : 'off'} · --kb-inset ${up.kbInset || '∅'} · bar ${up.hasBar ? (up.barHidden ? 'hidden' : 'UP') : 'n/a'} · composer gap ${gap}px`, detail: reasons.join('; ') })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

// ── Check 9 · theme-color ──────────────────────────────────────────────────
type TC = { theme: string | null; meta: string | null; metas: string[]; bg: string; metaRgb: number[] | null; bgRgb: number[] }
const close3 = (a: number[] | null, b: number[] | null) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 3)

async function themeColorJob(run: Run, s: Surface) {
  const size = PHONE_SIZES[0]
  // OS dark, SITE light: a meta that follows only prefers-color-scheme fails.
  const o = await openCtx(run, { size, theme: 'light', os: 'dark', auth: s.auth })
  const b = { ...base(run, size, 'light', s), check: 'themecolor' as CheckId, item: 'follows the site theme' }
  try {
    await load(o, s)
    const page = o.page
    const steps: { label: string; st: TC }[] = []
    steps.push({ label: 'site light · OS dark', st: (await page.evaluate('window.__nq.themeColor()')) as TC })
    const toggle = async (mode: 'dark' | 'light') => {
      const btn = page.locator(`.themetog [aria-label="${mode === 'dark' ? 'Dark theme' : 'Light theme'}"]`).first()
      if ((await btn.count().catch(() => 0)) && (await btn.isVisible().catch(() => false))) {
        await btn.scrollIntoViewIfNeeded().catch(() => {})
        await btn.click({ timeout: 4000 }).catch(() => {})
        return 'footer toggle'
      }
      await page.evaluate(`(() => { try { localStorage.setItem('yf-theme', '${mode}') } catch {} ; document.documentElement.dataset.theme = '${mode}'; document.documentElement.classList.toggle('dark', '${mode}' === 'dark') })()`)
      return 'data-theme (no toggle on this page)'
    }
    const via1 = await toggle('dark')
    await sleep(600)
    steps.push({ label: `→ dark via ${via1}`, st: (await page.evaluate('window.__nq.themeColor()')) as TC })
    const via2 = await toggle('light')
    await sleep(600)
    steps.push({ label: `→ light via ${via2}`, st: (await page.evaluate('window.__nq.themeColor()')) as TC })
    const bad = steps.filter((x) => !close3(x.st.metaRgb, x.st.bgRgb))
    record({
      ...b,
      state: bad.length ? 'FAIL' : 'PASS',
      value: steps.map((x) => `${x.st.theme}: meta ${x.st.meta ?? '∅'} vs --bg ${x.st.bg || '∅'}`).join(' | '),
      detail: bad.map((x) => `${x.label}: meta rgb(${x.st.metaRgb?.join(',') ?? '∅'}) ≠ --bg rgb(${x.st.bgRgb.join(',')})`).join('; '),
    })
  } catch (e) {
    record({ ...b, state: 'FAIL', value: 'probe crashed', detail: (e as Error).message.split('\n')[0] })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

// ── Check 10 · manifest ────────────────────────────────────────────────────
async function manifestCheck() {
  const b = { check: 'manifest' as CheckId, engine: 'chrome' as EngineId, profile: '-' as const, size: '-', theme: '-' as const, surface: '/' }
  const html = await (await fetch(BASE + '/', { headers: { 'x-yf-internal-run': '1' } }).catch(() => null))?.text().catch(() => '') ?? ''
  const href = /<link[^>]+rel="manifest"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? /<link[^>]+href="([^"]+)"[^>]*rel="manifest"/.exec(html)?.[1] ?? null
  const apple = /<meta[^>]+name="(?:apple-mobile-web-app-capable|mobile-web-app-capable)"[^>]*>/.exec(html)?.[0] ?? null
  const appleTitle = /<meta[^>]+name="apple-mobile-web-app-title"[^>]*content="([^"]*)"/.exec(html)?.[1] ?? null
  const status = /<meta[^>]+name="apple-mobile-web-app-status-bar-style"[^>]*content="([^"]*)"/.exec(html)?.[1] ?? null
  if (!href) {
    const guess = await fetch(BASE + '/manifest.webmanifest').then((r) => r.status).catch(() => 0)
    record({ ...b, item: 'web app manifest', state: 'FAIL', value: 'not present', detail: `no <link rel="manifest"> on / (GET /manifest.webmanifest → ${guess}); apple-web-app meta: ${apple ? 'yes' : 'none'}` })
    return
  }
  const url = new URL(href, BASE).href
  const res = await fetch(url).catch(() => null)
  let m: { display?: string; icons?: { src: string; sizes?: string; purpose?: string }[]; name?: string; short_name?: string; start_url?: string; theme_color?: string; background_color?: string } = {}
  try {
    m = res && res.ok ? await res.json() : {}
  } catch {
    m = {}
  }
  const reasons: string[] = []
  if (!res || !res.ok) reasons.push(`GET ${href} → ${res?.status ?? 'failed'}`)
  if (m.display !== 'standalone') reasons.push(`display ${m.display ?? '∅'} (want standalone)`)
  const icons = m.icons ?? []
  const iconFor = (sz: string) => icons.find((i) => (i.sizes ?? '').split(/\s+/).includes(sz))
  for (const sz of ['192x192', '512x512']) {
    const icon = iconFor(sz)
    if (!icon) {
      reasons.push(`no ${sz} icon`)
      continue
    }
    const r = await fetch(new URL(icon.src, url).href).catch(() => null)
    const ct = r?.headers.get('content-type') ?? ''
    if (!r || r.status !== 200 || !/^image\//.test(ct)) reasons.push(`${sz} icon ${icon.src} → ${r?.status ?? 'failed'} ${ct}`)
  }
  record({
    ...b,
    item: 'web app manifest',
    state: reasons.length ? 'FAIL' : 'PASS',
    value: `${href} · display ${m.display ?? '∅'} · ${icons.length} icons · start ${m.start_url ?? '∅'} · apple meta ${apple ? 'yes' : 'no'}${appleTitle ? ` "${appleTitle}"` : ''}${status ? ` · status bar ${status}` : ''}`,
    detail: reasons.join('; '),
  })
}

// ── Check 11 · desktop unchanged ───────────────────────────────────────────
type Rects = Record<string, { x: number; y: number; w: number; h: number } | null>
const DESKTOP_SURFACES: { path: string; auth: Auth; name: string; parts: Record<string, string>; heightMatters: string[] }[] = [
  { path: '/chat', auth: 'wallet', name: 'chat', parts: { spine: 'aside[aria-label="Workspace"]', bar: '[data-spine-bar]', drawer: 'main aside:not([aria-label="Workspace"]), aside:not([aria-label="Workspace"])', composer: 'textarea' }, heightMatters: ['spine', 'drawer'] },
  { path: '/chat?tab=links', auth: 'wallet', name: 'chat·links', parts: { spine: 'aside[aria-label="Workspace"]', drawer: 'aside:not([aria-label="Workspace"])' }, heightMatters: ['spine', 'drawer'] },
  { path: '/markets', auth: 'wallet', name: 'markets', parts: { spine: 'aside[aria-label="Workspace"]', bar: '[data-spine-bar]', frame: '.mkt-frame', rail: '.mkt-frame__rail', side: '.mkt-frame__side', top: '.mkt-top, [class*="mkt-top"]' }, heightMatters: ['spine', 'rail'] },
  { path: '/t/AAPL', auth: 'wallet', name: 't·AAPL', parts: { spine: 'aside[aria-label="Workspace"]', frame: '.mkt-frame', rail: '.mkt-frame__rail', sym: '.sym' }, heightMatters: ['spine', 'rail'] },
  { path: '/wallet', auth: 'wallet', name: 'wallet', parts: { spine: 'aside[aria-label="Workspace"]', bar: '[data-spine-bar]', main: 'main' }, heightMatters: ['spine'] },
  { path: '/dashboard', auth: 'siwe', name: 'dashboard', parts: { spine: 'aside[aria-label="Workspace"]', rail: '.dash__rail', main: '.dash__main' }, heightMatters: ['spine', 'rail'] },
]

async function desktopJob(run: Run, d: (typeof DESKTOP_SURFACES)[number], session: { address: string; cookie: string } | null, baseline: Record<string, { rects: Rects; docScrolls: boolean }> | null, capture: Record<string, { rects: Rects; docScrolls: boolean }>) {
  const s: Surface = { path: d.path, kind: 'app', auth: d.auth, name: d.name }
  const o = await openCtx(run, { size: DESKTOP, theme: 'dark', auth: d.auth, session })
  const b = { ...base(run, DESKTOP, 'dark', s), check: 'desktop' as CheckId, item: 'rects vs main' }
  try {
    await load(o, s)
    const got = (await o.page
      .evaluate(`(() => {
        const parts = ${JSON.stringify(d.parts)}
        const out = {}
        for (const [k, sel] of Object.entries(parts)) {
          const el = [...document.querySelectorAll(sel)].find((e) => window.__nq.vis(e))
          out[k] = el ? (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })() : null
        }
        const se = document.scrollingElement
        return { rects: out, docScrolls: se.scrollHeight > innerHeight + 1 }
      })()`)
      .catch(() => null)) as { rects: Rects; docScrolls: boolean } | null
    if (!got) {
      record({ ...b, state: 'FAIL', value: 'probe crashed', detail: o.ready })
      return
    }
    const key = `${run.engine}:${d.path}`
    capture[key] = got
    await shot(o, `desktop-${d.name}`)
    if (!baseline) {
      record({ ...b, state: WRITE_BASELINE ? 'PASS' : 'FAIL', value: WRITE_BASELINE ? `baseline captured (${Object.entries(got.rects).map(([k, r]) => `${k} ${r ? `${r.x},${r.y} ${r.w}×${r.h}` : '∅'}`).join(' · ')})` : 'no baseline', detail: WRITE_BASELINE ? '' : `no ${BASELINE_FILE} — run the BEFORE pass with --write-baseline` })
      return
    }
    const want = baseline[key]
    if (!want) {
      record({ ...b, state: 'FAIL', value: 'no baseline for this surface', detail: key })
      return
    }
    const diffs: string[] = []
    for (const [k, r0] of Object.entries(want.rects)) {
      const r1 = got.rects[k] ?? null
      if (!r0 && !r1) continue
      if (!r0 || !r1) {
        diffs.push(`${k}: ${r0 ? 'gone' : 'appeared'}`)
        continue
      }
      const dims: (keyof typeof r0)[] = d.heightMatters.includes(k) ? ['x', 'y', 'w', 'h'] : ['x', 'y', 'w']
      const moved = dims.filter((dm) => Math.abs(r0[dm] - r1[dm]) > 1)
      if (moved.length) diffs.push(`${k}: ${moved.map((dm) => `${dm} ${r0[dm]}→${r1[dm]}`).join(' ')}`)
    }
    // Whether the document scrolls at desktop is compared only where main's
    // content was clearly taller or shorter than the screen: /wallet's main is
    // ~900px on a 900px screen and tips either way with its holdings.
    const content = Object.entries(want.rects).find(([k, r]) => (k === 'main' || k === 'frame' || k === 'sym') && r)?.[1]
    const borderline = !!content && Math.abs(content.h - DESKTOP.height) <= DESKTOP.height * 0.1
    if (want.docScrolls !== got.docScrolls && !borderline) diffs.push(`document ${want.docScrolls ? 'scrolled' : 'was still'} on main, now ${got.docScrolls ? 'scrolls' : 'still'}`)
    record({ ...b, state: diffs.length ? 'FAIL' : 'PASS', value: diffs.length ? `${diffs.length} part(s) moved` : `${Object.keys(want.rects).length} parts unchanged`, detail: diffs.join('; ') })
  } finally {
    await o.ctx.close().catch(() => {})
  }
}

// ── CHAT's drive, folded in (coordinator R1) ───────────────────────────────
// scripts/drive-native-chat.ts is a standalone drive (its own main, argv
// guard, contexts and fixtures; read-only, /api/chat answered from fixtures).
// drive:native runs it as a child against the same BASE and folds every
// verdict line (`✅ <ctx>/<id> — detail`) into a row under the check it
// measures. A child that prints ❌ and exits 0 still reads red, line by line.
const CHAT_ID_CHECK: [RegExp, CheckId][] = [
  [/^desktop\//, 'desktop'],
  [/composer-16px/, 'inputs'],
  [/rides-keyboard|composer-returns/, 'keyboard'],
  [/document-never-scrolls|one-app-scroller|i-frame-attrs|i-bottom-flush/, 'frame'],
  [/composer-above-bar|banner-in-its-seat/, 'bar'],
  [/-44$|sign-buttons-full-width/, 'targets'],
  [/no-h-scroll|-fit$|topbar-no-overflow/, 'overflow'],
  [/-door|topbar-exists|topbar-title/, 'tabs'],
  [/-sheet$/, 'sheets'],
]
async function chatDriveJob() {
  const file = join(SCRIPTS_DIR, 'drive-native-chat.ts')
  const shots = join(OUT_DIR, 'shots', 'qa', TAG, 'chat')
  mkdirSync(shots, { recursive: true })
  const out = await new Promise<{ code: number; text: string }>((resolve) => {
    const child = spawn('npx', ['tsx', file, '--phase=after', `--shots=${shots}`], { env: { ...process.env, BASE }, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', (b: Buffer) => (text += b.toString()))
    child.stderr.on('data', (b: Buffer) => (text += b.toString()))
    child.on('close', (code) => resolve({ code: code ?? 1, text }))
  })
  let n = 0
  for (const line of out.text.split('\n')) {
    const m = /^\s*(✅|❌) (\S+)(?: — (.*))?$/.exec(line)
    if (!m) continue
    n += 1
    const id = m[2]
    const ctxId = id.split('/')[0]
    const check = CHAT_ID_CHECK.find(([re]) => re.test(id))?.[1] ?? 'frame'
    record({
      check,
      engine: 'chrome',
      profile: /pixel/.test(ctxId) ? 'pixel' : /iphone/.test(ctxId) ? 'iphone' : ctxId === 'desktop' ? 'desktop' : '-',
      size: /-(\d{3})$/.exec(ctxId)?.[1] ?? '-',
      theme: /light/.test(ctxId) ? 'light' : 'dark',
      surface: /\/i-/.test(id) ? `/i/${HOUSE_SLUG}` : '/chat',
      item: `chat: ${id}`,
      state: m[1] === '✅' ? 'PASS' : 'FAIL',
      value: (m[3] ?? '').slice(0, 220),
      detail: '',
    })
  }
  if (!n || out.code !== 0 && !/❌/.test(out.text)) {
    record({ check: 'frame', engine: 'chrome', profile: '-', size: '-', theme: '-', surface: '/chat', item: 'chat: the CHAT drive', state: 'FAIL', value: `exit ${out.code}, ${n} verdict line(s)`, detail: out.text.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 220) })
  }
}

// ── The pool ───────────────────────────────────────────────────────────────
type Job = { check: CheckId; label: string; run: () => Promise<void> }
async function pool(jobs: Job[], n: number) {
  let i = 0
  const worker = async () => {
    for (;;) {
      const j = i++
      if (j >= jobs.length) return
      try {
        await jobs[j].run()
      } catch (e) {
        const msg = (e as Error).message.split('\n')[0].slice(0, 200)
        record({ check: jobs[j].check, engine: 'chrome', profile: '-', size: '-', theme: '-', surface: '?', item: jobs[j].label, state: 'FAIL', value: 'job crashed', detail: msg })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker))
}

// ── Output ─────────────────────────────────────────────────────────────────
let TAG = arg('tag')

function markdown(meta: Record<string, unknown>): string {
  const md: string[] = []
  md.push(`# drive:native — ${TAG}`)
  md.push('')
  md.push(`- base: \`${BASE}\` · commit \`${meta.sha}\` · ${meta.at}`)
  md.push(`- engines: ${meta.engines}`)
  md.push(`- rows: ${rows.length} · **PASS ${rows.filter((r) => r.state === 'PASS').length} · FAIL ${rows.filter((r) => r.state === 'FAIL').length}** · DECISION ${rows.filter((r) => r.state === 'DECISION').length} · SKIP ${rows.filter((r) => r.state === 'SKIP').length} · N/A ${rows.filter((r) => r.state === 'N/A').length}`)
  md.push('')
  md.push('## By check')
  md.push('')
  md.push('| # | check | PASS | FAIL | DECISION | SKIP/N/A | the first red, with its number |')
  md.push('|---|---|---:|---:|---:|---:|---|')
  CHECKS.forEach((c, i) => {
    const rs = rows.filter((r) => r.check === c)
    const f = rs.find((r) => r.state === 'FAIL')
    const cell = (s: string) => s.replace(/\|/g, '\\|')
    md.push(`| ${i + 1} | ${c} | ${rs.filter((r) => r.state === 'PASS').length} | ${rs.filter((r) => r.state === 'FAIL').length} | ${rs.filter((r) => r.state === 'DECISION').length} | ${rs.filter((r) => r.state === 'SKIP' || r.state === 'N/A').length} | ${f ? cell(`${[f.profile, f.size, f.theme, f.surface, f.item].filter((x) => x && x !== '-').join(' ')}: ${f.value}${f.detail ? ` — ${f.detail}` : ''}`).slice(0, 260) : '—'} |`)
  })
  md.push('')
  md.push('## By surface (layout checks, every size, profile and theme)')
  md.push('')
  const LAYOUT: CheckId[] = ['frame', 'bar', 'sheets', 'targets', 'inputs', 'overflow']
  md.push(`| surface | ${LAYOUT.join(' | ')} |`)
  md.push(`|---|${LAYOUT.map(() => '---').join('|')}|`)
  for (const s of SURFACES) {
    const cells = LAYOUT.map((c) => {
      const rs = rows.filter((r) => r.check === c && r.surface === s.path && r.size !== DESKTOP.id && !r.item.startsWith('sheet:') && !(c === 'sheets' && r.item !== 'on load'))
      if (!rs.length) return '·'
      const fails = rs.filter((r) => r.state === 'FAIL')
      if (rs.every((r) => r.state === 'N/A' || r.state === 'SKIP')) return 'n/a'
      if (!fails.length) return `✅ ${rs.length}`
      return `❌ ${fails.length}/${rs.length} ${fails[0].value}`.replace(/\|/g, '\\|').slice(0, 90)
    })
    md.push(`| \`${s.path}\` | ${cells.join(' | ')} |`)
  }
  md.push('')
  md.push('## Interactions (375×812 dark)')
  md.push('')
  md.push('| check | profile | surface | item | state | value | detail |')
  md.push('|---|---|---|---|---|---|---|')
  for (const r of rows.filter((x) => ['tabs', 'sheets', 'keyboard', 'themecolor', 'manifest', 'desktop'].includes(x.check) && x.item !== 'on load')) {
    const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    md.push(`| ${r.check} | ${r.profile} | \`${r.surface}\` | ${cell(r.item)} | ${r.state === 'PASS' ? '✅' : r.state === 'FAIL' ? '❌' : r.state} | ${cell(r.value).slice(0, 140)} | ${cell(r.detail).slice(0, 220)} |`)
  }
  md.push('')
  md.push('## The layout numbers at 375×812 (dark, per profile)')
  md.push('')
  md.push('| profile | surface | frame | bar | overflow | targets | inputs |')
  md.push('|---|---|---|---|---|---|---|')
  for (const p of ['iphone', 'pixel'] as ProfileId[]) {
    for (const s of SURFACES) {
      const pick = (c: CheckId, item?: string) => rows.find((r) => r.check === c && r.profile === p && r.surface === s.path && r.size === '375x812' && r.theme === 'dark' && (item === undefined || r.item === item))
      const fmt = (r?: Row) => (r ? `${r.state === 'PASS' ? '✅' : r.state === 'FAIL' ? '❌' : r.state} ${r.value}`.replace(/\|/g, '\\|').slice(0, 110) : '·')
      if (!pick('frame') && !pick('overflow')) continue
      md.push(`| ${p} | \`${s.path}\` | ${fmt(pick('frame'))} | ${fmt(pick('bar', s.kind === 'brochure' || s.path.startsWith('/i/') ? 'bottom chrome' : 'spine bar'))} | ${fmt(pick('overflow'))} | ${fmt(pick('targets', 'chrome'))} | ${fmt(pick('inputs'))} |`)
    }
  }
  md.push('')
  md.push('Raw rows: the sibling `.json`. Screenshots (with `--shots`): `gates/shots/qa/' + TAG + '/`.')
  return md.join('\n') + '\n'
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  // The tree UNDER TEST: --sha= when the drive runs from another checkout
  // (QA drives the integration server from its own worktree).
  let sha = arg('sha') || 'unknown'
  if (!arg('sha')) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      /* not a checkout */
    }
  }
  if (!TAG) TAG = `run-${sha}`
  mkdirSync(OUT_DIR, { recursive: true })

  const up = await fetch(BASE + '/api/auth/me', { headers: { 'x-yf-internal-run': '1' } }).then((r) => r.status).catch(() => 0)
  if (!up) {
    console.error(`\n  drive:native — nothing is serving ${BASE}.\n  Start it: MK2_AI_MOCK=1 MARKETS_AI_IP_HOURLY_CAP=3 TASTE_GUEST_DAILY=1 npx next start -p 3896\n`)
    process.exit(2)
  }

  const { chromium, webkit } = pw()
  const profileFilter = list('profiles') as ProfileId[]
  const phoneProfiles = ((QUICK ? ['iphone'] : ['iphone', 'pixel']) as ProfileId[]).filter((p) => !profileFilter.length || profileFilter.includes(p))

  console.log(`\n  drive:native — ${BASE} · commit ${sha} · tag ${TAG}`)
  const chrome = await chromium.launch({ channel: 'chrome' })
  const runs: Run[] = phoneProfiles.map((p) => ({ engine: 'chrome' as EngineId, profile: p, browser: chrome, device: deviceFor(p) }))
  const desktopRun: Run = { engine: 'chrome', profile: 'desktop', browser: chrome, device: deviceFor('desktop') }

  // WebKit: runs only when its build matches this playwright-core.
  let webkitNote = ''
  try {
    const exe = webkit.executablePath()
    if (!existsSync(exe)) webkitNote = `Playwright WebKit is not installed for playwright-core ${createRequire(ANCHOR)('playwright-core/package.json').version} (expects ${exe.split('/ms-playwright/')[1]?.split('/')[0] ?? exe}); only an older build is on this Mac and launching it hangs. Owner step: \`npx playwright install webkit\`.`
  } catch (e) {
    webkitNote = `WebKit unavailable: ${(e as Error).message.split('\n')[0]}`
  }
  if (webkitNote) {
    record({ check: 'frame', engine: 'webkit', profile: 'iphone', size: '-', theme: '-', surface: '*', item: 'the WebKit engine', state: 'SKIP', value: 'SKIPPED', detail: webkitNote })
  } else {
    const wk = await webkit.launch()
    runs.push({ engine: 'webkit', profile: 'iphone', browser: wk, device: deviceFor('iphone') })
  }
  const engines = `${runs.map((r) => `${r.engine}/${r.profile}`).join(', ')}${webkitNote ? ' · webkit SKIPPED' : ''}`
  console.log(`  engines: ${engines}\n`)

  // The dashboard's session: one throwaway key per context that needs it
  // (a sibling context sharing an address can end its session — memory
  // siwe-drive-orphan-session), minted lazily.
  const needSiwe = surfaces.some((s) => s.auth === 'siwe') || wantCheck('desktop') || wantCheck('sheets')
  const siwe = async () => (needSiwe ? throwawaySession() : null)

  const jobs: Job[] = []
  const add = (check: CheckId, label: string, run: () => Promise<void>) => jobs.push({ check, label, run })
  const layoutWanted = (['frame', 'bar', 'targets', 'inputs', 'overflow', 'sheets'] as CheckId[]).some(wantCheck)
  if (layoutWanted) {
    for (const run of runs) {
      for (const s of surfaces) {
        add('frame', `layout ${run.profile} dark ${s.path}`, async () => layoutJob(run, s, 'dark', s.auth === 'siwe' ? await siwe() : null))
        if (!QUICK) add('frame', `layout ${run.profile} light ${s.path}`, async () => layoutJob(run, s, 'light', s.auth === 'siwe' ? await siwe() : null))
      }
    }
  }
  if (wantCheck('tabs')) {
    for (const run of runs) {
      add('tabs', `tabs ${run.profile} at rest`, () => tabsAtRest(run))
      for (const [seat, ex] of Object.entries(D2_FROM_CHAT)) add('tabs', `tabs ${run.profile} /chat ${seat}`, () => tabsJob(run, S_CHAT, seat, ex))
      for (const [seat, ex] of Object.entries(D2_FROM_MARKETS)) add('tabs', `tabs ${run.profile} /markets ${seat}`, () => tabsJob(run, S_MARKETS, seat, ex))
      for (const seq of D2_SEQUENCES) add('tabs', `tabs ${run.profile} ${seq.name}`, () => tabsSequence(run, seq))
      for (const d of TOP_BAR_DOORS) add('tabs', `tabs ${run.profile} top bar ${d.door}`, () => topBarDoorJob(run, d))
    }
    // NAV's own drive, folded in (coordinator R1): NATIVE_NAV_SCENARIOS from
    // scripts/drive-native-nav.ts, run on NAV's profiles with THIS drive's
    // safety net on every context (fixture chat, internal stamps).
    if (existsSync(join(SCRIPTS_DIR, 'drive-native-nav.ts'))) {
      process.env.NAV_SHOT_DIR = join(OUT_DIR, 'shots', 'qa', TAG, 'nav')
      const navDrive = (await import('./drive-native-nav')) as unknown as {
        NATIVE_NAV_SCENARIOS: { row: string; name: string; run(ctx: unknown): Promise<{ row: string; check: string; ok: boolean; detail: string; note?: boolean }[]> }[]
        PROFILES: Record<string, { id: string; device: string; width: number; height: number }>
        makeCtx(browser: unknown, base: string, tag: string, profile: unknown, theme: 'dark' | 'light'): Promise<{ close(): Promise<void> }>
      }
      const guarded = { newContext: async (opts: unknown) => { const c = await chrome.newContext(opts); await guardContext(c); return c } }
      const navProfiles = (QUICK ? ['small'] : ['small', 'pixel']).filter((p) => !profileFilter.length || profileFilter.includes(p === 'small' ? 'iphone' : 'pixel'))
      for (const pid of navProfiles) {
        const prof = navDrive.PROFILES[pid]
        if (!prof) continue
        for (const sc of navDrive.NATIVE_NAV_SCENARIOS) {
          if (sc.row === 'desktop' && pid !== navProfiles[0]) continue
          const check: CheckId = sc.row === 'desktop' ? 'desktop' : 'tabs'
          if (!wantCheck(check)) continue
          add(check, `nav ${sc.row} ${pid}`, async () => {
            const ctx = await navDrive.makeCtx(guarded, BASE, TAG, prof, 'dark')
            try {
              for (const v of await sc.run(ctx)) {
                record({
                  check,
                  engine: 'chrome',
                  profile: pid === 'pixel' ? 'pixel' : 'iphone',
                  size: sc.row === 'desktop' ? DESKTOP.id : `${prof.width}x${prof.height}`,
                  theme: 'dark',
                  surface: '/chat',
                  item: `nav ${sc.row}: ${v.check}`.slice(0, 120),
                  state: v.note ? 'N/A' : v.ok ? 'PASS' : 'FAIL',
                  value: v.detail.slice(0, 240),
                  detail: '',
                })
              }
            } finally {
              await ctx.close()
            }
          })
        }
      }
    }
  }
  if (wantCheck('sheets')) {
    for (const run of runs) {
      for (const t of TRIGGERS) add('sheets', `sheet ${run.profile} ${t.id}`, async () => sheetJob(run, t, t.auth === 'siwe' ? await siwe() : null))
      // Where the lanes said their Sheets live (coordinator, R1): NAV more/links/
      // chats · MARKETS ask/wl-alert/wl-import · PAGES account/wallet/door/nav/
      // dashnav · CHAT mint/chart/job/addmcp/creator. The known ones have their
      // own trigger above; the rest are found by their data-sheet-open.
      for (const path of ['/chat', '/chat?tab=mcps', '/chat?tab=links', '/chat?tab=jobs', '/markets', '/t/AAPL', '/wallet', `/i/${HOUSE_SLUG}`, '/dashboard']) {
        const s = SURFACES.find((x) => x.path === path)!
        add('sheets', `sheets discovered ${run.profile} ${s.path}`, async () => {
          const session = s.auth === 'siwe' ? await siwe() : null
          const found = await discoveredSheets(run, s, session)
          for (const t of found) await sheetJob(run, t, s.auth === 'siwe' ? await siwe() : null)
        })
      }
    }
  }
  if (wantCheck('sheets')) {
    for (const run of runs) for (const c of SHEET_LINKS) add('sheets', `sheet link ${run.profile} ${c.id}`, async () => sheetLinkJob(run, c, c.auth === 'siwe' ? await siwe() : null))
  }
  if (wantCheck('keyboard')) {
    for (const run of runs) for (const s of [S_CHAT, SURFACES.find((x) => x.path.startsWith('/i/'))!]) add('keyboard', `keyboard ${run.profile} ${s.path}`, () => keyboardJob(run, s))
  }
  if (wantCheck('themecolor')) {
    for (const s of [S_LANDING, S_MARKETS]) add('themecolor', `theme-color ${s.path}`, () => themeColorJob(runs[0], s))
  }
  const capture: Record<string, { rects: Rects; docScrolls: boolean }> = {}
  let baseline: Record<string, { rects: Rects; docScrolls: boolean }> | null = null
  if (wantCheck('desktop')) {
    if (!WRITE_BASELINE && existsSync(BASELINE_FILE)) {
      try {
        baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).surfaces
      } catch {
        baseline = null
      }
    }
    for (const d of DESKTOP_SURFACES) add('desktop', `desktop ${d.path}`, async () => desktopJob(desktopRun, d, d.auth === 'siwe' ? await siwe() : null, baseline, capture))
  }

  // CHAT's own drive (a standalone file), when it is on this tree.
  if (!list('checks').length && !QUICK && existsSync(join(SCRIPTS_DIR, 'drive-native-chat.ts')) && !flag('no-chat')) add('frame', 'chat drive', () => chatDriveJob())
  const started = Date.now()
  if (wantCheck('manifest')) await manifestCheck()
  // --jobs=<substring>: only the jobs whose label contains it (iteration aid).
  const jobFilter = arg('jobs')
  await pool(jobFilter ? jobs.filter((j) => j.label.includes(jobFilter)) : jobs, WORKERS)
  await chrome.close().catch(() => {})
  for (const r of runs) if (r.engine === 'webkit') await r.browser.close().catch(() => {})

  if (WRITE_BASELINE && Object.keys(capture).length) {
    writeFileSync(BASELINE_FILE, JSON.stringify({ at: new Date().toISOString(), sha, base: BASE, viewport: DESKTOP, surfaces: capture }, null, 2))
    console.log(`\n  desktop baseline → ${BASELINE_FILE}`)
  }

  if (MERGE_INTO) {
    const file = join(OUT_DIR, `${MERGE_INTO}.json`)
    const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).rows as Row[]) : []
    // A group this run measured (check × profile × surface) is replaced whole,
    // so a row the new drive no longer emits can't linger from the old one.
    const group = (r: Row) => `${r.check}|${r.engine}|${r.profile}|${r.surface}|${r.check === 'bar' ? r.item : ''}`
    const fresh = new Set(rows.map(group))
    const kept = prior.filter((r) => !fresh.has(group(r)))
    console.log(`  merge-into ${MERGE_INTO}: kept ${kept.length} of ${prior.length} prior rows, added ${rows.length}`)
    rows.splice(0, rows.length, ...kept, ...rows)
    TAG = MERGE_INTO
  }
  const meta = { sha, at: new Date().toISOString(), engines, seconds: Math.round((Date.now() - started) / 1000) }
  writeFileSync(join(OUT_DIR, `${TAG}.json`), JSON.stringify({ meta, base: BASE, rows }, null, 2))
  writeFileSync(join(OUT_DIR, `${TAG}.md`), markdown(meta))
  const pass = rows.filter((r) => r.state === 'PASS').length
  const fail = rows.filter((r) => r.state === 'FAIL').length
  const skip = rows.filter((r) => r.state === 'SKIP').length
  console.log(`\n  ${pass} passed · ${fail} failed · ${rows.filter((r) => r.state === 'DECISION').length} decision · ${skip} skipped · ${rows.filter((r) => r.state === 'N/A').length} n/a · ${meta.seconds}s`)
  console.log(`  → ${join(OUT_DIR, `${TAG}.md`)}\n`)
  process.exit(fail ? 1 : 0)
}

// Guarded: the harness imports this file to pin its shape (the #872 bite —
// a bare main() would run a whole drive inside test:api).
if (process.argv[1] && /drive-native(\.ts)?$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error('drive:native crashed:', e)
    process.exit(2)
  })
}
