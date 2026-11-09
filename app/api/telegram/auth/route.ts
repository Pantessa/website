import { NextRequest, NextResponse } from 'next/server'
import { normalizeIdentity, setIdentityCookie } from '@/lib/community/identity'
import { COMMUNITY_SLUG_RE, INVITE_CODE_RE } from '@/lib/community/spec'
import { missingEnv, telegramConfig, telegramStatus, unconfiguredBody } from '@/lib/telegram/config'
import { joinUrlFor } from '@/lib/telegram/links'
import { AUTH_BODY_MAX, parseJsonObject, readCapped, sameOriginJson } from '@/lib/telegram/request'
import { verifyFailureReply, verifyInitData, verifyLoginWidget } from '@/lib/telegram/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/telegram/auth — a Telegram identity becomes a Pantessa identity here
// and nowhere else (squad community, lane TELEGRAM).
//
//   GET                      → { configured, bot, miniApp, loginWidget }: what a
//                              page may know about the bot (never a secret).
//   GET ?start=<slug>&via=   → 302 to the room's join door in Telegram (the
//                              zero-setup "Continue with Telegram": Telegram
//                              itself proves the account, no widget, no domain).
//   POST { initData }        → a Mini App's signed launch data
//   POST { id, first_name, …, auth_date, hash }
//                            → the Login Widget's signed fields
//
// The POST verifies Telegram's HMAC (lib/telegram/verify: constant-time,
// fresh both ways) and ONLY THEN mints the identity cookie. Nothing in the
// body is trusted before that, and nothing in it is logged.

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start')
  if (start === null) return NextResponse.json(telegramStatus(), { headers: { 'cache-control': 'no-store' } })

  const cfg = telegramConfig()
  const missing = missingEnv(cfg, ['token', 'bot'])
  if (missing || !cfg.bot) return NextResponse.json(unconfiguredBody(missing ?? 'TELEGRAM_BOT_NAME'), { status: 503 })
  if (!COMMUNITY_SLUG_RE.test(start)) return NextResponse.json({ error: 'Name a room.' }, { status: 400 })
  const viaRaw = req.nextUrl.searchParams.get('via')
  const via = viaRaw && INVITE_CODE_RE.test(viaRaw) ? viaRaw : null
  // The destination is built from validated parts on Telegram's own host: never an open redirect.
  return NextResponse.redirect(joinUrlFor({ bot: cfg.bot, app: cfg.app }, start, via), { status: 302, headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const cfg = telegramConfig()
  if (!cfg.token) return NextResponse.json(unconfiguredBody('TELEGRAM_BOT_TOKEN'), { status: 503 })
  if (!sameOriginJson(req.headers)) return NextResponse.json({ error: 'This sign-in must come from the Pantessa page itself.' }, { status: 403 })

  const body = parseJsonObject(await readCapped(req, AUTH_BODY_MAX))
  if (!body) return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })

  const nowSec = Math.floor(Date.now() / 1000)
  const fromMiniApp = typeof body.initData === 'string'
  const verdict = fromMiniApp ? verifyInitData(body.initData, cfg.token, nowSec) : verifyLoginWidget(body, cfg.token, nowSec)
  if (!verdict.ok) return NextResponse.json({ error: verifyFailureReply(verdict.reason) }, { status: 401 })

  const identity = normalizeIdentity({ p: 'tg', id: verdict.user.id, name: verdict.user.name, username: verdict.user.username })
  if (!identity) return NextResponse.json({ error: verifyFailureReply('no-user') }, { status: 401 })

  // The proof held. A Mini App runs in Telegram's webview (an iframe on Telegram Web): ask for the cookie that survives there.
  await setIdentityCookie(identity, { embedded: fromMiniApp })
  return NextResponse.json({ identity, startParam: verdict.startParam }, { headers: { 'cache-control': 'no-store' } })
}
