// Who is on the other end — one answer for every surface that counts people
// or spends money on them: the journey log's `is_bot` (lib/journey-server),
// the markets model fence (lib/markets-ai-fence), and the Web Analytics tag
// (components/SiteAnalytics). Pure: no server, no DOM, safe in the browser.
//
// Two tells, both read from the user agent:
//   · a NAMED automated client (crawlers, headless browsers, HTTP libraries);
//   · a STALE desktop browser. Desktop Chrome, Edge and Firefox update
//     themselves every four weeks, so a desktop browser more than about two
//     years behind is almost always a scraper reading from an old list of
//     user agents. Measured 2026-11-06 → 11-09: a daily crawl from thousands
//     of residential IPs rotated Chrome 118–120, Edge 119/120 and Firefox
//     120/121 (late 2023) evenly, beside `Lightpanda/1.0`, and Vercel's own
//     bot check passed all of it.
//
// Phones are never judged by version: an old phone can be stuck on an old
// browser for good (Chrome dropped Android 7 at 119). Neither is Safari,
// whose version follows the OS. The current version is computed from the
// release cadence, so the line moves on its own and needs no yearly edit.

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|headless|lightpanda|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|preview|facebookexternalhit|embedly|python-requests|python-urllib|aiohttp|curl\/|wget|go-http-client|okhttp|axios|node-fetch|undici|java\/|libwww|scrapy|httpclient|monitor|uptime|pingdom|datadog|vercel-screenshot|google-inspectiontool|chrome-lighthouse|stripebot|yak\/|trendiction/i

/** Pure: does this user agent name an automated client? An empty one does. */
export function isBotUa(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true
  return BOT_UA.test(ua)
}

const DAY_MS = 86_400_000
/** Chrome and Firefox both ship a major version every four weeks. */
const RELEASE_DAYS = 28
/** Anchors: Chrome 120 shipped 2023-12-05, Firefox 121 on 2023-12-19. */
const CHROME_ANCHOR = { major: 120, at: Date.UTC(2023, 11, 5) }
const FIREFOX_ANCHOR = { major: 121, at: Date.UTC(2023, 11, 19) }
/** How far behind a desktop browser may be before it reads as automated:
 *  26 releases, about two years. A real browser that far behind has been
 *  refusing its own updates since before the anchor's successor shipped. */
export const STALE_RELEASES = 26

function majorAt(anchor: { major: number; at: number }, now: Date): number {
  return anchor.major + Math.floor((now.getTime() - anchor.at) / (RELEASE_DAYS * DAY_MS))
}

/** The Chrome (and Edge) major shipping on `now`, from the release cadence. */
export function chromeMajorAt(now: Date = new Date()): number {
  return majorAt(CHROME_ANCHOR, now)
}

/** The Firefox major shipping on `now`, from the release cadence. */
export function firefoxMajorAt(now: Date = new Date()): number {
  return majorAt(FIREFOX_ANCHOR, now)
}

/** Pure: a desktop Chrome, Edge or Firefox more than STALE_RELEASES behind.
 *  Phones, tablets and Safari are never stale here. */
export function isStaleBrowserUa(ua: string | null | undefined, now: Date = new Date()): boolean {
  if (!ua) return false
  if (/Android|Mobile|iPhone|iPad|iPod/i.test(ua)) return false
  if (!/Windows NT|Macintosh|X11|CrOS/.test(ua)) return false
  const ff = /\bFirefox\/(\d+)/.exec(ua)
  if (ff) return Number(ff[1]) < firefoxMajorAt(now) - STALE_RELEASES
  const cr = /\bEdg\/(\d+)/.exec(ua) ?? /\bChrom(?:e|ium)\/(\d+)/.exec(ua)
  if (cr) return Number(cr[1]) < chromeMajorAt(now) - STALE_RELEASES
  return false
}

/** Pure: either tell. The one question the counting and spending surfaces ask. */
export function isAutomatedUa(ua: string | null | undefined, now: Date = new Date()): boolean {
  return isBotUa(ua) || isStaleBrowserUa(ua, now)
}
