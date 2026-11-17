// /api/communities/[slug]/discord — link a room to a Discord channel (lane DISCORD).
//
//   GET     public   { configured: { webhooks: true, app }, channels: [{ title, webhook }] }
//   POST    owner/mod { webhookUrl }  → { linked: true, title }
//           owner/mod { mintCode: true } → { code, expiresAt, command, inviteUrl }  (needs DISCORD_APP_ID)
//   DELETE  owner/mod { title? }      → { unlinked: true }
//
// The webhook URL is parsed under a strict grammar and REBUILT on discord.com
// (lib/discord/webhook); only the rebuilt URL is fetched (one GET, 5s,
// redirect: 'error') and stored server-side through the store. No answer of
// this route ever carries the URL or its token, and nothing logs it.
// The channel a DELETE removes is picked from THIS room's own rows.
import { NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin, sameOriginJson } from '@/lib/community/origin'
import { getSessionAddress } from '@/lib/auth'
import { clientIpFrom } from '@/lib/turn-limits'
import { LINK_HOURLY_CAP, linkTripped } from '@/lib/community/limits'
import { COMMUNITY_SLUG_RE, walletKey, type MemberKey } from '@/lib/community/spec'
import { linkChannel, mintLinkCode, roleOf, unlinkChannel } from '@/lib/community/store'
import { discordChannelTitle } from '@/lib/community/rules'
import { parseDiscordWebhookUrl, readWebhookObject } from '@/lib/discord/webhook'
import { roomDiscordChannels } from '@/lib/discord/channels'
import { pickChannelToUnlink } from '@/lib/discord/pick'
import { botInviteUrl, discordAppId } from '@/lib/discord/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY = 8 * 1024
type Ctx = { params: Promise<{ slug: string }> }
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status })

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text().catch(() => '')
  if (!raw) return {}
  if (raw.length > MAX_BODY) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** null = may manage; otherwise the refusal. */
async function managerRefusal(slug: string, actor: { key: MemberKey }): Promise<NextResponse | null> {
  try {
    const role = await roleOf(slug, actor.key)
    if (role === 'owner' || role === 'mod') return null
    return refuse(403, 'Only the room owner or a mod can connect Discord.')
  } catch {
    return refuse(503, 'Rooms are not open yet. Try again soon.')
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  if (!COMMUNITY_SLUG_RE.test(slug)) return refuse(404, 'No such room.')
  const channels = await roomDiscordChannels(slug).catch(() => [])
  return NextResponse.json({
    configured: { webhooks: true, app: !!discordAppId() },
    channels: channels.map((c) => ({ title: c.title, webhook: c.webhook })),
  })
}

export async function POST(req: Request, ctx: Ctx) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOriginJson(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const { slug } = await ctx.params
  if (!COMMUNITY_SLUG_RE.test(slug)) return refuse(404, 'No such room.')
  // S7: managing a room needs the WALLET session; a provider identity cookie
  // alone (even one linked to the owner's wallet) never manages a room.
  const wallet = await getSessionAddress().catch(() => null)
  if (!wallet) return refuse(401, 'Sign in with your wallet to manage this room.', { needsIdentity: true })
  const actor = { key: walletKey(wallet) }
  // S8: every POST may send our server to Discord: fenced per wallet + per IP.
  const tripped = await linkTripped(clientIpFrom(req.headers), actor.key, 'discord')
  if (tripped) return refuse(429, `Too many Discord link attempts in the last hour (${LINK_HOURLY_CAP} a ${tripped === 'ip' ? 'network' : 'wallet'}). Try again later.`, { rateGate: tripped })
  const body = await readBody(req)
  if (!body) return refuse(400, 'Send JSON: { webhookUrl }.')

  if (body.mintCode === true) {
    const appId = discordAppId()
    if (!appId) return refuse(503, 'The Pantessa Discord bot is not set up yet: DISCORD_APP_ID is not set. Paste a channel webhook instead.', { unconfigured: 'DISCORD_APP_ID' })
    const denied = await managerRefusal(slug, actor)
    if (denied) return denied
    const minted = await mintLinkCode(slug, actor.key, 'discord').catch(() => null)
    if (!minted) return refuse(503, 'Could not make a link code right now.')
    if (!minted.ok) return refuse(minted.status, minted.reason)
    return NextResponse.json({ code: minted.code, expiresAt: minted.expiresAt, command: `/pantessa link ${minted.code}`, inviteUrl: botInviteUrl(appId) })
  }

  const hook = parseDiscordWebhookUrl(body.webhookUrl)
  if (!hook) return refuse(400, 'That is not a Discord webhook URL. It looks like https://discord.com/api/webhooks/<id>/<token>.')
  const denied = await managerRefusal(slug, actor)
  if (denied) return denied

  let res: Response
  try {
    res = await fetch(hook.url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' })
  } catch {
    return refuse(502, 'Discord did not answer. Try again in a minute.')
  }
  if (res.status === 404 || res.status === 401) return refuse(400, 'Discord does not know that webhook. It was deleted, or the URL was cut short. Copy it again.')
  if (!res.ok) return refuse(502, `Discord refused the check (${res.status}). Try again in a minute.`)
  const obj = readWebhookObject(await res.json().catch(() => null), hook.id)
  if (!obj) return refuse(400, 'That webhook does not post to a channel Pantessa can use.')

  // S17: the webhook's name passes the room-name rule, or the channel is the neutral "Discord channel".
  const title = discordChannelTitle(obj.name)
  const linked = await linkChannel(slug, actor.key, 'discord', { externalId: obj.channelId, title, secret: hook.url }).catch(() => null)
  if (!linked) return refuse(503, 'Could not save the link right now.')
  if (!linked.ok) return refuse(linked.status, linked.reason)
  return NextResponse.json({ linked: true, title })
}

export async function DELETE(req: Request, ctx: Ctx) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOrigin(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const { slug } = await ctx.params
  if (!COMMUNITY_SLUG_RE.test(slug)) return refuse(404, 'No such room.')
  // S7: managing a room needs the WALLET session; a provider identity cookie
  // alone (even one linked to the owner's wallet) never manages a room.
  const wallet = await getSessionAddress().catch(() => null)
  if (!wallet) return refuse(401, 'Sign in with your wallet to manage this room.', { needsIdentity: true })
  const actor = { key: walletKey(wallet) }
  const body = await readBody(req)
  if (!body) return refuse(400, 'Send JSON: { title }.')
  const denied = await managerRefusal(slug, actor)
  if (denied) return denied
  const rows = await roomDiscordChannels(slug).catch(() => null)
  if (!rows) return refuse(503, 'Could not read this room\'s channels right now.')
  const pick = pickChannelToUnlink(rows, body.title)
  if (!pick) return refuse(rows.length > 1 ? 400 : 404, rows.length > 1 ? 'Name the channel to unlink.' : 'This room has no such Discord channel.')
  const ok = await unlinkChannel('discord', pick.externalId, actor.key).catch(() => false)
  if (!ok) return refuse(503, 'Could not unlink right now.')
  return NextResponse.json({ unlinked: true, title: pick.title })
}
