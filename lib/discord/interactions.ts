// DISCORD SLASH COMMANDS (lane DISCORD, 2026-11-09). Pure over injected deps.
//
// One top-level command `/pantessa` with one subcommand per BOT_COMMANDS
// entry (`/pantessa chart ETH`, `/pantessa link <code>`). One name because a
// guild hosts many bots: `/chart`, `/top` and `/invite` collide with other
// apps' commands and Discord then shows the user two of each. A bare
// command whose name is a BOT_COMMANDS entry is also accepted (forward
// compatible with registering them individually later).
//
// The route verifies the signature over the raw body BEFORE this runs; the
// `member.permissions` bitfield read here is therefore Discord's word, not a
// claim. Every response carries allowed_mentions.parse = [] and escaped text.

import { BOT_COMMANDS, LINK_CODE_RE, communityPath, type FeedPost, type PublicCommunity, type PublicMember, type BotCommandName } from '@/lib/community/spec'
import { DISCORD_EMBED_COLOR, escapeDiscord, plainDiscord, type DiscordButton } from './format'
import { SNOWFLAKE_RE } from './webhook'

export const ROOT_COMMAND = 'pantessa'
export const EPHEMERAL = 64
const PERM_ADMINISTRATOR = BigInt(0x8)
const PERM_MANAGE_GUILD = BigInt(0x20)
/** Discord wants an answer inside 3s; the price read gets this much of it. */
export const CHART_BUDGET_MS = 2500

export interface InteractionDeps {
  site: string
  communityOfChannel: (externalId: string) => Promise<PublicCommunity | null>
  listFeed: (q: { community: string; sort: 'new'; kind: 'idea'; limit: number }) => Promise<{ posts: FeedPost[] }>
  listMembers: (slug: string, opts: { sort: 'invites' | 'trades'; limit: number }) => Promise<PublicMember[]>
  redeemLinkCode: (code: string, chat: { externalId: string; title: string | null }) => Promise<{ ok: true; community: PublicCommunity } | { ok: false; status: number; reason: string }>
  /** The chart's pair + one quote. May be slow; the handler races it. */
  chartQuote: (symbol: string) => Promise<{ symbol: string; label: string; last: number | null; chgPct: number | null } | null>
  budgetMs?: number
}

export interface InteractionResponse {
  type: 1 | 4
  data?: {
    content: string
    flags?: number
    embeds?: { title?: string; url?: string; description?: string; color?: number }[]
    components?: { type: 1; components: DiscordButton[] }[]
    allowed_mentions: { parse: string[] }
  }
}

type Opt = { name?: unknown; type?: unknown; value?: unknown; options?: unknown }

export function hasManagePermission(permissions: unknown): boolean {
  if (typeof permissions !== 'string' || !/^\d{1,40}$/.test(permissions)) return false
  const p = BigInt(permissions)
  return (p & PERM_ADMINISTRATOR) !== BigInt(0) || (p & PERM_MANAGE_GUILD) !== BigInt(0)
}

const COMMAND_NAMES = new Set<string>(BOT_COMMANDS.map((c) => c.name))

/** The subcommand and its one string argument, from the signed payload. */
export function readCommand(data: unknown): { name: BotCommandName; arg: string } | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Opt
  let node: Opt | undefined = d
  if (d.name === ROOT_COMMAND) {
    const sub = Array.isArray(d.options) ? (d.options[0] as Opt | undefined) : undefined
    if (!sub || sub.type !== 1) return null
    node = sub
  }
  if (typeof node?.name !== 'string' || !COMMAND_NAMES.has(node.name)) return null
  const first = Array.isArray(node.options) ? (node.options[0] as Opt | undefined) : undefined
  const arg = typeof first?.value === 'string' ? first.value.trim().slice(0, 64) : ''
  return { name: node.name as BotCommandName, arg }
}

function reply(content: string, opts: { ephemeral?: boolean; buttons?: DiscordButton[]; embeds?: NonNullable<InteractionResponse['data']>['embeds'] } = {}): InteractionResponse {
  const data: NonNullable<InteractionResponse['data']> = { content, allowed_mentions: { parse: [] } }
  if (opts.ephemeral) data.flags = EPHEMERAL
  if (opts.embeds?.length) data.embeds = opts.embeds
  if (opts.buttons?.length) data.components = [{ type: 1, components: opts.buttons.slice(0, 5) }]
  return { type: 4, data }
}

const button = (label: string, url: string): DiscordButton => ({ type: 2, style: 5, label: plainDiscord(label, 80) || 'Open', url })

export const HOW_TO_LINK = 'This channel is not linked to a Pantessa room yet. A room owner opens the room on pantessa.com, taps Discord, copies the code, and runs `/pantessa link <code>` here.'

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

export function normalizeSymbolArg(raw: string): string | null {
  const s = raw.trim().replace(/^\$/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,19}$/.test(s)) return null
  const [a, b] = s.split(':')
  return b !== undefined ? `${a.toLowerCase()}:${b.toUpperCase()}` : s.toUpperCase()
}

async function withBudget<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const t = new Promise<'timeout'>((res) => {
    timer = setTimeout(() => res('timeout'), ms)
  })
  try {
    return await Promise.race([p.catch(() => 'timeout' as const), t])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The whole interaction, minus the signature (the route checks it first). */
export async function handleInteraction(interaction: unknown, deps: InteractionDeps): Promise<InteractionResponse | null> {
  if (!interaction || typeof interaction !== 'object') return null
  const i = interaction as Record<string, unknown>
  if (i.type === 1) return { type: 1 }
  if (i.type !== 2) return reply('Pantessa only answers its slash commands.', { ephemeral: true })

  const cmd = readCommand(i.data)
  if (!cmd) return reply('Unknown command. Try `/pantessa chart ETH`.', { ephemeral: true })

  const channel = (i.channel && typeof i.channel === 'object' ? i.channel : {}) as Record<string, unknown>
  const channelId = typeof i.channel_id === 'string' ? i.channel_id : typeof channel.id === 'string' ? channel.id : ''
  const guildId = typeof i.guild_id === 'string' ? i.guild_id : null
  const member = (i.member && typeof i.member === 'object' ? i.member : null) as Record<string, unknown> | null
  const site = deps.site

  if (cmd.name === 'link') {
    if (!guildId || !member) return reply('Link a room from a server channel, not a DM.', { ephemeral: true })
    if (!hasManagePermission(member.permissions)) return reply('Only someone with Manage Server can link this channel to a room.', { ephemeral: true })
    if (!SNOWFLAKE_RE.test(channelId)) return reply('Discord did not say which channel this is. Try again in the channel itself.', { ephemeral: true })
    const code = cmd.arg.toLowerCase()
    if (!LINK_CODE_RE.test(code)) return reply('That is not a link code. Copy the 16-character code from the room page on pantessa.com.', { ephemeral: true })
    const title = typeof channel.name === 'string' ? plainDiscord(`#${channel.name}`, 80) : null
    let res: Awaited<ReturnType<InteractionDeps['redeemLinkCode']>>
    try {
      res = await deps.redeemLinkCode(code, { externalId: channelId, title })
    } catch {
      return reply('Pantessa could not link this channel right now. Try again in a minute.', { ephemeral: true })
    }
    if (!res.ok) return reply(`Not linked: ${escapeDiscord(res.reason, 200)}`, { ephemeral: true })
    const room = res.community
    return reply(`Linked to **${escapeDiscord(room.name, 48)}**. New posts in the room will appear here.`, { buttons: [button(`Open ${room.name}`, `${site}${communityPath(room.slug)}`)] })
  }

  let room: PublicCommunity | null = null
  if (SNOWFLAKE_RE.test(channelId)) {
    try {
      room = await deps.communityOfChannel(channelId)
    } catch {
      return reply('Pantessa could not read this channel right now. Try again in a minute.', { ephemeral: true })
    }
  }
  if (!room) return reply(HOW_TO_LINK, { ephemeral: true })
  const roomUrl = `${site}${communityPath(room.slug)}`
  const roomName = escapeDiscord(room.name, 48)

  if (cmd.name === 'join') {
    return reply(`Join **${roomName}** on Pantessa. One tap, no wallet needed.`, { ephemeral: true, buttons: [button(`Join ${room.name}`, roomUrl)] })
  }
  if (cmd.name === 'invite') {
    return reply(`Your own invite link lives on the site: open the room and tap Share. Joins that carry it count for you on the board.\nRoom: ${roomUrl}`, { ephemeral: true, buttons: [button(`Open ${room.name}`, roomUrl)] })
  }
  if (cmd.name === 'chart') {
    const sym = normalizeSymbolArg(cmd.arg)
    if (!sym) return reply('Name a market, e.g. `/pantessa chart ETH`.', { ephemeral: true })
    const chartUrl = `${site}/t/${encodeURIComponent(sym)}`
    const read = await withBudget(deps.chartQuote(sym), deps.budgetMs ?? CHART_BUDGET_MS)
    if (read === null) return reply(`No chart for ${escapeDiscord(sym, 24)} on Pantessa.`, { ephemeral: true })
    const buttons = [button(`Chart ${sym}`, chartUrl), button(`Join ${room.name}`, roomUrl)]
    if (read === 'timeout' || read.last == null || !(read.last > 0)) {
      return reply(`**${escapeDiscord(sym, 24)}**: the price is slow to answer. The chart has it live.`, { buttons })
    }
    const sign = read.chgPct == null ? '' : read.chgPct >= 0 ? '+' : ''
    const chg = read.chgPct == null || !Number.isFinite(read.chgPct) ? '' : ` (${sign}${read.chgPct.toFixed(2)}% 24h)`
    return reply(`**${escapeDiscord(read.label, 32)}** $${fmtPrice(read.last)}${chg}`, { buttons: [button(`Chart ${read.symbol}`, `${site}/t/${encodeURIComponent(read.symbol)}`), button(`Join ${room.name}`, roomUrl)] })
  }
  if (cmd.name === 'calls') {
    let posts: FeedPost[] = []
    try {
      posts = (await deps.listFeed({ community: room.slug, sort: 'new', kind: 'idea', limit: 3 })).posts.slice(0, 3)
    } catch {
      return reply('Pantessa could not read the calls right now.', { ephemeral: true })
    }
    if (!posts.length) return reply(`No calls in **${roomName}** yet. Post the first one on the site.`, { buttons: [button(`Open ${room.name}`, roomUrl)] })
    const lines = posts.map((p) => {
      const sym = p.symbol && /^[A-Za-z0-9:._-]{1,24}$/.test(p.symbol) ? ` · ${escapeDiscord(p.symbol.toUpperCase(), 24)}` : ''
      const title = escapeDiscord(p.title, 120) || 'Untitled call'
      const link = /^[A-Za-z0-9_-]{1,64}$/.test(p.id) ? `[${title}](${site}/c/${p.id})` : title
      return `• ${link}${sym} · ${escapeDiscord(p.authorLabel, 48)}`
    })
    return reply('', { embeds: [{ title: `Newest calls in ${plainDiscord(room.name, 48)}`, url: roomUrl, description: lines.join('\n'), color: DISCORD_EMBED_COLOR }] })
  }
  if (cmd.name === 'top') {
    let byInvites: PublicMember[] = []
    let byTrades: PublicMember[] = []
    try {
      ;[byInvites, byTrades] = await Promise.all([deps.listMembers(room.slug, { sort: 'invites', limit: 5 }), deps.listMembers(room.slug, { sort: 'trades', limit: 5 })])
    } catch {
      return reply('Pantessa could not read the board right now.', { ephemeral: true })
    }
    const rows = (list: PublicMember[], n: (m: PublicMember) => number, unit: string) => {
      const kept = list.filter((m) => n(m) > 0).slice(0, 5)
      return kept.length ? kept.map((m, k) => `${k + 1}. ${escapeDiscord(m.label, 48)} · ${n(m)} ${unit}`).join('\n') : 'Nobody yet.'
    }
    const description = `**Brought people in**\n${rows(byInvites, (m) => m.invited, 'joined')}\n\n**Verified receipts**\n${rows(byTrades, (m) => m.verifiedTrades, 'verified')}`
    return reply('', { embeds: [{ title: `${plainDiscord(room.name, 48)} board`, url: roomUrl, description, color: DISCORD_EMBED_COLOR }] })
  }
  return reply('Unknown command.', { ephemeral: true })
}

/** The command JSON Discord registers (scripts/discord-register-commands.ts). */
export function discordCommandSpec() {
  return [
    {
      name: ROOT_COMMAND,
      type: 1,
      description: 'Pantessa: charts, calls and the room board',
      dm_permission: false,
      options: BOT_COMMANDS.map((c) => {
        const arg = c.args.replace(/[<>]/g, '')
        return {
          type: 1,
          name: c.name,
          description: c.does.slice(0, 100),
          ...(arg ? { options: [{ type: 3, name: arg, description: arg === 'symbol' ? 'A market, e.g. ETH' : 'The code from the room page', required: true, max_length: 32 }] } : {}),
        }
      }),
    },
  ]
}
