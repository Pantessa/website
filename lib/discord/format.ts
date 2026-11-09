// DISCORD MESSAGE SHAPES (lane DISCORD, 2026-11-09). Pure.
//
// Every string a poster typed is escaped before it reaches Discord: markdown
// is backslash-escaped, mentions are broken with a zero-width space, control
// and bidi characters are stripped. `allowed_mentions.parse` is [] on every
// message we send, so even an escape we missed can never ping @everyone.
// Every URL we emit is built on SITE (our canonical origin) from ids, never
// from a poster's string.

import type { FeedPost, PublicCommunity, TradeProof } from '@/lib/community/spec'
import { communityPath } from '@/lib/community/spec'
import { proofFactLine, proofLinkIsRebuilt, proofTagLine } from '@/lib/community/proof-words'

const isVerifiedProof = (p: TradeProof | null | undefined): p is TradeProof => !!p && p.verification === 'verified'

/** The brand's emerald (--accent / --gem-5 in app/x402-design.css: #3ECF8E). */
export const DISCORD_EMBED_COLOR = 0x3ecf8e
export const NO_MENTIONS = Object.freeze({ parse: [] as string[] })

const ZWSP = '​'
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f‎‏‪-‮⁦-⁩]/g

/** Break every mention shape: @everyone, @here, <@id>, <@&id>, <#id>. */
export function neutralizeMentions(s: string): string {
  return s.replace(/@/g, `@${ZWSP}`).replace(/<([@#&!])/g, `<${ZWSP}$1`).replace(/:\/\//g, `:${ZWSP}//`)
}

/** Plain text for fields Discord does not render as markdown (footers, button labels). */
export function plainDiscord(raw: unknown, max = 200): string {
  if (typeof raw !== 'string') return ''
  return clip(neutralizeMentions(raw.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\n+/g, ' ').trim()), max)
}

/** Markdown-escaped text for titles, descriptions and message content. */
export function escapeDiscord(raw: unknown, max = 2000): string {
  if (typeof raw !== 'string') return ''
  const s = raw.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\n+/g, ' ').trim()
  // A poster's URL never autolinks: the only links in our messages are ours.
  const escaped = s.replace(/[\\*_~`|>[\]()#<]/g, '\\$&').replace(/@/g, `\\@${ZWSP}`).replace(/:\/\//g, `:${ZWSP}//`)
  return clip(escaped, max)
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let out = s.slice(0, max - 1)
  // Never end on a lone escape backslash or half a surrogate pair.
  out = out.replace(/\\$/, '').replace(/[\ud800-\udbff]$/, '')
  return `${out}…`
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const SAFE_SYMBOL = /^[A-Za-z0-9:._-]{1,24}$/

export function kindLine(post: Pick<FeedPost, 'kind' | 'proof'>): string {
  if (post.kind === 'trade') return post.proof?.verification === 'verified' ? 'Trade, transaction verified on-chain' : 'Trade'
  if (post.kind === 'video') return 'Video'
  if (post.kind === 'link') return 'Link'
  return 'Chart idea'
}

export interface AnnouncementLinks {
  open: string | null
  trade: string | null
  join: string
}

export function announcementLinks(post: Pick<FeedPost, 'id' | 'linkSlug'>, community: Pick<PublicCommunity, 'slug'>, site: string): AnnouncementLinks {
  return {
    open: SAFE_ID.test(post.id) ? `${site}/c/${post.id}` : null,
    trade: post.linkSlug && SAFE_ID.test(post.linkSlug) ? `${site}/i/${post.linkSlug}` : null,
    join: `${site}${communityPath(community.slug)}`,
  }
}

export interface DiscordEmbed {
  title: string
  url?: string
  description: string
  color: number
  footer: { text: string }
  timestamp?: string
}

export interface DiscordButton {
  type: 2
  style: 5
  label: string
  url: string
}

export interface DiscordMessage {
  content?: string
  embeds: DiscordEmbed[]
  allowed_mentions: { parse: string[] }
  components?: { type: 1; components: DiscordButton[] }[]
}

/**
 * The announcement of one new room post.
 * `buttons: false` (a plain channel webhook — Discord drops components from a
 * webhook no app owns) puts the links in the description as markdown links;
 * `buttons: true` (the bot path) sends them as real link buttons.
 */
export function discordAnnouncement(post: FeedPost, community: PublicCommunity, site: string, opts: { buttons?: boolean } = {}): DiscordMessage {
  const links = announcementLinks(post, community, site)
  const roomName = plainDiscord(community.name, 48) || community.slug
  // S9: a trade's headline is what the CHAIN confirmed; the poster's typed
  // title is their words, quoted in the body, never the headline.
  const proof = post.kind === 'trade' && isVerifiedProof(post.proof) ? post.proof : null
  const typed = escapeDiscord(post.title, 1000)
  const title =
    post.kind === 'trade'
      ? escapeDiscord(proof ? proofFactLine(proof) : 'A trade post (no proof on record)', 256)
      : typed.slice(0, 256) || escapeDiscord(`New post in ${community.name}`, 256)
  const meta = [kindLine(post)]
  if (post.symbol && SAFE_SYMBOL.test(post.symbol)) meta.push(escapeDiscord(post.symbol.toUpperCase(), 24))
  const by = escapeDiscord(post.authorLabel, 64)
  if (by) meta.push(`by ${by}`)
  const lines = [meta.join(' · ')]
  if (post.kind === 'trade') {
    const tag = proof ? proofTagLine(proof) : null
    if (tag) lines.push(escapeDiscord(tag, 200))
    if (typed) lines.push(`The author wrote: "${typed}"`)
    if (proof && proofLinkIsRebuilt(proof)) lines.push(`[The transaction](${proof.txUrl})`)
  }
  if (!opts.buttons) {
    const md: string[] = []
    if (links.open) md.push(`[Open](${links.open})`)
    if (links.trade) md.push(`[Trade this](${links.trade})`)
    md.push(`[Join ${escapeDiscord(community.name, 48) || community.slug}](${links.join})`)
    lines.push(md.join(' · '))
  }
  const embed: DiscordEmbed = {
    title,
    description: lines.join('\n'),
    color: DISCORD_EMBED_COLOR,
    footer: { text: `${roomName} on Pantessa` },
  }
  if (links.open) embed.url = links.open
  // createdAt is unix SECONDS (PublicPost); Discord wants ISO-8601.
  if (Number.isFinite(post.createdAt) && post.createdAt > 0) embed.timestamp = new Date(post.createdAt * 1000).toISOString()
  const msg: DiscordMessage = { embeds: [embed], allowed_mentions: { parse: [] } }
  if (opts.buttons) {
    const row: DiscordButton[] = []
    if (links.open) row.push({ type: 2, style: 5, label: 'Open', url: links.open })
    if (links.trade) row.push({ type: 2, style: 5, label: 'Trade this', url: links.trade })
    row.push({ type: 2, style: 5, label: clip(`Join ${roomName}`, 80), url: links.join })
    msg.components = [{ type: 1, components: row }]
  }
  return msg
}

/** Every URL in a message, for the "all ours" pin. */
export function urlsIn(msg: { embeds?: { url?: string; description?: string }[]; content?: string; components?: { components: { url?: string }[] }[] }): string[] {
  const out: string[] = []
  const scan = (s?: string) => {
    for (const m of (s ?? '').matchAll(/https?:\/\/[^\s)\]]+/g)) out.push(m[0])
  }
  scan(msg.content)
  for (const e of msg.embeds ?? []) {
    if (e.url) out.push(e.url)
    scan(e.description)
  }
  for (const r of msg.components ?? []) for (const b of r.components) if (b.url) out.push(b.url)
  return out
}
