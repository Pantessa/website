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
  '/', '/markets',
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
  '/markets/opengraph-image', '/t/AAPL/opengraph-image', '/t/ETH/opengraph-image',
  '/links/opengraph-image', '/chat/opengraph-image', '/agents/opengraph-image',
  '/roster/opengraph-image', '/t/ZZQQXX/opengraph-image',
]
const VIEWPORTS = [{ width: 375, height: 812 }, { width: 1440, height: 900 }]

type Row = {
  route: string; width: number; status: number | null; overflow: number
  consoleErrors: string[]; pageErrors: string[]; failedRequests: string[]
  yeetful: string[]; badImages: string[]
}

async function main() {
  let browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
  const headers: Record<string, string> = { 'x-yf-internal-run': '1' }
  const rows: Row[] = []
  const links = new Set<string>()
  const routes = ONLY ?? ROUTES
  for (const vp of VIEWPORTS) {
    let ctx = await browser.newContext({ viewport: vp, extraHTTPHeaders: headers, isMobile: vp.width < 768 })
    for (const route of routes) {
      if (!browser.isConnected()) browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
      let page: any
      try { page = await ctx.newPage() } catch {
        ctx = await browser.newContext({ viewport: vp, extraHTTPHeaders: headers, isMobile: vp.width < 768 })
        page = await ctx.newPage()
      }
      if (process.env.VERBOSE) console.error('..', vp.width, route)
      const row: Row = { route, width: vp.width, status: null, overflow: 0, consoleErrors: [], pageErrors: [], failedRequests: [], yeetful: [], badImages: [] }
      page.on('console', (m: any) => { if (m.type() === 'error') row.consoleErrors.push(m.text().slice(0, 200)) })
      page.on('pageerror', (e: any) => row.pageErrors.push(String(e.message).slice(0, 200)))
      page.on('requestfailed', (r: any) => { if (!/_rsc=|google|youtube|analytics/.test(r.url())) row.failedRequests.push(`FAIL ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ''}`) })
      page.on('response', (r: any) => { if (r.status() >= 400 && r.url() !== BASE + route) row.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '').slice(0, 140)}`) })
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
