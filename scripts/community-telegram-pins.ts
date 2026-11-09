// Pins for squad community, lane TELEGRAM (2026-11-09). The lane owns this
// file and fills it; the harness (scripts/test-api.ts) already calls both
// exports, so a lane never edits test-api.ts or package.json.
//   npx tsx scripts/community-telegram-pins.ts            (npm run pins:community-telegram)
//   BASE=http://localhost:PORT npx tsx scripts/community-telegram-pins.ts --served
//   TG_FAKE=1 BASE=… npx tsx scripts/community-telegram-pins.ts --served
//     (the server was started with TELEGRAM_BOT_TOKEN=123:fake
//      TELEGRAM_WEBHOOK_SECRET=s3cr3t TELEGRAM_BOT_NAME=pantessa_test_bot:
//      proves the VERIFIED paths end to end against the TEST DB)
//
// Nothing here ever reaches a real bot: there is none. The Bot API is a
// recording fake in the pure pins; under TG_FAKE the server's own outbound
// calls carry a token Telegram refuses, which is itself the pin (no word
// from Telegram = no link).

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSiweMessage } from 'viem/siwe'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { deliverTelegramWith } from '../lib/community/deliver-telegram'
import { BOT_COMMANDS, joinPayload, parseJoinPayload, type Actor, type FeedPost, type MyMembership, type PublicCommunity, type PublicMember, type TradeProof } from '../lib/community/spec'
import { isLinkish } from '../lib/telegram/messages'
import { chatIsGone, isChatAdmin, telegramCaller, type TgCall, type TgResult } from '../lib/telegram/client'
import { ALLOWED_UPDATES, groupCommands, privateCommands } from '../lib/telegram/commands'
import { missingEnv, telegramConfig, telegramStatus } from '../lib/telegram/config'
import { OUTSIDE_LINE } from '../lib/telegram/copy'
import { handleUpdate, type BotDeps, type BotStore } from '../lib/telegram/handler'
import { addToGroupAsAdminUrl, addToGroupUrl, isOurUrl, joinUrlFor, type LinkCtx } from '../lib/telegram/links'
import {
  announcementMessage,
  callsMessage,
  chartMessage,
  escapeHtml,
  helpMessage,
  inviteMessage,
  joinedMessage,
  joinPromptMessage,
  linkRefusedMessage,
  notLinkedMessage,
  sendParams,
  startMessage,
  TG_TEXT_MAX,
  tidy,
  topMessage,
  unknownSymbolMessage,
  urlsOf,
  webhookReply,
  welcomeMessage,
  type TgMessage,
} from '../lib/telegram/messages'
import { readCapped, sameOrigin, sameOriginJson, secretHeaderOk, WEBHOOK_BODY_MAX } from '../lib/telegram/request'
import { GROUP_ANONYMOUS_BOT_ID, parseCommand, readUpdate, senderOf, type InMessage } from '../lib/telegram/update'
import { verifyInitData, verifyLoginWidget } from '../lib/telegram/verify'

type Check = (name: string, ok: boolean, extra?: string) => void

// ── fixtures ───────────────────────────────────────────────────────────────

const TOKEN = '123456:TEST-fake-token'
const BOT = 'pantessa_test_bot'
const SITE = 'https://www.pantessa.com'
const CTX: LinkCtx = { site: SITE, bot: BOT, app: null }
const CTX_APP: LinkCtx = { site: SITE, bot: BOT, app: 'room' }
const NOW = 1_762_700_600 // 10 minutes after the vectors' auth_date

/** Telegram's Mini App signature, computed HERE (not through lib/telegram/verify). */
function signInitData(fields: Record<string, string>, token: string): string {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  return createHmac('sha256', secret).update(dcs).digest('hex')
}
const initDataOf = (fields: Record<string, string>, token: string, hash = signInitData(fields, token)) => new URLSearchParams({ ...fields, hash }).toString()

/** Telegram's Login Widget signature, computed HERE. */
function signWidget(fields: Record<string, string | number>, token: string): string {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
  return createHmac('sha256', createHash('sha256').update(token).digest()).update(dcs).digest('hex')
}

const USER_JSON = '{"id":424242,"first_name":"Ada","last_name":"L","username":"ada_l"}'
const INIT_FIELDS = { auth_date: '1762700000', query_id: 'AAF', start_param: 'g_eth-traders__abc12345', user: USER_JSON }
// The same two vectors computed with openssl (dgst -sha256 -mac HMAC), outside this codebase.
const OPENSSL_INIT_HASH = 'e83bc235a6da224ecdb3e8012d88f9cb346ef0bb60acca531797d3e8bc2cde19'
const OPENSSL_WIDGET_HASH = '23960023056dd07dbc18d47b2708dc7be27a4a5ae82f3470c6bfc5df595f6004'
const WIDGET_FIELDS = { auth_date: 1762700000, first_name: 'Ada', id: 424242, username: 'ada_l' }

const HOSTILE = '<b>x</b> & "q" <a href="https://evil.example/x">click</a> <script>alert(1)</script>\u202eevil\u0000'
const ROOM: PublicCommunity = { slug: 'eth-traders', name: 'ETH Traders', about: '', symbols: ['ETH'], members: 3, postsWeek: 1, channels: [], ownerLabel: '@ada', createdAt: 0 }
const HOSTILE_ROOM = { slug: 'eth-traders', name: HOSTILE }

/** Only the tags the bot writes may remain once they are stripped; every other angle bracket must be escaped. */
function onlyOurTags(text: string): boolean {
  const stripped = text.replace(/<\/?b>|<\/?code>|<\/a>|<a href="[^"<>]*">/g, '')
  return !/[<>]/.test(stripped)
}
const clean = (m: TgMessage, ctx: LinkCtx = CTX): boolean =>
  onlyOurTags(m.text) && m.text.length <= TG_TEXT_MAX && urlsOf(m).every((u) => isOurUrl(u, ctx)) && !/[\u0000\u202e]/.test(m.text + m.buttons.flat().map((b) => b.text).join(''))
const flatButtons = (m: TgMessage) => m.buttons.flat()

const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'cmh1abcd2efgh3ijkl',
  symbol: 'ETH',
  kind: 'idea',
  title: 'ETH holds 3,400',
  body: '',
  chartState: null,
  asks: [],
  linkSlug: null,
  linkUrl: null,
  forkOf: null,
  author: '0x00000000000000000000000000000000000000aa',
  authorLabel: '@ada',
  createdAt: 0,
  comments: 0,
  executedBy: 0,
  isInternal: false,
  community: { slug: ROOM.slug, name: ROOM.name },
  mediaUrl: null,
  video: null,
  proof: null,
  score: 0,
  myVote: 0,
  ...over,
})
const PROOF: TradeProof = { turnId: 't1', chainId: 8453, txHash: '0xabababababababababababababababababababababababababababababababab', symbols: ['buy:ETH'], side: 'buy', sizeUsd: 25, chain: 'Base', txUrl: 'https://basescan.org/tx/0xabababababababababababababababababababababababababababababababab', signedAt: 0, verification: 'verified' }

// Telegram-shaped updates (Bot API field names, exactly).
const GROUP = { id: -1001234567890, type: 'supergroup', title: 'ETH Traders chat' }
const from = (id: number, over: Record<string, unknown> = {}) => ({ id, is_bot: false, first_name: 'Ada', last_name: 'L', username: 'ada_l', ...over })
let seq = 100
function msg(chat: Record<string, unknown>, sender: Record<string, unknown> | null, text: string, over: Record<string, unknown> = {}) {
  const command = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0].length }] : undefined
  return { update_id: ++seq, message: { message_id: ++seq, date: NOW, chat, ...(sender ? { from: sender } : {}), text, ...(command ? { entities: command } : {}), ...over } }
}
const priv = (id: number) => ({ id, type: 'private', first_name: 'Ada' })
const anonAdmin = (chat: { id: number }) => ({ from: { id: Number(GROUP_ANONYMOUS_BOT_ID), is_bot: true, first_name: 'Group', username: 'GroupAnonymousBot' }, sender_chat: { id: chat.id, type: 'supergroup', title: 'x' } })

// ── a fake store + a recording Bot API ─────────────────────────────────────

interface FakeWorld {
  store: BotStore
  codes: Map<string, string>
  channels: Map<string, string>
  seats: Map<string, { via: string | null; source: string | undefined; displayName: string | null | undefined; internal: boolean | undefined }>
  invites: Map<string, string>
}

function fakeWorld(): FakeWorld {
  const rooms = new Map<string, PublicCommunity>([[ROOM.slug, ROOM]])
  const codes = new Map<string, string>()
  const channels = new Map<string, string>()
  const seats: FakeWorld['seats'] = new Map()
  const invites = new Map<string, string>()
  const membership = (slug: string, key: string): MyMembership => {
    const k = `${slug}|${key}`
    if (!invites.has(k)) invites.set(k, `inv${String(invites.size + 1).padStart(5, '0')}`)
    const code = invites.get(k) as string
    return { key: key as MyMembership['key'], role: 'member', invite: { code, url: `${SITE}/g/${slug}?via=${code}`, uses: 0 } }
  }
  const store: BotStore = {
    communityOfChannel: async (_p, externalId) => rooms.get(channels.get(externalId) ?? '') ?? null,
    redeemLinkCode: async (code, _p, chat) => {
      const slug = codes.get(code)
      if (!slug) return { ok: false, status: 404, reason: 'That link code is not known. <Mint> a new one.' }
      codes.delete(code)
      channels.set(chat.externalId, slug)
      return { ok: true, community: rooms.get(slug) as PublicCommunity }
    },
    unlinkChannel: async (_p, externalId) => channels.delete(externalId),
    joinCommunity: async (slug, actor: Actor, input = {}) => {
      const room = rooms.get(slug)
      if (!room) return { ok: false, status: 404, reason: 'No such room.' }
      const k = `${slug}|${actor.key}`
      const joined = !seats.has(k)
      if (joined) seats.set(k, { via: input.via ?? null, source: input.source, displayName: input.displayName, internal: input.isInternal })
      return { ok: true, joined, community: room, me: membership(slug, actor.key) }
    },
    listFeed: async (q) => ({ posts: q.community === ROOM.slug && q.kind === 'idea' && q.limit === 3 ? [post(), post({ id: 'cmh2abcd2efgh3ijkl', title: HOSTILE })] : [], next: null }),
    listMembers: async (_slug, opts) => {
      const m = (label: string, invited: number, verifiedTrades: number): PublicMember => ({ label, role: 'member', source: 'telegram', invited, verifiedTrades, joinedAt: 0 })
      return opts?.sort === 'trades' ? [m('@ada', 0, 4), m(HOSTILE, 0, 0)] : [m('@bob', 12, 0), m('@nobody', 0, 0)]
    },
  }
  return { store, codes, channels, seats, invites }
}

interface Recorded {
  method: string
  params: Record<string, unknown>
}
/** A Bot API that records and answers from a script: method → result. */
function fakeCall(script: Partial<Record<string, TgResult>>): { call: TgCall; calls: Recorded[] } {
  const calls: Recorded[] = []
  return {
    calls,
    call: async (method, params) => {
      calls.push({ method, params })
      return script[method] ?? { ok: false, errorCode: 0, description: 'network' }
    },
  }
}

const actorFor: BotDeps['actorFor'] = async (u) => ({ key: `tg:${u.id}` as Actor['key'], wallet: null, provider: { p: 'tg', id: u.id, name: u.name, username: u.username } })
function deps(world: FakeWorld, call: TgCall | null, over: Partial<BotDeps> = {}): BotDeps {
  return {
    links: CTX,
    store: world.store,
    call,
    quote: async (s) => (s === 'ETH' ? { last: 3412.1, chgPct: 1.2345, feed: 'coinbase' } : null),
    market: (raw) => (raw.toUpperCase() === 'ETH' ? { symbol: 'ETH', label: 'ETH / USD' } : null),
    actorFor,
    isInternal: true,
    ...over,
  }
}
const textOf = (reply: Record<string, unknown> | null): string => (typeof reply?.text === 'string' ? reply.text : '')
const buttonsOf = (reply: Record<string, unknown> | null): { text: string; url?: string; web_app?: { url: string } }[] =>
  ((reply?.reply_markup as { inline_keyboard?: { text: string; url?: string; web_app?: { url: string } }[][] } | undefined)?.inline_keyboard ?? []).flat()

// ── pure pins ──────────────────────────────────────────────────────────────

/** Pure pins: no server, no network, no DB. */
export function communityTelegramPins(check: Check): void {
  // config
  const unset = telegramConfig({})
  const cfg = telegramConfig({ TELEGRAM_BOT_TOKEN: '123:fake', TELEGRAM_BOT_NAME: '@pantessa_test_bot', TELEGRAM_WEBHOOK_SECRET: 's3cr3t', TELEGRAM_APP_NAME: 'room' })
  const bad = telegramConfig({ TELEGRAM_BOT_TOKEN: 'not a token', TELEGRAM_BOT_NAME: 'pantessa', TELEGRAM_WEBHOOK_SECRET: 'has spaces', TELEGRAM_APP_NAME: 'a b' })
  check(
    'community telegram: config — unset reads as unconfigured (no bot name leaks); a malformed value reads as unset; the @ is stripped; the first missing name is named',
    !unset.token && !unset.bot && !unset.secret && telegramStatus({}).configured === false && telegramStatus({}).bot === null &&
      cfg.token === '123:fake' && cfg.bot === 'pantessa_test_bot' && cfg.secret === 's3cr3t' && cfg.app === 'room' &&
      !bad.token && !bad.bot && !bad.secret && !bad.app &&
      missingEnv(unset, ['secret', 'token', 'bot']) === 'TELEGRAM_WEBHOOK_SECRET' && missingEnv({ ...unset, secret: 's' }, ['secret', 'token', 'bot']) === 'TELEGRAM_BOT_TOKEN' && missingEnv(cfg, ['secret', 'token', 'bot']) === null &&
      telegramStatus({ TELEGRAM_BOT_TOKEN: '123:fake' }).configured === false && telegramStatus({ TELEGRAM_BOT_TOKEN: '123:fake', TELEGRAM_BOT_NAME: BOT }).miniApp === false,
  )

  // Mini App initData
  const good = verifyInitData(initDataOf(INIT_FIELDS, TOKEN), TOKEN, NOW)
  check(
    'community telegram: initData — the HMAC (key "WebAppData" over the token, then over the sorted key=value lines) verifies; this pin and openssl compute the same hash',
    signInitData(INIT_FIELDS, TOKEN) === OPENSSL_INIT_HASH && good.ok && good.user.id === '424242' && good.user.name === 'Ada L' && good.user.username === 'ada_l' && good.authDate === 1762700000 && good.startParam === 'g_eth-traders__abc12345',
  )
  const tampered = verifyInitData(initDataOf({ ...INIT_FIELDS, user: USER_JSON.replace('424242', '999') }, TOKEN, signInitData(INIT_FIELDS, TOKEN)), TOKEN, NOW)
  const wrongToken = verifyInitData(initDataOf(INIT_FIELDS, 'other:token'), TOKEN, NOW)
  const extra = verifyInitData(`${initDataOf(INIT_FIELDS, TOKEN)}&is_premium=true`, TOKEN, NOW)
  const dup = verifyInitData(`${initDataOf(INIT_FIELDS, TOKEN)}&auth_date=1762700000`, TOKEN, NOW)
  const noHash = verifyInitData(new URLSearchParams(INIT_FIELDS).toString(), TOKEN, NOW)
  const withSig = { ...INIT_FIELDS, signature: 'abc_DEF-123' }
  const botUser = { ...INIT_FIELDS, user: '{"id":5,"is_bot":true,"first_name":"B"}' }
  check(
    'community telegram: initData — a tampered user, another bot\'s token, an added field, a repeated key and a missing hash are all refused; `signature` is part of what is signed; a bot is no user',
    !tampered.ok && tampered.reason === 'bad-hash' && !wrongToken.ok && wrongToken.reason === 'bad-hash' && !extra.ok && extra.reason === 'bad-hash' && !dup.ok && dup.reason === 'malformed' && !noHash.ok && noHash.reason === 'malformed' &&
      verifyInitData(initDataOf(withSig, TOKEN), TOKEN, NOW).ok && !verifyInitData(initDataOf(INIT_FIELDS, TOKEN), '', NOW).ok && !verifyInitData(42, TOKEN, NOW).ok && !verifyInitData('x'.repeat(9000), TOKEN, NOW).ok &&
      (() => { const v = verifyInitData(initDataOf(botUser, TOKEN), TOKEN, NOW); return !v.ok && v.reason === 'no-user' })(),
  )
  const at = (authDate: number) => verifyInitData(initDataOf({ ...INIT_FIELDS, auth_date: String(authDate) }, TOKEN), TOKEN, NOW)
  const stale = at(NOW - 86_401)
  const future = at(NOW + 301)
  check(
    'community telegram: initData — fresh both ways: 24h old passes and one second more is stale; 5 min ahead passes and one second more is "future"',
    at(NOW - 86_400).ok && !stale.ok && stale.reason === 'stale' && at(NOW + 300).ok && !future.ok && future.reason === 'future',
  )

  // Login Widget
  const wGood = verifyLoginWidget({ ...WIDGET_FIELDS, hash: signWidget(WIDGET_FIELDS, TOKEN) }, TOKEN, NOW)
  const wTampered = verifyLoginWidget({ ...WIDGET_FIELDS, id: 999, hash: signWidget(WIDGET_FIELDS, TOKEN) }, TOKEN, NOW)
  const wExtra = verifyLoginWidget({ ...WIDGET_FIELDS, photo_url: 'https://evil.example/a.png', hash: signWidget(WIDGET_FIELDS, TOKEN) }, TOKEN, NOW)
  const wStaleFields = { ...WIDGET_FIELDS, auth_date: NOW - 86_401 }
  const wStale = verifyLoginWidget({ ...wStaleFields, hash: signWidget(wStaleFields, TOKEN) }, TOKEN, NOW)
  const wFutureFields = { ...WIDGET_FIELDS, auth_date: NOW + 301 }
  const wFuture = verifyLoginWidget({ ...wFutureFields, hash: signWidget(wFutureFields, TOKEN) }, TOKEN, NOW)
  // A Mini App hash is not a widget hash (different secret derivation): the two proofs never cross.
  const crossed = verifyLoginWidget({ ...WIDGET_FIELDS, hash: signInitData(Object.fromEntries(Object.entries(WIDGET_FIELDS).map(([k, v]) => [k, String(v)])), TOKEN) }, TOKEN, NOW)
  check(
    'community telegram: Login Widget — SHA256(token) keys the HMAC (same hash as openssl); a tampered id, an unsigned extra field, a stale and a future auth_date, and a Mini App hash are refused',
    signWidget(WIDGET_FIELDS, TOKEN) === OPENSSL_WIDGET_HASH && wGood.ok && wGood.user.id === '424242' && wGood.user.name === 'Ada' && wGood.startParam === null &&
      !wTampered.ok && wTampered.reason === 'bad-hash' && !wExtra.ok && wExtra.reason === 'bad-hash' && !wStale.ok && wStale.reason === 'stale' && !wFuture.ok && wFuture.reason === 'future' && !crossed.ok &&
      !verifyLoginWidget(null, TOKEN, NOW).ok && !verifyLoginWidget([], TOKEN, NOW).ok && !verifyLoginWidget({ ...WIDGET_FIELDS, nested: { a: 1 }, hash: 'x' }, TOKEN, NOW).ok,
  )

  // commands
  const m = (text: string, hasCommandEntity: boolean | null = true) => ({ text, hasCommandEntity })
  const c1 = parseCommand(m('/chart ETH'), BOT)
  const c2 = parseCommand(m(`/chart@${BOT} eth  now`), BOT)
  const c3 = parseCommand(m('/START@Pantessa_Test_Bot abcdef0123456789'), BOT)
  check(
    'community telegram: commands — /cmd and /cmd@<our bot> parse (case-blind), the argument is trimmed; /cmd@otherbot, a slash with no command entity, and plain text are not ours',
    c1?.name === 'chart' && c1.arg === 'ETH' && c2?.name === 'chart' && c2.arg === 'eth  now' && c3?.name === 'start' && c3.arg === 'abcdef0123456789' &&
      parseCommand(m('/chart@otherbot ETH'), BOT) === null && parseCommand(m('/chart ETH', false), BOT) === null && parseCommand(m('chart ETH', null), BOT) === null && parseCommand(m('/', null), BOT) === null && parseCommand(m('/help', null), BOT)?.name === 'help',
  )
  check(
    'community telegram: command menus — the group menu is BOT_COMMANDS + help; the private menu drops the group-only ones; the webhook asks for three update kinds',
    groupCommands().map((c) => c.command).join() === [...BOT_COMMANDS.map((c) => c.name), 'help'].join() && privateCommands().map((c) => c.command).join() === 'chart,help' && ALLOWED_UPDATES.join() === 'message,my_chat_member,callback_query' &&
      groupCommands().every((c) => /^[a-z0-9_]{1,32}$/.test(c.command) && c.description.length >= 1 && c.description.length <= 256),
  )

  // payloads + links
  const longest = joinPayload('a'.repeat(32), 'b'.repeat(12))
  check(
    'community telegram: join payloads — round-trip with and without an invite, fit Telegram\'s 64 chars at the longest slug + code, and junk is refused',
    JSON.stringify(parseJoinPayload(joinPayload('eth-traders'))) === '{"slug":"eth-traders","invite":null}' && JSON.stringify(parseJoinPayload(joinPayload('eth-traders', 'abc12345'))) === '{"slug":"eth-traders","invite":"abc12345"}' &&
      longest.length <= 64 && /^[A-Za-z0-9_-]{1,64}$/.test(longest) && parseJoinPayload(longest)?.invite === 'b'.repeat(12) &&
      parseJoinPayload('g_Bad Slug') === null && parseJoinPayload('g_eth-traders__BAD!') === null && parseJoinPayload('x_eth-traders') === null && parseJoinPayload(42) === null && parseJoinPayload('abcdef0123456789') === null,
  )
  check(
    'community telegram: links — the join door prefers the Mini App (one tap) and falls back to the bot chat; add-to-group carries the code; only our site, our bot, and a share sheet wrapping them count as ours',
    joinUrlFor(CTX_APP, 'eth-traders', 'abc12345') === `https://t.me/${BOT}/room?startapp=g_eth-traders__abc12345` && joinUrlFor(CTX, 'eth-traders') === `https://t.me/${BOT}?start=g_eth-traders` &&
      addToGroupUrl(BOT, 'abcdef0123456789') === `https://t.me/${BOT}?startgroup=abcdef0123456789` && addToGroupAsAdminUrl(BOT, 'abcdef0123456789').endsWith('&admin=pin_messages') &&
      isOurUrl(`${SITE}/c/x`, CTX) && isOurUrl(`https://t.me/${BOT}?start=g_x`, CTX) && isOurUrl(`https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${BOT}?start=g_x`)}&text=hi`, CTX) &&
      !isOurUrl('https://www.pantessa.com.evil.example/c/x', CTX) && !isOurUrl(`https://t.me/${BOT}2`, CTX) && !isOurUrl('https://t.me/someone_else', CTX) && !isOurUrl(`https://t.me/share/url?url=${encodeURIComponent('https://evil.example')}`, CTX) && !isOurUrl('https://evil.example', CTX),
  )

  // messages
  const welcome = welcomeMessage(CTX, HOSTILE_ROOM)
  const all: TgMessage[] = [
    welcome,
    welcomeMessage(CTX_APP, HOSTILE_ROOM, { pinHint: true }),
    joinedMessage(CTX, HOSTILE_ROOM, { joined: true, inviteCode: 'abc12345' }),
    joinPromptMessage(CTX, HOSTILE_ROOM),
    inviteMessage(CTX, HOSTILE_ROOM, { name: HOSTILE }, 'abc12345'),
    callsMessage(CTX, HOSTILE_ROOM, [post({ title: HOSTILE, authorLabel: HOSTILE, symbol: '<i>' })]),
    topMessage(CTX, HOSTILE_ROOM, [{ label: HOSTILE, role: 'member', source: 'telegram', invited: 3, verifiedTrades: 0, joinedAt: 0 }], []),
    chartMessage(CTX, { symbol: 'ETH', label: HOSTILE }, { last: 3412.1, chgPct: 1.2, feed: 'coinbase' }, HOSTILE_ROOM),
    unknownSymbolMessage(HOSTILE),
    linkRefusedMessage('bad-code', HOSTILE),
    notLinkedMessage(CTX),
    startMessage(CTX),
    helpMessage(),
    announcementMessage(CTX, HOSTILE_ROOM, post({ title: HOSTILE, authorLabel: HOSTILE, linkUrl: 'https://evil.example/x', linkSlug: 'abc123' })) as TgMessage,
  ]
  check(
    'community telegram: every message is escaped — hostile room names, titles, labels and store reasons leave only the bot\'s own tags, no control or bidi characters, <= 4096 chars, and every URL is ours',
    all.every((x) => !!x && clean(x)) && clean(all[1], CTX_APP) && escapeHtml('<a href="x">&') === '&lt;a href=&quot;x&quot;&gt;&amp;' && tidy(' a\u0000\u202e  b ', 10) === 'a b' && tidy('abcdefghij', 5).length === 5,
    all.map((x, i) => (x && clean(x, i === 1 ? CTX_APP : CTX) ? '' : `#${i}`)).join(''),
  )
  const joinedHttps = joinedMessage(CTX, ROOM, { joined: true, inviteCode: 'abc12345' })
  const joinedLocal = joinedMessage({ ...CTX, site: 'http://localhost:4504' }, ROOM, { joined: false, inviteCode: null })
  check(
    'community telegram: the welcome has ONE button (the join door); a join reply opens the room with a web_app button on https (a plain link on a local origin), says "already in" the second time, and hands over the invite link',
    flatButtons(welcome).length === 1 && flatButtons(welcome)[0].url === joinUrlFor(CTX, 'eth-traders') && /^Join /.test(flatButtons(welcome)[0].text) &&
      flatButtons(joinedHttps)[0].web_app?.url === `${SITE}/tg?startapp=g_eth-traders` && /You are in/.test(joinedHttps.text) && joinedHttps.text.includes(`${SITE}/g/eth-traders?via=abc12345`) &&
      flatButtons(joinedLocal)[0].web_app === undefined && !!flatButtons(joinedLocal)[0].url && /already in/.test(joinedLocal.text) && flatButtons(joinedLocal).length === 1,
  )
  const chartMsg = chartMessage(CTX, { symbol: 'ETH', label: 'ETH / USD' }, { last: 3412.1, chgPct: 1.2345, feed: 'coinbase' }, ROOM)
  const chartBare = chartMessage(CTX, { symbol: 'ETH', label: 'ETH / USD' }, null, null)
  const calls = callsMessage(CTX, ROOM, [post(), post({ id: 'cmh2abcd2efgh3ijkl' }), post({ id: 'cmh3abcd2efgh3ijkl' }), post({ id: 'cmh4abcd2efgh3ijkl' }), post({ id: 'bad id!' })])
  const top = topMessage(CTX, ROOM, [{ label: '@bob', role: 'member', source: 'site', invited: 12, verifiedTrades: 0, joinedAt: 0 }, { label: '@zero', role: 'member', source: 'site', invited: 0, verifiedTrades: 0, joinedAt: 0 }], [])
  check(
    'community telegram: /chart is the price line + the market link + at most two buttons (no price → it says so); /calls lists at most three, each a link to /c/<id>; /top never ranks a zero',
    chartMsg.text.includes('$3,412.10') && chartMsg.text.includes('+1.23% 24h') && chartMsg.text.includes('Coinbase') && chartMsg.text.includes(`href="${SITE}/t/ETH"`) && flatButtons(chartMsg).length === 2 && flatButtons(chartMsg)[0].url === `${SITE}/t/ETH` &&
      flatButtons(chartBare).length === 1 && /No price right now/.test(chartBare.text) &&
      (calls.text.match(/href="/g) ?? []).length === 3 && calls.text.includes(`href="${SITE}/c/cmh1abcd2efgh3ijkl"`) && !calls.text.includes('cmh4') &&
      top.text.includes('<code>@bob</code> · 12') && !top.text.includes('@zero') && !/Verified receipts/.test(top.text),
  )
  const idea = announcementMessage(CTX, ROOM, post({ linkSlug: 'abc123' })) as TgMessage
  const tradeVerified = announcementMessage(CTX, ROOM, post({ kind: 'trade', proof: PROOF })) as TgMessage
  const tradeNoProof = announcementMessage(CTX, ROOM, post({ kind: 'trade', proof: null })) as TgMessage
  const tradeBadProof = announcementMessage(CTX, ROOM, post({ kind: 'trade', proof: { ...PROOF, verification: 'attested' as unknown as 'verified' } })) as TgMessage
  const ideaWithProof = announcementMessage(CTX, ROOM, post({ kind: 'idea', title: 'verified? no', proof: PROOF })) as TgMessage
  const noLink = announcementMessage(CTX, ROOM, post({ linkSlug: null, linkUrl: 'https://evil.example/x' })) as TgMessage
  check(
    'community telegram: an announcement says "verified on-chain" ONLY for a trade whose proof is literally verified; "Trade this" only with a link slug; a post URL never becomes a button; an unlinkable id sends nothing',
    /Chart idea/.test(idea.text) && !/verified/i.test(idea.text) && flatButtons(idea).map((b) => b.text).join('|') === 'Open|Trade this|Join ETH Traders' && flatButtons(idea)[1].url === `${SITE}/i/abc123` && flatButtons(idea)[0].url === `${SITE}/c/cmh1abcd2efgh3ijkl` &&
      tradeVerified.text.split('\n')[0] === '<b>Verified on-chain: this wallet moved $25.00 on Base</b>' &&
      !/verified/i.test(tradeNoProof.text) && !/verified/i.test(tradeBadProof.text) && !/verified on-chain/.test(ideaWithProof.text) &&
      flatButtons(noLink).map((b) => b.text).join('|') === 'Open|Join ETH Traders' && !JSON.stringify(noLink).includes('evil.example') &&
      announcementMessage(CTX, ROOM, post({ id: '../../x y' })) === null && announcementMessage(CTX, ROOM, post({ linkSlug: 'a/b?x' }))?.buttons[0].length === 1,
  )
  {
    const typed = announcementMessage(CTX, ROOM, post({ kind: 'trade', title: 'Bought $5,000,000 of BTC at the low', proof: { ...PROOF, sizeUsd: null } })) as TgMessage
    const lines = typed.text.split('\n')
    const forged = announcementMessage(CTX, ROOM, post({ kind: 'trade', proof: { ...PROOF, txUrl: 'https://evil.example/claim?tx=0xabababababababababababababababababababababababababababababababab' } })) as TgMessage
    check(
      'S9 + T4 telegram: a trade announcement\'s FIRST line is the chain-confirmed line ("Verified on-chain: this wallet moved funds on Base"), the market is the author\'s tag, and the typed title is QUOTED as the author\'s words below; the tx button is the rebuilt explorer link, a forged link is never a button',
      lines[0] === '<b>Verified on-chain: this wallet moved funds on Base</b>' && lines[1] === 'Tagged by the author: bought ETH' && lines[2] === 'The author says: <code>Bought $5,000,000 of BTC at the low</code>' &&
        flatButtons(tradeVerified).some((b) => b.text === 'The transaction' && b.url === PROOF.txUrl) && !JSON.stringify(forged).includes('evil.example') && !flatButtons(forged).some((b) => b.text === 'The transaction'),
      lines.slice(0, 3).join(' | '),
    )
  }
  {
    // Text OUTSIDE <code> must carry no link-shaped token from a member.
    const outside = (m: TgMessage) => m.text.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<a href="[^"]*">/g, '')
    const scam = 'Free ETH: evil.example/claim'
    const inv = inviteMessage(CTX, ROOM, { name: scam }, 'abc12345')
    const room = { ...ROOM, name: 'Claim at evil.example @scambot' }
    const wel = welcomeMessage(CTX, room)
    const ann = announcementMessage(CTX, ROOM, post({ title: 'Claim at evil.example @scambot #free $SCAM', authorLabel: '@nate' })) as TgMessage
    const tp = topMessage(CTX, ROOM, [{ label: 't.me/scam_support', role: 'member', source: 'telegram', invited: 3, verifiedTrades: 0, joinedAt: 0 }], [])
    const unk = unknownSymbolMessage('bit.ly/3xYz12')
    const names = ['Free ETH: evil.example/claim', 'https://x.y', '@scambot', '/start', 't.me/x', '$SCAM airdrop', '#claim', 'go to bit.ly']
    check(
      'T3 telegram: a display name with a link, an @, a leading /, a word.tld, t.me, a $TICKER or a #tag becomes "A member"; titles and room names ride inside <code> (Telegram links nothing there); a board label with an @ is code-wrapped; /chart never echoes what was typed',
      names.every((n) => isLinkish(n)) && !isLinkish('Ana K') && !isLinkish('Bob') &&
        /<b>A member<\/b> is inviting you/.test(inv.text) && !inv.text.includes('evil.example') &&
        !/evil\.example|@scambot/.test(outside(wel)) && wel.text.includes('<code>Claim at evil.example @scambot</code>') &&
        !/evil\.example|@scambot|#free|\$SCAM|@nate/.test(outside(ann)) && ann.text.includes('<code>@nate</code>') &&
        !/t\.me\/scam/.test(outside(tp)) && !unk.text.includes('bit.ly') && /I do not have a chart for that/.test(unk.text),
      `${inv.text.split('\n')[0]} | ${outside(ann).replace(/\n/g, ' / ')}`,
    )
  }
  const wire = webhookReply('-100123', welcome, { replyTo: 7, threadId: 9 })
  check(
    'community telegram: a reply rides the webhook response as a sendMessage call — HTML, previews off, the buttons as an inline keyboard, answered under the asking message',
    wire.method === 'sendMessage' && wire.chat_id === '-100123' && wire.parse_mode === 'HTML' && (wire.link_preview_options as { is_disabled: boolean }).is_disabled === true &&
      Array.isArray((wire.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard) && (wire.reply_parameters as { message_id: number }).message_id === 7 && wire.message_thread_id === 9 &&
      sendParams('1', helpMessage()).reply_markup === undefined && sendParams('1', helpMessage()).method === undefined,
  )

  // reading an update
  const g = readUpdate(msg(GROUP, from(42), '/chart ETH', { message_thread_id: 5, is_topic_message: true })) as InMessage
  const anon = readUpdate(msg(GROUP, null, '/link abcdef0123456789', anonAdmin(GROUP))) as InMessage
  const asChannel = readUpdate(msg(GROUP, { id: 136817688, is_bot: true, first_name: 'Channel' }, '/link abcdef0123456789', { sender_chat: { id: -1009999, type: 'channel' } })) as InMessage
  const mcm = readUpdate({ update_id: 1, my_chat_member: { chat: GROUP, from: from(42), date: NOW, old_chat_member: { status: 'member' }, new_chat_member: { status: 'kicked', user: { id: 7, is_bot: true } } } })
  check(
    'community telegram: updates are read by the Bot API\'s own field names — chat.id / chat.type / from.id / text / entities / sender_chat / my_chat_member; edits, channel posts and junk are ignored',
    g.kind === 'message' && g.chat.id === '-1001234567890' && g.chat.type === 'supergroup' && g.from?.id === '42' && g.text === '/chart ETH' && g.hasCommandEntity === true && g.threadId === 5 &&
      mcm?.kind === 'my_chat_member' && mcm.status === 'kicked' && readUpdate({ update_id: 2, callback_query: { id: 'abc123', from: from(42) } })?.kind === 'callback' &&
      readUpdate({ update_id: 3, edited_message: { message_id: 1, chat: GROUP, from: from(42), text: '/link abcdef0123456789' } }) === null && readUpdate({ update_id: 4, channel_post: { message_id: 1, chat: { id: -1, type: 'channel' }, text: '/chart ETH' } }) === null &&
      readUpdate(null) === null && readUpdate('x') === null && readUpdate([]) === null && readUpdate({ message: { chat: { id: '1; DROP', type: 'group' }, text: '/help' } }) === null && readUpdate({ message: { chat: { id: 1, type: 'weird' } } }) === null,
  )
  check(
    'community telegram: who sent it — a real account is a person; a bot is nobody; the group\'s own anonymous admin (sender_chat = the chat) proves admin and no identity; a channel speaking in the group is nobody',
    senderOf(g).kind === 'person' && senderOf(readUpdate(msg(GROUP, from(7, { is_bot: true }), '/help')) as InMessage).kind === 'none' && senderOf(anon).kind === 'anon-admin' && senderOf(asChannel).kind === 'none' &&
      senderOf(readUpdate(msg(priv(42), null, '/help', anonAdmin({ id: 42 }))) as InMessage).kind === 'none' && senderOf(readUpdate(msg(GROUP, null, '/help')) as InMessage).kind === 'none',
  )

  // request guards
  const h = (o: Record<string, string>) => new Headers(o)
  check(
    'community telegram: the webhook secret — exact match only, fails closed with no configured secret or no header (compared as hashes: constant-time, length-blind)',
    secretHeaderOk('s3cr3t', 's3cr3t') && !secretHeaderOk('s3cr3t ', 's3cr3t') && !secretHeaderOk('S3CR3T', 's3cr3t') && !secretHeaderOk('', 's3cr3t') && !secretHeaderOk(null, 's3cr3t') && !secretHeaderOk('s3cr3t', null) && !secretHeaderOk('', '') && !secretHeaderOk(undefined, undefined),
  )
  check(
    'community telegram: sign-in must come from our own page — JSON only, Sec-Fetch-Site same-origin or none, an Origin that names the request host',
    sameOriginJson(h({ 'content-type': 'application/json', host: 'www.pantessa.com', origin: 'https://www.pantessa.com', 'sec-fetch-site': 'same-origin' })) && sameOriginJson(h({ 'content-type': 'application/json; charset=utf-8', host: 'x' })) &&
      !sameOriginJson(h({ 'content-type': 'text/plain', host: 'x' })) && !sameOriginJson(h({ 'content-type': 'application/x-www-form-urlencoded' })) && !sameOriginJson(h({ host: 'x' })) &&
      !sameOriginJson(h({ 'content-type': 'application/json', host: 'www.pantessa.com', origin: 'https://evil.example' })) && !sameOriginJson(h({ 'content-type': 'application/json', host: 'www.pantessa.com', 'sec-fetch-site': 'cross-site' })) &&
      !sameOrigin(h({ host: 'www.pantessa.com', origin: 'null' })) && sameOrigin(h({ host: 'www.pantessa.com' })),
  )
  check(
    'community telegram: the outbound caller refuses an unknown method before a socket opens; 403 / "chat not found" mean the chat is gone; only creator or administrator may link',
    chatIsGone({ ok: false, errorCode: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }) && chatIsGone({ ok: false, errorCode: 400, description: 'Bad Request: chat not found' }) && !chatIsGone({ ok: false, errorCode: 429, description: 'Too Many Requests' }) && !chatIsGone({ ok: false, errorCode: 0, description: 'network' }) && !chatIsGone({ ok: true }) &&
      isChatAdmin({ ok: true, result: { status: 'creator' } }) && isChatAdmin({ ok: true, result: { status: 'administrator', can_pin_messages: true } }) && isChatAdmin({ ok: true, result: { status: 'administrator', can_change_info: true } }) && !isChatAdmin({ ok: true, result: { status: 'administrator', can_delete_messages: true } }) && !isChatAdmin({ ok: true, result: { status: 'member' } }) && !isChatAdmin({ ok: true, result: { status: 'restricted' } }) && !isChatAdmin({ ok: false, result: { status: 'creator' } }) && !isChatAdmin({ ok: true }),
  )
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const authRoute = code('app/api/telegram/auth/route.ts')
  const hookRoute = code('app/api/telegram/webhook/route.ts')
  const libFiles = ['lib/telegram/client.ts', 'lib/telegram/handler.ts', 'lib/telegram/server.ts', 'lib/telegram/verify.ts', 'lib/telegram/request.ts', 'lib/community/deliver-telegram.ts', 'app/api/telegram/auth/route.ts', 'app/api/telegram/webhook/route.ts'].map(code)
  check(
    'community telegram: the identity cookie is set in ONE place, after a verified proof; the webhook checks the secret before it reads the body; no console line carries the token, the secret or initData',
    (authRoute.match(/setIdentityCookie\(/g) ?? []).length === 1 && authRoute.indexOf('if (!verdict.ok) return') > 0 && authRoute.indexOf('if (!verdict.ok) return') < authRoute.indexOf('setIdentityCookie(') && authRoute.indexOf('sameOriginJson(') < authRoute.indexOf('readCapped(') &&
      hookRoute.indexOf('secretHeaderOk(') > 0 && hookRoute.indexOf('secretHeaderOk(') < hookRoute.indexOf('readCapped(') && hookRoute.indexOf("unconfiguredBody('TELEGRAM_WEBHOOK_SECRET')") < hookRoute.indexOf('secretHeaderOk(') && /maxDuration = \d+\b/.test(hookRoute) &&
      libFiles.every((f) => [...f.matchAll(/console\.\w+\(([^\n]*)/g)].every((mm) => !/token|secret|initData|cfg\./i.test(mm[1]))) &&
      !/setIdentityCookie/.test(code('lib/telegram/handler.ts') + code('app/api/telegram/webhook/route.ts') + code('app/tg/TgEntry.tsx')),
  )
  const tg = src('app/tg/TgEntry.tsx')
  const panel = src('components/community/telegram/TelegramPanel.tsx')
  check(
    'community telegram: /tg loads Telegram\'s script on its own route only, posts initData to the verifier and never reads who the user is from initDataUnsafe; the panel is { slug, canManage } with a default export',
    tg.includes('https://telegram.org/js/telegram-web-app.js') && tg.includes("'/api/telegram/auth'") && !/initDataUnsafe\??\.user/.test(tg) && tg.includes('OUTSIDE_LINE') && OUTSIDE_LINE.length > 10 &&
      /export default function TelegramPanel\(\{ slug, canManage \}: TelegramPanelProps\)/.test(panel) && /slug: string\s+canManage: boolean/.test(panel) && !src('app/layout.tsx').includes('telegram-web-app'),
  )
}

// ── the bot over fakes (async, still no network and no DB) ─────────────────

let botPinsRan = false

/** The webhook handler and the deliverer, driven by Telegram-shaped fixtures with an injected store and Bot API. */
export async function communityTelegramBotPins(check: Check): Promise<void> {
  if (botPinsRan) return
  botPinsRan = true
  const CODE = 'abcdef0123456789'

  // link by an admin: Telegram is asked first, then the code is spent, then the welcome is sent and pinned.
  {
    const w = fakeWorld()
    w.codes.set(CODE, ROOM.slug)
    const api = fakeCall({ getChatMember: { ok: true, result: { status: 'administrator', can_pin_messages: true } }, sendMessage: { ok: true, result: { message_id: 555 } }, pinChatMessage: { ok: true, result: true } })
    const out = await handleUpdate(msg(GROUP, from(42), `/start@${BOT} ${CODE}`), deps(w, api.call))
    const sent = api.calls[1]?.params as { text?: string; reply_markup?: { inline_keyboard: { text: string; url: string }[][] } }
    check(
      'community telegram (bot): an admin links the group — getChatMember(chat, sender) first, the code spent once, the welcome sent with ONE join button, then pinned; nothing left to say in the response',
      out.action === 'linked-pinned' && out.reply === null && api.calls.map((c) => c.method).join() === 'getChatMember,sendMessage,pinChatMessage' &&
        api.calls[0].params.chat_id === '-1001234567890' && api.calls[0].params.user_id === 42 && w.channels.get('-1001234567890') === ROOM.slug && !w.codes.has(CODE) &&
        sent.reply_markup?.inline_keyboard.flat().length === 1 && sent.reply_markup.inline_keyboard[0][0].url === joinUrlFor(CTX, ROOM.slug) && api.calls[2].params.message_id === 555,
      `${out.action} ${api.calls.map((c) => c.method).join()}`,
    )
    const again = await handleUpdate(msg(GROUP, from(42), `/link ${CODE}`), deps(w, api.call))
    check('community telegram (bot): a spent code is refused in the store\'s own words, escaped', again.action === 'link-refused' && /did not work/.test(textOf(again.reply)) && textOf(again.reply).includes('&lt;Mint&gt;') && onlyOurTags(textOf(again.reply)))
  }

  // link refused: not an admin, Telegram unreachable, no caller at all. The code survives every one.
  {
    const w = fakeWorld()
    w.codes.set(CODE, ROOM.slug)
    const member = fakeCall({ getChatMember: { ok: true, result: { status: 'member' } } })
    const notAdmin = await handleUpdate(msg(GROUP, from(43), `/link ${CODE}`), deps(w, member.call))
    const down = fakeCall({})
    const unreachable = await handleUpdate(msg(GROUP, from(43), `/link ${CODE}`), deps(w, down.call))
    const noCaller = await handleUpdate(msg(GROUP, from(43), `/link ${CODE}`), deps(w, null))
    const viaBot = await handleUpdate(msg(GROUP, from(44, { is_bot: true }), `/link ${CODE}`), deps(w, member.call))
    const viaChannel = await handleUpdate(msg(GROUP, { id: 136817688, is_bot: true, first_name: 'Channel' }, `/link ${CODE}`, { sender_chat: { id: -1009999, type: 'channel' } }), deps(w, member.call))
    const inPrivate = await handleUpdate(msg(priv(43), from(43), `/start ${CODE}`), deps(w, member.call))
    const edited = await handleUpdate({ update_id: 9, edited_message: { message_id: 1, chat: GROUP, from: from(42), text: `/link ${CODE}` } }, deps(w, member.call))
    check(
      'community telegram (bot): no link without Telegram\'s word — a non-admin, an unreachable Telegram and a missing caller are refused; a bot, a channel, a private chat and an edit never link; the code is never spent',
      notAdmin.action === 'link-refused' && /Only an admin/.test(textOf(notAdmin.reply)) && unreachable.action === 'link-refused' && /could not check/.test(textOf(unreachable.reply)) && noCaller.action === 'link-refused' &&
        viaBot.action === 'ignored-sender' && viaBot.reply === null && viaChannel.action === 'ignored-sender' && inPrivate.action === 'link-refused' && /inside a group/.test(textOf(inPrivate.reply)) && edited.action === 'ignored' &&
        w.codes.has(CODE) && w.channels.size === 0 && member.calls.every((c) => c.method === 'getChatMember'),
      `${notAdmin.action}/${unreachable.action}/${noCaller.action}/${viaBot.action}/${viaChannel.action}/${inPrivate.action}/${edited.action}`,
    )
    // The group's own anonymous admin: no getChatMember is possible or needed. The pin fails here → the bot says so.
    const api = fakeCall({ sendMessage: { ok: true, result: { message_id: 9 } }, pinChatMessage: { ok: false, errorCode: 400, description: 'Bad Request: not enough rights to manage pinned messages in the chat' } })
    const anon = await handleUpdate(msg(GROUP, null, `/link ${CODE}`, anonAdmin(GROUP)), deps(w, api.call))
    check(
      'community telegram (bot): the group\'s anonymous admin links without a member lookup; when the pin is refused the bot says so in the response',
      anon.action === 'linked' && /could not pin/.test(textOf(anon.reply)) && api.calls.map((c) => c.method).join() === 'sendMessage,pinChatMessage' && w.channels.get('-1001234567890') === ROOM.slug,
    )
    // The outbound send failed: the welcome still arrives, in the response, with the pin hint.
    const w2 = fakeWorld()
    w2.codes.set(CODE, ROOM.slug)
    const dead = fakeCall({ getChatMember: { ok: true, result: { status: 'creator' } } })
    const fallback = await handleUpdate(msg(GROUP, from(42), `/link@${BOT} ${CODE}`), deps(w2, dead.call))
    check('community telegram (bot): when the welcome cannot be sent out it rides the response, one button, asking an admin to pin it', fallback.action === 'linked' && /pin this message/.test(textOf(fallback.reply)) && buttonsOf(fallback.reply).length === 1 && fallback.reply?.method === 'sendMessage')
    const usage = await handleUpdate(msg(GROUP, from(42), '/link nope'), deps(w2, dead.call))
    check('community telegram (bot): /link with no real code explains itself and asks Telegram nothing', usage.action === 'link-refused' && /16 characters/.test(textOf(usage.reply)) && dead.calls.filter((c) => c.method === 'getChatMember').length === 1)
  }

  // private /start g_<slug>__<invite>: the member is from.id, the payload only names the room.
  {
    const w = fakeWorld()
    const api = fakeCall({})
    const d = deps(w, api.call)
    const joined = await handleUpdate(msg(priv(777), from(777, { first_name: '<b>Eve</b>', last_name: undefined }), '/start g_eth-traders__abc12345 tg:1 999'), d)
    const real = await handleUpdate(msg(priv(777), from(777), '/start g_eth-traders__abc12345'), d)
    const again = await handleUpdate(msg(priv(777), from(777), '/start g_eth-traders'), d)
    const seat = w.seats.get('eth-traders|tg:777')
    const missing = await handleUpdate(msg(priv(778), from(778), '/start g_no-such-room'), d)
    check(
      'community telegram (bot): a private /start g_<slug>__<invite> seats exactly from.id (never an id in the text), credits the invite, replies "You are in" with the room button, and is idempotent',
      joined.action === 'start' && real.action === 'joined' && /You are in <code>ETH Traders<\/code>/.test(textOf(real.reply)) && again.action === 'already-in' && /already in/.test(textOf(again.reply)) &&
        w.seats.size === 1 && seat?.via === 'abc12345' && seat.source === 'telegram' && seat.displayName === 'Ada L' && seat.internal === true &&
        buttonsOf(real.reply)[0].web_app?.url === `${SITE}/tg?startapp=g_eth-traders` && real.reply?.chat_id === '777' && api.calls.length === 0 &&
        missing.action === 'join-refused' && /no room called/.test(textOf(missing.reply)) && !w.seats.has('eth-traders|tg:1') && !w.seats.has('eth-traders|tg:999'),
      `${joined.action}/${real.action}/${again.action}/${missing.action} seats=${[...w.seats.keys()].join()}`,
    )
    const botJoin = await handleUpdate(msg(priv(5), from(5, { is_bot: true }), '/start g_eth-traders'), d)
    check('community telegram (bot): a bot account is never seated', botJoin.action === 'ignored-sender' && botJoin.reply === null && w.seats.size === 1)
  }

  // commands in a linked group, all answered in the webhook response (no outbound call).
  {
    const w = fakeWorld()
    w.channels.set('-1001234567890', ROOM.slug)
    const api = fakeCall({})
    const d = deps(w, api.call)
    const run = (text: string, sender: Record<string, unknown> | null = from(42), over: Record<string, unknown> = {}) => handleUpdate(msg(GROUP, sender, text, over), d)
    const chart = await run('/chart eth')
    const chartUnknown = await run(`/chart ${HOSTILE}`)
    const calls = await run(`/calls@${BOT}`)
    const top = await run('/top')
    const invite = await run('/invite', from(900, { first_name: 'Bob', last_name: undefined, username: 'bob' }))
    const inviteAnon = await run('/invite', null, anonAdmin(GROUP))
    const join = await run('/join')
    const help = await run('/help')
    const other = await run('/chart@otherbot ETH')
    const unknown = await run('/price ETH')
    const chatter = await handleUpdate(msg(GROUP, from(42), 'gm everyone'), d)
    const replies = [chart, chartUnknown, calls, top, invite, inviteAnon, join, help]
    check(
      'community telegram (bot): /chart /calls /top /invite /join /help each answer in the webhook response (no outbound call), under the asking message, escaped, with only our URLs',
      replies.every((r) => r.reply?.method === 'sendMessage' && r.reply.chat_id === '-1001234567890' && r.reply.parse_mode === 'HTML' && !!(r.reply.reply_parameters as { message_id?: number })?.message_id && onlyOurTags(textOf(r.reply)) && buttonsOf(r.reply).every((b) => isOurUrl(b.url ?? '', CTX) && !b.web_app)) && api.calls.length === 0 &&
        chart.action === 'chart' && textOf(chart.reply).includes('$3,412.10') && buttonsOf(chart.reply).length === 2 && chartUnknown.action === 'chart-unknown' &&
        calls.action === 'calls' && (textOf(calls.reply).match(/<a href="/g) ?? []).length === 2 && top.action === 'top' && textOf(top.reply).includes('<code>@bob</code> · 12') && textOf(top.reply).includes('<code>@ada</code> · 4 verified') && join.action === 'join-prompt' && help.action === 'help',
      replies.map((r) => r.action).join('/'),
    )
    const bobCode = w.invites.get('eth-traders|tg:900') ?? ''
    check(
      'community telegram (bot): /invite seats the sender first (a command proves the account), then posts THEIR link in the group; the button joins and credits them; an anonymous admin is told an invite is personal',
      invite.action === 'invite' && w.seats.has('eth-traders|tg:900') && !!bobCode && buttonsOf(invite.reply)[0].url === joinUrlFor(CTX, 'eth-traders', bobCode) && textOf(invite.reply).includes(`${SITE}/g/eth-traders?via=${bobCode}`) && /<b>Bob<\/b> is inviting you/.test(textOf(invite.reply)) &&
        inviteAnon.action === 'invite-anonymous' && w.seats.size === 1,
    )
    check(
      'community telegram (bot): another bot\'s command, an unknown command and ordinary chatter are never answered',
      other.action === 'ignored' && other.reply === null && unknown.action === 'ignored' && unknown.reply === null && chatter.action === 'ignored' && chatter.reply === null,
    )
    // not linked
    const w2 = fakeWorld()
    const d2 = deps(w2, api.call)
    const nl = await Promise.all(['/calls', '/top', '/invite', '/join', '/start'].map((t) => handleUpdate(msg(GROUP, from(42), t), d2)))
    const chartAnywhere = await handleUpdate(msg(GROUP, from(42), '/chart ETH'), d2)
    const privCalls = await handleUpdate(msg(priv(42), from(42), '/calls'), d2)
    check(
      'community telegram (bot): in a chat with no room the room commands answer with how to link it; /chart still answers (one button); room commands in a private chat point at a group',
      nl.every((r) => r.action === 'not-linked' && /not linked to a Pantessa room/.test(textOf(r.reply))) && chartAnywhere.action === 'chart' && buttonsOf(chartAnywhere.reply).length === 1 && privCalls.action === 'group-only' && w2.seats.size === 0,
    )
    // a store that throws: an apology for a command, silence otherwise; never the error.
    const broken = deps(w, api.call, { store: { ...w.store, listFeed: async () => { throw new Error('db: password=hunter2') } } })
    const apology = await handleUpdate(msg(GROUP, from(42), '/calls'), broken)
    check('community telegram (bot): a failing store earns a plain apology, never the error text', apology.action === 'error' && /not answering right now/.test(textOf(apology.reply)) && !/hunter2/.test(JSON.stringify(apology)))
    // slow quote: the reply does not wait past the budget (the fake resolves late; the race falls back to "no price").
    const slow = await handleUpdate(msg(GROUP, from(42), '/chart ETH'), deps(w, api.call, { quote: () => new Promise(() => {}), market: () => ({ symbol: 'ETH', label: 'ETH / USD' }) }))
    check('community telegram (bot): a quote that never arrives is cut at the budget and the chart still answers', slow.action === 'chart' && /No price right now/.test(textOf(slow.reply)))
  }

  // the bot's own seat
  {
    const w = fakeWorld()
    w.channels.set('-1001234567890', ROOM.slug)
    const d = deps(w, null)
    const mc = (status: string, over: Record<string, unknown> = {}) => ({ update_id: ++seq, my_chat_member: { chat: GROUP, from: from(42), date: NOW, old_chat_member: { status: 'member', user: { id: 7, is_bot: true } }, new_chat_member: { status, user: { id: 7, is_bot: true }, ...over } } })
    const demoted = await handleUpdate(mc('member'), d)
    const stillLinked = w.channels.size === 1
    const muted = await handleUpdate(mc('restricted', { can_send_messages: false }), d)
    w.channels.set('-1001234567890', ROOM.slug)
    const kicked = await handleUpdate(mc('kicked'), d)
    const leftAgain = await handleUpdate(mc('left'), d)
    w.channels.set('-1001234567890', ROOM.slug)
    const upgraded = await handleUpdate(msg(GROUP, from(42), '', { migrate_to_chat_id: -1005555 }), d)
    const cb = await handleUpdate({ update_id: 1, callback_query: { id: 'cb1', from: from(42), data: 'x' } }, d)
    check(
      'community telegram (bot): removed, banned or muted → the chat is unlinked (a demotion to member keeps it: the bot can still post); a group upgrade drops the link and says so in the new chat; a stray callback is acknowledged',
      demoted.action === 'membership' && stillLinked && muted.action === 'unlinked' && kicked.action === 'unlinked' && leftAgain.action === 'unlink-noop' && [demoted, muted, kicked, leftAgain].every((r) => r.reply === null) &&
        upgraded.action === 'unlinked-upgrade' && upgraded.reply?.chat_id === '-1005555' && w.channels.size === 0 && cb.reply?.method === 'answerCallbackQuery' && cb.reply.callback_query_id === 'cb1',
      `${demoted.action}/${muted.action}/${kicked.action}/${leftAgain.action}/${upgraded.action}`,
    )
  }

  // the outbound caller + the deliverer
  {
    const seen: { url: string; body: string }[] = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const call = telegramCaller(TOKEN, fetchImpl)
    const ok = await call('sendMessage', { chat_id: '1', text: 'x' })
    const refusedMethod = await call('banChatMember' as never, { chat_id: '1' })
    const noToken = await telegramCaller('', fetchImpl)('sendMessage', {})
    const throwing = await telegramCaller(TOKEN, (async () => { throw new Error(`fetch failed https://api.telegram.org/bot${TOKEN}/x`) }) as typeof fetch)('getMe', {})
    const refused = await telegramCaller(TOKEN, (async () => new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }), { status: 403 })) as typeof fetch)('sendMessage', {})
    check(
      'community telegram: ONE outbound door — api.telegram.org/bot<token>/<method> as JSON; a method off the list or a missing token never opens a socket; a failure resolves (never throws) and never echoes the token',
      ok.ok && seen.length === 1 && seen[0].url === `https://api.telegram.org/bot${TOKEN}/sendMessage` && JSON.parse(seen[0].body).chat_id === '1' && !refusedMethod.ok && !noToken.ok &&
        !throwing.ok && throwing.errorCode === 0 && !JSON.stringify(throwing).includes(TOKEN) && !refused.ok && refused.errorCode === 403 && chatIsGone(refused),
    )

    const channel = { id: 'c1', platform: 'telegram' as const, externalId: '-1001234567890', secret: null }
    const api = fakeCall({ sendMessage: { ok: true, result: { message_id: 1 } } })
    const unlinked: string[] = []
    const deliver = deliverTelegramWith({ links: CTX, call: api.call, unlink: async (id) => void unlinked.push(id) })
    const sent = await deliver(channel, { post: post({ kind: 'trade', proof: PROOF, linkSlug: 'abc123' }), community: ROOM })
    const p = api.calls[0]?.params as { chat_id: string; text: string; parse_mode: string; reply_markup: { inline_keyboard: { text: string; url: string }[][] } }
    const internal = await deliver(channel, { post: post({ isInternal: true }), community: ROOM })
    const wrongPlatform = await deliver({ ...channel, platform: 'discord' }, { post: post(), community: ROOM })
    const badChat = await deliver({ ...channel, externalId: '@evil' }, { post: post(), community: ROOM })
    const unconfigured = await deliverTelegramWith({ links: null, call: null, unlink: async () => {} })(channel, { post: post(), community: ROOM })
    const kicked = fakeCall({ sendMessage: { ok: false, errorCode: 403, description: 'Forbidden: bot was kicked from the supergroup chat' } })
    const gone = await deliverTelegramWith({ links: CTX, call: kicked.call, unlink: async (id) => void unlinked.push(id) })(channel, { post: post(), community: ROOM })
    const limited = fakeCall({ sendMessage: { ok: false, errorCode: 429, description: 'Too Many Requests' } })
    const flood = await deliverTelegramWith({ links: CTX, call: limited.call, unlink: async (id) => void unlinked.push(`x${id}`) })(channel, { post: post(), community: ROOM })
    const boom = await deliverTelegramWith({ links: CTX, call: async () => { throw new Error('boom') }, unlink: async () => {} })(channel, { post: post(), community: ROOM })
    check(
      'community telegram: the deliverer sends one message per post (kind line, title, author, Open / Trade this / Join), resolves false and never throws; an internal post, a wrong platform and a bad chat id send nothing; a kicked bot is unlinked, a rate limit is not',
      sent === true && api.calls.length === 1 && p.chat_id === '-1001234567890' && p.parse_mode === 'HTML' && /^<b>Verified on-chain: this wallet moved \$25\.00 on Base<\/b>/.test(p.text) && p.reply_markup.inline_keyboard.flat().map((b) => b.text).join('|') === 'Open|Trade this|The transaction|Join ETH Traders' &&
        p.reply_markup.inline_keyboard.flat().every((b) => isOurUrl(b.url, CTX) || b.url === PROOF.txUrl) && internal === false && wrongPlatform === false && badChat === false && unconfigured === false &&
        gone === false && unlinked.join() === '-1001234567890' && flood === false && boom === false,
      `sent=${sent} calls=${api.calls.length} unlinked=${unlinked.join()}`,
    )
  }

  // body cap
  {
    const big = new Request('http://x/', { method: 'POST', body: 'x'.repeat(WEBHOOK_BODY_MAX + 1) })
    const declared = { headers: new Headers({ 'content-length': String(WEBHOOK_BODY_MAX + 1) }), body: null } as unknown as Request
    const fine = new Request('http://x/', { method: 'POST', body: '{"a":1}' })
    check('community telegram: an update body past 64 KB is refused (by its declared length, or while reading) and a small one is read whole', (await readCapped(big, WEBHOOK_BODY_MAX)) === null && (await readCapped(declared, WEBHOOK_BODY_MAX)) === null && (await readCapped(fine, WEBHOOK_BODY_MAX)) === '{"a":1}')
  }
}

// ── served ─────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  if (process.env.DATABASE_URL && process.env.PRIVATE_KEY && process.env.SESSION_SECRET) return
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m || process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    }
  } catch {
    /* the harness already has its env */
  }
}

function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function signIn(base: string, account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`, { cache: 'no-store' })
  const nonceCookie = cookieOf(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) }, body: JSON.stringify({ message, signature }) })
  const session = cookieOf(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

const INTERNAL = { 'x-yf-internal-run': '1' }
type Json = Record<string, unknown> & { error?: string; unconfigured?: string }

async function http(base: string, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; raw?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...INTERNAL, ...(opts.body !== undefined || opts.raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.headers ?? {}) },
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    cache: 'no-store',
    redirect: 'manual',
  })
  const text = await res.text()
  let json: Json = {}
  try {
    json = JSON.parse(text) as Json
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, res }
}

/** Served pins: against a running `next start` (BASE) on the standard harness belt + the TEST DB.
 *  Every row written carries the internal-run header and is cleaned up. */
export async function communityTelegramPinsServed(check: Check, base: string): Promise<void> {
  await communityTelegramBotPins(check)

  const status = await http(base, 'GET', '/api/telegram/auth')
  const configured = status.json.configured === true
  const fake = process.env.TG_FAKE === '1'

  const tg = await http(base, 'GET', '/tg')
  check(
    'community telegram (served): /tg serves 200 with the outside-Telegram line in the HTML, and is not indexed',
    tg.status === 200 && tg.text.replace(/<!--.*?-->/g, '').includes(OUTSIDE_LINE) && /<meta name="robots" content="noindex/.test(tg.text),
    String(tg.status),
  )

  if (!configured) {
    const hook = await http(base, 'POST', '/api/telegram/webhook', { body: msg(GROUP, from(42), '/help'), headers: { 'x-telegram-bot-api-secret-token': 's3cr3t' } })
    const auth = await http(base, 'POST', '/api/telegram/auth', { body: { initData: initDataOf(INIT_FIELDS, TOKEN) } })
    const start = await http(base, 'GET', '/api/telegram/auth?start=eth-traders')
    const mint = await http(base, 'POST', '/api/communities/t-telegram-none/telegram', { body: {} })
    const unlink = await http(base, 'DELETE', '/api/communities/t-telegram-none/telegram')
    const room = await http(base, 'GET', '/api/communities/t-telegram-none/telegram')
    check(
      'community telegram (served, env unset): the webhook answers 503 naming TELEGRAM_WEBHOOK_SECRET even with a secret header (fail closed)',
      hook.status === 503 && hook.json.unconfigured === 'TELEGRAM_WEBHOOK_SECRET' && /TELEGRAM_WEBHOOK_SECRET/.test(hook.json.error ?? ''),
      String(hook.status),
    )
    check(
      'community telegram (served, env unset): sign-in answers 503 naming TELEGRAM_BOT_TOKEN and sets no cookie; the status says configured: false and names no bot',
      auth.status === 503 && auth.json.unconfigured === 'TELEGRAM_BOT_TOKEN' && cookieOf(auth.res, 'pt_ident') === null && status.status === 200 && status.json.configured === false && status.json.bot === null && status.json.miniApp === false,
      `${auth.status}/${status.status}`,
    )
    check(
      'community telegram (served, env unset): the join redirect, the link mint and the unlink each answer 503 by name; the room read answers 200 with nothing to show',
      start.status === 503 && start.json.unconfigured === 'TELEGRAM_BOT_TOKEN' && mint.status === 503 && mint.json.unconfigured === 'TELEGRAM_BOT_TOKEN' && unlink.status === 503 &&
        room.status === 200 && room.json.configured === false && room.json.joinUrl === null && Array.isArray(room.json.channels) && (room.json.channels as unknown[]).length === 0,
      `${start.status}/${mint.status}/${unlink.status}/${room.status}`,
    )
    return
  }
  if (!fake) {
    check('community telegram (served): a bot is configured on this server; the env-unset pins are skipped (run with TG_FAKE=1 against fake env for the verified paths)', true)
    return
  }

  // ── TG_FAKE=1: the server runs with a fake token / secret / bot name; the verified paths, end to end ──
  loadEnvLocal()
  const token = process.env.TG_FAKE_TOKEN ?? '123:fake'
  const secret = process.env.TG_FAKE_SECRET ?? 's3cr3t'
  const bot = String(status.json.bot ?? '')
  const ctx: LinkCtx = { site: SITE, bot, app: null }
  const hookHeaders = { 'x-telegram-bot-api-secret-token': secret }
  const hook = (update: unknown, headers: Record<string, string> = hookHeaders) => http(base, 'POST', '/api/telegram/webhook', { body: update, headers })
  const nowSec = Math.floor(Date.now() / 1000)
  const uid = 7_000_000_000 + Math.floor(Math.random() * 900_000_000)
  const vid = uid + 1
  const chat = { id: -1_000_000_000_000 - Math.floor(Math.random() * 900_000_000), type: 'supergroup', title: 'TG pin <group>' }
  const slug = `t-tgpins-${Date.now().toString(36)}` // S5: a slug may not carry "telegram"

  // webhook authentication
  const noHeader = await hook(msg(priv(uid), from(uid), '/help'), {})
  const wrong = await hook(msg(priv(uid), from(uid), '/help'), { 'x-telegram-bot-api-secret-token': `${secret}x` })
  const junk = await http(base, 'POST', '/api/telegram/webhook', { raw: '{not json', headers: hookHeaders })
  const huge = await http(base, 'POST', '/api/telegram/webhook', { raw: JSON.stringify({ pad: 'x'.repeat(70_000) }), headers: hookHeaders })
  const help = await hook(msg(priv(uid), from(uid), '/help'))
  const unknownChart = await hook(msg(priv(uid), from(uid), '/chart <b>ZZZNOPE</b>'))
  check(
    'community telegram (served, fake env): the webhook refuses no header and a wrong secret (401), ignores junk with a 200, refuses 70 KB (413), and answers /help in the response body',
    noHeader.status === 401 && wrong.status === 401 && junk.status === 200 && junk.res.headers.get('x-pt-action') === 'ignored' && huge.status === 413 &&
      help.status === 200 && help.json.method === 'sendMessage' && help.json.chat_id === String(uid) && /\/chart/.test(String(help.json.text)) && help.res.headers.get('x-pt-action') === 'help' &&
      unknownChart.res.headers.get('x-pt-action') === 'chart-unknown' && onlyOurTags(String(unknownChart.json.text)),
    `${noHeader.status}/${wrong.status}/${junk.status}/${huge.status}/${help.status}`,
  )

  // sign-in
  const fields = { auth_date: String(nowSec), query_id: 'AAF', start_param: `g_${slug}`, user: JSON.stringify({ id: vid, first_name: 'Vera', username: 'vera_pin' }) }
  const authOk = await http(base, 'POST', '/api/telegram/auth', { body: { initData: initDataOf(fields, token) } })
  const ident = cookieOf(authOk.res, 'pt_ident')
  const setCookie = (authOk.res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('pt_ident=')) ?? ''
  const authTampered = await http(base, 'POST', '/api/telegram/auth', { body: { initData: initDataOf({ ...fields, user: fields.user.replace(String(vid), '1') }, token, signInitData(fields, token)) } })
  const staleFields = { ...fields, auth_date: String(nowSec - 86_500) }
  const authStale = await http(base, 'POST', '/api/telegram/auth', { body: { initData: initDataOf(staleFields, token) } })
  const authForm = await http(base, 'POST', '/api/telegram/auth', { raw: JSON.stringify({ initData: initDataOf(fields, token) }), headers: { 'content-type': 'text/plain' } })
  const authCross = await http(base, 'POST', '/api/telegram/auth', { body: { initData: initDataOf(fields, token) }, headers: { origin: 'https://evil.example' } })
  const wFields = { auth_date: nowSec, first_name: 'Vera', id: vid, username: 'vera_pin' }
  const widgetOk = await http(base, 'POST', '/api/telegram/auth', { body: { ...wFields, hash: signWidget(wFields, token) } })
  const widgetBad = await http(base, 'POST', '/api/telegram/auth', { body: { ...wFields, id: 1, hash: signWidget(wFields, token) } })
  check(
    'community telegram (served, fake env): a signed initData and signed widget fields each mint the HttpOnly identity cookie; tampered, stale, non-JSON and cross-origin requests set no cookie (401 / 401 / 403 / 403)',
    authOk.status === 200 && !!ident && /HttpOnly/i.test(setCookie) && (authOk.json.identity as { id: string; p: string })?.id === String(vid) && (authOk.json.identity as { p: string }).p === 'tg' && authOk.json.startParam === `g_${slug}` &&
      authTampered.status === 401 && cookieOf(authTampered.res, 'pt_ident') === null && authStale.status === 401 && /day old/.test(authStale.json.error ?? '') && authForm.status === 403 && authCross.status === 403 && cookieOf(authCross.res, 'pt_ident') === null &&
      widgetOk.status === 200 && !!cookieOf(widgetOk.res, 'pt_ident') && widgetBad.status === 401,
    `${authOk.status}/${authTampered.status}/${authStale.status}/${authForm.status}/${authCross.status}/${widgetOk.status}/${widgetBad.status}`,
  )
  const start = await http(base, 'GET', `/api/telegram/auth?start=${slug}&via=abc12345`)
  const startBad = await http(base, 'GET', '/api/telegram/auth?start=Not%20A%20Slug')
  const startEvil = await http(base, 'GET', `/api/telegram/auth?start=${slug}&via=${encodeURIComponent('x&start=evil')}`)
  check(
    'community telegram (served, fake env): GET ?start=<slug> redirects to the bot\'s own join door (never an open redirect); a bad slug is a 400; a junk invite is dropped',
    start.status === 302 && start.res.headers.get('location') === `https://t.me/${bot}?start=g_${slug}__abc12345` && startBad.status === 400 && startEvil.status === 302 && startEvil.res.headers.get('location') === `https://t.me/${bot}?start=g_${slug}`,
    `${start.status} ${start.res.headers.get('location')}`,
  )

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    check('community telegram (served, fake env): the burner PRIVATE_KEY is in the env', false, 'not set')
    return
  }
  const { default: prisma } = await import('../lib/db')
  const A = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const B = privateKeyToAccount(generatePrivateKey())
  try {
    const sa = await signIn(base, A)
    const sb = await signIn(base, B)
    const created = await http(base, 'POST', '/api/communities', { headers: { cookie: sa }, body: { slug, name: 'TG <pin> room' } })
    const ownerInvite = ((await http(base, 'GET', `/api/communities/${slug}`, { headers: { cookie: sa } })).json.me as { invite: { code: string } } | null)?.invite.code ?? ''

    // minting the code
    const mintAnon = await http(base, 'POST', `/api/communities/${slug}/telegram`, { body: {} })
    const mintB = await http(base, 'POST', `/api/communities/${slug}/telegram`, { headers: { cookie: sb }, body: {} })
    const mintCross = await http(base, 'POST', `/api/communities/${slug}/telegram`, { headers: { cookie: sa, origin: 'https://evil.example' }, body: {} })
    const mint = await http(base, 'POST', `/api/communities/${slug}/telegram`, { headers: { cookie: sa }, body: {} })
    const code = String(mint.json.code ?? '')
    check(
      'community telegram (served, fake env): the link code — a stranger 401, a non-manager 403, a cross-origin post 403; the owner gets a 16-hex code, the add-to-group link carrying it, and the /link line',
      created.status === 201 && mintAnon.status === 401 && mintB.status === 403 && mintCross.status === 403 && mint.status === 200 && /^[a-f0-9]{16}$/.test(code) &&
        mint.json.addToGroupUrl === `https://t.me/${bot}?startgroup=${code}` && mint.json.linkCommand === `/link@${bot} ${code}` && mint.json.joinUrl === `https://t.me/${bot}?start=g_${slug}` && Number(mint.json.expiresAt) > Date.now(),
      `${created.status}/${mintAnon.status}/${mintB.status}/${mintCross.status}/${mint.status}`,
    )

    // linking: a person cannot be verified (Telegram refuses the fake token) → refused, the code survives.
    const byPerson = await hook(msg(chat, from(uid), `/start@${bot} ${code}`))
    const stillThere = await prisma.channelLinkCode.count({ where: { code } })
    const inPrivate = await hook(msg(priv(uid), from(uid), `/start ${code}`))
    // the group's own anonymous admin: proven by Telegram's update shape, no lookup → linked. The welcome cannot be sent out (fake token) → it rides the response.
    const byAnon = await hook(msg(chat, null, `/link ${code}`, anonAdmin(chat)))
    const linkedRow = await prisma.communityChannel.findFirst({ where: { communitySlug: slug, platform: 'telegram' } })
    const reuse = await hook(msg(chat, null, `/link ${code}`, anonAdmin(chat)))
    const roomRead = await http(base, 'GET', `/api/communities/${slug}/telegram`)
    check(
      'community telegram (served, fake env): with no word from Telegram a person\'s /start <code> links NOTHING and the code survives; a private chat is refused; the group\'s anonymous admin links it, and the welcome (one join button) rides the response',
      byPerson.res.headers.get('x-pt-action') === 'link-refused' && /could not check/.test(String(byPerson.json.text)) && stillThere === 1 && inPrivate.res.headers.get('x-pt-action') === 'link-refused' &&
        byAnon.res.headers.get('x-pt-action') === 'linked' && byAnon.json.method === 'sendMessage' && /TG &lt;pin&gt; room/.test(String(byAnon.json.text)) && buttonsOf(byAnon.json).length === 1 && buttonsOf(byAnon.json)[0].url === `https://t.me/${bot}?start=g_${slug}` &&
        linkedRow?.externalId === String(chat.id) && linkedRow.title === 'TG pin <group>' && reuse.res.headers.get('x-pt-action') === 'link-refused',
      `${byPerson.res.headers.get('x-pt-action')}/${inPrivate.res.headers.get('x-pt-action')}/${byAnon.res.headers.get('x-pt-action')}/${reuse.res.headers.get('x-pt-action')} codes=${stillThere}`,
    )
    check(
      'community telegram (served, fake env): the room read lists the linked chat by TITLE only (no chat id anywhere in the JSON) with the join link',
      roomRead.status === 200 && roomRead.json.configured === true && (roomRead.json.channels as { title: string }[])?.[0]?.title === 'TG pin <group>' && roomRead.json.joinUrl === `https://t.me/${bot}?start=g_${slug}` && !roomRead.text.includes(String(chat.id)) && !roomRead.text.includes(String(Math.abs(chat.id))),
      String(roomRead.status),
    )

    // the mass join: a private /start g_<slug>__<invite> from two accounts
    const join1 = await hook(msg(priv(uid), from(uid, { first_name: 'Uma', last_name: undefined, username: 'uma_pin' }), `/start g_${slug}__${ownerInvite}`))
    const join2 = await hook(msg(priv(uid), from(uid), `/start g_${slug}`))
    const seat = await prisma.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: slug, memberKey: `tg:${uid}` } } })
    const forged = await hook(msg(priv(uid), from(uid), `/start g_${slug} tg:${vid}`))
    const noRoom = await hook(msg(priv(uid), from(uid), '/start g_t-telegram-no-such-room'))
    check(
      'community telegram (served, fake env): a private /start g_<slug>__<invite> seats tg:<from.id> in the TEST DB (source telegram, the invite credited, internal), replies "You are in"; the second tap says "already in"; text after the payload seats nobody',
      join1.res.headers.get('x-pt-action') === 'joined' && /You are in/.test(String(join1.json.text)) && join2.res.headers.get('x-pt-action') === 'already-in' &&
        seat?.source === 'telegram' && seat.via === ownerInvite && seat.isInternal === true && seat.displayName === 'Uma' && seat.wallet === null &&
        forged.res.headers.get('x-pt-action') === 'start' && noRoom.res.headers.get('x-pt-action') === 'join-refused' &&
        (await prisma.communityMember.count({ where: { communitySlug: slug, memberKey: `tg:${vid}` } })) === 0,
      `${join1.res.headers.get('x-pt-action')}/${join2.res.headers.get('x-pt-action')}/${forged.res.headers.get('x-pt-action')}/${noRoom.res.headers.get('x-pt-action')} via=${seat?.via}`,
    )

    // the same account through the Mini App cookie is the SAME seat
    const uFields = { auth_date: String(nowSec), user: JSON.stringify({ id: uid, first_name: 'Uma' }) }
    const uAuth = await http(base, 'POST', '/api/telegram/auth', { body: { initData: initDataOf(uFields, token) } })
    const uCookie = cookieOf(uAuth.res, 'pt_ident')
    const sameSeat = await http(base, 'POST', `/api/communities/${slug}/join`, { headers: uCookie ? { cookie: uCookie } : {}, body: {} })
    const vJoin = await http(base, 'POST', `/api/communities/${slug}/join`, { headers: ident ? { cookie: ident } : {}, body: { via: ownerInvite } })
    check(
      'community telegram (served, fake env): the Mini App cookie and the bot agree on who a person is — the account the bot seated is "already joined" through /tg\'s cookie; a new account joins through the cookie alone (no wallet)',
      uAuth.status === 200 && sameSeat.status === 200 && sameSeat.json.joined === false && (sameSeat.json.me as { key: string })?.key === `tg:${uid}` && vJoin.status === 200 && vJoin.json.joined === true && (vJoin.json.me as { key: string })?.key === `tg:${vid}`,
      `${uAuth.status}/${sameSeat.status}/${vJoin.status}`,
    )

    // commands in the linked group, against the real store
    const gJoin = await hook(msg(chat, from(uid), '/join'))
    const gCalls = await hook(msg(chat, from(uid), '/calls'))
    const gTop = await hook(msg(chat, from(uid), `/top@${bot}`))
    const gInvite = await hook(msg(chat, from(uid), '/invite'))
    const umaCode = (await prisma.communityInvite.findUnique({ where: { communitySlug_inviterKey: { communitySlug: slug, inviterKey: `tg:${uid}` } } }))?.code ?? ''
    const gOther = await hook(msg(chat, from(uid), '/chart@some_other_bot ETH'))
    const group = [gJoin, gCalls, gTop, gInvite]
    check(
      'community telegram (served, fake env): /join /calls /top /invite in the linked group answer in the response with only our URLs; /invite carries the sender\'s own code on the button; another bot\'s command is not answered',
      group.every((r) => r.status === 200 && r.json.method === 'sendMessage' && r.json.chat_id === String(chat.id) && onlyOurTags(String(r.json.text)) && buttonsOf(r.json).every((b) => isOurUrl(b.url ?? '', ctx))) &&
        gCalls.res.headers.get('x-pt-action') === 'calls' && gTop.res.headers.get('x-pt-action') === 'top' && /^[a-z0-9]{6,12}$/.test(umaCode) && buttonsOf(gInvite.json)[0]?.url === `https://t.me/${bot}?start=g_${slug}__${umaCode}` &&
        gOther.res.headers.get('x-pt-action') === 'ignored' && gOther.json.method === undefined,
      group.map((r) => r.res.headers.get('x-pt-action')).join('/'),
    )

    // unlinking: the owner from the site, then the bot being removed
    const delB = await http(base, 'DELETE', `/api/communities/${slug}/telegram`, { headers: { cookie: sb } })
    const delA = await http(base, 'DELETE', `/api/communities/${slug}/telegram`, { headers: { cookie: sa } })
    const afterDelete = await prisma.communityChannel.count({ where: { communitySlug: slug } })
    const unlinkedCalls = await hook(msg(chat, from(uid), '/calls'))
    const mint2 = String((await http(base, 'POST', `/api/communities/${slug}/telegram`, { headers: { cookie: sa }, body: {} })).json.code ?? '')
    await hook(msg(chat, null, `/link ${mint2}`, anonAdmin(chat)))
    const relinked = await prisma.communityChannel.count({ where: { communitySlug: slug } })
    const removed = await hook({ update_id: ++seq, my_chat_member: { chat, from: from(uid), date: nowSec, old_chat_member: { status: 'member', user: { id: 7, is_bot: true } }, new_chat_member: { status: 'kicked', user: { id: 7, is_bot: true } } } })
    const afterKick = await prisma.communityChannel.count({ where: { communitySlug: slug } })
    check(
      'community telegram (served, fake env): unlink — a non-manager 403, the owner unlinks from the site (the chat then reads "not linked"); linked again, the bot being kicked unlinks it',
      delB.status === 403 && delA.status === 200 && delA.json.unlinked === 1 && afterDelete === 0 && unlinkedCalls.res.headers.get('x-pt-action') === 'not-linked' && relinked === 1 && removed.res.headers.get('x-pt-action') === 'unlinked' && afterKick === 0,
      `${delB.status}/${delA.status} ${afterDelete}/${relinked}/${afterKick}`,
    )
  } catch (e) {
    check('community telegram (served, fake env): the end-to-end block ran', false, e instanceof Error ? e.message : String(e))
  } finally {
    try {
      await prisma.communityMember.deleteMany({ where: { communitySlug: slug } })
      await prisma.communityInvite.deleteMany({ where: { communitySlug: slug } })
      await prisma.communityChannel.deleteMany({ where: { communitySlug: slug } })
      await prisma.channelLinkCode.deleteMany({ where: { communitySlug: slug } })
      await prisma.community.deleteMany({ where: { slug } })
      const left = (await prisma.community.count({ where: { slug } })) + (await prisma.communityMember.count({ where: { OR: [{ communitySlug: slug }, { memberKey: { in: [`tg:${uid}`, `tg:${vid}`] } }] } })) + (await prisma.communityChannel.count({ where: { externalId: String(chat.id) } }))
      check('community telegram (served, fake env): cleanup — every row this run wrote is gone', left === 0, `left=${left}`)
    } catch (e) {
      check('community telegram (served, fake env): cleanup', false, e instanceof Error ? e.message : String(e))
    }
  }
}

if (process.argv[1]?.endsWith('community-telegram-pins.ts')) {
  let failed = 0
  let count = 0
  const check: Check = (name, ok, extra) => {
    count++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => communityTelegramPins(check))
    .then(() => communityTelegramBotPins(check))
    .then(() => (served ? communityTelegramPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} of ${count} failed` : `\nall green (${count})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
