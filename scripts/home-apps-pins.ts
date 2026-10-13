// Pins for THE APPS ROW (lib/home-apps — the fleet's marks on the splash in
// the guide card's old seat, each a door into the chat's apps drawer with
// that app on, 2026-10-13) and the rule that lets a stranger through: the
// table, the hrefs, every slug first-party and resolvable in both directory
// spellings, a vendored mark for each, the chat surface public to look at,
// the wiring (the row keeps the guide's visit record, the spine's APPS seat
// opens no door, the chat applies `?mcps=` through the families, the splash
// mounts no guide seat and the pulse lesson is gone). Pure: no server.
//   npx tsx scripts/home-apps-pins.ts      (npm run pins:home-apps)
import { readFileSync } from 'node:fs'
import { HOME_APPS, HOME_APPS_ALL_HREF, HOME_APPS_EYEBROW, HOME_APPS_WHY, homeAppHref } from '../lib/home-apps'
import { FIRST_PARTY_APP_SLUGS, resolveAppIds } from '../lib/ask-apps'
import { isPublicAppPath } from '../lib/app-entry'
import { GUIDE_HINTS, GUIDE_SURFACES } from '../lib/guide'
import { getProtocolMark } from '../components/protocol-marks'
import { DEFAULT_TAB, parseTabParam } from '../lib/app-tab-url'

type Check = (name: string, ok: boolean, extra?: string) => void

/** Two directories, as prod and the seed spell the fleet. */
const row = (slug: string, name: string) => ({ id: `id-${slug}`, slug, name, endpoint: `https://${slug}.example`, gated: false })
const PROD = ['uniswap-free', 'snapshot-free', 'cow-free', 'hyperliquid-free', 'opensea-free', 'robinhood-free', 'aave', 'morpho-free', 'lido-free', 'near-intents-mcp-yeetful', 'yeetful-tool-wallet'].map((s) => row(s, s.replace(/-free$|-mcp-yeetful$/, '').replace(/-/g, ' ')))
const SEED = ['uniswap-free', 'snapshot-free', 'cow-free', 'hyperliquid-free', 'opensea-free', 'robinhood-free', 'aave-free', 'morpho-free', 'lido-free', 'near-intents-free', 'yeetful-tool-wallet'].map((s) => row(s, s.replace(/-free$/, '').replace(/-/g, ' ')))

export function homeAppsPins(check: Check): void {
  const slugs = HOME_APPS.map((a) => a.slug)
  check(
    "apps row: eleven first-party apps in the order a stranger should meet them (where money moves first, then where it earns, then the rest), names unique and short, each with one line of what it does; every slug is a FIRST-PARTY free app (lib/ask-apps) — never a custom or paid row",
    HOME_APPS.length === 11 &&
      slugs.slice(0, 4).join() === 'uniswap-free,robinhood-free,hyperliquid-free,cow-free' &&
      new Set(HOME_APPS.map((a) => a.name)).size === HOME_APPS.length &&
      HOME_APPS.every((a) => a.name.length <= 16 && a.does.length > 0 && a.does.length <= 60) &&
      slugs.every((s) => FIRST_PARTY_APP_SLUGS.has(s) || s.startsWith('yeetful-tool-')),
    slugs.join(','),
  )
  check(
    "apps row: every slug resolves to exactly one row in prod's spelling AND in the seed's (the families: aave ↔ aave-free, near-intents ↔ near-intents-free / -mcp-yeetful), and every app wears a vendored mark (components/protocol-marks)",
    HOME_APPS.every((a) => resolveAppIds([a.slug], PROD).length === 1 && resolveAppIds([a.slug], SEED).length === 1) &&
      HOME_APPS.every((a) => getProtocolMark(a.slug, a.name) !== null),
    HOME_APPS.filter((a) => resolveAppIds([a.slug], PROD).length !== 1 || resolveAppIds([a.slug], SEED).length !== 1 || !getProtocolMark(a.slug, a.name)).map((a) => a.slug).join(',') || 'all resolve',
  )
  check(
    "apps row: a logo's door is the chat's own deep link — the APPS tab named (`?tab=mcps`, the drawer first) with that one app on (`?mcps=<slug>`); the \"All apps\" door is the spine's APPS destination; both are public to a stranger (lib/app-entry), and the tab param parses as the drawer",
    homeAppHref('aave') === '/chat?tab=mcps&mcps=aave' &&
      homeAppHref('yeetful-tool-wallet') === '/chat?tab=mcps&mcps=yeetful-tool-wallet' &&
      HOME_APPS_ALL_HREF === '/chat?tab=mcps' &&
      HOME_APPS.every((a) => isPublicAppPath(homeAppHref(a.slug))) &&
      isPublicAppPath(HOME_APPS_ALL_HREF) &&
      parseTabParam('?tab=mcps&mcps=aave') === 'mcps' &&
      DEFAULT_TAB === 'mcps',
  )
  check(
    "apps open: the bare /chat and its deep links are public to LOOK at (2026-10-13, Nate: \"click apps without needing to sign into the wallet\") — an open chat (/chat/<id>), /wallet and the dashboard stay the signed-in app's",
    isPublicAppPath('/chat') && isPublicAppPath('/chat/') && isPublicAppPath('/chat?prompt=hi') && isPublicAppPath('/chat?tab=jobs') && !isPublicAppPath('/chat/abc') && !isPublicAppPath('/chats') && !isPublicAppPath('/wallet') && !isPublicAppPath('/dashboard'),
  )
  check(
    'apps row: the words — the eyebrow names the apps and the one-chat idea; the why says a wallet is asked for when you act, never to look',
    /every dapp, one chat/i.test(HOME_APPS_EYEBROW) && /act/.test(HOME_APPS_WHY) && /never to look/.test(HOME_APPS_WHY) && HOME_APPS_WHY.length <= 110,
  )

  // ── The wiring ────────────────────────────────────────────────────────
  const home = readFileSync('components/home/HomeSurface.tsx', 'utf8')
  const rowSrc = readFileSync('components/home/AppsRow.tsx', 'utf8')
  const spine = readFileSync('components/AppSpine.tsx', 'utf8')
  const workspace = readFileSync('components/ChatWorkspace.tsx', 'utf8')
  const css = readFileSync('components/home/apps-row.css', 'utf8')
  check(
    "apps row: HomeSurface seats the row where the guide card sat (the `guide` prop — the seat's margins stay), the row is SpineLinks (a plain link while the chat is public, the door if that rule ever closes) with prefetch off and a journey label per app, it keeps the guide's record of a splash visit (the claim block reads `visited.home`), and the splash mounts no guide seat",
    /guide=\{<AppsRow \/>\}/.test(home) &&
      !/GuideSeat/.test(home) &&
      /noteGuideEvent\('visited:home'\)/.test(rowSrc) &&
      /<SpineLink href=\{homeAppHref\(a\.slug\)\} className="apps-row__app" prefetch=\{false\}/.test(rowSrc) &&
      /data-journey=\{`App \$\{a\.name\}`\}/.test(rowSrc) &&
      /<SpineLink href=\{HOME_APPS_ALL_HREF\}/.test(rowSrc) &&
      /getProtocolMark\(a\.slug, a\.name\)/.test(rowSrc),
  )
  check(
    "apps open: the spine's APPS seat (desktop pick and the phone's navigate) opens no door for a public destination; the chat applies `?mcps=` through the families (resolveAppIds) and never seeds the default fleet over a deep link",
    /if \(!isPublicAppPath\(href\) && openDoorFor\(href\)\) return/.test(spine) &&
      /if \(!isPublicAppPath\(action\.href\) && openDoorFor\(action\.href\)\) return/.test(spine) &&
      /const ids = resolveAppIds\(slugs, servers\)/.test(workspace) &&
      /if \(new URLSearchParams\(window\.location\.search\)\.get\('mcps'\)\) return/.test(workspace),
  )
  check(
    "guide: the splash's own lesson is gone (the deck IS the live-tape lesson now) — six hints, no 'pulse', 'home' still a surface in the rulebook",
    !GUIDE_HINTS.some((h) => (h.id as string) === 'pulse') && GUIDE_HINTS.length === 6 && GUIDE_SURFACES.includes('home'),
  )
  check(
    "apps row: a thumb gets 44px pills; the phone keeps one scrolling row of pills and drops the head (the guide row's 62px budget — the first board row stays above the bar)",
    /@media \(hover: none\) \{ \.apps-row__app \{ height: 44px; \}/.test(css) && /@media \(max-width: 640px\) \{[^]*?\.apps-row__head \{ display: none; \}/.test(css) && /\.apps-row__list \{ flex-wrap: nowrap; overflow-x: auto;/.test(css),
  )
}

if (process.argv[1]?.endsWith('home-apps-pins.ts')) {
  let failed = 0
  homeAppsPins((name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  })
  console.log(failed ? `\n${failed} failed` : '\nall green')
  process.exit(failed ? 1 : 0)
}
