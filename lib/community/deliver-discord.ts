// Lane DISCORD: announce one post to one linked Discord channel.
// Contract (fanout.ts): best-effort, resolves false, never throws.
//
// Two shapes of linked channel:
//   · secret present = the owner pasted a channel webhook URL. The stored URL
//     is re-parsed with the same fence as the paste (a poisoned row can never
//     aim this fetch off discord.com), then POSTed with ?wait=true. A plain
//     webhook cannot carry buttons, so the links ride the embed as markdown.
//     404 / 401 from Discord = the webhook was deleted: the channel unlinks.
//   · no secret = linked from inside Discord with `/pantessa link <code>`;
//     it needs DISCORD_BOT_TOKEN (POST /channels/<id>/messages, real link
//     buttons). Unset token = false. A 404 (unknown channel) unlinks; a 401 /
//     403 is OUR token or permissions and never unlinks a room's channel.
// The URL is never logged; failures log the status only.
import type { Deliverer } from './fanout'
import { unlinkChannel } from './store'
import { SITE_URL } from '@/lib/site-url'
import { parseDiscordWebhookUrl, SNOWFLAKE_RE, DISCORD_API } from '@/lib/discord/webhook'
import { discordAnnouncement } from '@/lib/discord/format'
import { discordBotToken } from '@/lib/discord/env'

const TIMEOUT_MS = 8000

export interface DeliverDeps {
  fetch: typeof fetch
  unlink: (externalId: string) => Promise<unknown>
  botToken: string | null
  site: string
}

const defaultDeps = (): DeliverDeps => ({
  fetch: (...a) => fetch(...a),
  unlink: (externalId) => unlinkChannel('discord', externalId),
  botToken: discordBotToken(),
  site: SITE_URL,
})

export async function deliverDiscordWith(deps: DeliverDeps, ...[channel, { post, community }]: Parameters<Deliverer>): Promise<boolean> {
  try {
    if (channel.platform !== 'discord') return false
    if (channel.secret) {
      const hook = parseDiscordWebhookUrl(channel.secret)
      if (!hook) return false
      const res = await deps.fetch(`${hook.url}?wait=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(discordAnnouncement(post, community, deps.site, { buttons: false })),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
      if (res.status === 404 || res.status === 401) await deps.unlink(channel.externalId).catch(() => null)
      if (!res.ok) console.warn('[deliver-discord] webhook', res.status)
      return res.ok
    }
    if (!deps.botToken || !SNOWFLAKE_RE.test(channel.externalId)) return false
    const res = await deps.fetch(`${DISCORD_API}/channels/${channel.externalId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bot ${deps.botToken}` },
      body: JSON.stringify(discordAnnouncement(post, community, deps.site, { buttons: true })),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (res.status === 404) await deps.unlink(channel.externalId).catch(() => null)
    if (!res.ok) console.warn('[deliver-discord] bot', res.status)
    return res.ok
  } catch (e) {
    console.warn('[deliver-discord]', e instanceof Error ? e.name : 'error')
    return false
  }
}

export const deliverDiscord: Deliverer = (channel, a) => deliverDiscordWith(defaultDeps(), channel, a)
