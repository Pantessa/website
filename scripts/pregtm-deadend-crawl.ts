/**
 * The dead-end crawler (squad pre-gtm QA lane, 2026-10-06).
 *
 * THE INVARIANT: a stranger never hits a dead end. For every route × persona ×
 * width this enumerates every visible interactive control (button, a,
 * [role=button|tab|menuitem|link|switch|checkbox|option], summary, label-wrapped
 * inputs), clicks each one, and classifies what a visitor would see within
 * ~2.5s:
 *
 *   NAV      the URL changed, a new tab opened, or an external link was followed
 *            (external navigations are aborted, never fetched)
 *   DOOR     a dialog / sheet / menu / listbox / popover appeared
 *   SEND     a turn fired (POST /api/chat, or POST /api/markets/ask — the chart
 *            lane). Both are STUBBED: nothing real runs, nothing is billed.
 *   PREFILL  a composer / input value changed
 *   STATE    the DOM changed meaningfully (aria-expanded/selected/pressed/checked,
 *            open, hidden, data-state, or a visible element appeared/disappeared)
 *   COPY     navigator.clipboard was written
 *   SCROLL   the page scrolled (anchor / "jump to" controls)
 *   FOCUS    focus moved into a text field
 *   ERROR    a page error or a console error fired during the click
 *   DEAD     nothing observable happened
 *   ACTIVE   clicked an option that is already the selected one (pressed/selected/
 *            current/is-on) and nothing changed — expected, not dead
 *   BLOCKED  the control could not be clicked (covered / detached) — reported
 *            separately; usually an overlay already open, sometimes a real bug
 *
 * Noise control: the page is hovered and watched for a short baseline before
 * each click; every element that mutates during the baseline (the live tape,
 * the pulse, tickers) is excluded from the STATE signal. Repeated controls are
 * grouped into families (same tag + classes + role) and sampled (MAX_PER_FAMILY),
 * so a 200-row board costs a few clicks, not 200.
 *
 * Personas: `out` = signed out, no wallet. `empty` = a mock EIP-6963 wallet,
 * connected only (every signature refused with 4001), holding nothing.
 * Widths: 1440 (fine pointer) and 375 (isMobile + touch = coarse pointer, DPR 2).
 *
 *   BASE=http://localhost:3994 PLAYWRIGHT_CORE=/path/to/playwright-core \
 *     npx tsx scripts/pregtm-deadend-crawl.ts [--out dir] [--only /a,/b] \
 *     [--personas out,empty] [--widths 1440,375] [--jobs 8] [--max 30]
 *
 * Writes <out>/deadend.json (every click) and <out>/deadend.md (the DEAD +
 * ERROR + BLOCKED tables). `--diff <old deadend.json>` adds a regressions /
 * improvements section keyed by route|persona|width|label.
 *
 * playwright-core is NOT a project dependency and must never be statically
 * imported (a static import broke #858's Vercel build): it is resolved at run
 * time from PLAYWRIGHT_CORE. Never point this at production: it clicks.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const require_ = createRequire(import.meta.url)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.BASE || 'http://localhost:3994').replace(/\/$/, '')
const argv = process.argv.slice(2)
const opt = (k: string, d = '') => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const OUT = opt('--out', 'deadend-out')
const ONLY = opt('--only') ? opt('--only').split(',') : null
const PERSONAS = opt('--personas', 'out,empty').split(',') as Persona[]
const WIDTHS = opt('--widths', '1440,375').split(',').map(Number)
const JOBS = Number(opt('--jobs', '8'))
const MAX = Number(opt('--max', '30'))
const DIFF = opt('--diff')
const MAX_PER_FAMILY = 2
const SETTLE_MS = 2500
const BASELINE_MS = 450

/** Never a real address with history: a fresh, empty, watch-only wallet. */
const EMPTY_WALLET = '0x9a3a1e6f0c3b7d2e4f5a6b7c8d9e0f1a2b3c4d5e'

type Persona = 'out' | 'empty'
type Outcome = 'NAV' | 'DOOR' | 'SEND' | 'PREFILL' | 'STATE' | 'COPY' | 'SCROLL' | 'FOCUS' | 'ERROR' | 'DEAD' | 'BLOCKED' | 'GONE' | 'ACTIVE'

/** The public set (README mission). House /i slugs come from lib/house-links. */
function routes(): string[] {
  let house: string[] = []
  try {
    const src = readFileSync(join(process.cwd(), 'lib/house-links.ts'), 'utf8')
    house = [...src.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => `/i/${m[1]}`)
  } catch { /* run from the repo root */ }
  return [
    '/', '/t/AAPL', '/t/ETH', '/t/HYPE', '/t/NOTREAL',
    '/live', '/live?view=front', '/live?view=siege', '/live?view=map',
    '/chat', '/chat?tab=jobs', '/chat?tab=links', '/chat?tab=mcps', '/wallet',
    ...house,
    '/links', '/story', '/docs', '/docs/first-five-minutes', '/docs/links', '/docs/markets',
    '/pricing', '/this-route-does-not-exist',
  ]
}

const NOISE = /fonts\.gstatic|api\.cdp\.coinbase|cca-lite\.coinbase|web3modal|walletconnect|_vercel\/insights|YOUR_CDP_PROJECT|Cross-Origin-Opener-Policy|Failed to load resource|ERR_ABORTED|ERR_FAILED|Download the React DevTools/i

function mockWalletScript(address: string): string {
  return `(() => {
    const ADDR = ${JSON.stringify(address)}; let chain = '0x2105'; const L = {};
    const provider = { isMetaMask: false,
      request: async ({ method, params }) => { switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [ADDR];
        case 'eth_chainId': return chain; case 'net_version': return String(parseInt(chain, 16));
        case 'wallet_switchEthereumChain': chain = params?.[0]?.chainId ?? chain; (L.chainChanged||[]).forEach(f=>f(chain)); return null;
        case 'wallet_addEthereumChain': return null;
        case 'eth_getBalance': return '0x0';
        case 'personal_sign': case 'eth_signTypedData_v4': case 'eth_sendTransaction': { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
        default: { const e = new Error('Unsupported method ' + method); e.code = 4200; throw e; } } },
      on: (ev, fn) => { (L[ev] = L[ev] || []).push(fn); },
      removeListener: (ev, fn) => { L[ev] = (L[ev]||[]).filter(f => f !== fn); } };
    const detail = Object.freeze({ info: Object.freeze({ uuid: '11111111-2222-3333-4444-555555555555', name: 'Mock Wallet',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'pro.nate.mock' }), provider });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    window.addEventListener('eip6963:requestProvider', announce); announce(); window.ethereum = provider;
    try { localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('pro.nate.mock')); localStorage.removeItem('wagmi.pro.nate.mock.disconnected'); } catch {}
  })()`
}

/** Instrumentation, injected before any page script. */
const PROBE = `(() => {
  const W = window; W.__qa = { muts: [], clip: 0, opens: 0 };
  W.__qaLabel = (el) => ((el.tagName === 'INPUT' && el.closest('label') ? el.closest('label').innerText : '') || el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || el.getAttribute('alt') || (el.querySelector('img,svg title')?.getAttribute?.('alt')) || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
  try { const c = navigator.clipboard; if (c) { const w = c.writeText?.bind(c); c.writeText = async (t) => { W.__qa.clip++; try { return await w(t) } catch {} };
    const wr = c.write?.bind(c); if (wr) c.write = async (d) => { W.__qa.clip++; try { return await wr(d) } catch {} }; } } catch {}
  const oo = W.open; W.open = function (...a) { W.__qa.opens++; return oo.apply(W, a) };
  const ATTR = ['aria-expanded','aria-selected','aria-pressed','aria-checked','aria-hidden','open','hidden','data-state','data-open','class','style','value'];
  const start = () => { new MutationObserver((list) => { const t = performance.now();
    for (const m of list) W.__qa.muts.push({ t, n: m.target, type: m.type, attr: m.attributeName,
      add: [...(m.addedNodes||[])].filter(x => x.nodeType === 1), rem: m.removedNodes ? m.removedNodes.length : 0 });
    if (W.__qa.muts.length > 4000) W.__qa.muts.splice(0, 2000); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ATTR, characterData: true }); };
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start);
})()`

/** In-page: enumerate visible interactive controls; tags each with data-qa-i. */
const ENUM = `(() => {
  const SEL = 'a[href],button,[role=button],[role=tab],[role=menuitem],[role=link],[role=switch],[role=checkbox],[role=option],summary,input[type=checkbox],input[type=radio],select';
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    if (el.closest('[aria-hidden=true],[inert]')) return false; return true; };
  const label = (el) => window.__qaLabel(el);
  const css = (el) => { const parts = []; let e = el; for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) {
      let p = e.tagName.toLowerCase(); if (e.id) { p += '#' + e.id; parts.unshift(p); break; }
      const cls = [...e.classList].filter(c => !/^(hover|focus|active|md|lg|sm|xl|dark|light|group|peer):|^(p|m|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr|w|h|min|max|text|bg|border|rounded|flex|grid|gap|items|justify|font|leading|tracking|shadow|transition|duration|opacity|z|top|left|right|bottom|inset|overflow|truncate|block|inline|hidden|absolute|relative|fixed|sticky)-?/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      const sib = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(p); }
    return parts.join(' > '); };
  let i = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!vis(el)) continue;
    const shut = el.closest('details:not([open])'); if (shut && !(el.tagName === 'SUMMARY' && el.parentElement === shut)) continue; // a closed <details> renders nothing but its summary
    if (el.closest('a[href],button,[role=button]') !== el && el.closest('a[href],button,[role=button]')) continue; // nested inside another control
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const tag = el.tagName.toLowerCase();
    const href = el.getAttribute('href') || '';
    const fam = tag + '|' + (el.getAttribute('role') || '') + '|' + [...el.classList].sort().join('.') + '|' + (el.closest('[class]')?.parentElement?.className || '').toString().slice(0, 40);
    el.setAttribute('data-qa-i', String(i));
    out.push({ i, tag, role: el.getAttribute('role') || '', label: label(el), href, target: el.getAttribute('target') || '', disabled, fam, sel: css(el),
      journey: el.getAttribute('data-journey') || '',
      active: el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true' || !!el.getAttribute('aria-current') || el.classList.contains('is-on') || el.classList.contains('is-active') || el.getAttribute('data-state') === 'active' || el.getAttribute('data-active') === 'true' });
    i++;
  }
  return out;
})()`

/** In-page snapshot used before/after a click. */
const SNAP = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const DOORS = '[role=dialog],[role=alertdialog],dialog[open],[aria-modal=true],[role=menu],[role=listbox],[data-radix-popper-content-wrapper],[data-rk] [role=dialog],.askdoor-sheet,[data-sheet],[data-popover]';
  const doors = [...document.querySelectorAll(DOORS)].filter(vis).length;
  const fields = [...document.querySelectorAll('textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),[contenteditable=true]')]
    .map(e => (e.value ?? e.innerText ?? '').slice(0, 200)).join('\\u0001');
  const ae = document.activeElement; const focusField = !!ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !/checkbox|radio|button|submit/.test(ae.type)) || ae.isContentEditable);
  const checks = [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].map(e => e.checked ? 1 : 0).join('');
  return { url: location.href, doors, fields, checks, focusField, scroll: Math.round(scrollY) + ':' + Math.round(document.scrollingElement?.scrollTop || 0), clip: window.__qa?.clip || 0, opens: window.__qa?.opens || 0 };
})()`

/** In-page: meaningful mutations since t0, excluding elements noisy before t0. */
const MEANINGFUL = `((t0, tb) => {
  const q = window.__qa; if (!q) return 0;
  const noisy = new Set(q.muts.filter(m => m.t >= tb && m.t < t0).map(m => m.n));
  const inNoisy = (n) => { for (let e = n, k = 0; e && k < 3; e = e.parentNode, k++) if (noisy.has(e)) return true; return false; };
  const big = (el) => { try { const r = el.getBoundingClientRect(); return r.width * r.height > 600 } catch { return false } };
  let n = 0;
  for (const m of q.muts) { if (m.t < t0 || inNoisy(m.n)) continue;
    if (m.type === 'attributes' && /^aria-(expanded|selected|pressed|checked)|^(open|hidden|data-state|data-open)$/.test(m.attr || '')) { n += 3; continue; }
    if (m.type === 'childList' && m.add.some(big)) { n += 2; continue; }
    if (m.type === 'childList' && m.rem > 0) { n += 1; continue; }
    if (m.type === 'attributes' && (m.attr === 'class' || m.attr === 'style')) { n += 0.5; continue; }
    if (m.type === 'characterData') n += 0.5; }
  return n;
})`

type Ctl = { i: number; tag: string; role: string; label: string; href: string; target: string; disabled: boolean; fam: string; sel: string; journey: string; active: boolean }
type Click = { route: string; persona: Persona; width: number; i: number; tag: string; label: string; href: string; sel: string; journey: string; outcome: Outcome; detail: string }
type Cell = { route: string; persona: Persona; width: number; status: number | null; controls: number; sampled: number; clicks: Click[]; loadError?: string; redirectedTo?: string }

/** Live labels carry prices: compare without digits, signs and arrows. */
const norm = (s: string) => String(s || '').toLowerCase().replace(/[0-9$%,.+\-−▲▼]/g, '').replace(/\s+/g, ' ').trim()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function newCtx(browser: any, persona: Persona, width: number) {
  const phone = width < 768
  const ctx = await browser.newContext({
    viewport: { width, height: phone ? 812 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1,
    colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'],
  })
  await ctx.addInitScript(PROBE)
  if (persona === 'empty') await ctx.addInitScript(mockWalletScript(EMPTY_WALLET))
  const origin = new URL(BASE).origin
  const state = { sends: [] as string[], external: [] as string[], rsc: 0 }
  await ctx.route('**/*', async (r: any) => {
    const req = r.request(); const u = new URL(req.url())
    if (u.origin === origin) {
      if (req.method() === 'POST' && u.pathname === '/api/chat') {
        state.sends.push('chat')
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '(qa stub — dead-end crawl)' }) })
      }
      if (req.method() === 'POST' && u.pathname === '/api/markets/ask') {
        state.sends.push('ask')
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'answer', text: '(qa stub)' }) })
      }
      if (req.headers()['rsc'] === '1' || u.searchParams.has('_rsc') || (req.isNavigationRequest() && req.resourceType() === 'document')) state.rsc++
      return r.continue({ headers: { ...req.headers(), 'x-yf-internal-run': '1' } })
    }
    // An external DOCUMENT navigation is a NAV: record it, never follow it.
    if (req.isNavigationRequest() && req.resourceType() === 'document') { state.external.push(u.href); return r.abort() }
    return r.continue()
  })
  return { ctx, state }
}

async function load(page: any, url: string): Promise<number | null> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  try { await page.waitForLoadState('load', { timeout: 10_000 }) } catch {}
  try { await page.waitForLoadState('networkidle', { timeout: 1_200 }) } catch { /* live pages never idle */ }
  await sleep(700) // hydration + wagmi reconnect
  return res ? res.status() : null
}

async function crawlCell(browser: any, route: string, persona: Persona, width: number): Promise<Cell> {
  const cell: Cell = { route, persona, width, status: null, controls: 0, sampled: 0, clicks: [] }
  const { ctx, state } = await newCtx(browser, persona, width)
  const errors: string[] = []
  const popups: string[] = []
  ctx.on('page', async (p: any) => { const op = await p.opener().catch(() => null); if (!op) return; popups.push(p.url()); p.close().catch(() => {}) })
  let page = await ctx.newPage()
  const wire = (p: any) => {
    p.on('pageerror', (e: Error) => errors.push('pageerror: ' + String(e.message).slice(0, 160)))
    p.on('console', (m: any) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)) })
    p.on('dialog', (d: any) => d.dismiss().catch(() => {}))
  }
  wire(page)
  const url = BASE + route
  try {
    cell.status = await load(page, url)
    const landed = new URL(page.url())
    const want = new URL(url)
    if (landed.pathname !== want.pathname) {
      // The app sent this visitor elsewhere (e.g. signed-out /chat → home). The
      // landing page is crawled on its own; record the bounce, click nothing.
      cell.redirectedTo = landed.pathname + landed.search
      await ctx.close().catch(() => {})
      return cell
    }
    let ctls: Ctl[] = await page.evaluate(ENUM)
    cell.controls = ctls.length
    // Sample families; keep document order.
    const seen = new Map<string, number>()
    const plan = ctls.filter((c) => { const k = c.fam; const n = seen.get(k) || 0; seen.set(k, n + 1); return n < MAX_PER_FAMILY }).slice(0, MAX)
    cell.sampled = plan.length
    let dirty = false
    let cur: Ctl[] = ctls
    for (const c of plan) {
      if (dirty) {
        // A fresh page state: storage + cookies cleared (a dismissed guide card or a
        // remembered view must not leak into the next click). The persona's init
        // script re-seeds the mock wallet on load.
        try { await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} }) } catch {}
        try { await ctx.clearCookies() } catch {}
        try { await page.close() } catch {}
        page = await ctx.newPage(); wire(page)
        try { await load(page, url) } catch { /* recorded below as GONE */ }
        cur = (await page.evaluate(ENUM).catch(() => [])) as Ctl[]
        dirty = false
      }
      const rec: Click = { route, persona, width, i: c.i, tag: c.tag, label: c.label || '(no label)', href: c.href, sel: c.sel, journey: c.journey, outcome: 'DEAD', detail: '' }
      if (c.disabled) { rec.outcome = 'BLOCKED'; rec.detail = 'disabled'; cell.clicks.push(rec); continue }
      if (/^(mailto|tel|sms):/i.test(c.href)) { rec.outcome = 'NAV'; rec.detail = c.href.split('?')[0]; cell.clicks.push(rec); continue }
      // Re-find by index, verify the label (live content shifts indices).
      let h = await page.$(`[data-qa-i="${c.i}"]`)
      if (h) {
        const lbl = await h.evaluate((el: any) => (window as any).__qaLabel(el)).catch(() => '')
        if (norm(lbl) !== norm(c.label) && c.label) h = null
      }
      if (!h && c.label) {
        const all = await page.$$(c.tag === 'a' ? 'a[href]' : c.tag)
        for (const x of all) {
          const l = await x.evaluate((el: any) => (window as any).__qaLabel(el)).catch(() => '')
          if (norm(l) === norm(c.label) && (await x.isVisible().catch(() => false))) { h = x; break }
        }
      }
      if (!h) {
        // Live content (pulse chips, tape rows, movers) renames itself between loads:
        // click a sibling of the same family whose verb matches ("Long …", "Buy …").
        const verb = (c.label.split(' ')[0] || '').toLowerCase()
        const sub = cur.find((x) => x.fam === c.fam && x.tag === c.tag && (x.label.split(' ')[0] || '').toLowerCase() === verb && !x.disabled)
        if (sub) { h = await page.$(`[data-qa-i="${sub.i}"]`); if (h) { rec.detail = `substitute: ${sub.label.slice(0, 40)}`; rec.label = c.label } }
      }
      if (!h) { rec.outcome = 'GONE'; rec.detail = 'not found after reset (live content)'; cell.clicks.push(rec); continue }
      if (c.tag === 'select') {
        // A native <select> opens an OS popup the DOM never sees: pick another option instead.
        const pick = await h.evaluate((el: any) => { const o = [...el.options].find((x: any) => !x.selected && !x.disabled); return o ? { v: o.value, t: o.textContent } : null }).catch(() => null)
        let changed = ''
        if (pick) { try { await h.selectOption(pick.v, { timeout: 1500 }); changed = pick.t } catch { /* detached */ } }
        rec.outcome = changed ? 'STATE' : 'GONE'; rec.detail = changed ? `select → ${String(changed).trim().slice(0, 40)}` : 'select not found / single option'
        cell.clicks.push(rec); dirty = true; continue
      }
      try { await h.scrollIntoViewIfNeeded({ timeout: 1500 }) } catch {}
      try { await h.hover({ timeout: 1000, force: true }) } catch {}
      const tb = await page.evaluate('performance.now()')
      await sleep(BASELINE_MS)
      const before = await page.evaluate(SNAP)
      const t0 = await page.evaluate('performance.now()')
      const e0 = errors.length, s0 = state.sends.length, x0 = state.external.length, p0 = popups.length, r0 = state.rsc
      let forced = false
      try {
        try { await h.click({ timeout: 2000, noWaitAfter: true }) } catch (e1: any) {
          // A marquee / animated tape never reads as "stable": click it where it is.
          if (/Timeout/.test(String(e1?.message)) && !/intercepts pointer/.test(String(e1?.message))) { forced = true; await h.click({ timeout: 1500, noWaitAfter: true, force: true }) }
          else if (/not attached/.test(String(e1?.message))) {
            // A tape row recycled between find and click: take the row now in that seat.
            const again = (await page.evaluate(ENUM).catch(() => [])) as Ctl[]
            const verb = (c.label.split(' ')[0] || '').toLowerCase()
            const sub = again.find((x) => x.fam === c.fam && x.tag === c.tag && (x.label.split(' ')[0] || '').toLowerCase() === verb && !x.disabled)
            const h2 = sub ? await page.$(`[data-qa-i="${sub.i}"]`) : null
            if (!h2) throw e1
            await h2.click({ timeout: 1500, noWaitAfter: true, force: true })
          }
          else throw e1
        }
      } catch (err: any) {
        const m = String(err?.message || err)
        rec.outcome = 'BLOCKED'; rec.detail = /intercepts pointer|covered/.test(m) ? 'covered by another element' : m.split('\n')[0].slice(0, 120)
        cell.clicks.push(rec); continue
      }
      // Poll until something decisive happens or SETTLE_MS passes.
      let deadline = Date.now() + SETTLE_MS
      let extended = false
      let after: any = before, meaningful = 0
      while (Date.now() < deadline) {
        // A soft navigation was requested: give a cold route up to 8s to land.
        if (!extended && state.rsc > r0) { extended = true; deadline = Date.now() + 8000 }
        await sleep(200)
        if (state.sends.length > s0 || state.external.length > x0 || popups.length > p0) break
        try { after = await page.evaluate(SNAP) } catch { after = { ...before, url: page.url() }; break }
        if (after.url !== before.url || after.doors > before.doors) break
      }
      try { after = await page.evaluate(SNAP) } catch { after = { ...after, url: page.url() } }
      try { meaningful = await page.evaluate(`${MEANINGFUL}(${t0}, ${tb})`) } catch { meaningful = 0 }
      const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname + x.search + x.hash } catch { return u } }
      const subNote = rec.detail.startsWith('substitute') ? rec.detail : ''
      rec.detail = ''
      if (state.sends.length > s0) { rec.outcome = 'SEND'; rec.detail = state.sends.slice(s0).join(',') }
      else if (state.external.length > x0) { rec.outcome = 'NAV'; rec.detail = 'external ' + state.external[state.external.length - 1].slice(0, 100) }
      else if (popups.length > p0 || after.opens > before.opens) { rec.outcome = 'NAV'; rec.detail = 'new tab ' + (popups[popups.length - 1] || '').slice(0, 100) }
      else if (after.url !== before.url) { rec.outcome = 'NAV'; rec.detail = pathOf(before.url) + ' → ' + pathOf(after.url) }
      else if (after.doors > before.doors) { rec.outcome = 'DOOR'; rec.detail = `${before.doors}→${after.doors} dialogs/menus` }
      else if (after.fields !== before.fields) { rec.outcome = 'PREFILL'; rec.detail = after.fields.split('\u0001').filter(Boolean).join(' | ').slice(0, 100) }
      else if (after.checks !== before.checks) { rec.outcome = 'STATE'; rec.detail = 'toggled' }
      else if (after.clip > before.clip) { rec.outcome = 'COPY' }
      else if (meaningful >= 2) { rec.outcome = 'STATE'; rec.detail = `mutation score ${meaningful}` }
      else if (after.doors < before.doors) { rec.outcome = 'STATE'; rec.detail = 'closed a dialog/menu' }
      else if (after.scroll !== before.scroll) { rec.outcome = 'SCROLL'; rec.detail = `${before.scroll}→${after.scroll}` }
      else if (after.focusField && !before.focusField) { rec.outcome = 'FOCUS' }
      else if (meaningful > 0) { rec.outcome = 'STATE'; rec.detail = `weak mutation ${meaningful}` }
      if (rec.outcome === 'DEAD' && state.rsc > r0) { rec.outcome = 'NAV'; rec.detail = 'navigation requested, URL not changed within 8s (slow route?)' }
      if (forced) rec.detail = (rec.detail ? rec.detail + ' · ' : '') + 'animated (force-clicked)'
      if (rec.outcome === 'DEAD' && c.active) { rec.outcome = 'ACTIVE'; rec.detail = 'already the selected option' }
      if (errors.length > e0) {
        const errs = errors.slice(e0).join(' ; ').slice(0, 220)
        if (rec.outcome === 'DEAD') { rec.outcome = 'ERROR'; rec.detail = errs }
        else rec.detail = (rec.detail ? rec.detail + ' · ' : '') + 'ERR ' + errs
      }
      if (subNote && !rec.detail.startsWith('substitute')) rec.detail = subNote + (rec.detail ? ' · ' + rec.detail : '')
      if (rec.outcome !== 'DEAD' && rec.outcome !== 'FOCUS' && rec.outcome !== 'COPY') dirty = true
      if (rec.outcome === 'STATE' && /weak/.test(rec.detail)) dirty = true
      cell.clicks.push(rec)
    }
  } catch (err: any) {
    cell.loadError = String(err?.message || err).split('\n')[0].slice(0, 200)
  }
  await ctx.close().catch(() => {})
  return cell
}

function md(cells: Cell[], old?: Cell[]): string {
  const all = cells.flatMap((c) => c.clicks)
  const count = (o: Outcome) => all.filter((c) => c.outcome === o).length
  const outs: Outcome[] = ['NAV', 'DOOR', 'SEND', 'PREFILL', 'STATE', 'COPY', 'SCROLL', 'FOCUS', 'ERROR', 'DEAD', 'ACTIVE', 'BLOCKED', 'GONE']
  const esc = (s: string) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const L: string[] = []
  L.push(`# Dead-end crawl — ${BASE} — ${new Date().toISOString().slice(0, 16)}Z`, '')
  L.push(`${cells.length} cells (${new Set(cells.map((c) => c.route)).size} routes × personas ${[...new Set(cells.map((c) => c.persona))].join('/')} × widths ${[...new Set(cells.map((c) => c.width))].join('/')}) · ${all.length} clicks`, '')
  L.push('| ' + outs.join(' | ') + ' |', '|' + outs.map(() => '---').join('|') + '|', '| ' + outs.map(count).join(' | ') + ' |', '')
  const loadErr = cells.filter((c) => c.loadError)
  if (loadErr.length) { L.push('## Cells that failed to load', ''); for (const c of loadErr) L.push(`- ${c.route} ${c.persona}@${c.width}: ${esc(c.loadError!)}`); L.push('') }
  // DEAD controls, grouped by label+route so the same control across personas/widths is one row.
  const group = (o: Outcome[]) => {
    const m = new Map<string, { route: string; label: string; sel: string; href: string; where: string[]; detail: string }>()
    for (const c of all.filter((x) => o.includes(x.outcome))) {
      const k = `${c.route}|${c.label}|${c.outcome}`
      const g = m.get(k) || { route: c.route, label: c.label, sel: c.sel, href: c.href, where: [], detail: c.detail }
      g.where.push(`${c.persona}@${c.width}`); m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.where.length - a.where.length || a.route.localeCompare(b.route))
  }
  const red = cells.filter((c) => c.redirectedTo)
  if (red.length) { L.push('## Cells the app redirected (not clicked; the landing is crawled on its own)', ''); for (const c of red) L.push(`- ${c.route} ${c.persona}@${c.width} → ${c.redirectedTo}`); L.push('') }
  L.push('## DEAD — clicked, nothing observable', '', '| # | route | label | seen as | selector | href |', '|---|---|---|---|---|---|')
  group(['DEAD']).forEach((g, n) => L.push(`| ${n + 1} | ${g.route} | ${esc(g.label)} | ${g.where.join(' ')} | \`${esc(g.sel)}\` | ${esc(g.href)} |`))
  L.push('', '## ERROR — a page/console error fired on click', '', '| route | label | seen as | error |', '|---|---|---|---|')
  for (const g of group(['ERROR'])) L.push(`| ${g.route} | ${esc(g.label)} | ${g.where.join(' ')} | ${esc(g.detail)} |`)
  const errOn = all.filter((c) => c.outcome !== 'ERROR' && /ERR /.test(c.detail))
  if (errOn.length) { L.push('', '### Worked, but logged an error', '', '| route | label | as | outcome | error |', '|---|---|---|---|---|'); for (const c of errOn) L.push(`| ${c.route} | ${esc(c.label)} | ${c.persona}@${c.width} | ${c.outcome} | ${esc(c.detail.replace(/.*ERR /, ''))} |`) }
  L.push('', '## BLOCKED — could not be clicked (not counted as dead; disabled controls listed for review)', '', '| route | label | seen as | why |', '|---|---|---|---|')
  for (const g of group(['BLOCKED'])) L.push(`| ${g.route} | ${esc(g.label)} | ${g.where.join(' ')} | ${esc(g.detail)} |`)
  L.push('', '## Per cell', '', '| route | persona | width | status | controls | clicked | dead | error |', '|---|---|---|---|---|---|---|---|')
  for (const c of cells) L.push(`| ${c.route} | ${c.persona} | ${c.width} | ${c.status} | ${c.controls} | ${c.sampled} | ${c.clicks.filter((x) => x.outcome === 'DEAD').length} | ${c.clicks.filter((x) => x.outcome === 'ERROR').length} |`)
  if (old) {
    const key = (c: Click) => `${c.route}|${c.persona}|${c.width}|${c.label}`
    const bad = new Set<Outcome>(['DEAD', 'ERROR'])
    const o = new Map(old.flatMap((c) => c.clicks).map((c) => [key(c), c]))
    const n = new Map(all.map((c) => [key(c), c]))
    const reg: string[] = [], imp: string[] = []
    for (const [k, c] of n) { const p = o.get(k); if (bad.has(c.outcome) && (!p || !bad.has(p.outcome))) reg.push(`${k} ${p ? p.outcome : 'new'}→${c.outcome}`) }
    for (const [k, p] of o) { const c = n.get(k); if (bad.has(p.outcome) && (!c || !bad.has(c.outcome))) imp.push(`${k} ${p.outcome}→${c ? c.outcome : 'gone'}`) }
    L.push('', `## Diff vs ${DIFF}`, '', `**Regressions ${reg.length}** (became DEAD/ERROR or new DEAD/ERROR)`, ...reg.map((r) => '- ' + esc(r)), '', `**Improvements ${imp.length}**`, ...imp.map((r) => '- ' + esc(r)))
  }
  return L.join('\n') + '\n'
}

async function main() {
  const pw = require_(process.env.PLAYWRIGHT_CORE || 'playwright-core')
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
  const list = ONLY || routes()
  const jobs: Array<[string, Persona, number]> = []
  for (const r of list) for (const p of PERSONAS) for (const w of WIDTHS) jobs.push([r, p, w])
  const cells: Cell[] = []
  let next = 0
  const t0 = Date.now()
  await Promise.all(Array.from({ length: Math.max(1, JOBS) }, async () => {
    while (next < jobs.length) {
      const [r, p, w] = jobs[next++]
      const c = await crawlCell(browser, r, p, w)
      cells.push(c)
      const dead = c.clicks.filter((x) => x.outcome === 'DEAD').length
      console.log(`${String(cells.length).padStart(3)}/${jobs.length} ${r} ${p}@${w} status=${c.status}${c.redirectedTo ? ' → ' + c.redirectedTo : ''} controls=${c.controls} clicked=${c.clicks.length} dead=${dead}${c.loadError ? ' LOADERR ' + c.loadError : ''} (${Math.round((Date.now() - t0) / 1000)}s)`)
    }
  }))
  await browser.close()
  const order = (c: Cell) => jobs.findIndex(([r, p, w]) => r === c.route && p === c.persona && w === c.width)
  cells.sort((a, b) => order(a) - order(b))
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'deadend.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), cells }, null, 1))
  const old = DIFF && existsSync(DIFF) ? (JSON.parse(readFileSync(DIFF, 'utf8')).cells as Cell[]) : undefined
  const report = md(cells, old)
  writeFileSync(join(OUT, 'deadend.md'), report)
  const all = cells.flatMap((c) => c.clicks)
  console.log(`deadend: ${all.length} clicks · DEAD ${all.filter((c) => c.outcome === 'DEAD').length} · ERROR ${all.filter((c) => c.outcome === 'ERROR').length} · BLOCKED ${all.filter((c) => c.outcome === 'BLOCKED').length} · ${Math.round((Date.now() - t0) / 1000)}s → ${join(OUT, 'deadend.md')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
