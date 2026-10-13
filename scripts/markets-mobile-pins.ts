/**
 * markets-mobile-pins — the MARKETS-MOBILE lane's numbers as a gate (squad
 * polish, 2026-10-13; blackboard ~/pantessa/squad-polish-2026-10-13/).
 *
 * THE RULEBOOK §B on the markets surfaces (`/`, `/t/<sym>`, `/live`): every
 * secondary panel on a phone is a SHEET (the bell, the order ticket), the act
 * chips dock above the tab bar as the phone act bar, every target ≥44px, no
 * horizontal overflow, nothing opens on its own.
 *
 * Two halves:
 *   SOURCE (always) — the rules read off the files that carry them, so a
 *   refactor that drops one goes red before a build.
 *   LIVE (`--base=http://localhost:4073`) — Playwright + installed Chrome as a
 *   phone (iPhone 13 Mini / Pixel 7 widths, coarse pointer): 0 overflow and 0
 *   sub-44 targets per route × width, the act bar docked exactly above the
 *   spine bar, a chip opens the ticket SHEET (role=dialog, data-sheet) and
 *   Escape closes it, the bell opens the alerts SHEET and the scrim closes it.
 *   Nothing signs, sends or fires a turn (a stranger, no wallet).
 *
 *   npm run pins:markets-mobile
 *   npx tsx scripts/markets-mobile-pins.ts --base=http://localhost:4073
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const rf = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✅' : '❌'} markets-mobile: ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

// ── SOURCE ──────────────────────────────────────────────────────────────────
const hook = rf('components/markets/shell/usePhoneSheet.ts')
const bell = rf('components/markets/shell/RailAlerts.tsx')
const strip = rf('components/markets/trade/ExecStrip.tsx')
const css = rf('components/markets/markets.css')

check(
  'the phone posture is ONE matchMedia (≤1023px, the spine\'s bottom-bar break) read through useSyncExternalStore with a false server snapshot — the first paint never differs',
  hook.includes("export const PHONE_SHEET_QUERY = '(max-width: 1023px)'") && hook.includes('useSyncExternalStore(subscribe, read, serverRead)') && hook.includes('const serverRead = () => false'),
)
check(
  'the bell: on a phone the alerts body is a Sheet (id "alerts"), the popover renders only off the phone, and the outside-click closer stands down for the sheet (its portal is outside the bell\'s root)',
  bell.includes("import Sheet from '@/components/mobile/Sheet'") && bell.includes('const phone = usePhoneSheet()') && bell.includes('{open && !phone && (') &&
    bell.includes('<Sheet open={open} onClose={() => setOpen(false)} title="Alerts" id="alerts" className="mkt-alertsheet">') && bell.includes('if (!open || phone) return') &&
    bell.includes('data-journey="Open alerts"') && /const body = \(\s*<div className="mkt-alertpop__body">/.test(bell) && (bell.match(/\{body\}/g) ?? []).length === 2,
)
check(
  'the order ticket: on a phone a chip\'s ticket is a Sheet (id "order-ticket") titled by its side, the inline ticket renders only off the phone, ONE ticket element feeds both seats, and the sheet never opens on its own',
  strip.includes("import Sheet from '@/components/mobile/Sheet'") && strip.includes('const phone = usePhoneSheet()') && strip.includes('{shown && !phone && ticketEl}') &&
    strip.includes('<Sheet open={!!shown} onClose={close} title={shownLabel ?? `Trade ${pair.symbol}`} id="order-ticket" className="mkt-ticketsheet">') &&
    strip.includes('{shown && ticketEl}') && strip.includes('if (window.matchMedia?.(PHONE_SHEET_QUERY).matches) open = false') && strip.includes('data-journey={`Pick ${a.label}`}') &&
    (strip.match(/<OrderTicket/g) ?? []).length === 1,
)
check(
  'the act bar: on a phone (≤1023) the act chips dock fixed above the spine bar (the bar\'s own height + the safe area), the page pads for the bar, the bar hides under the soft keyboard, the NO VENUE prose stays in the flow (:has(.sym__act-chips))',
  /@media \(max-width: 1023px\) \{\s*\.mkt-frame--sym \.sym__exec:has\(\.sym__act-chips\) \{\s*position: fixed; left: 0; right: 0; z-index: 33;\s*bottom: calc\(var\(--spine-bar-h, 49px\) \+ env\(safe-area-inset-bottom\)\);/.test(css) &&
    css.includes('.mkt-frame--sym .sym--cockpit { padding-bottom: 57px; }') && css.includes('html[data-keyboard] .mkt-frame--sym .sym__exec:has(.sym__act-chips) { display: none; }') &&
    css.includes('.mkt-frame--sym .sym__exec:has(.sym__act-chips) .sym__act-chip { flex: 0 0 auto; min-height: 44px; }'),
)
check(
  'the act bar sits UNDER the sheet (90) and the full-screen chart (60): z-index 33',
  /\.sym__exec:has\(\.sym__act-chips\) \{\s*position: fixed; left: 0; right: 0; z-index: 33;/.test(css) && rf('components/mobile/mobile.css').includes('z-index: 90;') && rf('app/x402-design.css').includes('.tchart--expanded { position: fixed; inset: 0; z-index: 60;'),
)
check(
  'the last small targets (375, coarse, measured on main): the timeframe row is its own row with ≥44px buttons, the bell 44, the brief\'s chip 44, the attribution link a 44px hit area, the movers tape items 44',
  css.includes('.sym .mkt-chart__bar:has(> .mkt-view) > .tok__tf, .sym .mkt-chart__bar > .tok__tf { flex: 0 0 100%; gap: 4px; }') && css.includes('.sym .mkt-chart__bar:has(> .mkt-view) > .tok__tf > .tok__tfbtn, .sym .mkt-chart__bar > .tok__tf > .tok__tfbtn { flex: 1 1 0; min-width: 44px; }') &&
    rf('components/markets/chart/depth.css').includes('.dp__chip { height: 44px; padding: 0 12px; border-radius: 10px; }') && rf('components/markets/chart/depth.css').includes('.dp__chip { min-width: 44px; justify-content: center; }') && css.includes(".mkt-frame .mkt-link::after { content: ''; position: absolute; inset: -14px -4px; }") &&
    rf('components/markets/trade/trade.css').includes('.mkt-ticket__preset { min-width: 44px; }') && rf('components/markets/trade/trade.css').includes(".mkt-ticket input[type='range'] { height: 44px; }") && rf('components/markets/technicals/fundamentals.css').includes(".mk-fund__head a::after, .mk-fund__foot a::after { content: ''; position: absolute; inset: -15px -6px; }") &&
    css.includes('.mkt-frame__top .mkt-frame__bell { width: 44px; height: 44px; }') && css.includes('.mk-ai__chip { min-height: 44px; }') &&
    css.includes(".sym .mkt-attrib::after { content: ''; position: absolute; inset: -7px 0; }") && css.includes('.mk-tape__item { min-height: 44px; padding-block: 0; }'),
)
check(
  'the sheet bodies: the ticket loses its card chrome inside the sheet (the sheet is the card) and its own × (the sheet closes); the alerts body keeps its sections',
  css.includes('.mkt-ticketsheet .mkt-ticket--strip { margin: 0; border: 0; border-radius: 0; background: transparent; padding: 0 0 4px; }') && css.includes('.mkt-ticketsheet .mkt-ticket__x { display: none; }') &&
    css.includes('.mkt-alertsheet .mkt-alertpop__body { display: block; }'),
)
check(
  'the server renders chips and the bell only — no sheet, no popover, no ticket in the HTML (the Sheet returns null while closed; the ticket mounts on a tap)',
  rf('components/mobile/Sheet.tsx').includes("if (!mounted || phase === 'closed') return null") && strip.includes('autoOpen = true,') && strip.includes('const [ticket, setTicket] = useState<TicketSide | null>(null)') && !bell.includes('useState(true)'),
)

// ── LIVE ────────────────────────────────────────────────────────────────────
const arg = (k: string, d = '') => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const BASE = arg('base', process.env.BASE ?? '').replace(/\/$/, '')

const PROBE = String.raw`(() => {
  const de = document.documentElement, vw = de.clientWidth
  const sel = (el) => { let s = el.tagName.toLowerCase(); const c = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.'); if (c) s += '.' + c; const lab = (el.getAttribute('aria-label') || '').slice(0, 22); if (lab) s += '[' + lab + ']'; else { const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16); if (t) s += '"' + t + '"' } return s.slice(0, 90) }
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 }
  const hiddenUp = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity <= 0.05) return true } return false }
  const excused = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); const ox = cs.overflowX
      if (ox === 'auto' || ox === 'scroll') { if (p.hasAttribute('data-app-scroll')) continue; return 'scroller' }
      if (ox === 'hidden' || ox === 'clip') { if (p.hasAttribute('data-app-scroll') || p.hasAttribute('data-app-frame')) continue; const r = p.getBoundingClientRect(); if (r.right <= vw + 2 && r.left >= -2) return 'clipbox' }
      if (cs.position === 'fixed') return 'fixed' } return null }
  const over = [], small = []
  const TARGET = 'a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],input:not([type=hidden]),select,textarea,summary'
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    if ((r.right > vw + 2 || r.left < -2) && cs.position !== 'fixed' && !excused(el)) over.push(sel(el))
    if (el.matches(TARGET)) {
      if (el.closest('[aria-hidden=true]') || hiddenUp(el)) continue
      if (el.closest('details:not([open])') && !el.closest('summary')) continue
      let h = r.height, w = r.width
      const lab = el.matches('input,select,textarea') && el.closest('label'); if (lab) { const lr = lab.getBoundingClientRect(); h = Math.max(h, lr.height); w = Math.max(w, lr.width) }
      for (const ps of ['::after', '::before']) { const p = getComputedStyle(el, ps); if (p.content !== 'none' && p.position === 'absolute') { const t = parseFloat(p.top) || 0, bo = parseFloat(p.bottom) || 0, l = parseFloat(p.left) || 0, ri = parseFloat(p.right) || 0; const ph = (p.top !== 'auto' && p.bottom !== 'auto') ? r.height - t - bo : parseFloat(p.height) || 0; const pw = (p.left !== 'auto' && p.right !== 'auto') ? r.width - l - ri : parseFloat(p.width) || 0; h = Math.max(h, ph); w = Math.max(w, pw) } }
      if (h < 43.5 || w < 43.5) small.push(sel(el) + ' ' + Math.round(w) + 'x' + Math.round(h))
    }
  }
  return { sw: de.scrollWidth, cw: vw, over, small }
})()`

async function live() {
  const req = createRequire(path.join(process.cwd(), 'anchor.js'))
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const pw: any = req(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
  const routes = ['/', '/t/ETH', '/t/HYPE', '/live']
  const widths = [375, 430]
  try {
    for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' })
      for (const route of routes) {
        const page = await ctx.newPage()
        await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
        await page.waitForTimeout(3500)
        const a = await page.evaluate(PROBE)
        check(`live ${route} @${w}: 0 horizontal overflow`, a.sw === a.cw && a.over.length === 0, `sw${a.sw}/cw${a.cw} ${a.over.slice(0, 5).join('; ')}`)
        check(`live ${route} @${w}: 0 sub-44 targets`, a.small.length === 0, a.small.slice(0, 8).join('; '))
        if (route.startsWith('/t/')) {
          const geo = await page.evaluate(`(() => { const R = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { pos: cs.position, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } }; return { exec: R('.sym__exec'), bar: R('[data-spine-bar]'), chart: R('.sym__chart'), sheet: !!document.querySelector('[data-sheet]') } })()`)
          check(`live ${route} @${w}: the act bar is fixed and sits exactly above the spine bar`, !!geo.exec && geo.exec.pos === 'fixed' && !!geo.bar && Math.abs(geo.exec.bottom - geo.bar.top) <= 1, JSON.stringify(geo))
          check(`live ${route} @${w}: no sheet is open on load`, geo.sheet === false)
          // A chip opens the ticket sheet; Escape closes it.
          await page.locator('.sym__act-chip').first().tap()
          await page.waitForTimeout(600)
          const sheet = await page.evaluate(`(() => { const s = document.querySelector('[data-sheet="order-ticket"]'); if (!s) return null; const d = s.querySelector('[role="dialog"]'); const t = s.querySelector('.mkt-ticket'); const r = d && d.getBoundingClientRect(); return { phase: s.dataset.phase, dialog: !!d, ticket: !!t, bottom: r && Math.round(r.bottom), vh: innerHeight, send: !!s.querySelector('.mkt-ticket__send') } })()`)
          check(`live ${route} @${w}: a chip opens the order ticket as a SHEET (role=dialog, the ticket + its send button inside, resting on the bottom edge)`, !!sheet && sheet.phase === 'open' && sheet.dialog && sheet.ticket && sheet.send && sheet.bottom === sheet.vh, JSON.stringify(sheet))
          await page.keyboard.press('Escape')
          await page.waitForTimeout(500)
          check(`live ${route} @${w}: Escape closes the ticket sheet`, (await page.evaluate(`!document.querySelector('[data-sheet="order-ticket"]')`)) === true)
          // The bell opens the alerts sheet; the scrim closes it.
          await page.locator('.mkt-frame__bell').tap()
          await page.waitForTimeout(600)
          const al = await page.evaluate(`(() => { const s = document.querySelector('[data-sheet="alerts"]'); return s ? { phase: s.dataset.phase, dialog: !!s.querySelector('[role="dialog"]'), body: !!s.querySelector('.mkt-alertpop__body'), pop: !!document.querySelector('.mkt-alertpop') } : null })()`)
          check(`live ${route} @${w}: the bell opens the alerts as a SHEET (no popover)`, !!al && al.phase === 'open' && al.dialog && al.body && !al.pop, JSON.stringify(al))
          await page.locator('[data-sheet="alerts"] .sheet__scrim').tap({ position: { x: 10, y: 10 }, force: true })
          await page.waitForTimeout(500)
          check(`live ${route} @${w}: the scrim closes the alerts sheet`, (await page.evaluate(`!document.querySelector('[data-sheet="alerts"]')`)) === true)
        }
        await page.close()
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
}

;(async () => {
  if (BASE) await live()
  console.log(`\nmarkets-mobile pins: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
