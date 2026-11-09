// Pins for squad community, lane DISCORD (2026-11-09). The lane owns this
// file and fills it; the harness (scripts/test-api.ts) already calls both
// exports, so a lane never edits test-api.ts or package.json.
//   npx tsx scripts/community-discord-pins.ts            (npm run pins:community-discord)
//   BASE=http://localhost:PORT npx tsx scripts/community-discord-pins.ts --served
//   DC_FAKE=1 … --served   against a server started with DISCORD_PUBLIC_KEY=<the fake key below>
//                           (print it: npx tsx scripts/community-discord-pins.ts --print-fake-key)

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseDiscordWebhookUrl, readWebhookObject } from '../lib/discord/webhook'
import { verifyDiscordSignature, ed25519PublicKeyFromHex } from '../lib/discord/verify'
import { discordAnnouncement, escapeDiscord, plainDiscord, urlsIn, kindLine, DISCORD_EMBED_COLOR } from '../lib/discord/format'
import { handleInteraction, readCommand, hasManagePermission, discordCommandSpec, HOW_TO_LINK, EPHEMERAL, type InteractionDeps } from '../lib/discord/interactions'
import { pickChannelToUnlink } from '../lib/discord/pick'
import { deliverDiscordWith, type DeliverDeps } from '../lib/community/deliver-discord'
import { BOT_COMMANDS, type FeedPost, type PublicCommunity } from '../lib/community/spec'

type Check = (name: string, ok: boolean, extra?: string) => void

const SITE = 'https://www.pantessa.com'
const ID = '123456789012345678'
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz01'
const GOOD = `https://discord.com/api/webhooks/${ID}/${TOKEN}`

// A FIXED test keypair (seed below) so a served run can be started with its public half.
const FAKE_SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const fakePriv = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(FAKE_SEED_HEX, 'hex')]), format: 'der', type: 'pkcs8' })
const rawPub = (k: KeyObject) => (k.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex')
export const FAKE_PUBLIC_KEY_HEX = rawPub(createPublicKey(fakePriv))
const signWith = (priv: KeyObject, ts: string, body: string) => edSign(null, Buffer.from(ts + body), priv).toString('hex')

const room: PublicCommunity = { slug: 't-discord-room', name: 'Tape Readers', about: '', symbols: ['ETH'], members: 3, postsWeek: 1, channels: [], ownerLabel: '@nate', createdAt: 1 }

function post(over: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'cmpost123abc',
    symbol: 'ETH',
    kind: 'idea',
    title: 'ETH holds the range',
    body: '',
    chartState: null,
    asks: [],
    linkSlug: 'abc123xy',
    linkUrl: null,
    forkOf: null,
    author: '0x' + 'a'.repeat(40),
    authorLabel: '@nate',
    createdAt: Date.UTC(2026, 10, 9),
    comments: 0,
    executedBy: 0,
    isInternal: false,
    community: { slug: room.slug, name: room.name },
    mediaUrl: null,
    video: null,
    proof: null,
    score: 1,
    myVote: 0,
    ...over,
  } as FeedPost
}

/** Pure pins: no server, no network, no DB. */
export function communityDiscordPins(check: Check): void {
  // ── the webhook URL fence ──
  const accept: [string, string][] = [
    ['plain', GOOD],
    ['discordapp.com', `https://discordapp.com/api/webhooks/${ID}/${TOKEN}`],
    ['canary.', `https://canary.discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['ptb.', `https://ptb.discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['v10 segment', `https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`],
    ['trailing slash', `${GOOD}/`],
    ['surrounding spaces', `  ${GOOD}  `],
    ['HOST CASE', `https://DISCORD.com/api/webhooks/${ID}/${TOKEN}`],
  ]
  for (const [name, url] of accept) {
    const p = parseDiscordWebhookUrl(url)
    check(`discord webhook: accepts ${name}, rebuilt on discord.com`, !!p && p.url === GOOD && p.id === ID && p.token === TOKEN, p?.url)
  }
  const refuse: [string, unknown][] = [
    ['http', `http://discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['lookalike suffix host', `https://discord.com.evil.example/api/webhooks/${ID}/${TOKEN}`],
    ['host in the path', `https://evil.example/discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['userinfo', `https://discord.com@evil.example/api/webhooks/${ID}/${TOKEN}`],
    ['userinfo on discord', `https://user:pw@discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['port', `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`],
    ['port 443 spelled', `https://discord.com:443/api/webhooks/${ID}/${TOKEN}x`],
    ['query', `${GOOD}?wait=true`],
    ['fragment', `${GOOD}#x`],
    ['short id', `https://discord.com/api/webhooks/12345/${TOKEN}`],
    ['short token', `https://discord.com/api/webhooks/${ID}/abc`],
    ['extra path', `${GOOD}/slack`],
    ['dot-dot', `https://discord.com/api/webhooks/../webhooks/${ID}/${TOKEN}`],
    ['other subdomain', `https://cdn.discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['trailing dot host', `https://discord.com./api/webhooks/${ID}/${TOKEN}`],
    ['javascript:', `javascript:alert(1)//discord.com/api/webhooks/${ID}/${TOKEN}`],
    ['backslash', `https://discord.com\\@evil.example/api/webhooks/${ID}/${TOKEN}`],
    ['not a string', { url: GOOD }],
    ['empty', ''],
    ['messages path', `https://discord.com/api/channels/${ID}/messages`],
  ]
  for (const [name, url] of refuse) check(`discord webhook: refuses ${name}`, parseDiscordWebhookUrl(url) === null)
  check('discord webhook: object read keeps channel id + name', JSON.stringify(readWebhookObject({ id: ID, channel_id: '223456789012345678', guild_id: '323456789012345678', name: 'calls\u0007' }, ID)) === JSON.stringify({ channelId: '223456789012345678', guildId: '323456789012345678', name: 'calls' }))
  check('discord webhook: object with another id is refused', readWebhookObject({ id: '999999999999999999', channel_id: '223456789012345678', name: 'x' }, ID) === null)

  // ── the signature ──
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = rawPub(publicKey)
  const now = Math.floor(Date.now() / 1000)
  const ts = String(now)
  const body = JSON.stringify({ type: 1 })
  const sig = signWith(privateKey, ts, body)
  check('discord sig: a real signature verifies', verifyDiscordSignature(pub, sig, ts, body, now))
  check('discord sig: tampered body refused', !verifyDiscordSignature(pub, sig, ts, body.replace('1', '2'), now))
  check('discord sig: another timestamp refused', !verifyDiscordSignature(pub, sig, String(now - 1), body, now))
  check('discord sig: stale (10 min) refused even when signed', !verifyDiscordSignature(pub, signWith(privateKey, String(now - 600), body), String(now - 600), body, now))
  check('discord sig: another key refused', !verifyDiscordSignature(rawPub(generateKeyPairSync('ed25519').publicKey), sig, ts, body, now))
  check('discord sig: malformed signature hex refused', !verifyDiscordSignature(pub, 'zz' + sig.slice(2), ts, body, now) && !verifyDiscordSignature(pub, sig.slice(0, 100), ts, body, now))
  check('discord sig: missing headers refused', !verifyDiscordSignature(pub, null, ts, body, now) && !verifyDiscordSignature(pub, sig, null, body, now))
  check('discord sig: malformed public key refused', !verifyDiscordSignature('nothex', sig, ts, body, now) && ed25519PublicKeyFromHex('ab') === null)
  check('discord sig: fixed fake key is 32 bytes hex', /^[0-9a-f]{64}$/.test(FAKE_PUBLIC_KEY_HEX))

  // ── escaping ──
  const e = escapeDiscord('@everyone **buy** <@123> [x](https://evil.example) `a` ~b~ _c_ |d| > e #f')
  check('discord escape: @everyone cannot ping', !/@everyone/.test(e) && e.includes('\\@\u200beveryone'), e)
  check('discord escape: user mention broken', !e.includes('<@123>') && !plainDiscord('<@123> <#9> <@&7>').match(/<[@#]/))
  check('discord escape: markdown escaped', e.includes('\\*\\*buy\\*\\*') && e.includes('\\[x\\]') && e.includes('\\`a\\`') && e.includes('\\~b\\~') && e.includes('\\_c\\_') && e.includes('\\|d\\|') && e.includes('\\> e') && e.includes('\\#f'))
  check('discord escape: a poster URL never autolinks', !/https:\/\/evil/.test(e))
  check('discord escape: control + bidi stripped', escapeDiscord('a\u0000b\u202ec') === 'abc')
  check('discord escape: @here broken in plain text', !plainDiscord('hi @here').includes('@here'))
  check('discord escape: clipped never ends on a lone backslash', !/[^\\]\\…$/.test(escapeDiscord('*'.repeat(300), 51)))

  // ── the announcement ──
  for (const [kind, extra, want] of [
    ['idea', {}, 'Chart idea'],
    ['video', {}, 'Video'],
    ['link', {}, 'Link'],
    ['trade', {}, 'Trade'],
    ['trade', { proof: { turnId: 't', symbols: ['buy:ETH'], side: 'buy', sizeUsd: 25, chain: 'base', txUrl: null, signedAt: 1, verification: 'verified' } }, 'Trade, verified on-chain'],
  ] as const) {
    const p = post({ kind, ...(extra as Partial<FeedPost>) })
    const m = discordAnnouncement(p, room, SITE)
    const d = m.embeds[0]?.description ?? ''
    check(`discord announce (${want}): kind line`, kindLine(p) === want && d.startsWith(want))
  }
  check('discord announce: "verified" only with a verified proof', !discordAnnouncement(post({ kind: 'trade', proof: null }), room, SITE).embeds[0].description.includes('verified'))
  const evil = post({ title: '@everyone [free](https://evil.example) <@&1234567890>', authorLabel: '@here' })
  const m = discordAnnouncement(evil, room, SITE)
  const blob = JSON.stringify(m)
  check('discord announce: allowed_mentions.parse = []', Array.isArray(m.allowed_mentions.parse) && m.allowed_mentions.parse.length === 0)
  check('discord announce: an @everyone title cannot ping', !/@everyone|@here|<@&\d/.test(blob.replace(/\\\\/g, '')))
  check('discord announce: every URL is ours', urlsIn(m).length >= 3 && urlsIn(m).every((u) => u.startsWith(`${SITE}/`)), urlsIn(m).join(' '))
  check('discord announce: links Open + Trade this + Join', /\[Open\]\(https:\/\/www\.pantessa\.com\/c\/cmpost123abc\)/.test(m.embeds[0].description) && m.embeds[0].description.includes(`(${SITE}/i/abc123xy)`) && m.embeds[0].description.includes(`(${SITE}/g/t-discord-room)`))
  check('discord announce: one embed, emerald, footer names the room', m.embeds.length === 1 && m.embeds[0].color === DISCORD_EMBED_COLOR && DISCORD_EMBED_COLOR === 0x3ecf8e && m.embeds[0].footer.text === 'Tape Readers on Pantessa')
  check('discord announce: webhook shape carries no components', !m.components)
  check('discord announce: title ≤ 256', discordAnnouncement(post({ title: 'x'.repeat(900) }), room, SITE).embeds[0].title.length <= 256)
  const bot = discordAnnouncement(post({ linkSlug: null }), room, SITE, { buttons: true })
  check('discord announce: bot shape = link buttons on our site, no Trade without a link', bot.components?.[0].components.map((b) => b.label).join('|') === 'Open|Join Tape Readers' && urlsIn(bot).every((u) => u.startsWith(`${SITE}/`)))
  check('discord announce: an unsafe linkSlug is never a URL', !JSON.stringify(discordAnnouncement(post({ linkSlug: '../../x' }), room, SITE)).includes('/i/'))

  // ── the commands ──
  const spec = discordCommandSpec()
  check('discord commands: one /pantessa with a subcommand per BOT_COMMANDS', spec.length === 1 && spec[0].name === 'pantessa' && spec[0].options.map((o) => o.name).join() === BOT_COMMANDS.map((c) => c.name).join() && spec[0].options.every((o) => o.type === 1 && o.description.length <= 100))
  check('discord commands: chart takes a required symbol, link a code', JSON.stringify(spec[0].options.find((o) => o.name === 'chart')).includes('"name":"symbol"') && JSON.stringify(spec[0].options.find((o) => o.name === 'link')).includes('"required":true'))
  check('discord commands: read subcommand + arg', JSON.stringify(readCommand({ name: 'pantessa', options: [{ type: 1, name: 'chart', options: [{ name: 'symbol', type: 3, value: ' eth ' }] }] })) === '{"name":"chart","arg":"eth"}')
  check('discord commands: unknown subcommand refused', readCommand({ name: 'pantessa', options: [{ type: 1, name: 'rm' }] }) === null)
  check('discord perms: MANAGE_GUILD (0x20) and ADMINISTRATOR (0x8) pass', hasManagePermission('32') && hasManagePermission('8') && hasManagePermission(String(BigInt(1) << BigInt(40) | BigInt(32))))
  check('discord perms: SEND_MESSAGES alone, junk, number refused', !hasManagePermission('2048') && !hasManagePermission('abc') && !hasManagePermission(32))
  check('discord unlink pick: by title from the room rows; one row = that row; ambiguous = none', pickChannelToUnlink([{ externalId: '1', title: 'a', webhook: true }, { externalId: '2', title: 'b', webhook: true }], 'b')?.externalId === '2' && pickChannelToUnlink([{ externalId: '1', title: 'a', webhook: true }], undefined)?.externalId === '1' && pickChannelToUnlink([{ externalId: '1', title: 'a', webhook: true }, { externalId: '2', title: 'b', webhook: true }], undefined) === null && pickChannelToUnlink([{ externalId: '1', title: 'a', webhook: true }], 'zzz') === null)
}

/** The interaction handler over fixtures (async; pure: injected store, no network). */
export async function communityDiscordHandlerPins(check: Check): Promise<void> {
  const LINKED = '423456789012345678'
  const calls: string[] = []
  const deps: InteractionDeps = {
    site: SITE,
    communityOfChannel: async (id) => (id === LINKED ? room : null),
    listFeed: async () => ({ posts: [post(), post({ id: 'cmpost2', title: '@everyone pump', authorLabel: '0xabcd…1234' })] }),
    listMembers: async (_s, o) => (o.sort === 'invites' ? [{ label: '@nate', role: 'owner', source: 'site', invited: 4, verifiedTrades: 1, joinedAt: 1 }] : [{ label: '@here', role: 'member', source: 'discord', invited: 0, verifiedTrades: 2, joinedAt: 1 }]),
    redeemLinkCode: async (code, chat) => {
      calls.push(`redeem:${code}:${chat.externalId}:${chat.title}`)
      return { ok: true, community: room }
    },
    chartQuote: async (s) => (s === 'ETH' ? { symbol: 'ETH', label: 'ETH / USD', last: 2365.1, chgPct: 1.234 } : s === 'SLOW' ? new Promise(() => {}) : null),
    budgetMs: 150,
  }
  const cmd = (name: string, value?: string, over: Record<string, unknown> = {}) => ({
    type: 2,
    channel_id: LINKED,
    guild_id: '523456789012345678',
    channel: { id: LINKED, name: 'calls' },
    member: { permissions: '2048', user: { id: '623456789012345678' } },
    data: { name: 'pantessa', options: [{ type: 1, name, ...(value !== undefined ? { options: [{ name: 'x', type: 3, value }] } : {}) }] },
    ...over,
  })
  const all: unknown[] = []
  const run = async (i: unknown) => {
    const r = await handleInteraction(i, deps)
    all.push(r)
    return r
  }

  check('discord ix: PING → PONG', JSON.stringify(await run({ type: 1 })) === '{"type":1}')
  const chart = await run(cmd('chart', 'eth'))
  check('discord ix: chart ETH → price line + chart button', chart?.type === 4 && chart.data!.content.includes('$2,365.10') && chart.data!.content.includes('+1.23%') && chart.data!.components?.[0].components[0].url === `${SITE}/t/ETH`)
  const slow = await run(cmd('chart', 'slow'))
  check('discord ix: chart on a slow read answers with links, no price, inside the budget', slow?.type === 4 && !slow.data!.content.includes('$') && slow.data!.components?.[0].components[0].url === `${SITE}/t/SLOW`)
  const none = await run(cmd('chart', 'nope'))
  check('discord ix: chart with no pair says so', none?.data?.content.startsWith('No chart for NOPE') === true)
  check('discord ix: chart with junk asks for a market', (await run(cmd('chart', '<@1>')))?.data?.flags === EPHEMERAL)
  const callsR = await run(cmd('calls'))
  const callsD = callsR?.data?.embeds?.[0].description ?? ''
  check('discord ix: calls lists the newest ideas with /c links', callsD.includes(`(${SITE}/c/cmpost123abc)`) && callsD.split('\n').length === 2 && !/@everyone/.test(callsD))
  const top = await run(cmd('top'))
  const topD = top?.data?.embeds?.[0].description ?? ''
  check('discord ix: top shows both boards, labels escaped', topD.includes('@nate'.replace('@', '\\@\u200b')) && topD.includes('4 joined') && topD.includes('2 verified') && !topD.includes('@here'))
  const join = await run(cmd('join'))
  check('discord ix: join is ephemeral with the room button', join?.data?.flags === EPHEMERAL && join.data.components?.[0].components[0].url === `${SITE}/g/t-discord-room`)
  const inv = await run(cmd('invite'))
  check('discord ix: invite is ephemeral and points at Share on the site', inv?.data?.flags === EPHEMERAL && /tap Share/.test(inv.data.content))
  const noPerm = await run(cmd('link', 'a'.repeat(16)))
  check('discord ix: link without Manage Server refused, store never called', noPerm?.data?.flags === EPHEMERAL && /Manage Server/.test(noPerm.data.content) && calls.length === 0)
  const badCode = await run(cmd('link', 'not-a-code', { member: { permissions: '32' } }))
  check('discord ix: link with a bad code refused, store never called', /not a link code/.test(badCode?.data?.content ?? '') && calls.length === 0)
  const dm = await run(cmd('link', 'a'.repeat(16), { guild_id: undefined, member: undefined, user: { id: '1' } }))
  check('discord ix: link from a DM refused', /not a DM/.test(dm?.data?.content ?? '') && calls.length === 0)
  const ok = await run(cmd('link', 'ABCDEF0123456789', { member: { permissions: '8' } }))
  check('discord ix: link with ADMINISTRATOR redeems for THIS channel', /Linked to \*\*Tape Readers\*\*/.test(ok?.data?.content ?? '') && calls[0] === `redeem:abcdef0123456789:${LINKED}:#calls`)
  const unlinked = await run(cmd('calls', undefined, { channel_id: '723456789012345678', channel: { id: '723456789012345678' } }))
  check('discord ix: unlinked channel → how to link, ephemeral', unlinked?.data?.content === HOW_TO_LINK && unlinked.data.flags === EPHEMERAL)
  const broken = await handleInteraction(cmd('calls'), { ...deps, communityOfChannel: async () => { throw new Error('lane CORE lands this') } })
  check('discord ix: a store that throws answers a line, never a 500', broken?.type === 4 && /could not read/.test(broken.data!.content))
  check('discord ix: unknown command refused politely', (await run({ type: 2, data: { name: 'other' } }))?.data?.flags === EPHEMERAL)
  check('discord ix: allowed_mentions.parse = [] on every response', all.filter((r) => (r as { type: number }).type === 4).every((r) => JSON.stringify((r as { data: { allowed_mentions: unknown } }).data.allowed_mentions) === '{"parse":[]}'))
  const urls = all.flatMap((r) => urlsIn(((r as { data?: object }).data ?? {}) as Parameters<typeof urlsIn>[0]))
  check('discord ix: every URL emitted is ours', urls.length > 5 && urls.every((u) => u.startsWith(`${SITE}/`)), urls.filter((u) => !u.startsWith(SITE)).join(' '))

  // ── delivery over a mocked fetch ──
  const sent: { url: string; init: RequestInit }[] = []
  const unlinked2: string[] = []
  let status = 200
  const dd: DeliverDeps = {
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), init })
      return new Response('{}', { status })
    }) as unknown as typeof fetch,
    unlink: async (x) => unlinked2.push(x),
    botToken: null,
    site: SITE,
  }
  const ch = { id: 'c1', platform: 'discord' as const, externalId: '823456789012345678', secret: GOOD }
  const a = { post: post({ title: '@everyone' }), community: room }
  check('discord deliver: webhook → true', (await deliverDiscordWith(dd, ch, a)) === true)
  const s0 = sent[0]
  const b0 = JSON.parse(String(s0?.init.body ?? '{}'))
  check('discord deliver: posts the REBUILT url with ?wait=true, redirect error', s0?.url === `${GOOD}?wait=true` && s0.init.redirect === 'error' && s0.init.method === 'POST')
  check('discord deliver: body has allowed_mentions [] and one embed', JSON.stringify(b0.allowed_mentions) === '{"parse":[]}' && b0.embeds.length === 1)
  sent.length = 0
  check('discord deliver: a poisoned secret is never fetched', (await deliverDiscordWith(dd, { ...ch, secret: 'https://evil.example/api/webhooks/1/2' }, a)) === false && sent.length === 0)
  check('discord deliver: a variant secret is re-fenced to discord.com', (await deliverDiscordWith(dd, { ...ch, secret: `https://discordapp.com/api/webhooks/${ID}/${TOKEN}` }, a)) && sent[0]?.url === `${GOOD}?wait=true`)
  status = 404
  check('discord deliver: 404 → false + the channel unlinks', (await deliverDiscordWith(dd, ch, a)) === false && unlinked2[0] === ch.externalId)
  status = 500
  unlinked2.length = 0
  check('discord deliver: 500 → false, stays linked', (await deliverDiscordWith(dd, ch, a)) === false && unlinked2.length === 0)
  sent.length = 0
  status = 200
  check('discord deliver: bot-linked channel with no token → false, no fetch', (await deliverDiscordWith(dd, { ...ch, secret: null }, a)) === false && sent.length === 0)
  check('discord deliver: bot token → /channels/<id>/messages with link buttons', (await deliverDiscordWith({ ...dd, botToken: 'tok' }, { ...ch, secret: null }, a)) && sent[0]?.url === `https://discord.com/api/v10/channels/${ch.externalId}/messages` && (sent[0].init.headers as Record<string, string>).authorization === 'Bot tok' && JSON.parse(String(sent[0].init.body)).components[0].components.length === 3)
  status = 401
  unlinked2.length = 0
  check('discord deliver: bot 401 is OUR token, never unlinks', (await deliverDiscordWith({ ...dd, botToken: 'tok' }, { ...ch, secret: null }, a)) === false && unlinked2.length === 0)
  check('discord deliver: a telegram row is not ours', (await deliverDiscordWith(dd, { ...ch, platform: 'telegram' }, a)) === false)
  const throwing = { ...dd, fetch: (async () => { throw new Error('boom') }) as unknown as typeof fetch }
  check('discord deliver: a throw resolves false', (await deliverDiscordWith(throwing, ch, a)) === false)

  // ── source fences: the secret never leaves ──
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const route = src('app/api/communities/[slug]/discord/route.ts')
  const jsonCalls = route.match(/NextResponse\.json\([^)]*\)/g) ?? []
  check('discord source: no route answer carries the URL, token or secret', jsonCalls.length > 3 && jsonCalls.every((c) => !/hook\.|secret|token|webhookUrl/.test(c)) && !/console\./.test(route))
  const deliver = src('lib/community/deliver-discord.ts')
  check('discord source: delivery logs status only', (deliver.match(/console\.warn\([^)]*\)/g) ?? []).every((c) => !/hook\.|secret|\burl\b|token/i.test(c)))
  check('discord source: every fetch to Discord says redirect: error', [route, deliver, src('scripts/discord-register-commands.ts')].every((f) => (f.match(/await (?:deps\.)?fetch\(/g) ?? []).length === (f.match(/redirect: 'error',/g) ?? []).length))
  const ix = src('app/api/discord/interactions/route.ts')
  check('discord source: interactions read the RAW body before parsing, capped', ix.indexOf('req.text()') > 0 && ix.indexOf('verifyDiscordSignature(key') > ix.indexOf('req.text()') && ix.indexOf('JSON.parse') > ix.indexOf('verifyDiscordSignature(key') && /64 \* 1024/.test(ix) && /runtime = 'nodejs'/.test(ix))
}

const INTERNAL = { 'x-yf-internal-run': '1' }

function envGet(k: string): string | null {
  if (process.env[k]) return process.env[k] as string
  try {
    const env = readFileSync('.env.local', 'utf8')
    return env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null
  } catch {
    return null
  }
}

async function siweCookie(base: string): Promise<string | null> {
  const pk = envGet('PRIVATE_KEY')
  if (!pk) return null
  const { privateKeyToAccount } = await import('viem/accounts')
  const { createSiweMessage } = await import('viem/siwe')
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const n = await fetch(`${base}/api/auth/nonce`, { headers: INTERNAL })
  const nonceCookie = (n.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('yf_siwe_nonce='))
  const { nonce } = (await n.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const v = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...INTERNAL, ...(nonceCookie ? { cookie: nonceCookie } : {}) }, body: JSON.stringify({ message, signature }) })
  return (v.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('yf_session=')) ?? null
}

/** Served pins: against a running `next start` (BASE) on the standard harness belt + the TEST DB.
 *  This lane writes no rows (linking needs CORE's store); nothing to clean up. */
export async function communityDiscordPinsServed(check: Check, base: string): Promise<void> {
  // The handler + delivery pins are async, so they ride here (the harness calls this export).
  await communityDiscordHandlerPins(check)
  const J = { 'content-type': 'application/json', ...INTERNAL }
  const ix = `${base}/api/discord/interactions`
  const slug = 't-discord-pins'
  const roomUrl = `${base}/api/communities/${slug}/discord`
  const fake = process.env.DC_FAKE === '1'

  if (!fake) {
    const r = await fetch(ix, { method: 'POST', headers: J, body: '{"type":1}' })
    const j = (await r.json().catch(() => ({}))) as { error?: string; unconfigured?: string }
    check('discord served: interactions with no key = 503 naming DISCORD_PUBLIC_KEY', r.status === 503 && j.unconfigured === 'DISCORD_PUBLIC_KEY' && /DISCORD_PUBLIC_KEY/.test(j.error ?? ''), `${r.status}`)
  } else {
    const body = JSON.stringify({ type: 1 })
    const ts = String(Math.floor(Date.now() / 1000))
    const unsigned = await fetch(ix, { method: 'POST', headers: J, body })
    check('discord served (fake key): unsigned = 401', unsigned.status === 401, `${unsigned.status}`)
    const bad = await fetch(ix, { method: 'POST', headers: { ...J, 'x-signature-ed25519': signWith(fakePriv, ts, body).replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), 'x-signature-timestamp': ts }, body })
    check('discord served (fake key): bad signature = 401', bad.status === 401, `${bad.status}`)
    const tampered = await fetch(ix, { method: 'POST', headers: { ...J, 'x-signature-ed25519': signWith(fakePriv, ts, body), 'x-signature-timestamp': ts }, body: body + ' ' })
    check('discord served (fake key): signed then tampered = 401', tampered.status === 401, `${tampered.status}`)
    const ping = await fetch(ix, { method: 'POST', headers: { ...J, 'x-signature-ed25519': signWith(fakePriv, ts, body), 'x-signature-timestamp': ts }, body })
    check('discord served (fake key): signed PING = PONG', ping.status === 200 && JSON.stringify(await ping.json()) === '{"type":1}', `${ping.status}`)
    const cmdBody = JSON.stringify({ type: 2, channel_id: '923456789012345678', guild_id: '523456789012345678', member: { permissions: '0' }, data: { name: 'pantessa', options: [{ type: 1, name: 'join' }] } })
    const c = await fetch(ix, { method: 'POST', headers: { ...J, 'x-signature-ed25519': signWith(fakePriv, ts, cmdBody), 'x-signature-timestamp': ts }, body: cmdBody })
    const cj = (await c.json().catch(() => ({}))) as { type?: number; data?: { content?: string; flags?: number; allowed_mentions?: unknown } }
    check('discord served (fake key): signed command in an unlinked channel answers a line', c.status === 200 && cj.type === 4 && cj.data?.flags === EPHEMERAL && JSON.stringify(cj.data?.allowed_mentions) === '{"parse":[]}', `${c.status} ${cj.data?.content?.slice(0, 60)}`)
    const big = 'x'.repeat(70 * 1024)
    const huge = await fetch(ix, { method: 'POST', headers: { ...J, 'x-signature-ed25519': signWith(fakePriv, ts, big), 'x-signature-timestamp': ts }, body: big })
    check('discord served (fake key): a 70KB body is refused before verify', huge.status === 413, `${huge.status}`)
  }

  const g = await fetch(roomUrl, { headers: INTERNAL })
  const gj = (await g.json().catch(() => ({}))) as { configured?: { webhooks?: boolean; app?: boolean }; channels?: unknown[] }
  check('discord served: GET names what is configured, no secrets', g.status === 200 && gj.configured?.webhooks === true && gj.configured?.app === false && Array.isArray(gj.channels), `${g.status}`)
  const s = await fetch(roomUrl, { method: 'POST', headers: J, body: JSON.stringify({ webhookUrl: GOOD }) })
  check('discord served: a stranger cannot link (401)', s.status === 401, `${s.status}`)
  const sd = await fetch(roomUrl, { method: 'DELETE', headers: J, body: '{}' })
  check('discord served: a stranger cannot unlink (401)', sd.status === 401, `${sd.status}`)

  const cookie = await siweCookie(base).catch(() => null)
  check('discord served: SIWE as the burner', !!cookie)
  if (cookie) {
    const H = { ...J, cookie }
    for (const [name, url] of [
      ['a non-Discord URL', `https://evil.example/api/webhooks/${ID}/${TOKEN}`],
      ['a lookalike host', `https://discord.com.evil.example/api/webhooks/${ID}/${TOKEN}`],
      ['http', `http://discord.com/api/webhooks/${ID}/${TOKEN}`],
    ] as const) {
      const r = await fetch(roomUrl, { method: 'POST', headers: H, body: JSON.stringify({ webhookUrl: url }) })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      check(`discord served: ${name} = 400 by name`, r.status === 400 && /Discord webhook URL/.test(j.error ?? ''), `${r.status} ${j.error}`)
    }
    const mc = await fetch(roomUrl, { method: 'POST', headers: H, body: JSON.stringify({ mintCode: true }) })
    const mj = (await mc.json().catch(() => ({}))) as { unconfigured?: string }
    check('discord served: a link code with no app = 503 naming DISCORD_APP_ID', mc.status === 503 && mj.unconfigured === 'DISCORD_APP_ID', `${mc.status}`)
    const nm = await fetch(`${base}/api/communities/${slug}-nobody-owns/discord`, { method: 'POST', headers: H, body: JSON.stringify({ webhookUrl: GOOD }) })
    check('discord served: a non-manager with a valid URL is refused before any Discord fetch (403, or 503 until CORE)', nm.status === 403 || nm.status === 503, `${nm.status}`)
  }
}

if (process.argv[1]?.endsWith('community-discord-pins.ts')) {
  if (process.argv.includes('--print-fake-key')) {
    console.log(FAKE_PUBLIC_KEY_HEX)
    process.exit(0)
  }
  let failed = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => communityDiscordPins(check))
    .then(() => (served ? communityDiscordPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : communityDiscordHandlerPins(check)))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : '\nall green')
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
