import { NextRequest, NextResponse } from 'next/server'
import { normalizeIdentity, setIdentityCookie } from '@/lib/community/identity'
import { COMMUNITY_SLUG_RE, INVITE_CODE_RE, parseJoinPayload, providerKey } from '@/lib/community/spec'
import { joinCommunity } from '@/lib/community/store'
import { isInternalRun } from '@/lib/internal-run'
import { missingEnv, telegramConfig, telegramStatus, unconfiguredBody } from '@/lib/telegram/config'
import { joinUrlFor } from '@/lib/telegram/links'
import { AUTH_BODY_MAX, parseJsonObject, readCapped, sameOriginJson } from '@/lib/telegram/request'
import { TG_MINI_APP_MAX_AGE_SEC, verifyFailureReply, verifyInitData, verifyLoginWidget } from '@/lib/telegram/verify'

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
//   POST { initData, join? } → a Mini App's signed launch data (fresh for ten
//                              minutes). `join` is a room payload (`g_<slug>`,
//                              spec joinPayload): the route seats the identity
//                              IT JUST VERIFIED in that room and says so.
//   POST { id, first_name, …, auth_date, hash }
//                            → the Login Widget's signed fields
//
// The POST verifies Telegram's HMAC (lib/telegram/verify: constant-time,
// fresh both ways) and ONLY THEN mints the identity cookie. Nothing in the
// body is trusted before that, and nothing in it is logged.
//
// WHO IS SEATED (QA-SECURITY-2 T1). The join here is for `tg:<the verified
// id>` and nobody else. It never goes through getActor(): a browser that also
// holds a wallet session is NOT joined as that wallet by opening a link that
// carries somebody else's launch data.

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
  const verdict = fromMiniApp ? verifyInitData(body.initData, cfg.token, nowSec, TG_MINI_APP_MAX_AGE_SEC) : verifyLoginWidget(body, cfg.token, nowSec)
  if (!verdict.ok) return NextResponse.json({ error: verifyFailureReply(verdict.reason) }, { status: 401 })

  const identity = normalizeIdentity({ p: 'tg', id: verdict.user.id, name: verdict.user.name, username: verdict.user.username })
  if (!identity) return NextResponse.json({ error: verifyFailureReply('no-user') }, { status: 401 })

  // The proof held.
  await setIdentityCookie(identity)

  // The room this launch names: Telegram's SIGNED start parameter first, then
  // the page's own (`join`, from our button's query). Either way the seat is
  // the verified Telegram account's.
  const target = parseJoinPayload(verdict.startParam) ?? parseJoinPayload(body.join)
  let joined: { slug: string; joined: boolean } | null = null
  let roomMissing = false
  if (target) {
    const actor = { key: providerKey('tg', identity.id), wallet: null, provider: { p: identity.p, id: identity.id, name: identity.name, username: identity.username } }
    const r = await joinCommunity(target.slug, actor, { via: target.invite, source: 'telegram', displayName: identity.name, isInternal: isInternalRun(req.headers, body) }).catch(() => null)
    if (r?.ok) joined = { slug: r.community.slug, joined: r.joined }
    else if (r && r.status === 404) roomMissing = true
  }
  return NextResponse.json({ identity, startParam: verdict.startParam, joined, ...(roomMissing ? { roomMissing: true } : {}) }, { headers: { 'cache-control': 'no-store' } })
}
