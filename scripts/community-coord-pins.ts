// Pins for squad community, the COORDINATOR's own fixes (2026-11-09): the
// second security pass's Telegram sign-in findings (QA-SECURITY-2 T1, T5,
// T6) and the room-invite / share-arrival split. Wired into test-api.
//   npx tsx scripts/community-coord-pins.ts            (npm run pins:community-coord)
//   BASE=http://localhost:PORT npx tsx scripts/community-coord-pins.ts --served
import { readFileSync } from 'node:fs'
import { inTelegramApp } from '../lib/telegram/container'
import { TG_MINI_APP_MAX_AGE_SEC, initDataHash, verifyInitData } from '../lib/telegram/verify'
import { additiveRefusal } from './run-ddl'
import { INVISIBLE_RE, cleanText } from '../lib/chart-posts'
import { sameOrigin, sameOriginJson } from '../lib/community/origin'

type Check = (name: string, ok: boolean, extra?: string) => void

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** Source with comments removed, so a rule is read from code and never from prose. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function initData(fields: Record<string, string>, token: string): string {
  const pairs = new Map(Object.entries(fields))
  return new URLSearchParams({ ...fields, hash: initDataHash(pairs, token) }).toString()
}

export function communityCoordPins(check: Check): void {
  // ── T1: the Mini App entry signs in only inside a Telegram app ──
  const self = {}
  const browser = { parent: self, self, external: { AddSearchProvider() {} } }
  check(
    "T1 container: an ordinary browser tab is NOT a Telegram app (a link's #tgWebAppData cannot make it one); the native bridge is (TelegramWebviewProxy, or Telegram Desktop's external.notify); a FRAMED page never is, bridge or not",
    !inTelegramApp(browser) &&
      !inTelegramApp({ parent: self, self }) &&
      inTelegramApp({ parent: self, self, TelegramWebviewProxy: { postEvent() {} } }) &&
      inTelegramApp({ parent: self, self, external: { notify() {} } }) &&
      !inTelegramApp({ parent: {}, self, TelegramWebviewProxy: { postEvent() {} } }) &&
      !inTelegramApp({ parent: self, self, TelegramWebviewProxy: null }),
  )
  const entry = code('app/tg/TgEntry.tsx')
  check(
    'T1 entry: the page asks inTelegramApp BEFORE it loads Telegram\'s script or reads initData, and it makes ONE request (the auth route seats the account) — it never calls the join route itself',
    /if \(!inTelegramApp\(window as unknown as Parameters<typeof inTelegramApp>\[0\]\)\) return outside\(\)\s*const app = await loadTelegram\(\)/.test(entry) && !/\/api\/communities\//.test(entry),
  )
  const token = '123456:coord-pin-fake-token'
  const now = 1_780_000_000
  const at = (age: number) => verifyInitData(initData({ auth_date: String(now - age), user: JSON.stringify({ id: 4242, first_name: 'Pin' }) }, token), token, now, TG_MINI_APP_MAX_AGE_SEC)
  const old = at(TG_MINI_APP_MAX_AGE_SEC + 1)
  check(
    'T1 freshness: at the auth route a Mini App launch is good for ten minutes — 600s old verifies, one second more is stale (a day-old launch string is a credential someone can paste into a link)',
    TG_MINI_APP_MAX_AGE_SEC === 600 && at(600).ok && !old.ok && old.reason === 'stale',
  )
  const auth = code('app/api/telegram/auth/route.ts')
  check(
    "T1 seat: the auth route passes the ten-minute window, seats `tg:<the verified id>` through providerKey and joinCommunity, and never reads getActor (a wallet session in the same browser is not joined by a link carrying someone else's launch data)",
    /verifyInitData\(body\.initData, cfg\.token, nowSec, TG_MINI_APP_MAX_AGE_SEC\)/.test(auth) &&
      /key: providerKey\('tg', identity\.id\), wallet: null/.test(auth) &&
      /joinCommunity\(target\.slug, actor,/.test(auth) &&
      !/getActor|getSessionAddress/.test(auth),
  )
  // ── T5: the identity cookie is never SameSite=None ──
  const ident = code('lib/community/identity.ts')
  check(
    "T5 cookie: the identity cookie is SameSite=Lax and nothing in the identity module can ask for None (a framed room page is signed out, like the wallet session — no clickjacked join or vote, no zero-click plant)",
    /sameSite: 'lax'/.test(ident) && !/'none'/i.test(ident) && !/embedded \?/.test(ident),
  )
  // ── T6: signing out clears the identity too ──
  const logout = code('app/api/auth/logout/route.ts')
  check('T6 logout: the sign-out route clears the wallet session AND the Telegram / Discord identity', /await clearSessionCookie\(\)\s*await clearIdentityCookie\(\)/.test(logout))
  // ── a room invite is not a share arrival ──
  const via = code('components/ViaTracker.tsx')
  check(
    "invite vs arrival: ?via= on a room page (/g, /g/<slug>) or the Telegram entry (/tg) never sets the site-wide yf_via cookie — a room's invite code credits a member inside the room, not a sharer in wallet_arrivals",
    /if \(pathname === '\/g' \|\| pathname\.startsWith\('\/g\/'\) \|\| pathname === '\/tg'\) return/.test(via),
  )
  // ── T15 + S7: the same-origin check ──
  const h = (o: Record<string, string>) => new Headers(o)
  check(
    "T15 origin: a request is ours when Origin names the host it was sent to (or the canonical site); X-Forwarded-Host is ignored (a caller can write it); a cross-site Sec-Fetch-Site is refused; a server-to-server call with neither header passes; a write with a body must also be JSON",
    sameOrigin(h({ host: 'localhost:4500', origin: 'http://localhost:4500' })) &&
      sameOrigin(h({ host: 'internal.vercel', origin: 'https://www.pantessa.com' })) &&
      !sameOrigin(h({ host: 'www.pantessa.com', origin: 'https://evil.example' })) &&
      !sameOrigin(h({ host: 'www.pantessa.com', 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' })) &&
      !sameOrigin(h({ host: 'www.pantessa.com', 'sec-fetch-site': 'cross-site' })) &&
      !sameOrigin(h({ host: 'www.pantessa.com', origin: 'null' })) &&
      sameOrigin(h({ host: 'www.pantessa.com' })) &&
      sameOriginJson(h({ host: 'www.pantessa.com', 'content-type': 'application/json; charset=utf-8' })) &&
      !sameOriginJson(h({ host: 'www.pantessa.com', 'content-type': 'text/plain' })) &&
      !sameOriginJson(h({ host: 'www.pantessa.com' })),
  )
  // ── S21: a wallet session is never a token minted for another audience ──
  check(
    'S21 session: the wallet-session verifier refuses any token that carries an audience (the identity cookie has one), before it reads the address claim',
    /if \(payload\.aud !== undefined\) return null\s*return typeof payload\.address === 'string'/.test(code('lib/auth.ts')),
  )
  // ── R8: running text keeps the joiners real writing needs ──
  const persian = '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645' // "mi-khaham" with its ZWNJ
  const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}' // an emoji ZWJ sequence
  check(
    'R8 text: a title, body or comment keeps U+200C and U+200D (Persian words, emoji sequences) while bidi overrides, isolates, zero-width SPACE and C1 controls are still stripped; the strict strip used for NAMES still removes the joiners',
    cleanText(persian, 80) === persian && cleanText(family, 80) === family && cleanText('a\u202eb\u200bc\u2066d\u0085e\ufeff', 50) === 'abcde' && persian.replace(INVISIBLE_RE, '') !== persian,
  )
  // ── S11: the DDL runner's additive fence reads every clause ──
  const refused = [
    'ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS x text, DROP COLUMN title',
    'ALTER TABLE a ADD COLUMN IF NOT EXISTS x text, RENAME TO b',
    'ALTER TABLE a ADD COLUMN IF NOT EXISTS x text, ALTER COLUMN email DROP NOT NULL',
    'CREATE TABLE IF NOT EXISTS copy AS SELECT * FROM api_keys',
    "ALTER TABLE a ADD COLUMN IF NOT EXISTS x text DEFAULT (query_to_xml('delete from t', true, true, ''))",
    'DROP TABLE x',
    'UPDATE x SET y = 1',
  ]
  const ours = read('prisma/ddl/2026-11-09-community.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)
  check(
    'S11 ddl fence: a destructive clause hidden behind an ADD COLUMN, a table copied AS SELECT, and a DEFAULT that calls a function are all refused; every statement of the community DDL file passes',
    refused.every((s) => additiveRefusal(s) !== null) && ours.length >= 25 && ours.every((s) => additiveRefusal(s) === null),
    refused.filter((s) => additiveRefusal(s) === null).join(' | ') || `${ours.length} statements`,
  )
}

/** Served: against a running `next start` (BASE). No DB rows are written. */
export async function communityCoordPinsServed(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: 'yf_session=x; pt_ident=y' } })
  const cookies = res.headers.getSetCookie?.() ?? []
  check(
    'T6 logout (served): one sign-out answers a clearing Set-Cookie for BOTH yf_session and pt_ident',
    res.status === 200 && cookies.some((c) => /^yf_session=;/.test(c)) && cookies.some((c) => /^pt_ident=;/.test(c)),
    cookies.map((c) => c.split(';')[0]).join(' | '),
  )
  const tg = await fetch(`${base}/tg?startapp=g_no-such-room`)
  const html = await tg.text()
  check(
    "T1 entry (served): /tg answers 200 and its HTML does not load Telegram's script by itself (the client loads it only after the container check)",
    tg.status === 200 && !/telegram-web-app\.js/.test(html),
  )
}

if (process.argv[1]?.endsWith('community-coord-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => communityCoordPins(check))
    .then(() => (served ? communityCoordPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
