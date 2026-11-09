// ─────────────────────────────────────────────────────────────────────────
//  WHAT THE BOT SAYS — every message, built by a pure function (lane
//  TELEGRAM, 2026-11-09). The pins read these; nothing here opens a socket.
//
//  Rules every builder holds:
//   · HTML parse mode, and EVERY interpolated value is escaped. Room names,
//     post titles, display names and symbols are user-controlled: they are
//     stripped of control and bidi characters, length-capped, then escaped.
//   · every URL is OURS (lib/telegram/links isOurUrl): the site, our own
//     bot, or Telegram's share sheet wrapping one of those. A URL typed
//     into a post never reaches a button or an href.
//   · "verified" appears only behind `proof.verification === 'verified'`,
//     the receipt row the chain confirmed.
//   · short sentences, no em dashes, no hype.
// ─────────────────────────────────────────────────────────────────────────

import { BOT_COMMANDS, type FeedPost, type PublicMember, type TradeProof } from '@/lib/community/spec'
import { joinUrlFor, roomInviteUrl, shareUrl, tgEntryUrl, type LinkCtx } from './links'
import { joinPayload } from '@/lib/community/spec'
import { proofFactLine, proofLinkIsRebuilt, proofTagLine } from '@/lib/community/proof-words'

/** The Bot API's hard cap on a message's text. */
export const TG_TEXT_MAX = 4096
const NAME_MAX = 48
const TITLE_MAX = 100
const LABEL_MAX = 32
const BUTTON_MAX = 56

export interface TgButton {
  text: string
  url?: string
  /** Private chats only (the Bot API refuses a web_app button in a group). */
  web_app?: { url: string }
}

export interface TgMessage {
  /** HTML (parse_mode HTML), <= TG_TEXT_MAX. */
  text: string
  buttons: TgButton[][]
}

export interface RoomRef {
  slug: string
  name: string
}

// ── text hygiene ───────────────────────────────────────────────────────────

/** Escape for Telegram's HTML parse mode. Quotes too: values land in href. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Control characters, bidi overrides and zero-width marks never reach a
 *  message; runs of whitespace are one space; the result is capped. */
export function tidy(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  const s = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…` : s
}

/** Tidy, cap, escape: the only way a dynamic value enters a message. */
const t = (raw: unknown, max: number): string => escapeHtml(tidy(raw, max))
const roomName = (room: RoomRef): string => t(room.name, NAME_MAX) || escapeHtml(room.slug)
const buttonText = (s: string): string => tidy(s, BUTTON_MAX)

function fit(lines: string[]): string {
  const text = lines.filter((l) => l !== '').join('\n')
  // Every builder stays far under the cap by construction (capped parts);
  // this is the belt. Cut on a line boundary so a tag is never split.
  if (text.length <= TG_TEXT_MAX) return text
  const kept: string[] = []
  let size = 0
  for (const l of lines) {
    if (size + l.length + 1 > TG_TEXT_MAX) break
    kept.push(l)
    size += l.length + 1
  }
  return kept.join('\n')
}

const say = (...lines: string[]): TgMessage => ({ text: fit(lines), buttons: [] })

export function joinButton(ctx: LinkCtx, room: RoomRef, opts: { invite?: string | null; long?: boolean } = {}): TgButton {
  const name = tidy(room.name, NAME_MAX) || room.slug
  return { text: buttonText(opts.long ? `Join ${name} on Pantessa` : `Join ${name}`), url: joinUrlFor(ctx, room.slug, opts.invite) }
}

// ── linking a group (flow A) ───────────────────────────────────────────────

/** The message the bot posts (and tries to pin) when a group is linked. ONE button. */
export function welcomeMessage(ctx: LinkCtx, room: RoomRef, opts: { pinHint?: boolean } = {}): TgMessage {
  return {
    text: fit([
      `<b>${roomName(room)}</b> is on Pantessa.`,
      'Chart ideas, calls and trades with proof, in one feed.',
      'One tap and you are in. No wallet, no form.',
      opts.pinHint ? 'Admins: pin this message so new members see it.' : '',
    ]),
    buttons: [[joinButton(ctx, room, { long: true })]],
  }
}

export const couldNotPinMessage = (): TgMessage => say('I could not pin the join button. Pin it so new members see it: hold the message, then Pin.')

export type LinkRefusal = 'not-admin' | 'cannot-verify' | 'bad-code' | 'private' | 'usage'

export function linkRefusedMessage(why: LinkRefusal, detail?: string | null): TgMessage {
  if (why === 'not-admin') return say('Only an admin of this group can link it to a room.')
  if (why === 'cannot-verify') return say('I could not check with Telegram that you are an admin here. Try again in a minute.')
  if (why === 'private') return say('A link code works inside a group. Add me to your group from the room page, or send /link with the code there.')
  if (why === 'usage') return say('Send /link followed by the code from your room page. The code is 16 characters and lasts 15 minutes.')
  const more = t(detail, 160)
  return say(more ? `That code did not work. ${more}` : 'That code is not valid or has expired. Mint a new one on the room page.')
}

export function notLinkedMessage(ctx: LinkCtx): TgMessage {
  return say(
    'This chat is not linked to a Pantessa room yet.',
    `An admin opens their room on <a href="${escapeHtml(`${ctx.site}/community`)}">Pantessa</a>, presses Connect Telegram, and sends the code here with /link.`,
  )
}

export const groupOnlyMessage = (): TgMessage => say('Send this in a group that is linked to a Pantessa room.')
export const unlinkedByUpgradeMessage = (): TgMessage =>
  say('This group was upgraded by Telegram, so its Pantessa link was dropped. An admin can link it again from the room page.')
export const notAnsweringMessage = (): TgMessage => say('Pantessa is not answering right now. Try again in a minute.')

// ── joining (flow B) ───────────────────────────────────────────────────────

/** The private-chat reply to a proven join. The first button opens the room
 *  inside Telegram (a web_app button: allowed in a private chat). */
export function joinedMessage(ctx: LinkCtx, room: RoomRef, opts: { joined: boolean; inviteCode: string | null }): TgMessage {
  const lines = [opts.joined ? `You are in <b>${roomName(room)}</b>.` : `You are already in <b>${roomName(room)}</b>.`]
  const openText = buttonText(`Open ${tidy(room.name, NAME_MAX) || room.slug}`)
  const entry = tgEntryUrl(ctx.site, joinPayload(room.slug))
  // Telegram refuses a web_app button that is not https (a local origin): fall back to a plain link there.
  const buttons: TgButton[][] = [[ctx.site.startsWith('https://') ? { text: openText, web_app: { url: entry } } : { text: openText, url: entry }]]
  if (opts.inviteCode) {
    lines.push('Your invite link. Every join through it is credited to you:', `<code>${escapeHtml(roomInviteUrl(ctx.site, room.slug, opts.inviteCode))}</code>`)
    buttons.push([{ text: 'Invite a chat', url: shareUrl(joinUrlFor(ctx, room.slug, opts.inviteCode), `Join ${tidy(room.name, NAME_MAX) || room.slug} on Pantessa`) }])
  }
  return { text: fit(lines), buttons }
}

export function joinRefusedMessage(detail?: string | null): TgMessage {
  const more = t(detail, 160)
  return say(more ? `That join did not go through. ${more}` : 'That join did not go through. Try the button again.')
}

export function noSuchRoomMessage(slug: string): TgMessage {
  return say(`There is no room called ${t(slug, 40)} on Pantessa.`)
}

export function joinPromptMessage(ctx: LinkCtx, room: RoomRef): TgMessage {
  return { text: fit([`Join <b>${roomName(room)}</b> on Pantessa.`, 'One tap. No wallet, no form.']), buttons: [[joinButton(ctx, room)]] }
}

export function startMessage(ctx: LinkCtx): TgMessage {
  return say(
    'I bring a Telegram group into its room on Pantessa: chart ideas, calls and trades with proof.',
    `Tap a group's join button to join its room. To link your own group, open your room on <a href="${escapeHtml(`${ctx.site}/community`)}">Pantessa</a> and press Connect Telegram.`,
    'Send /help for what I answer.',
  )
}

// ── commands (flow E) ──────────────────────────────────────────────────────

export function helpMessage(): TgMessage {
  const lines = BOT_COMMANDS.map((c) => `/${c.name}${c.args ? ` ${escapeHtml(c.args)}` : ''} - ${escapeHtml(c.does)}`)
  return say('<b>Pantessa</b>', ...lines)
}

export interface QuoteLine {
  last: number
  chgPct: number | null
  /** lib/quotes feed name: coinbase | hyperliquid | robinhood | yahoo. */
  feed: string
}

export function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

export function fmtPct(n: number): string {
  const v = Math.abs(n) < 0.005 ? 0 : n
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

const FEED_WORDS: Record<string, { name: string; window: string }> = {
  coinbase: { name: 'Coinbase', window: '24h' },
  hyperliquid: { name: 'Hyperliquid', window: '24h' },
  robinhood: { name: 'Robinhood 24/7 tape', window: 'vs prior close' },
  yahoo: { name: 'Yahoo, delayed', window: 'vs prior close' },
}

/** `/chart <symbol>`: the price line, the market's link, up to two buttons.
 *  `symbol` and `label` come from lib/charts chartPairFor (our own table). */
export function chartMessage(ctx: LinkCtx, market: { symbol: string; label: string }, quote: QuoteLine | null, room: RoomRef | null): TgMessage {
  const sym = market.symbol.replace(/[^A-Z0-9]/g, '').slice(0, 12)
  const url = `${ctx.site}/t/${encodeURIComponent(sym)}`
  const price = quote ? fmtPrice(quote.last) : ''
  const feed = quote ? FEED_WORDS[quote.feed] : undefined
  const parts: string[] = []
  if (price) {
    parts.push(`$${price}`)
    if (quote && quote.chgPct !== null && Number.isFinite(quote.chgPct)) parts.push(`${fmtPct(quote.chgPct)}${feed ? ` ${feed.window}` : ''}`)
    if (feed) parts.push(feed.name)
  }
  const buttons: TgButton[] = [{ text: buttonText(`Open the ${sym} chart`), url }]
  if (room) buttons.push(joinButton(ctx, room))
  return {
    text: fit([`<b>${t(market.label, 24)}</b>`, price ? escapeHtml(parts.join(' · ')) : 'No price right now. The chart is one tap away.', `<a href="${escapeHtml(url)}">The chart, the levels and the order ticket</a>`]),
    buttons: [buttons],
  }
}

export function unknownSymbolMessage(raw: string): TgMessage {
  const asked = t(raw.replace(/\s+/g, ' ').split(' ')[0] ?? '', 16)
  return say(asked ? `I do not have a chart for ${asked}. Try a ticker like ETH, HYPE or AAPL.` : 'Send /chart with a ticker, like /chart ETH.')
}

const POST_ID_RE = /^[A-Za-z0-9_-]{6,40}$/
const LINK_SLUG_RE = /^[A-Za-z0-9_-]{3,40}$/
const postUrl = (site: string, id: string): string | null => (POST_ID_RE.test(id) ? `${site}/c/${id}` : null)

type CallRow = Pick<FeedPost, 'id' | 'title' | 'symbol' | 'authorLabel'>

/** `/calls`: the room's newest stamped calls, each a link to its /c page. */
export function callsMessage(ctx: LinkCtx, room: RoomRef, posts: readonly CallRow[]): TgMessage {
  const rows = posts
    .slice(0, 3)
    .map((p) => ({ p, url: postUrl(ctx.site, p.id) }))
    .filter((r): r is { p: CallRow; url: string } => !!r.url)
  if (!rows.length) return { text: fit([`No calls in <b>${roomName(room)}</b> yet.`, 'Post the first one from any chart.']), buttons: [[joinButton(ctx, room)]] }
  const lines = rows.map(({ p, url }, i) => {
    const sym = t(p.symbol, 12)
    return `${i + 1}. <a href="${escapeHtml(url)}">${t(p.title, TITLE_MAX) || 'Untitled'}</a>${sym ? ` · ${sym}` : ''} · ${t(p.authorLabel, LABEL_MAX)}`
  })
  return { text: fit([`<b>Newest calls in ${roomName(room)}</b>`, ...lines]), buttons: [[joinButton(ctx, room)]] }
}

/** `/top`: who brought members and who traded with proof. Zero rows are not ranked. */
export function topMessage(ctx: LinkCtx, room: RoomRef, byInvites: readonly PublicMember[], byTrades: readonly PublicMember[]): TgMessage {
  const inv = byInvites.filter((m) => m.invited > 0).slice(0, 5)
  const trd = byTrades.filter((m) => m.verifiedTrades > 0).slice(0, 5)
  const lines = [`<b>${roomName(room)} board</b>`]
  if (!inv.length && !trd.length) lines.push('Nobody has brought a member or traded with proof yet.', 'Send /invite for your own link.')
  if (inv.length) lines.push('Brought the most members', ...inv.map((m, i) => `${i + 1}. ${t(m.label, LABEL_MAX)} · ${Math.trunc(m.invited)}`))
  if (trd.length) lines.push('Verified receipts', ...trd.map((m, i) => `${i + 1}. ${t(m.label, LABEL_MAX)} · ${Math.trunc(m.verifiedTrades)} verified`))
  return { text: fit(lines), buttons: [[joinButton(ctx, room)]] }
}

/** `/invite`, answered in the group so the share is seen. The button joins
 *  AND credits the sender. */
export function inviteMessage(ctx: LinkCtx, room: RoomRef, who: { name: string | null }, code: string): TgMessage {
  const name = t(who.name, LABEL_MAX)
  return {
    text: fit([
      name ? `<b>${name}</b> is inviting you to <b>${roomName(room)}</b>.` : `An invite to <b>${roomName(room)}</b>.`,
      'One tap and you are in. No wallet, no form.',
      `Outside Telegram: <code>${escapeHtml(roomInviteUrl(ctx.site, room.slug, code))}</code>`,
    ]),
    buttons: [[joinButton(ctx, room, { invite: code })]],
  }
}

export const anonymousInviteMessage = (): TgMessage => say('An invite link is personal. Send /invite as yourself, not as the group.')

// ── announcements (flow F) ─────────────────────────────────────────────────

const KIND_WORDS: Record<FeedPost['kind'], string> = { idea: 'Chart idea', video: 'Video', link: 'Link', trade: 'Trade' }

const isVerified = (proof: TradeProof | null | undefined): proof is TradeProof => !!proof && proof.verification === 'verified'

/** A verified proof in the two-part wording (S1/S9): what the chain
 *  confirmed, then the author's own tag. */
export function proofLine(proof: TradeProof): string {
  const tag = proofTagLine(proof)
  return [proofFactLine(proof), tag].filter(Boolean).join('. ')
}

type AnnouncedPost = Pick<FeedPost, 'id' | 'kind' | 'title' | 'symbol' | 'authorLabel' | 'linkSlug' | 'proof'>

/**
 * One new room post, announced in the room's linked chat. null = nothing we
 * can link to (an id we would not put in a URL): the caller sends nothing.
 */
export function announcementMessage(ctx: LinkCtx, room: RoomRef, post: AnnouncedPost): TgMessage | null {
  const open = postUrl(ctx.site, post.id)
  if (!open) return null
  const verified = post.kind === 'trade' && isVerified(post.proof)
  const kind = `${KIND_WORDS[post.kind] ?? 'Post'}${verified ? ', transaction verified on-chain' : ''}`
  const sym = t(post.symbol, 12)
  const lines = [`<b>${escapeHtml(kind)}</b>${sym ? ` · ${sym}` : ''}`]
  const typed = t(post.title, TITLE_MAX)
  if (post.kind === 'trade') {
    // S9: the headline is what the chain confirmed; the typed title is the
    // author's words, quoted under it.
    lines.push(`<b>${escapeHtml(verified && post.proof ? proofFactLine(post.proof) : 'A trade post (no proof on record)')}</b>`)
    const tag = verified && post.proof ? proofTagLine(post.proof) : null
    if (tag) lines.push(escapeHtml(tag))
    if (typed) lines.push(`The author wrote: "${typed}"`)
  } else {
    lines.push(typed)
  }
  lines.push(`${t(post.authorLabel, LABEL_MAX) || 'A member'} in ${roomName(room)}`)
  const first: TgButton[] = [{ text: 'Open', url: open }]
  if (post.linkSlug && LINK_SLUG_RE.test(post.linkSlug)) first.push({ text: 'Trade this', url: `${ctx.site}/i/${post.linkSlug}` })
  if (verified && post.proof && proofLinkIsRebuilt(post.proof)) first.push({ text: 'The transaction', url: post.proof.txUrl })
  return { text: fit(lines), buttons: [first, [joinButton(ctx, room)]] }
}

// ── wire shapes ────────────────────────────────────────────────────────────

/** sendMessage params for a built message. Previews are off: the buttons are the links. */
export interface SendOpts {
  /** Answer under this message (keeps the reply in its forum topic). */
  replyTo?: number | null
  /** Post into this forum topic. */
  threadId?: number | null
}

export function sendParams(chatId: string, msg: TgMessage, opts: SendOpts = {}): Record<string, unknown> {
  const p: Record<string, unknown> = { chat_id: chatId, text: msg.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
  if (msg.buttons.length) p.reply_markup = { inline_keyboard: msg.buttons }
  if (opts.threadId) p.message_thread_id = opts.threadId
  if (opts.replyTo) p.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true }
  return p
}

/** The same message as a webhook RESPONSE body (the Bot API runs the method
 *  named in the response: no outbound call, and nothing to mock in a pin). */
export function webhookReply(chatId: string, msg: TgMessage, opts: SendOpts = {}): Record<string, unknown> {
  return { method: 'sendMessage', ...sendParams(chatId, msg, opts) }
}

/** Every URL a message would hand out (buttons and hrefs), for the pins. */
export function urlsOf(msg: TgMessage): string[] {
  const out: string[] = []
  for (const row of msg.buttons) for (const b of row) out.push(b.url ?? b.web_app?.url ?? '')
  for (const m of msg.text.matchAll(/href="([^"]*)"/g)) out.push(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  for (const m of msg.text.matchAll(/<code>(https?:[^<]*)<\/code>/g)) out.push(m[1].replace(/&amp;/g, '&'))
  return out
}
