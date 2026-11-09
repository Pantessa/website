import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/community/identity'
import { COMMUNITY_SLUG_RE } from '@/lib/community/spec'
import { getCommunity, mintLinkCode, roleOf, unlinkChannel } from '@/lib/community/store'
import { missingEnv, telegramConfig, telegramStatus, unconfiguredBody } from '@/lib/telegram/config'
import { addToGroupAsAdminUrl, addToGroupUrl, joinUrlFor } from '@/lib/telegram/links'
import { sameOrigin } from '@/lib/telegram/request'
import { telegramChatsOf } from '@/lib/telegram/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/communities/[slug]/telegram — a room's Telegram link (squad
// community, lane TELEGRAM).
//
//   GET     public   → { configured, bot, miniApp, joinUrl, channels: [{ title }] }
//                      (titles only: a chat id never leaves the server)
//   POST    owner/mod → { code, expiresAt, addToGroupUrl, addAsAdminUrl, linkCommand, joinUrl }
//                      mints the single-use code (15 min) and the link that
//                      opens Telegram's group picker with it
//   DELETE  owner/mod → { unlinked }
//
// The caller is read from getActor(), never from the body. Minting a code
// proves nothing about a group: the bot checks with Telegram that whoever
// sends the code administers the chat before it is spent.

type Ctx = { params: Promise<{ slug: string }> }

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { slug } = await params
  if (!COMMUNITY_SLUG_RE.test(slug)) return refuse('No such room.', 404)
  const status = telegramStatus()
  const cfg = telegramConfig()
  if (!status.configured || !cfg.bot) return NextResponse.json({ ...status, joinUrl: null, channels: [] }, { headers: { 'cache-control': 'no-store' } })
  const community = await getCommunity(slug)
  if (!community) return refuse('No such room.', 404)
  const channels = community.channels.filter((c) => c.platform === 'telegram').map((c) => ({ title: c.title }))
  return NextResponse.json({ ...status, joinUrl: joinUrlFor({ bot: cfg.bot, app: cfg.app }, slug), channels }, { headers: { 'cache-control': 'no-store' } })
}

async function manager(req: NextRequest, slug: string) {
  const cfg = telegramConfig()
  const missing = missingEnv(cfg, ['token', 'bot'])
  if (missing || !cfg.bot) return { refusal: NextResponse.json(unconfiguredBody(missing ?? 'TELEGRAM_BOT_NAME'), { status: 503 }) }
  if (!COMMUNITY_SLUG_RE.test(slug)) return { refusal: refuse('No such room.', 404) }
  // The identity cookie can be SameSite=None (a Mini App in an iframe): a write names its own origin.
  if (!sameOrigin(req.headers)) return { refusal: refuse('This must come from the Pantessa page itself.', 403) }
  const actor = await getActor()
  if (!actor) return { refusal: NextResponse.json({ error: 'Sign in to manage this room.', needsIdentity: true }, { status: 401 }) }
  const role = await roleOf(slug, actor.key)
  if (role !== 'owner' && role !== 'mod') return { refusal: refuse('Only the room owner or a mod can link a chat.', 403) }
  return { actor, bot: cfg.bot, app: cfg.app }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug } = await params
  const m = await manager(req, slug)
  if ('refusal' in m) return m.refusal
  const minted = await mintLinkCode(slug, m.actor.key, 'telegram')
  if (!minted.ok) return refuse(minted.reason, minted.status)
  return NextResponse.json(
    {
      code: minted.code,
      expiresAt: minted.expiresAt,
      addToGroupUrl: addToGroupUrl(m.bot, minted.code),
      addAsAdminUrl: addToGroupAsAdminUrl(m.bot, minted.code),
      linkCommand: `/link@${m.bot} ${minted.code}`,
      joinUrl: joinUrlFor({ bot: m.bot, app: m.app }, slug),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { slug } = await params
  const m = await manager(req, slug)
  if ('refusal' in m) return m.refusal
  const chats = await telegramChatsOf(slug)
  let unlinked = 0
  for (const c of chats) if (await unlinkChannel('telegram', c.externalId, m.actor.key)) unlinked++
  return NextResponse.json({ unlinked })
}
