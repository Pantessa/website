/**
 * polish-sheet-probe (QA lane, squad polish, 2026-10-13) — the security half
 * of rule B4 that drive:native's `sheets` check does not read: for every
 * labeled sheet trigger (`[data-sheet-open="<id>"]`) on the probed routes, on
 * a phone (coarse pointer, 375×812) it opens the sheet from a FRESH page and
 * measures:
 *
 *   opened    a `[data-sheet] [role=dialog]` appeared within 2.5s
 *   modal     the dialog says aria-modal="true" and has a name
 *   focusIn   focus moved INTO the panel
 *   trap      Tab ×12 and Shift+Tab ×4 never leave the panel
 *   noLeak    the point above the panel (and the tab bar's point) hit-tests
 *             to the scrim / the sheet, never to the page under it — a tap
 *             there cannot fire an underlying control
 *   scrim     a scrim tap closes it (a non-dismissible sheet is named, not failed)
 *   esc       Escape closes it (re-opened first)
 *   restore   focus returns to the trigger after close
 *   stuck     a sheet still open 3s after every exit — the overlay that never closes
 *
 *   BASE=http://localhost:4076 PLAYWRIGHT_CORE=/path/to/playwright-core \
 *     npx tsx scripts/polish-sheet-probe.ts --out sheets.json [--only /a,/b]
 *
 * Read-only: a watch-only mock EIP-6963 wallet (every signature refused), POST
 * /api/chat fulfilled from a canned reply, `x-yf-internal-run: 1` on every
 * same-origin request. playwright-core resolved at run time (never imported).
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require_ = createRequire(import.meta.url)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.BASE || 'http://localhost:4076').replace(/\/$/, '')
const argv = process.argv.slice(2)
const opt = (k: string, d = '') => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const OUT = opt('--out', 'sheets.json')
const ROUTES = opt('--only') ? opt('--only').split(',') : ['/', '/t/ETH', '/live', '/chat', '/wallet', '/links', '/i/buy-aapl', '/story', '/docs', '/pricing']
const WALLET = '0x9a3a1e6f0c3b7d2e4f5a6b7c8d9e0f1a2b3c4d5e'

const MOCK = `(() => {
  const ADDR = ${JSON.stringify(WALLET)}; let chain = '0x2105'; const L = {};
  const provider = { isMetaMask: false,
    request: async ({ method, params }) => { switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [ADDR];
      case 'eth_chainId': return chain; case 'net_version': return String(parseInt(chain, 16));
      case 'wallet_switchEthereumChain': chain = params?.[0]?.chainId ?? chain; return null;
      case 'eth_getBalance': return '0x0';
      default: { const e = new Error('User rejected the request.'); e.code = 4001; throw e; } } },
    on: (ev, fn) => { (L[ev] = L[ev] || []).push(fn); }, removeListener: () => {} };
  const detail = Object.freeze({ info: Object.freeze({ uuid: '33333333-4444-5555-6666-777777777777', name: 'QA Mock Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'pro.nate.qasheet' }), provider });
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
  try { localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('pro.nate.qasheet')) } catch {}
})()`

type Probe = { route: string; id: string; label: string; opened: boolean; modal: boolean; focusIn: boolean; trap: boolean; noLeak: boolean; leakAt: string; scrim: boolean | 'n/a'; esc: boolean | 'n/a'; restore: boolean; stuck: boolean; dismissible: boolean; note: string }

const OPEN_SEL = '[data-sheet] [role="dialog"]'

async function main() {
  const pw = require_(process.env.PLAYWRIGHT_CORE || 'playwright-core')
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  // tsx names inner arrow functions with a __name() helper that does not exist in the page
  await ctx.addInitScript('window.__name = (f) => f')
  await ctx.addInitScript(MOCK)
  await ctx.route((u: URL) => u.origin === new URL(BASE).origin, (r: any) => {
    const req = r.request()
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/chat') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'QA probe: canned reply.' }) })
    return r.continue({ headers: { ...req.headers(), 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' } })
  })
  const out: Probe[] = []
  const load = async (route: string) => {
    const page = await ctx.newPage()
    await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(2500)
    return page
  }
  for (const route of ROUTES) {
    let triggers: { id: string; label: string; n: number }[] = []
    try {
      const page = await load(route)
      triggers = await page.evaluate(() => {
        const seen = new Map<string, { id: string; label: string; n: number }>()
        const all = [...document.querySelectorAll<HTMLElement>('[data-sheet-open]')]
        all.forEach((el, n) => {
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
          if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') return
          const id = el.getAttribute('data-sheet-open') || ''
          if (!seen.has(id)) seen.set(id, { id, label: (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), n })
        })
        return [...seen.values()]
      })
      await page.close()
    } catch (e: any) { out.push({ route, id: '(load)', label: '', opened: false, modal: false, focusIn: false, trap: false, noLeak: false, leakAt: '', scrim: 'n/a', esc: 'n/a', restore: false, stuck: false, dismissible: true, note: 'LOAD ' + String(e.message).split('\n')[0].slice(0, 100) }); continue }
    for (const t of triggers) {
      const p: Probe = { route, id: t.id, label: t.label, opened: false, modal: false, focusIn: false, trap: false, noLeak: false, leakAt: '', scrim: 'n/a', esc: 'n/a', restore: false, stuck: false, dismissible: true, note: '' }
      let page: any
      try {
        page = await load(route)
        const trig = page.locator(`[data-sheet-open="${t.id}"]`).nth(0)
        await trig.scrollIntoViewIfNeeded().catch(() => {})
        const tapped = await trig.tap({ timeout: 4000 }).then(() => true).catch(async () => trig.click({ timeout: 4000, force: true }).then(() => true).catch(() => false))
        if (!tapped) { p.note = 'trigger not tappable on a fresh load (hidden until a scroll/state)'; out.push(p); await page.close(); continue }
        p.opened = await page.waitForSelector(OPEN_SEL, { state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
        if (!p.opened) { p.note = 'no dialog within 2.5s (may need a signed session / held state)'; out.push(p); await page.close(); continue }
        await page.waitForTimeout(450) // the open motion (160–240ms) settles
        const m = await page.evaluate((sel: string) => {
          const d = document.querySelector(sel) as HTMLElement
          const wrap = d.closest('[data-sheet]') as HTMLElement
          const r = d.getBoundingClientRect()
          const named = !!(d.getAttribute('aria-label') || (d.getAttribute('aria-labelledby') && document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent?.trim()))
          const hit = (x: number, y: number) => { const el = document.elementFromPoint(x, y) as HTMLElement | null; return { inSheet: !!el && wrap.contains(el), what: el ? el.tagName.toLowerCase() + '.' + String(el.className || '').toString().split(' ')[0] : 'none' } }
          const above = r.top > 24 ? hit(innerWidth / 2, Math.max(4, r.top / 2)) : { inSheet: true, what: 'panel at top' }
          const bar = document.querySelector('[data-spine-bar]') as HTMLElement | null
          const br = bar?.getBoundingClientRect()
          const barHit = br && br.height > 0 && br.top < innerHeight ? hit(br.left + br.width / 2, br.top + br.height / 2) : { inSheet: true, what: 'no bar' }
          return { modal: d.getAttribute('aria-modal') === 'true' && named, focusIn: d.contains(document.activeElement) || document.activeElement === d,
            above, barHit, dismissible: wrap.getAttribute('data-dismissible') !== 'false' }
        }, OPEN_SEL)
        p.modal = m.modal; p.focusIn = m.focusIn; p.dismissible = m.dismissible
        p.noLeak = m.above.inSheet && m.barHit.inSheet
        if (!p.noLeak) p.leakAt = `${m.above.inSheet ? '' : 'above→' + m.above.what} ${m.barHit.inSheet ? '' : 'bar→' + m.barHit.what}`.trim()
        // the trap: Tab ×12, Shift+Tab ×4 — focus never leaves the panel
        let left = 0
        for (let i = 0; i < 16; i++) {
          await page.keyboard.press(i < 12 ? 'Tab' : 'Shift+Tab')
          const inside = await page.evaluate((sel: string) => { const d = document.querySelector(sel); return !!d && (d.contains(document.activeElement) || document.activeElement === d) }, OPEN_SEL)
          if (!inside) left++
        }
        p.trap = left === 0
        if (!p.trap) p.note += `focus left the panel ${left}/16 · `
        if (p.dismissible) {
          // the scrim: tap the point above the panel
          const box = await page.evaluate((sel: string) => { const r = (document.querySelector(sel) as HTMLElement).getBoundingClientRect(); return { top: r.top } }, OPEN_SEL)
          if (box.top > 24) {
            await page.touchscreen.tap(187, Math.max(6, box.top / 2))
            p.scrim = await page.waitForSelector(OPEN_SEL, { state: 'detached', timeout: 1500 }).then(() => true).catch(() => false)
          } else p.scrim = 'n/a'
          // Escape: re-open, press, gone
          if (!(await page.$(OPEN_SEL))) {
            await trig.tap({ timeout: 4000 }).catch(async () => { await trig.click({ timeout: 4000, force: true }) })
            await page.waitForSelector(OPEN_SEL, { state: 'visible', timeout: 2500 }).catch(() => {})
            await page.waitForTimeout(350)
          }
          await page.keyboard.press('Escape')
          p.esc = await page.waitForSelector(OPEN_SEL, { state: 'detached', timeout: 1500 }).then(() => true).catch(() => false)
          await page.waitForTimeout(300)
          p.restore = await page.evaluate((id: string) => { const a = document.activeElement as HTMLElement | null; return !!a && (a.getAttribute('data-sheet-open') === id || !!a.closest(`[data-sheet-open="${id}"]`)) }, t.id)
          await page.waitForTimeout(3000)
          p.stuck = !!(await page.$(OPEN_SEL))
        } else {
          p.note += 'non-dismissible (owner closes it) · '
        }
      } catch (e: any) { p.note += 'ERR ' + String(e.message).split('\n')[0].slice(0, 100) }
      out.push(p)
      await page?.close().catch(() => {})
    }
  }
  await ctx.close(); await browser.close()
  for (const p of out) {
    const bad = [!p.opened && 'not-opened', p.opened && !p.modal && 'not-modal', p.opened && !p.focusIn && 'focus-not-in', p.opened && !p.trap && 'trap-leaks', p.opened && !p.noLeak && `click-leak(${p.leakAt})`, p.scrim === false && 'scrim-stays', p.esc === false && 'esc-stays', p.opened && p.dismissible && p.esc === true && !p.restore && 'focus-not-restored', p.stuck && 'STUCK'].filter(Boolean)
    console.log(`${bad.length ? '!!' : 'ok'} ${p.route} [${p.id}] "${p.label}" ${bad.join(' · ')} ${p.note}`)
  }
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), probes: out }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
