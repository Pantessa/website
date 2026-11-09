// Pins for lib/bot-ua: who counts as a person on the surfaces that count
// people (the journey log's is_bot, the Web Analytics tag) or spend house
// money on them (the markets model fence, the brief's wait for a hand).
// Pure plus source reads: no server, no DB. Called from scripts/test-api.ts,
// and runnable alone:
//   npx tsx scripts/bot-ua-pins.ts
import { readFileSync } from 'node:fs'
import { STALE_RELEASES, chromeMajorAt, firefoxMajorAt, isAutomatedUa, isBotUa, isStaleBrowserUa } from '../lib/bot-ua'
import { automatedCaller } from '../lib/markets-ai-fence'

type Check = (name: string, ok: boolean, extra?: string) => void

/** The day the crawl was measured. Pins pass it, so they never age. */
const NOW = new Date(Date.UTC(2026, 10, 9))

const win = (chrome: number, tail = '') => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36${tail}`
const mac = (chrome: number) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`
const ffWin = (v: number) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`
const ffMac = (v: number) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`
const android = (chrome: number) => `Mozilla/5.0 (Linux; Android 7.0; SM-G930F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Mobile Safari/537.36`

/** The user agents the 2026-11-06 → 11-09 crawl rotated (Vercel request
 *  metrics, grouped by clientUserAgent), plus its headless browser. */
export const CRAWL_UAS = [
  win(118), win(119), win(120), mac(119), mac(120),
  win(119, ' Edg/119.0.0.0'), win(120, ' Edg/120.0.0.0'),
  ffWin(120), ffWin(121), ffMac(121),
  'Lightpanda/1.0',
]

/** A current browser, for harness calls that must read as a person. */
export const PERSON_UA = mac(157)

export function botUaPins(check: Check): void {
  // ── the named tells ────────────────────────────────────────────────────
  check('bot ua: Lightpanda, HeadlessChrome, a bare HTTP client and an empty UA are named automation; a current desktop Chrome is not',
    isBotUa('Lightpanda/1.0') && isBotUa('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/145.0.0.0 Safari/537.36') && isBotUa('node') && isBotUa('') && isBotUa(null) &&
      !isBotUa(PERSON_UA))
  check('bot ua: user-flows still exports isBotUa (the journey pins read it there), from lib/bot-ua',
    /export \{ isBotUa \} from '\.\/bot-ua'/.test(readFileSync('lib/user-flows.ts', 'utf8')) && !/const BOT_UA/.test(readFileSync('lib/user-flows.ts', 'utf8')))

  // ── the stale tell ─────────────────────────────────────────────────────
  const chromeNow = chromeMajorAt(NOW)
  const ffNow = firefoxMajorAt(NOW)
  check('bot ua: the release cadence puts Chrome and Firefox in the 155–160 range on 2026-11-09 (a real visitor that day wore Chrome/157)',
    chromeNow >= 155 && chromeNow <= 160 && ffNow >= 155 && ffNow <= 160, `chrome=${chromeNow} firefox=${ffNow}`)
  const missed = CRAWL_UAS.filter((ua) => !isAutomatedUa(ua, NOW))
  check('bot ua: every user agent the November crawl rotated (Chrome 118–120, Edge 119/120, Firefox 120/121, Lightpanda) reads as automated', missed.length === 0, missed.join(' | '))
  const people = [
    PERSON_UA,
    win(152),
    win(156, ' Edg/156.0.0.0'),
    ffWin(156),
    ffMac(140), // Firefox ESR 140 (2025-06), inside its support window
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
    android(119), // Chrome's last release on Android 7: a stuck phone, not a bot
    'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.169 Mobile/15E148 Safari/604.1',
  ]
  const flagged = people.filter((ua) => isAutomatedUa(ua, NOW))
  check('bot ua: people are never flagged by version — current Chrome/Edge/Firefox, Firefox ESR 140, Safari on a Mac, and an old iPhone, iPad or Android phone stuck on an old browser', flagged.length === 0, flagged.join(' | '))
  const floor = chromeNow - STALE_RELEASES
  check(`bot ua: the line is ${STALE_RELEASES} releases (about two years): Chrome at the floor is a person, one release under it is stale`,
    !isStaleBrowserUa(win(floor), NOW) && isStaleBrowserUa(win(floor - 1), NOW) && !isStaleBrowserUa(ffWin(ffNow - STALE_RELEASES), NOW) && isStaleBrowserUa(ffWin(ffNow - STALE_RELEASES - 1), NOW), `floor=${floor}`)
  check('bot ua: the line moves with the calendar — the Chrome/152 a person wears today reads as stale in 2029, with no edit',
    !isStaleBrowserUa(win(152), NOW) && isStaleBrowserUa(win(152), new Date(Date.UTC(2029, 0, 1))))

  // ── the model fence ────────────────────────────────────────────────────
  const h = (ua: string, ip?: string) => new Headers({ 'user-agent': ua, ...(ip ? { 'x-forwarded-for': ip } : {}) })
  check('bot ua: the model fence judges only platform callers — loopback (no platform IP) is exempt like every fence; a platform IP with Lightpanda or Chrome 119 is automated, with Chrome 157 it is a person',
    !automatedCaller(h('Lightpanda/1.0'), NOW) && !automatedCaller(h('node', '::1'), NOW) &&
      automatedCaller(h('Lightpanda/1.0', '203.0.113.5'), NOW) && automatedCaller(h(win(119), '203.0.113.5'), NOW) && !automatedCaller(h(PERSON_UA, '203.0.113.5'), NOW))
  const fence = readFileSync('lib/markets-ai-fence.ts', 'utf8')
  const botAt = fence.indexOf('if (!owner && automatedCaller(headers)) return { wall: MARKETS_AI_BOT_WALL, owner }')
  const ipAt = fence.indexOf('if (!plus && (await bumpAndCheckMarketsAi(headers, body)))')
  check('bot ua: admitMarketsAi walls a signed-out automated caller AFTER BYOK/Plus and BEFORE the per-IP counter and the daily fuse (a crawl never spends either)',
    botAt > 0 && ipAt > botAt && fence.indexOf('bumpFuse(surface)') > botAt && fence.indexOf('resolveInferenceKey(owner)') < botAt)

  // ── the brief waits for a hand ─────────────────────────────────────────
  const hi = readFileSync('lib/human-input.ts', 'utf8')
  check('bot ua: lib/human-input counts only trusted hand events (pointer, touch, wheel, key) — never scroll, which a script can fire',
    hi.includes('if (!e.isTrusted || seen) return') && /EVENTS = \['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'\]/.test(hi) && !/'scroll'/.test(hi.replace(/\/\/.*$/gm, '')))
  const brief = readFileSync('components/markets/ai/AiBrief.tsx', 'utf8')
  const tape = readFileSync('components/markets/ai/MorningTape.tsx', 'utf8')
  check('bot ua: the AI brief and the morning tape ask the model only after a hand touches the page (the effect returns on !human and re-runs when it flips)',
    brief.includes('const human = useHumanInput()') && /if \(!human\) return\n\s+abortRef\.current\?\.abort\(\)/.test(brief) && brief.includes('}, [load, nonce, human])') &&
      tape.includes('const human = useHumanInput()') && /if \(!human\) return\n\s+abortRef\.current\?\.abort\(\)/.test(tape) && tape.includes('}, [key, nonce, human])'))

  // ── the counts ─────────────────────────────────────────────────────────
  const js = readFileSync('lib/journey-server.ts', 'utf8')
  check('bot ua: the journey log stamps is_bot with isAutomatedUa (so /analytics visitors and the flows page drop a stale browser too)',
    js.includes('isBot: isAutomatedUa(ua),') && !/isBot: isBotUa\(/.test(js))
  const layout = readFileSync('app/layout.tsx', 'utf8')
  const sa = readFileSync('components/SiteAnalytics.tsx', 'utf8')
  check('bot ua: Web Analytics mounts through SiteAnalytics, whose beforeSend drops a driven browser (navigator.webdriver) and an automated user agent',
    layout.includes("{process.env.NODE_ENV === 'production' && <SiteAnalytics />}") && !layout.includes('<Analytics />') &&
      sa.includes('<Analytics beforeSend={dropMachines} />') && sa.includes('if (navigator.webdriver === true) return null') && sa.includes('if (isAutomatedUa(navigator.userAgent)) return null'))
}

if (process.argv[1]?.endsWith('bot-ua-pins.ts')) {
  let failed = 0
  botUaPins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall bot-ua pins green')
  process.exit(failed ? 1 : 0)
}
