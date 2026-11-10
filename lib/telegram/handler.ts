// ─────────────────────────────────────────────────────────────────────────
//  THE BOT'S BRAIN — one update in, one outcome out (lane TELEGRAM,
//  2026-11-09). A pure function over its dependencies: the store, the Bot
//  API caller, the quote reader and the seat lookup are all handed in, so
//  the pins drive every path with fixture updates and no network.
//
//  The route has ALREADY authenticated the request (the webhook secret), so
//  an update here is Telegram's own word. What that word proves:
//   · `message.from.id` (a real account) proves WHO sent a message. A join
//     from a private chat seats exactly that id, never an id in the text.
//   · it does NOT prove they run the group: linking asks Telegram
//     (getChatMember → creator | administrator) before a code is spent. An
//     admin posting anonymously arrives as the group itself
//     (`sender_chat.id === chat.id`), which only an admin can do.
//   · a bot sender is ignored; a channel speaking in a group is ignored.
//
//  One message is the whole answer wherever it can be: it rides the webhook
//  RESPONSE (`reply`), which needs no outbound call. Outbound calls are the
//  admin check, the welcome (so it can be pinned) and the pin.
// ─────────────────────────────────────────────────────────────────────────

import { INVITE_CODE_RE, LINK_CODE_RE, parseJoinPayload, type Actor } from '@/lib/community/spec'
import type * as Store from '@/lib/community/store'
import { isChatAdmin, type TgCall } from './client'
import type { LinkCtx } from './links'
import {
  anonymousInviteMessage,
  callsMessage,
  chartMessage,
  couldNotPinMessage,
  groupOnlyMessage,
  helpMessage,
  inviteMessage,
  joinedMessage,
  joinPromptMessage,
  joinRefusedMessage,
  linkRefusedMessage,
  noSuchRoomMessage,
  notAnsweringMessage,
  notLinkedMessage,
  sendParams,
  startMessage,
  tidy,
  topMessage,
  unknownSymbolMessage,
  unlinkedByUpgradeMessage,
  webhookReply,
  welcomeMessage,
  type QuoteLine,
  type TgMessage,
} from './messages'
import { parseCommand, readUpdate, senderOf, type InMembership, type InMessage, type InUser, type ParsedCommand } from './update'

/** The store functions the bot calls (lib/community/store, lane CORE's bodies). */
export type BotStore = Pick<typeof Store, 'communityOfChannel' | 'redeemLinkCode' | 'burnLinkCode' | 'unlinkChannel' | 'joinCommunity' | 'listFeed' | 'listMembers'>

/** The bot's memory (lib/community/limits over unsigned_turn_windows). Each
 *  answers true = go; the real one fails OPEN on a DB error. Absent = no memory. */
export interface BotFence {
  /** T10: first sight of this update_id in 24 hours. */
  updateFresh: (updateId: number) => Promise<boolean>
  /** T9: this chat's first answer to this command in the cooldown window. */
  commandFresh: (chatId: string, command: string) => Promise<boolean>
}

/** T9: the commands that make the bot post in a GROUP, one answer per chat per window.
 *  /link and /start are never cooled (an admin linking must always get an answer). */
export const COOLED_COMMANDS: ReadonlySet<string> = new Set(['join', 'invite', 'top', 'calls', 'help', 'chart'])

export interface BotDeps {
  links: LinkCtx
  store: BotStore
  /** The outbound Bot API. null = no call can be made: anything that needs Telegram's word is refused. */
  call: TgCall | null
  /** One quote for one charted symbol, or null. Raced against QUOTE_BUDGET_MS here. */
  quote: (symbol: string) => Promise<QuoteLine | null>
  /** lib/charts: a typed symbol → our own market, or null. */
  market: (raw: string) => Promise<{ symbol: string; label: string } | null> | { symbol: string; label: string } | null
  /** The seat a PROVEN Telegram account acts from (its linked wallet's key when one exists). */
  actorFor: (user: InUser) => Promise<Actor>
  /** The request declared itself an internal run (lib/internal-run). */
  isInternal: boolean
  /** T9 / T10: update and command memory. */
  fence?: BotFence
}

export interface BotOutcome {
  /** What happened, for the pins and the response header. Never shown to a user. */
  action: string
  /** A Bot API method call to return as the webhook response body, or null. */
  reply: Record<string, unknown> | null
}

export const QUOTE_BUDGET_MS = 3_000

const done = (action: string, reply: Record<string, unknown> | null = null): BotOutcome => ({ action, reply })
const isGroup = (m: InMessage): boolean => m.chat.type === 'group' || m.chat.type === 'supergroup'

/** A fence answer that never throws: an error means go (fail open). */
async function fenceSays(f: (() => Promise<boolean>) | null): Promise<boolean> {
  if (!f) return true
  try {
    return await f()
  } catch {
    return true
  }
}

function race<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

export async function handleUpdate(raw: unknown, deps: BotDeps): Promise<BotOutcome> {
  const inb = readUpdate(raw)
  if (!inb) return done('ignored')
  // T10: Telegram redelivers an update it thinks we missed; a handled one runs once.
  const fence = deps.fence
  if (fence && inb.updateId !== null && !(await fenceSays(() => fence.updateFresh(inb.updateId as number)))) return done('duplicate')
  if (inb.kind === 'callback') return done('callback', { method: 'answerCallbackQuery', callback_query_id: inb.id })
  if (inb.kind === 'my_chat_member') {
    try {
      return await onMembership(inb, deps)
    } catch {
      return done('membership-error')
    }
  }
  const cmd = parseCommand(inb, deps.links.bot)
  try {
    return await onMessage(inb, cmd, deps)
  } catch (e) {
    // The store's own message (never a token: this module holds none).
    console.warn('[telegram bot]', e instanceof Error ? e.message.slice(0, 200) : 'error')
    // Only a command addressed to us earns an apology; anything else stays silent.
    return cmd ? done('error', answer(inb, notAnsweringMessage())) : done('ignored')
  }
}

/** Answer under the message in a group (keeps it in its forum topic); plainly in a private chat. */
function answer(m: InMessage, msg: TgMessage): Record<string, unknown> {
  return webhookReply(m.chat.id, msg, isGroup(m) ? { replyTo: m.messageId } : {})
}

// ── the bot's own seat changed ─────────────────────────────────────────────

async function onMembership(inb: InMembership, deps: BotDeps): Promise<BotOutcome> {
  if (inb.chat.type === 'private') return done('ignored')
  // Removed, banned, or muted: the bot cannot speak there, so the link is dead.
  // A demotion to plain member keeps it: the bot can still post.
  const gone = inb.status === 'left' || inb.status === 'kicked' || (inb.status === 'restricted' && inb.canSend === false)
  if (!gone) return done('membership')
  const removed = await deps.store.unlinkChannel('telegram', inb.chat.id)
  return done(removed ? 'unlinked' : 'unlink-noop')
}

// ── a message ──────────────────────────────────────────────────────────────

async function onMessage(m: InMessage, cmd: ParsedCommand | null, deps: BotDeps): Promise<BotOutcome> {
  if (m.chat.type === 'channel') return done('ignored')

  // A basic group became a supergroup: its id changed, so the old link is dead.
  if (m.migrateToChatId && isGroup(m)) {
    const removed = await deps.store.unlinkChannel('telegram', m.chat.id)
    return removed ? done('unlinked-upgrade', webhookReply(m.migrateToChatId, unlinkedByUpgradeMessage())) : done('ignored')
  }

  const sender = senderOf(m)
  if (sender.kind === 'none') return done('ignored-sender')

  if (m.chat.type === 'private') {
    if (sender.kind !== 'person') return done('ignored-sender')
    return onPrivate(m, cmd, sender.user, deps)
  }
  if (!cmd) return done('ignored')
  return onGroup(m, cmd, sender.kind === 'person' ? sender.user : null, deps)
}

// ── private chat ───────────────────────────────────────────────────────────

async function onPrivate(m: InMessage, cmd: ParsedCommand | null, user: InUser, deps: BotDeps): Promise<BotOutcome> {
  if (!cmd) return done('start', answer(m, startMessage(deps.links)))
  switch (cmd.name) {
    case 'start': {
      // The payload chooses the ROOM. The member is `from.id`, nothing else.
      const target = parseJoinPayload(cmd.arg)
      if (target) return joinFromPrivate(m, user, target, deps)
      if (LINK_CODE_RE.test(cmd.arg.toLowerCase())) return done('link-refused', answer(m, linkRefusedMessage('private')))
      return done('start', answer(m, startMessage(deps.links)))
    }
    case 'link':
      return done('link-refused', answer(m, linkRefusedMessage('private')))
    case 'chart':
      return chart(m, cmd.arg, null, deps)
    case 'calls':
    case 'top':
    case 'invite':
    case 'join':
      return done('group-only', answer(m, groupOnlyMessage()))
    default:
      return done('help', answer(m, helpMessage()))
  }
}

async function joinFromPrivate(m: InMessage, user: InUser, target: { slug: string; invite: string | null }, deps: BotDeps): Promise<BotOutcome> {
  const actor = await deps.actorFor(user)
  const r = await deps.store.joinCommunity(target.slug, actor, { via: target.invite, source: 'telegram', displayName: displayName(user), isInternal: deps.isInternal })
  if (!r.ok) return done('join-refused', answer(m, r.status === 404 ? noSuchRoomMessage(target.slug) : joinRefusedMessage(r.reason)))
  const code = INVITE_CODE_RE.test(r.me?.invite?.code ?? '') ? r.me.invite.code : null
  return done(r.joined ? 'joined' : 'already-in', answer(m, joinedMessage(deps.links, r.community, { joined: r.joined, inviteCode: code })))
}

const displayName = (user: InUser): string | null => tidy(user.name ?? user.username ?? '', 64) || null

// ── a group ────────────────────────────────────────────────────────────────

async function onGroup(m: InMessage, cmd: ParsedCommand, person: InUser | null, deps: BotDeps): Promise<BotOutcome> {
  // T9: a member cannot make the bot post on demand (its per-group send budget feeds the room's announcements).
  const fence = deps.fence
  if (fence && COOLED_COMMANDS.has(cmd.name) && !(await fenceSays(() => fence.commandFresh(m.chat.id, cmd.name)))) return done('cooldown')
  switch (cmd.name) {
    case 'start': {
      const code = cmd.arg.toLowerCase()
      if (LINK_CODE_RE.test(code)) return link(m, code, person, deps)
      const room = await deps.store.communityOfChannel('telegram', m.chat.id)
      return room ? done('join-prompt', answer(m, joinPromptMessage(deps.links, room))) : done('not-linked', answer(m, notLinkedMessage(deps.links)))
    }
    case 'link': {
      const code = cmd.arg.toLowerCase()
      return LINK_CODE_RE.test(code) ? link(m, code, person, deps) : done('link-refused', answer(m, linkRefusedMessage('usage')))
    }
    case 'help':
      return done('help', answer(m, helpMessage()))
    case 'chart': {
      // The chart answers in any chat; the room's button rides along when there is a room.
      const room = await deps.store.communityOfChannel('telegram', m.chat.id).catch(() => null)
      return chart(m, cmd.arg, room, deps)
    }
    case 'calls':
    case 'top':
    case 'invite':
    case 'join': {
      const room = await deps.store.communityOfChannel('telegram', m.chat.id)
      if (!room) return done('not-linked', answer(m, notLinkedMessage(deps.links)))
      if (cmd.name === 'join') return done('join-prompt', answer(m, joinPromptMessage(deps.links, room)))
      if (cmd.name === 'calls') {
        const { posts } = await deps.store.listFeed({ community: room.slug, kind: 'idea', sort: 'new', limit: 3 })
        return done('calls', answer(m, callsMessage(deps.links, room, posts)))
      }
      if (cmd.name === 'top') {
        const [byInvites, byTrades] = await Promise.all([deps.store.listMembers(room.slug, { sort: 'invites', limit: 5 }), deps.store.listMembers(room.slug, { sort: 'trades', limit: 5 })])
        return done('top', answer(m, topMessage(deps.links, room, byInvites, byTrades)))
      }
      // /invite: the sender's OWN link. A command from an account proves its id, so seat it first.
      if (!person) return done('invite-anonymous', answer(m, anonymousInviteMessage()))
      const actor = await deps.actorFor(person)
      const r = await deps.store.joinCommunity(room.slug, actor, { source: 'telegram', displayName: displayName(person), isInternal: deps.isInternal })
      if (!r.ok) return done('join-refused', answer(m, joinRefusedMessage(r.reason)))
      const code = r.me?.invite?.code ?? ''
      if (!INVITE_CODE_RE.test(code)) return done('error', answer(m, notAnsweringMessage()))
      return done('invite', answer(m, inviteMessage(deps.links, r.community, { name: displayName(person) }, code)))
    }
    default:
      // Somebody else's command (another bot's, unaddressed): not ours to answer.
      return done('ignored')
  }
}

/**
 * Link this group to a room. The order is the security rule:
 *   1. Telegram says the sender administers THIS chat (or the sender is the
 *      group's own anonymous admin). No word from Telegram = no link.
 *   2. only then is the single-use code spent.
 */
async function link(m: InMessage, code: string, person: InUser | null, deps: BotDeps): Promise<BotOutcome> {
  if (person) {
    // T8: a refused code is spent anyway: it sits in this chat for every member to read.
    const refuse = async (why: 'cannot-verify' | 'not-admin'): Promise<BotOutcome> => {
      await deps.store.burnLinkCode(code).catch(() => false)
      return done('link-refused', answer(m, linkRefusedMessage(why)))
    }
    if (!deps.call) return refuse('cannot-verify')
    const member = await deps.call('getChatMember', { chat_id: m.chat.id, user_id: Number(person.id) })
    if (!member.ok) return refuse('cannot-verify')
    if (!isChatAdmin(member)) return refuse('not-admin')
  }
  // person === null here means senderOf() saw the group's own anonymous admin.
  const r = await deps.store.redeemLinkCode(code, 'telegram', { externalId: m.chat.id, title: m.chat.title ? tidy(m.chat.title, 128) : null })
  if (!r.ok) return done('link-refused', answer(m, linkRefusedMessage('bad-code', r.reason)))

  // The welcome goes OUT (not in the response) so its message id comes back and it can be pinned.
  const topic = { threadId: m.threadId }
  if (deps.call) {
    const sent = await deps.call('sendMessage', sendParams(m.chat.id, welcomeMessage(deps.links, r.community), topic))
    const messageId = sent.ok && sent.result && typeof sent.result === 'object' ? (sent.result as { message_id?: unknown }).message_id : null
    if (typeof messageId === 'number') {
      const pinned = await deps.call('pinChatMessage', { chat_id: m.chat.id, message_id: messageId, disable_notification: true })
      return pinned.ok ? done('linked-pinned') : done('linked', webhookReply(m.chat.id, couldNotPinMessage(), topic))
    }
  }
  // The outbound send failed: the welcome still arrives, in the response, asking for a hand with the pin.
  return done('linked', webhookReply(m.chat.id, welcomeMessage(deps.links, r.community, { pinHint: true }), topic))
}

// ── /chart ─────────────────────────────────────────────────────────────────

async function chart(m: InMessage, arg: string, room: { slug: string; name: string } | null, deps: BotDeps): Promise<BotOutcome> {
  const asked = arg.split(/\s+/)[0] ?? ''
  const started = Date.now()
  const market = asked && /^[A-Za-z0-9.:$-]{1,16}$/.test(asked) ? await race(Promise.resolve(deps.market(asked.replace(/^\$/, ''))), QUOTE_BUDGET_MS, null) : null
  if (!market) return done('chart-unknown', answer(m, unknownSymbolMessage(asked)))
  const left = Math.max(250, QUOTE_BUDGET_MS - (Date.now() - started))
  const quote = await race(deps.quote(market.symbol), left, null)
  return done('chart', answer(m, chartMessage(deps.links, market, quote, room)))
}
