// lib/telegram.ts — alerts delivered to Telegram (squad five-million, lane
// PERPS, 2026-11-03; GTM-PLAN-5M-ARR §3 "perp traders live there").
//
// One bot (BotFather → TELEGRAM_BOT_TOKEN), one webhook, one message shape:
//   · an owner links a chat from the alerts bell: POST /api/alerts/telegram
//     mints a single-use code and answers `https://t.me/<bot>?start=<code>`;
//     Telegram sends the bot `/start <code>` from that chat, the webhook
//     (POST /api/telegram/webhook, fenced by X-Telegram-Bot-Api-Secret-Token)
//     binds chat ↔ owner in `telegram_links`. `/stop` unlinks.
//   · `notifyAlertFired` (lib/alerts-exec — the ONE notification path; the
//     price sweep and the print-alerts cron both land there) fans a fired
//     alert out to every linked chat of the owner, beside the mail. Never
//     for an internal (harness) row.
//   · the message is PURE (`alertTelegramMessage`): HTML-escaped words, and
//     exactly ONE tap-able pantessa.com URL — the inline button — that lands
//     on the chip (the chart for a price alert, the tape row for a print
//     alert). Nothing in the text is a link. A wallet signs or nothing moves.
//
// The Bot API call is best-effort by contract: `sendTelegram` logs and
// returns false, never throws — a Telegram outage must not fail a sweep.
// `fetchImpl` is the seam the pins use (a mocked Bot API); nothing here
// opens a socket on import.

import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { SITE_URL } from '@/lib/site-url'

/** A `/start` code: 24 hex chars from node:crypto. */
export const TELEGRAM_CODE_RE = /^[a-f0-9]{24}$/
/** A code is single-use and lives this long (createdAt-based; the row is
 *  deleted on expiry, so nothing accumulates). */
export const TELEGRAM_CODE_TTL_MS = 15 * 60_000
/** The Bot API's hard cap on a message's text. */
export const TELEGRAM_TEXT_MAX = 4096
/** A chat id as Telegram prints it: a signed integer (groups/channels are
 *  negative, `-100…` for supergroups). */
export const TELEGRAM_CHAT_ID_RE = /^-?\d{1,20}$/
/** Bot usernames: 5–32 word chars, ending in "bot" (Telegram's rule). */
export const TELEGRAM_BOT_NAME_RE = /^[A-Za-z]\w{3,30}bot$/i

const BOT_API = 'https://api.telegram.org'
const SEND_TIMEOUT_MS = 8_000

export function telegramEnabled(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN
}

/** The bot's @username without the @ (TELEGRAM_BOT_NAME), or null when the
 *  env is unset or malformed — the link door refuses rather than minting a
 *  `t.me/undefined` URL. */
export function telegramBotName(): string | null {
  const raw = (process.env.TELEGRAM_BOT_NAME ?? '').trim().replace(/^@/, '')
  return TELEGRAM_BOT_NAME_RE.test(raw) ? raw : null
}

/** The public channel fired print triggers are posted to (optional). */
export function telegramChannelId(): string | null {
  const raw = (process.env.TELEGRAM_CHANNEL_ID ?? '').trim()
  return raw && (TELEGRAM_CHAT_ID_RE.test(raw) || /^@[A-Za-z]\w{3,31}$/.test(raw)) ? raw : null
}

/** The deep link a chat opens to bind itself: `https://t.me/<bot>?start=<code>`. */
export function telegramStartUrl(bot: string, code: string): string {
  return `https://t.me/${bot}?start=${code}`
}

/** Escape for Telegram's HTML parse mode (it accepts a small tag set; every
 *  interpolated field is user-authored or derived from one). */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The same-site path rule the alert mail uses (lib/alerts-exec
 *  renderAlertEmail): a print alert points at the tape filtered to its
 *  market, a price alert at the chart. Anything else falls to the chart. */
function alertHref(symbol: string, href?: string): string {
  const sym = symbol.replace(/[^A-Z0-9]/g, '')
  return href && /^\/[A-Za-z0-9/_?=&%.:-]*$/.test(href) ? `${SITE_URL}${href}` : `${SITE_URL}/t/${encodeURIComponent(sym)}`
}

export interface AlertTelegramMessage {
  /** HTML (parse_mode HTML), ≤ TELEGRAM_TEXT_MAX, no URL inside. */
  text: string
  /** The ONE tap-able URL — the inline button. Always pantessa.com. */
  url: string
  /** The button's words. */
  label: string
}

/** The alert as a Telegram message — pure; mirrors renderAlertEmail's
 *  inputs. The text carries the title, the body and the ready sentence;
 *  the URL rides ONLY on the button, so a message has exactly one link. */
export function alertTelegramMessage(input: { symbol: string; title: string; body: string; actionAsk: string | null; href?: string }): AlertTelegramMessage {
  const symbol = input.symbol.replace(/[^A-Z0-9]/g, '')
  const title = input.title.replace(/[\r\n]+/g, ' ').trim()
  const body = input.body.replace(/\s+/g, ' ').trim()
  const ask = input.actionAsk ? input.actionAsk.replace(/[\r\n]+/g, ' ').trim() : null
  const url = alertHref(symbol, input.href)
  const label = input.href ? 'Open the tape' : `Open the ${symbol} chart`
  const lines = [`<b>${escapeTelegramHtml(title)}</b>`, escapeTelegramHtml(body)]
  if (ask) lines.push(`Ready to send: <code>${escapeTelegramHtml(ask)}</code> — your wallet signs or nothing moves.`)
  let text = lines.join('\n')
  if (text.length > TELEGRAM_TEXT_MAX) {
    // Cut inside the body, never inside a tag: drop the ask line first, then
    // the body's tail. A 4,000-char ask is not a chip anybody set.
    text = `${lines[0]}\n${lines[1]}`
    if (text.length > TELEGRAM_TEXT_MAX) text = `${text.slice(0, TELEGRAM_TEXT_MAX - 1)}…`
  }
  return { text, url, label }
}

export interface SendTelegramOptions {
  url?: string
  label?: string
  /** The seam for the pins (a mocked Bot API). */
  fetchImpl?: typeof fetch
}

/** Bot API sendMessage: HTML, previews off, one inline URL button when
 *  `url` is given. A failure of any kind logs and answers false. */
export async function sendTelegram(chatId: string, text: string, opts: SendTelegramOptions = {}): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !TELEGRAM_CHAT_ID_RE.test(chatId) && !/^@[A-Za-z]\w{3,31}$/.test(chatId)) return false
  const f = opts.fetchImpl ?? globalThis.fetch
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.length > TELEGRAM_TEXT_MAX ? `${text.slice(0, TELEGRAM_TEXT_MAX - 1)}…` : text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (opts.url) body.reply_markup = { inline_keyboard: [[{ text: opts.label ?? 'Open on Pantessa', url: opts.url }]] }
  try {
    const res = await f(`${BOT_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn(`[telegram] sendMessage ${res.status} to ${chatId}: ${detail.slice(0, 200)}`)
      return false
    }
    return true
  } catch (e) {
    console.warn(`[telegram] sendMessage failed to ${chatId}: ${(e as Error).message}`)
    return false
  }
}

// ── The link table ────────────────────────────────────────────────────────

/** Mint a single-use `/start` code for an owner. Every pending (unlinked)
 *  code of the same owner is swept first, so a bell pressed twice leaves one
 *  row and only the newest link works. */
export async function mintTelegramCode(ownerRaw: string): Promise<{ code: string; expiresAt: Date }> {
  const owner = ownerRaw.toLowerCase()
  const now = Date.now()
  await prisma.telegramLink.deleteMany({ where: { owner, chatId: null } })
  const code = randomBytes(12).toString('hex')
  await prisma.telegramLink.create({ data: { owner, code } })
  return { code, expiresAt: new Date(now + TELEGRAM_CODE_TTL_MS) }
}

export type LinkTelegramResult = { ok: true; owner: string } | { ok: false; reason: 'bad-code' | 'unknown' | 'expired' | 'bad-chat' }

/** `/start <code>` from a chat: bind the chat to the code's owner, clear the
 *  code (single-use). An expired code is deleted and refused; a second
 *  `/start` from a chat already linked to that owner is a no-op success. */
export async function linkTelegramChat(codeRaw: string, chatId: string, now = new Date()): Promise<LinkTelegramResult> {
  const code = codeRaw.trim().toLowerCase()
  if (!TELEGRAM_CODE_RE.test(code)) return { ok: false, reason: 'bad-code' }
  if (!TELEGRAM_CHAT_ID_RE.test(chatId)) return { ok: false, reason: 'bad-chat' }
  const row = await prisma.telegramLink.findUnique({ where: { code } })
  if (!row) return { ok: false, reason: 'unknown' }
  if (now.getTime() - row.createdAt.getTime() > TELEGRAM_CODE_TTL_MS) {
    await prisma.telegramLink.delete({ where: { id: row.id } }).catch(() => {})
    return { ok: false, reason: 'expired' }
  }
  const already = await prisma.telegramLink.findFirst({ where: { owner: row.owner, chatId, linkedAt: { not: null } }, select: { id: true } })
  if (already) {
    // The chat is already this owner's: spend the code, keep one row.
    await prisma.telegramLink.delete({ where: { id: row.id } }).catch(() => {})
    return { ok: true, owner: row.owner }
  }
  // Claim the code atomically: only the row still carrying it links.
  const linked = await prisma.telegramLink.updateMany({ where: { id: row.id, code }, data: { chatId, linkedAt: now, code: null } })
  if (linked.count === 0) return { ok: false, reason: 'unknown' }
  return { ok: true, owner: row.owner }
}

/** Unlink by owner (the bell's "unlink": every chat) or by chat (`/stop`
 *  from a chat: every owner it was bound to). Returns rows removed. */
export async function unlinkTelegram(by: { owner?: string; chatId?: string }): Promise<number> {
  if (by.owner) {
    const r = await prisma.telegramLink.deleteMany({ where: { owner: by.owner.toLowerCase() } })
    return r.count
  }
  if (by.chatId && TELEGRAM_CHAT_ID_RE.test(by.chatId)) {
    const r = await prisma.telegramLink.deleteMany({ where: { chatId: by.chatId } })
    return r.count
  }
  return 0
}

/** The linked chat ids of an owner (distinct; pending codes excluded). */
export async function chatsForOwner(ownerRaw: string): Promise<string[]> {
  const rows = await prisma.telegramLink.findMany({ where: { owner: ownerRaw.toLowerCase(), chatId: { not: null }, linkedAt: { not: null } }, select: { chatId: true } })
  return [...new Set(rows.map((r) => r.chatId).filter((c): c is string => !!c))]
}

export async function telegramStatus(owner: string): Promise<{ linked: boolean; chats: number }> {
  const chats = await chatsForOwner(owner)
  return { linked: chats.length > 0, chats: chats.length }
}

// ── The webhook's reading of an update (pure) ─────────────────────────────

export interface TelegramInbound {
  chatId: string
  text: string
}

/** The one shape the webhook acts on: a message (or an edited one) with a
 *  text in a chat. Everything else (joins, callbacks, channel posts) reads
 *  as null and is acknowledged untouched. */
export function parseTelegramUpdate(update: unknown): TelegramInbound | null {
  const u = update as { message?: unknown; edited_message?: unknown } | null
  const m = (u?.message ?? u?.edited_message) as { chat?: { id?: unknown }; text?: unknown } | null | undefined
  if (!m || typeof m !== 'object') return null
  const id = m.chat?.id
  const chatId = typeof id === 'number' && Number.isInteger(id) ? String(id) : typeof id === 'string' ? id : null
  if (!chatId || !TELEGRAM_CHAT_ID_RE.test(chatId)) return null
  const text = typeof m.text === 'string' ? m.text.trim().slice(0, 256) : ''
  return { chatId, text }
}

export type TelegramCommand = { cmd: 'start'; code: string | null } | { cmd: 'stop' } | { cmd: 'help' }

/** `/start <code>` · `/stop` · anything else is help. A `@botname` suffix on
 *  the command (groups) is tolerated. */
export function telegramCommand(text: string): TelegramCommand {
  const m = text.match(/^\/(start|stop|help)(?:@\w+)?(?:\s+(\S+))?/i)
  if (!m) return { cmd: 'help' }
  const cmd = m[1].toLowerCase()
  if (cmd === 'start') return { cmd: 'start', code: m[2] ? m[2].trim() : null }
  if (cmd === 'stop') return { cmd: 'stop' }
  return { cmd: 'help' }
}

/** What the bot says back (plain text; no HTML to escape). */
export const TELEGRAM_REPLIES = {
  linked: 'Linked. Alerts land here.',
  unlinked: 'Unlinked. This chat gets no more alerts.',
  nothingToUnlink: 'This chat was not linked to anything.',
  badCode: 'That link is expired or already used. On pantessa.com, open the alerts bell and tap "Get these on Telegram" for a fresh one.',
  help: 'Pantessa alerts land here once you link this chat: on pantessa.com, open the alerts bell and tap "Get these on Telegram". /stop unlinks.',
} as const
