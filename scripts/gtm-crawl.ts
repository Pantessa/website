/**
 * GTM crawl (QA lane, 2026-10-05). Visits every public route at 375x812 and
 * 1440x900 and reports: HTTP status, console + page errors, failed requests,
 * horizontal overflow, visible "Yeetful" text (outside /rebrand and the
 * footer's "Formerly Yeetful"), broken internal links and broken images.
 *
 *   BASE=http://localhost:3905 npx tsx scripts/gtm-crawl.ts [--out file.json] [--only /a,/b]
 *
 * playwright-core is NOT a project dependency. Point PLAYWRIGHT_CORE at an
 * install (or have it resolvable), and CHROME at a Chrome binary (defaults to
 * the macOS app). Against production it sends `x-yf-internal-run: 1` and only
 * issues GETs.
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require_ = createRequire(import.meta.url)
const pw = require_(process.env.PLAYWRIGHT_CORE || 'playwright-core')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.BASE || 'http://localhost:3905').replace(/\/$/, '')
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const OUT = outIdx >= 0 ? args[outIdx + 1] : ''
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null

const SYMBOLS = ['AAPL', 'ETH', 'HYPE', 'BTC', 'TSLA', 'SOL', 'ZZQQXX']
const TABS = ['overview', 'news', 'community', 'technicals', 'trade']
const DOCS = [
  '', 'creator-earnings', 'dca', 'desk', 'embed', 'embedded-wallet', 'first-five-minutes',
  'guardian', 'host-buttons', 'jobs', 'links', 'markets', 'privacy', 'roster', 'snapshot',
  'spend-policy', 'terms', 'transactions', 'trust',
]

/** The route list is data; keep it in sync with app/. */
export const ROUTES: string[] = [
  // `/` is the markets splash; /story the brochure; /markets follows its 308 to `/` (squad front-door, 2026-10-06).
  '/', '/story', '/markets',
  ...SYMBOLS.map((s) => `/t/${s}`),
  ...TABS.map((t) => `/t/AAPL?tab=${t}`),
  ...TABS.map((t) => `/t/ETH?tab=${t}`),
  '/chat', '/links', '/pricing',
  ...DOCS.map((d) => (d ? `/docs/${d}` : '/docs')),
  '/compare', '/rebrand', '/activity', '/agents', '/servers', '/blog', '/lists/nope-qa',
  '/wallet', '/sign', '/mosaic',
  // not-found cases
  '/i/nope-qa', '/l/nope-qa', '/c/nope-qa', '/p/nope-qa', '/r/nope-qa', '/this-does-not-exist',
]
/** Fetched, not rendered. */
export const RAW: string[] = [
  '/sitemap.xml', '/robots.txt', '/opengraph-image', '/twitter-image',
  '/story/opengraph-image', '/markets/opengraph-image', '/t/AAPL/opengraph-image', '/t/ETH/opengraph-image',
  '/links/opengraph-image', '/chat/opengraph-image', '/agents/opengraph-image',
  '/roster/opengraph-image', '/t/ZZQQXX/opengraph-image',
]
const VIEWPORTS = [{ width: 375, height: 812 }, { width: 1440, height: 900 }]

/** Not product signal: request interception (needed for the internal-run
 *  header) makes Chrome refuse cross-origin fonts / CDP / WalletConnect config
 *  (control run without interception: none of these), a local build has no
 *  Vercel insights and a placeholder CDP project. Counted separately. */
const NOISE = /fonts\.gstatic|api\.cdp\.coinbase|cca-lite\.coinbase|web3modal|_vercel\/insights|YOUR_CDP_PROJECT|Cross-Origin-Opener-Policy|^Failed to load resource: net::ERR_FAILED$|ERR_ABORTED/

type Row = {
  route: string; width: number; status: number | null; overflow: number
  consoleErrors: string[]; pageErrors: string[]; failedRequests: string[]
  yeetful: string[]; badImages: string[]
}

/** The internal-run header rides first-party requests only: on a cross-origin
 *  request it forces a CORS preflight that fonts/CDP refuse (a crawl artifact). */
async function newCtx(browser: any, vp: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 768 })
  await ctx.route((u: URL) => u.origin === new URL(BASE).origin, (r: any) =>
    r.continue({ headers: { ...r.request().headers(), 'x-yf-internal-run': '1' } }))
  return ctx
}

async function main() {
  let browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
  const headers: Record<string, string> = { 'x-yf-internal-run': '1' }
  const rows: Row[] = []
  const links = new Set<string>()
  const routes = ONLY ?? ROUTES
  for (const vp of VIEWPORTS) {
    let ctx = await newCtx(browser, vp)
    for (const route of routes) {
      if (!browser.isConnected()) browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
      let page: any
      try { page = await ctx.newPage() } catch {
        ctx = await newCtx(browser, vp)
        page = await ctx.newPage()
      }
      if (process.env.VERBOSE) console.error('..', vp.width, route)
      const row: Row = { route, width: vp.width, status: null, overflow: 0, consoleErrors: [], pageErrors: [], failedRequests: [], yeetful: [], badImages: [] }
      page.on('console', (m: any) => { if (m.type() === 'error' && !NOISE.test(m.text())) row.consoleErrors.push(m.text().slice(0, 200)) })
      page.on('pageerror', (e: any) => row.pageErrors.push(String(e.message).slice(0, 200)))
      page.on('requestfailed', (r: any) => { const t = `FAIL ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ''}`; if (!/_rsc=|youtube/.test(r.url()) && !NOISE.test(t)) row.failedRequests.push(t) })
      page.on('response', (r: any) => { if (r.status() >= 400 && r.url() !== BASE + route && !NOISE.test(r.url())) row.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '').slice(0, 140)}`) })
      try {
        const res = await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
        row.status = res?.status() ?? null
        await page.waitForTimeout(2500)
        const m = await page.evaluate(() => {
          const d = document.documentElement
          const text = document.body?.innerText ?? ''
          const hits = text.split('\n').filter((l) => /yeetful/i.test(l) && !/formerly yeetful/i.test(l)).map((l) => l.trim().slice(0, 120))
          const imgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).map((i) => i.src.slice(0, 120))
          const hrefs = Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).getAttribute('href') || '')
          return { overflow: d.scrollWidth - d.clientWidth, hits, imgs, hrefs }
        })
        row.overflow = m.overflow
        row.yeetful = route === '/rebrand' ? [] : m.hits
        row.badImages = m.imgs
        for (const h of m.hrefs) if (h.startsWith('/') && !h.startsWith('//')) links.add(h.split('#')[0])
      } catch (e: any) {
        row.pageErrors.push('NAV ' + String(e.message).slice(0, 160))
      }
      rows.push(row)
      await page.close().catch(() => {})
    }
    await ctx.close().catch(() => {})
  }
  await browser.close().catch(() => {})

  const raw: { route: string; status: number; type: string }[] = []
  for (const r of RAW) {
    const res = await fetch(BASE + r, { headers }).catch(() => null)
    raw.push({ route: r, status: res?.status ?? 0, type: res?.headers.get('content-type') ?? '' })
  }
  const broken: { href: string; status: number }[] = []
  for (const h of [...links].sort()) {
    if (!h || h.startsWith('/api/')) continue
    const res = await fetch(BASE + h, { headers, redirect: 'follow' }).catch(() => null)
    const s = res?.status ?? 0
    if (s >= 400 || s === 0) broken.push({ href: h, status: s })
  }

  for (const r of rows) {
    const flags = [
      r.status !== 200 ? `status ${r.status}` : '', r.overflow > 0 ? `overflow +${r.overflow}px` : '',
      r.pageErrors.length ? `${r.pageErrors.length} page errors` : '', r.consoleErrors.length ? `${r.consoleErrors.length} console errors` : '',
      r.failedRequests.length ? `${r.failedRequests.length} failed req` : '', r.yeetful.length ? `Yeetful x${r.yeetful.length}` : '',
      r.badImages.length ? `${r.badImages.length} bad img` : '',
    ].filter(Boolean)
    console.log(`${flags.length ? '!!' : 'ok'} ${r.width} ${r.route} ${flags.join(' · ')}`)
  }
  for (const r of raw) console.log(`${r.status === 200 ? 'ok' : '!!'} raw ${r.route} ${r.status} ${r.type}`)
  for (const b of broken) console.log(`!! link ${b.href} ${b.status}`)
  if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows, raw, broken }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
