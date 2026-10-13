/**
 * polish-crawl (QA lane, squad polish, 2026-10-13). The README's route
 * inventory × persona × width, measured the way the native rulebook (§B)
 * reads them. For every cell it records:
 *
 *   status · where it landed (a dashboard sends a stranger home — that is
 *   recorded, not failed) · document + scroller horizontal overflow (B6) ·
 *   whether the DOCUMENT scrolls on a phone (B1: a frame, not a page) ·
 *   sub-44 targets under a coarse pointer (B5; a ::before/::after absolute hit
 *   area counts — the gtm3h PHONE probe) · inputs under 16px (B5) · page
 *   errors · console errors · failed requests · 401 polls for a stranger ·
 *   visible "Yeetful" text · bad images · a JPEG screenshot.
 *
 *   BASE=http://localhost:4076 PLAYWRIGHT_CORE=/path/to/playwright-core \
 *     npx tsx scripts/polish-crawl.ts --out crawl.json [--shots dir] \
 *     [--personas stranger,connected,signed] [--widths 375,390,430,1440] \
 *     [--only /a,/b] [--jobs 6]
 *
 * Personas: stranger = no wallet, no session · connected = a watch-only mock
 * EIP-6963 wallet on a fresh EMPTY address (every signature refused, no
 * SIWE) · signed = the .env.local burner's REAL SIWE cookie + the same mock on
 * the burner's address (watch-only: no key in the browser, nothing signs).
 * Phone widths load with isMobile + hasTouch (coarse pointer) at DPR 3.
 *
 * playwright-core is NOT a dependency: resolved at run time from
 * PLAYWRIGHT_CORE (a static import broke #858's Vercel build). Read-only:
 * GETs only, every same-origin request wears `x-yf-internal-run: 1`, every
 * POST /api/chat is fulfilled from a canned refusal (a URL never fires a
 * turn, but an /i runtime auto-runs its ask on connect). Never point at prod.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require_ = createRequire(import.meta.url)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.BASE || 'http://localhost:4076').replace(/\/$/, '')
const argv = process.argv.slice(2)
const opt = (k: string, d = '') => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const OUT = opt('--out', 'polish-crawl.json')
const SHOTS = opt('--shots')
const ONLY = opt('--only') ? opt('--only').split(',') : null
const PERSONAS = opt('--personas', 'stranger,connected,signed').split(',') as Persona[]
const WIDTHS = opt('--widths', '375,390,430,1440').split(',').map(Number)
const JOBS = Number(opt('--jobs', '6'))
const FIXTURE_I = opt('--i', 'buy-aapl')
const FIXTURE_L = opt('--l', 'mobilelinks')
const FIXTURE_P = opt('--p', '5pszWt7-tmSu')

type Persona = 'stranger' | 'connected' | 'signed'

/** The README's route inventory (squad polish). `/i` `/l` `/p` take fixtures
 *  that exist on the TEST DB (house link · a claimed handle · a public chat). */
export const ROUTES: string[] = [
  // app
  '/', '/t/ETH', '/t/AAPL', '/t/HYPE',
  ...['overview', 'chart', 'news', 'community', 'technicals', 'trade'].map((t) => `/t/ETH?tab=${t}`),
  '/t/AAPL?tab=trade', '/t/HYPE?tab=trade',
  '/live', '/live?view=front', '/live?view=siege', '/live?view=map',
  '/chat', '/chat?tab=links', '/wallet',
  `/i/${FIXTURE_I}`, `/l/${FIXTURE_L}`, `/p/${FIXTURE_P}`, '/links',
  '/dashboard', '/dashboard/links', '/dashboard/plan', '/dashboard/customize', '/dashboard/guardian',
  '/dashboard/admin', '/dashboard/admin/flows', '/dashboard/failures',
  // brochure
  '/story', '/docs',
  ...['first-five-minutes', 'markets', 'embed', 'links', 'trust', 'transactions', 'privacy', 'terms'].map((d) => `/docs/${d}`),
  '/pricing', '/blog', '/servers', '/rebrand', '/compare', '/activity', '/agents', '/roster', '/mosaic',
  '/this-route-does-not-exist',
]
/** App surfaces: on a phone the document must not scroll (rule B1). */
const APP = /^\/($|\?|t\/|live|chat|wallet|i\/|links|dashboard)/
const NOISE = /fonts\.gstatic|api\.cdp\.coinbase|cca-lite\.coinbase|web3modal|walletconnect|_vercel\/insights|YOUR_CDP_PROJECT|Cross-Origin-Opener-Policy|^Failed to load resource: net::ERR_FAILED$|ERR_ABORTED|Download the React DevTools|api\.hyperliquid\.xyz|api\.dune|stream\.binance|ws-feed|advanced-trade-ws|youtube/i
const EMPTY_WALLET = '0x9a3a1e6f0c3b7d2e4f5a6b7c8d9e0f1a2b3c4d5e'

function mockWallet(address: string): string {
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
    const detail = Object.freeze({ info: Object.freeze({ uuid: '22222222-3333-4444-5555-666666666666', name: 'QA Mock Wallet',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'pro.nate.qamock' }), provider });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    window.addEventListener('eip6963:requestProvider', announce); announce();
    try { localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('pro.nate.qamock')); localStorage.removeItem('wagmi.pro.nate.qamock.disconnected'); } catch {}
  })()`
}

/** The gtm3h PHONE probe (shots/phone.mjs), plus the frame + input reads. */
const PROBE = String.raw`(() => {
  const de = document.documentElement, vw = de.clientWidth, vh = innerHeight
  const sel = (el) => { let s = el.tagName.toLowerCase(); const c = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.'); if (c) s += '.' + c; const lab = (el.getAttribute('aria-label') || '').slice(0, 22); if (lab) s += '[' + lab + ']'; else { const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16); if (t) s += '"' + t + '"' } return s.slice(0, 90) }
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 }
  const hiddenUp = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity <= 0.05) return true } return false }
  const excused = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); const ox = cs.overflowX
      if (ox === 'auto' || ox === 'scroll') { if (p.hasAttribute('data-app-scroll')) continue; return 'scroller' }
      if (ox === 'hidden' || ox === 'clip') { if (p.hasAttribute('data-app-scroll') || p.hasAttribute('data-app-frame')) continue; const r = p.getBoundingClientRect(); if (r.right <= vw + 2 && r.left >= -2) return 'clipbox' }
      if (cs.position === 'fixed') return 'fixed' } return null }
  const over = [], small = [], tinyInputs = []
  const TARGET = 'a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],input:not([type=hidden]),select,textarea,summary'
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    if ((r.right > vw + 2 || r.left < -2) && cs.position !== 'fixed' && !excused(el)) over.push(sel(el) + ' L' + Math.round(r.left) + ' R' + Math.round(r.right))
    if (el.matches(TARGET)) {
      if (el.closest('[aria-hidden=true]') || hiddenUp(el)) continue
      if (el.closest('details:not([open])') && !el.closest('summary')) continue
      if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea') && parseFloat(cs.fontSize) < 15.5) tinyInputs.push(sel(el) + ' ' + cs.fontSize)
      let h = r.height, w = r.width
      const lab = el.matches('input,select,textarea') && el.closest('label'); if (lab) { const lr = lab.getBoundingClientRect(); h = Math.max(h, lr.height); w = Math.max(w, lr.width) }
      for (const ps of ['::after', '::before']) { const p = getComputedStyle(el, ps); if (p.content !== 'none' && p.position === 'absolute') { const t = parseFloat(p.top) || 0, bo = parseFloat(p.bottom) || 0, l = parseFloat(p.left) || 0, ri = parseFloat(p.right) || 0; const ph = (p.top !== 'auto' && p.bottom !== 'auto') ? r.height - t - bo : parseFloat(p.height) || 0; const pw = (p.left !== 'auto' && p.right !== 'auto') ? r.width - l - ri : parseFloat(p.width) || 0; h = Math.max(h, ph); w = Math.max(w, pw) } }
      if (h < 43.5 || w < 43.5) small.push(sel(el) + ' ' + Math.round(w) + 'x' + Math.round(h))
    }
  }
  const scrollers = [...document.querySelectorAll('[data-app-scroll]')].filter(vis)
  const scrollerOver = Math.max(0, ...scrollers.map((s) => s.scrollWidth - s.clientWidth))
  const uniq = (a) => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return [...m].map(([k, n]) => n > 1 ? k + ' ×' + n : k) }
  const text = document.body?.innerText ?? ''
  const yeetful = text.split('\n').filter((l) => /yeetful/i.test(l) && !/formerly yeetful/i.test(l)).map((l) => l.trim().slice(0, 120)).slice(0, 5)
  const badImages = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).map((i) => i.src.slice(0, 120))
  const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '').filter((h) => h.startsWith('/') && !h.startsWith('//'))
  return { vw, vh, docOverflow: de.scrollWidth - de.clientWidth, docScrollH: de.scrollHeight - innerHeight, scrollers: scrollers.length, scrollerOver,
    over: uniq(over).slice(0, 8), overN: over.length, small: uniq(small).slice(0, 12), smallN: small.length, tinyInputs: uniq(tinyInputs).slice(0, 6),
    coarse: matchMedia('(pointer: coarse)').matches, yeetful, badImages, hrefs, title: document.title, h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 80) }
})()`

type Row = {
  persona: Persona; route: string; width: number; status: number | null; landed: string
  docOverflow: number; scrollerOver: number; docScrolls: boolean | null; scrollers: number
  smallN: number; small: string[]; over: string[]; tinyInputs: string[]; coarse: boolean
  pageErrors: string[]; consoleErrors: string[]; failedRequests: string[]; polls401: string[]
  yeetful: string[]; badImages: string[]; h1: string; shot?: string; ms: number
}

async function siweCookie(): Promise<{ address: string; cookie: string } | null> {
  const env = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const pk = (env.match(/^PRIVATE_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^"|"$/g, '')
  if (!pk) return null
  const { privateKeyToAccount } = require_('viem/accounts')
  const { createSiweMessage } = require_('viem/siwe')
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
  const n = await fetch(`${BASE}/api/auth/nonce`, { headers: { 'x-yf-internal-run': '1' } })
  const nc = (n.headers.getSetCookie?.() ?? []).map((c: string) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[0]).find(Boolean)
  const { nonce } = await n.json()
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const v = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', ...(nc ? { cookie: nc } : {}) }, body: JSON.stringify({ message, signature }) })
  const cookie = (v.headers.getSetCookie?.() ?? []).map((c: string) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
  return cookie ? { address: account.address, cookie } : null
}

const CANNED = JSON.stringify({ reply: 'QA crawl: canned reply (no turn ran).' })

async function main() {
  const pw = require_(process.env.PLAYWRIGHT_CORE || 'playwright-core')
  const routes = ONLY ?? ROUTES
  const session = PERSONAS.includes('signed') ? await siweCookie().catch((e) => { console.error('SIWE failed', e); return null }) : null
  if (PERSONAS.includes('signed') && !session) console.error('!! signed persona: SIWE failed — signed cells run without a session')
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  let browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
  const ctxs = new Map<string, any>()
  async function ctxFor(persona: Persona, width: number) {
    const k = `${persona}@${width}`
    if (ctxs.has(k)) return ctxs.get(k)
    const phone = width < 768
    const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1 })
    await ctx.route((u: URL) => u.origin === new URL(BASE).origin, (r: any) => {
      const req = r.request()
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/chat') return r.fulfill({ status: 200, contentType: 'application/json', body: CANNED })
      return r.continue({ headers: { ...req.headers(), 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' } })
    })
    if (persona === 'connected') await ctx.addInitScript(mockWallet(EMPTY_WALLET))
    if (persona === 'signed' && session) {
      await ctx.addCookies([{ name: 'yf_session', value: session.cookie, domain: new URL(BASE).hostname, path: '/' }])
      await ctx.addInitScript(mockWallet(session.address))
    }
    ctxs.set(k, ctx)
    return ctx
  }
  const cells: { persona: Persona; width: number; route: string }[] = []
  for (const persona of PERSONAS) for (const width of WIDTHS) for (const route of routes) cells.push({ persona, width, route })
  const rows: Row[] = []
  const links = new Set<string>()
  let next = 0
  async function worker() {
    while (next < cells.length) {
      const c = cells[next++]
      const t0 = Date.now()
      const row: Row = { ...c, status: null, landed: '', docOverflow: 0, scrollerOver: 0, docScrolls: null, scrollers: 0, smallN: 0, small: [], over: [], tinyInputs: [], coarse: false,
        pageErrors: [], consoleErrors: [], failedRequests: [], polls401: [], yeetful: [], badImages: [], h1: '', ms: 0 }
      let page: any
      try {
        if (!browser.isConnected()) { browser = await pw.chromium.launch({ executablePath: CHROME, headless: true }); ctxs.clear() }
        page = await (await ctxFor(c.persona, c.width)).newPage()
        page.on('console', (m: any) => { if (m.type() === 'error' && !NOISE.test(m.text())) row.consoleErrors.push(m.text().slice(0, 200)) })
        page.on('pageerror', (e: any) => row.pageErrors.push(String(e.message).slice(0, 200)))
        page.on('requestfailed', (r: any) => { const t = `FAIL ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ''}`; if (!/_rsc=/.test(r.url()) && !NOISE.test(t)) row.failedRequests.push(t) })
        page.on('response', (r: any) => {
          const s = r.status(); if (s < 400 || NOISE.test(r.url())) return
          const u = r.url().replace(BASE, '')
          if (s === 401) row.polls401.push(`${r.request().method()} ${u.slice(0, 100)}`)
          else if (u !== c.route) row.failedRequests.push(`${s} ${r.request().method()} ${u.slice(0, 140)}`)
        })
        const res = await page.goto(BASE + c.route, { waitUntil: 'load', timeout: 45000 })
        row.status = res?.status() ?? null
        await page.waitForTimeout(3000)
        row.landed = await page.evaluate(() => location.pathname + location.search).catch(() => '')
        const m = await page.evaluate(PROBE)
        Object.assign(row, { docOverflow: m.docOverflow, scrollerOver: m.scrollerOver, scrollers: m.scrollers, smallN: m.smallN, small: m.small, over: m.over, tinyInputs: m.tinyInputs, coarse: m.coarse, yeetful: c.route === '/rebrand' ? [] : m.yeetful, badImages: m.badImages, h1: m.h1 })
        // B1 only means something on an app surface on a phone
        row.docScrolls = c.width < 768 && APP.test(row.landed) ? m.docScrollH > 1 : null
        for (const h of m.hrefs) links.add(h.split('#')[0])
        if (SHOTS) {
          const f = `${c.persona}-${c.width}-${c.route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}.jpg`
          await page.screenshot({ path: join(SHOTS, f), type: 'jpeg', quality: 55 }).catch(() => {})
          row.shot = f
        }
      } catch (e: any) {
        row.pageErrors.push('NAV ' + String(e.message).split('\n')[0].slice(0, 160))
      }
      row.ms = Date.now() - t0
      rows.push(row)
      if (process.env.VERBOSE) console.error(`.. ${c.persona} ${c.width} ${c.route} ${row.status} ${row.ms}ms`)
      await page?.close().catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker))
  for (const ctx of ctxs.values()) await ctx.close().catch(() => {})
  await browser.close().catch(() => {})

  const broken: { href: string; status: number }[] = []
  for (const h of [...links].sort()) {
    if (!h || h.startsWith('/api/')) continue
    // with the admin session when there is one: admin-only pages (/incidents) 404 for everyone else by design
    const res = await fetch(BASE + h, { headers: { 'x-yf-internal-run': '1', ...(session ? { cookie: `yf_session=${session.cookie}` } : {}) }, redirect: 'follow' }).catch(() => null)
    const s = res?.status ?? 0
    if (s >= 400 || s === 0) broken.push({ href: h, status: s })
  }
  rows.sort((a, b) => a.persona.localeCompare(b.persona) || a.width - b.width || routes.indexOf(a.route) - routes.indexOf(b.route))
  for (const r of rows) {
    const flags = [
      r.status !== 200 ? `status ${r.status}` : '', r.landed && r.landed !== r.route ? `→ ${r.landed}` : '',
      r.docOverflow > 0 ? `doc overflow +${r.docOverflow}px` : '', r.scrollerOver > 0 ? `scroller overflow +${r.scrollerOver}px` : '',
      r.docScrolls ? 'DOCUMENT SCROLLS' : '', r.width < 768 && r.smallN ? `${r.smallN} sub-44` : '', r.tinyInputs.length ? `${r.tinyInputs.length} input<16px` : '',
      r.pageErrors.length ? `${r.pageErrors.length} page errors` : '', r.consoleErrors.length ? `${r.consoleErrors.length} console errors` : '',
      r.failedRequests.length ? `${r.failedRequests.length} failed req` : '', r.persona === 'stranger' && r.polls401.length ? `${r.polls401.length} 401` : '',
      r.yeetful.length ? `Yeetful x${r.yeetful.length}` : '', r.badImages.length ? `${r.badImages.length} bad img` : '',
    ].filter(Boolean)
    console.log(`${flags.length ? '!!' : 'ok'} ${r.persona} ${r.width} ${r.route} ${flags.join(' · ')}`)
  }
  for (const b of broken) console.log(`!! link ${b.href} ${b.status}`)
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), personas: PERSONAS, widths: WIDTHS, signedIn: !!session, rows, broken }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
