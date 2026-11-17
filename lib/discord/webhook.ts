// DISCORD WEBHOOK URL FENCE (squad community, lane DISCORD, 2026-11-09).
//
// A room owner pastes a channel webhook URL. That string is never stored,
// fetched or echoed as typed: it is reduced to (id, token) under a strict
// grammar and REBUILT on discord.com. The same parser runs again before every
// send (lib/community/deliver-discord), so a poisoned row can never aim our
// fetch anywhere else. Pure; pinned in scripts/community-discord-pins.ts.

export const DISCORD_API = 'https://discord.com/api/v10'
export const SNOWFLAKE_RE = /^\d{17,20}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{60,80}$/
const HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com', 'canary.discordapp.com', 'ptb.discordapp.com'])

export interface DiscordWebhook {
  id: string
  token: string
  /** Rebuilt from id + token on discord.com. The only form we store or fetch. */
  url: string
}

export function parseDiscordWebhookUrl(raw: unknown): DiscordWebhook | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.length < 40 || s.length > 220 || /[\s\\%]/.test(s)) return null
  // `new URL` would quietly normalize these away; the typed string must already be plain.
  if (/^[a-z]+:\/\/[^/]*:\d/i.test(s) || /\/\.{1,2}(\/|$)/.test(s)) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password || u.port) return null
  if (u.search || u.hash) return null
  // A trailing-dot host survives `new URL` and fails the exact set below.
  if (!HOSTS.has(u.hostname)) return null
  const m = u.pathname.match(/^\/api\/(?:v\d{1,2}\/)?webhooks\/([^/]+)\/([^/]+)\/?$/)
  if (!m) return null
  const [, id, token] = m
  if (!SNOWFLAKE_RE.test(id) || !TOKEN_RE.test(token)) return null
  return { id, token, url: `https://discord.com/api/webhooks/${id}/${token}` }
}

/** The webhook object Discord answers to a GET of the rebuilt URL, reduced to what we keep. */
export function readWebhookObject(raw: unknown, expectId: string): { channelId: string; guildId: string | null; name: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.id !== expectId) return null
  if (typeof o.channel_id !== 'string' || !SNOWFLAKE_RE.test(o.channel_id)) return null
  const guildId = typeof o.guild_id === 'string' && SNOWFLAKE_RE.test(o.guild_id) ? o.guild_id : null
  const name = typeof o.name === 'string' ? o.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) : ''
  return { channelId: o.channel_id, guildId, name: name || 'Discord webhook' }
}
