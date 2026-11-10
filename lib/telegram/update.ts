// READING AN UPDATE — Telegram's webhook body, parsed defensively into the
// few shapes the bot acts on (lane TELEGRAM, 2026-11-09). Pure.
//
// Field names are the Bot API's own: `message.chat.id`, `message.from.id`,
// `message.text`, `message.entities`, `message.sender_chat`,
// `my_chat_member.new_chat_member.status`, `callback_query.id`,
// `chat.type` in private | group | supergroup | channel. Anything that does
// not fit is `null` (ignored), never an exception.
//
// Edited messages, channel posts and every other update kind are ignored on
// purpose: an edit must never replay a command.

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel'

export interface InChat {
  /** Decimal string. Groups are negative, supergroups `-100…`. */
  id: string
  type: ChatType
  title: string | null
}

export interface InUser {
  id: string
  isBot: boolean
  name: string | null
  username: string | null
}

export interface InMessage {
  kind: 'message'
  updateId: number | null
  messageId: number | null
  chat: InChat
  /** Absent on a channel post; the GroupAnonymousBot for an anonymous admin. */
  from: InUser | null
  /** `sender_chat.id`: the group itself when an admin posts anonymously. */
  senderChatId: string | null
  text: string
  hasCommandEntity: boolean | null
  /** The supergroup id this basic group just became (service message). */
  migrateToChatId: string | null
  /** The forum topic the message sits in (`message_thread_id` with `is_topic_message`). */
  threadId: number | null
}

export interface InMembership {
  kind: 'my_chat_member'
  updateId: number | null
  chat: InChat
  /** The bot's new status in that chat. */
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'
  /** `restricted` only: may the bot still post? */
  canSend: boolean | null
}

export interface InCallback {
  kind: 'callback'
  updateId: number | null
  id: string
}

export type Inbound = InMessage | InMembership | InCallback

/** The largest text the bot reads. A command and its argument fit many times over. */
export const TG_TEXT_READ_MAX = 1024

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const idOf = (v: unknown): string | null => (typeof v === 'number' && Number.isSafeInteger(v) && v !== 0 ? String(v) : null)
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const CHAT_TYPES: readonly string[] = ['private', 'group', 'supergroup', 'channel']
const STATUSES: readonly string[] = ['creator', 'administrator', 'member', 'restricted', 'left', 'kicked']

function chatOf(raw: unknown): InChat | null {
  const c = obj(raw)
  const id = c ? idOf(c.id) : null
  if (!c || !id || typeof c.type !== 'string' || !CHAT_TYPES.includes(c.type)) return null
  return { id, type: c.type as ChatType, title: text(c.title, 128) }
}

function userOf(raw: unknown): InUser | null {
  const u = obj(raw)
  const id = u ? idOf(u.id) : null
  if (!u || !id || id.startsWith('-')) return null
  const name = [text(u.first_name, 64), text(u.last_name, 64)].filter(Boolean).join(' ') || null
  return { id, isBot: u.is_bot === true, name, username: text(u.username, 40) }
}

export function readUpdate(raw: unknown): Inbound | null {
  const u = obj(raw)
  if (!u) return null
  const updateId = typeof u.update_id === 'number' && Number.isSafeInteger(u.update_id) ? u.update_id : null

  const m = obj(u.message)
  if (m) {
    const chat = chatOf(m.chat)
    if (!chat) return null
    const entities = Array.isArray(m.entities) ? m.entities : null
    return {
      kind: 'message',
      updateId,
      messageId: typeof m.message_id === 'number' && Number.isSafeInteger(m.message_id) ? m.message_id : null,
      chat,
      from: userOf(m.from),
      senderChatId: idOf(obj(m.sender_chat)?.id),
      text: typeof m.text === 'string' ? m.text.slice(0, TG_TEXT_READ_MAX) : '',
      hasCommandEntity: entities ? entities.some((e) => obj(e)?.type === 'bot_command' && obj(e)?.offset === 0) : null,
      migrateToChatId: idOf(m.migrate_to_chat_id),
      threadId: m.is_topic_message === true && typeof m.message_thread_id === 'number' && Number.isSafeInteger(m.message_thread_id) ? m.message_thread_id : null,
    }
  }

  const mc = obj(u.my_chat_member)
  if (mc) {
    const chat = chatOf(mc.chat)
    const now = obj(mc.new_chat_member)
    if (!chat || !now || typeof now.status !== 'string' || !STATUSES.includes(now.status)) return null
    return { kind: 'my_chat_member', updateId, chat, status: now.status as InMembership['status'], canSend: typeof now.can_send_messages === 'boolean' ? now.can_send_messages : null }
  }

  const cq = obj(u.callback_query)
  if (cq && typeof cq.id === 'string' && /^[\w-]{1,64}$/.test(cq.id)) return { kind: 'callback', updateId, id: cq.id }

  return null
}

export interface ParsedCommand {
  /** Lowercased, no slash. */
  name: string
  /** Everything after the command, trimmed. */
  arg: string
}

const COMMAND_RE = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,32}))?(?:\s+([\s\S]*))?$/

/**
 * A bot command at the very start of a message, addressed to US or to
 * nobody. `/cmd@otherbot` is somebody else's and returns null. When Telegram
 * sent entities, one of them must mark a command at offset 0 (a message
 * that merely starts with a slash inside a code block is not a command).
 */
export function parseCommand(msg: Pick<InMessage, 'text' | 'hasCommandEntity'>, botName: string): ParsedCommand | null {
  if (!msg.text.startsWith('/') || msg.hasCommandEntity === false) return null
  const m = COMMAND_RE.exec(msg.text)
  if (!m) return null
  if (m[2] && m[2].toLowerCase() !== botName.toLowerCase()) return null
  return { name: m[1].toLowerCase(), arg: (m[3] ?? '').trim().slice(0, 256) }
}

/** Telegram's stand-in sender for an admin who posts anonymously. */
export const GROUP_ANONYMOUS_BOT_ID = '1087968824'

/**
 * Who sent a message, as far as Telegram proves it:
 *   person     a real account (`from`, not a bot): an identity we can seat
 *   anon-admin an admin posting AS the group (`sender_chat.id === chat.id`,
 *              `from` = GroupAnonymousBot). Telegram only lets an admin do
 *              that, so it proves admin rights and proves NO personal id.
 *   none       a bot, a channel speaking in the group, or nothing readable
 */
export function senderOf(msg: InMessage): { kind: 'person'; user: InUser } | { kind: 'anon-admin' } | { kind: 'none' } {
  const group = msg.chat.type === 'group' || msg.chat.type === 'supergroup'
  if (group && msg.senderChatId !== null && msg.senderChatId === msg.chat.id && msg.from?.id === GROUP_ANONYMOUS_BOT_ID) return { kind: 'anon-admin' }
  if (msg.senderChatId !== null) return { kind: 'none' }
  if (!msg.from || msg.from.isBot) return { kind: 'none' }
  return { kind: 'person', user: msg.from }
}
