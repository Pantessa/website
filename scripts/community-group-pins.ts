// Pins for squad community, lane GROUP (2026-11-09). The lane owns this
// file and fills it; the harness (scripts/test-api.ts) already calls both
// exports, so a lane never edits test-api.ts or package.json.
//   npx tsx scripts/community-group-pins.ts            (npm run pins:community-group)
//   BASE=http://localhost:PORT npx tsx scripts/community-group-pins.ts --served

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { COMMUNITY_SLUG_RE, INVITE_CODE_RE, RESERVED_COMMUNITY_SLUGS, parseJoinPayload, type MyMembership, type PublicCommunity, type PublicMember } from '../lib/community/spec'
import {
  HELD_JOIN_KEY,
  HELD_JOIN_TTL_MS,
  ROOM_DEFAULT_ABOUT,
  VIA_KEY,
  VIA_TTL_MS,
  checklistDone,
  cleanSlugInput,
  cleanVia,
  draftProblem,
  heldJoinRecord,
  inviteLine,
  inviteRank,
  inviteUrl,
  ordinal,
  parseSymbols,
  readDraft,
  readHeldJoin,
  readVia,
  roomCardText,
  roomMeta,
  slugProblem,
  stripVia,
  suggestSlug,
  telegramDoor,
  telegramJoinHref,
  telegramShareHref,
  viaRecord,
  xShareHref,
} from '../components/community/group/room-logic'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const GROUP_DIR = join(ROOT, 'components', 'community', 'group')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
/** Source with its comments removed: what ships as code and copy. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Pure pins: no server, no network, no DB. */
export function communityGroupPins(check: Check): void {
  // ── the slug a name suggests ────────────────────────────────────────────
  const slugCases: [string, string][] = [
    ['ETH Swing Traders', 'eth-swing-traders'],
    ['  Perps & Funding!! ', 'perps-and-funding'],
    ['Café Señor Désk', 'cafe-senor-desk'],
    ['HYPE___2x   longs', 'hype-2x-longs'],
    ['ab', ''],
    ['', ''],
    ['!!!', ''],
    ['Telegram', 'telegram-room'],
    ['new', 'new-room'],
    ['A really long room name that goes on and on forever', 'a-really-long-room-name-that-goe'],
  ]
  const slugMiss = slugCases.filter(([n, want]) => suggestSlug(n) !== want)
  check('group slug: a name suggests a lowercase hyphen address (accents folded, & spelled, cut at 32, reserved words padded, too short = none)', slugMiss.length === 0, slugMiss.map(([n]) => `${JSON.stringify(n)} → ${JSON.stringify(suggestSlug(n))}`).join(' · '))
  const everySuggested = ['ETH Swing Traders', 'x y z', 'Telegram', 'Nvidia earnings desk --', 'a'.repeat(80), 'ab-', '-cd-'].map(suggestSlug)
  check('group slug: every suggestion is empty or passes the contract (COMMUNITY_SLUG_RE, never reserved)', everySuggested.every((s) => s === '' || (COMMUNITY_SLUG_RE.test(s) && !RESERVED_COMMUNITY_SLUGS.has(s))), everySuggested.join(' · '))
  check(
    'group slug: slugProblem names the reason (empty, short, charset, edges, reserved) and passes a good one',
    slugProblem('') !== null && slugProblem('ab') !== null && slugProblem('Eth') !== null && slugProblem('-eth') !== null && slugProblem('eth-') !== null && slugProblem('admin') !== null && slugProblem('a'.repeat(33)) !== null && slugProblem('eth-swing') === null && slugProblem('abc') === null,
  )
  check('group slug: typing is cleaned as it lands (spaces and underscores become hyphens, capitals fold, the rest drops)', cleanSlugInput('ETH Swing_Traders!') === 'eth-swing-traders' && cleanSlugInput('x'.repeat(50)).length === 32)
  check('group form: tickers are read from free text (commas, spaces, $, case), deduped, capped at 12', eq(parseSymbols('eth, $hype  AAPL;eth btc'), ['ETH', 'HYPE', 'AAPL', 'BTC']) && parseSymbols(Array.from({ length: 30 }, (_, i) => `T${i}`).join(' ')).length === 12 && eq(parseSymbols('not-a-ticker <script>'), []))
  const draft = readDraft(JSON.stringify({ name: 'ETH desk', slug: 'ETH Desk', about: 'x', symbols: 'eth', slugTouched: true, extra: 1 }))
  check('group form: a stored draft comes back cleaned, a malformed one is an empty form', draft.name === 'ETH desk' && draft.slug === 'eth-desk' && draft.slugTouched === true && readDraft('{nope').name === '' && readDraft(null).slug === '' && readDraft('"str"').name === '')
  check('group form: the form refuses by name until it has a name and a usable address', draftProblem({ ...draft, name: 'x' }) !== null && draftProblem({ ...draft, slug: 'admin' }) !== null && draftProblem(draft) === null)

  // ── the held join ───────────────────────────────────────────────────────
  const now = 1_800_000_000_000
  const rec = heldJoinRecord('eth-swing', 'abc12345', now)
  const parsed = rec ? (JSON.parse(rec) as Record<string, unknown>) : null
  check('group held join: the record is exactly { slug, via, at } under pantessa.community.join', !!parsed && eq(Object.keys(parsed).sort(), ['at', 'slug', 'via']) && parsed.slug === 'eth-swing' && parsed.via === 'abc12345' && parsed.at === now && HELD_JOIN_KEY === 'pantessa.community.join')
  check('group held join: it lives 30 minutes, to the millisecond', HELD_JOIN_TTL_MS === 30 * 60_000 && eq(readHeldJoin(rec, now + HELD_JOIN_TTL_MS), { slug: 'eth-swing', via: 'abc12345' }) && readHeldJoin(rec, now + HELD_JOIN_TTL_MS + 1) === null)
  check('group held join: a record from the future, a malformed one, or one for a non-room slug is nothing', readHeldJoin(rec, now - 1) === null && readHeldJoin('{', now) === null && readHeldJoin(null, now) === null && readHeldJoin(JSON.stringify({ slug: '../x', via: null, at: now }), now) === null && heldJoinRecord('Not A Slug', null, now) === null)
  check('group held join: a via that is not an invite code is dropped, the join is kept', eq(readHeldJoin(heldJoinRecord('eth-swing', '<script>', now), now), { slug: 'eth-swing', via: null }) && eq(readHeldJoin(JSON.stringify({ slug: 'eth-swing', via: 'A B', at: now }), now), { slug: 'eth-swing', via: null }))

  // ── the invite a page was opened with ───────────────────────────────────
  check('group via: only an invite-code shape is read from the query (first value of a repeated one)', cleanVia('abc12345') === 'abc12345' && cleanVia(['abc12345', 'zzzzzzzz']) === 'abc12345' && cleanVia('AB') === null && cleanVia(undefined) === null && cleanVia('abc 123') === null && INVITE_CODE_RE.test('abc12345'))
  const v = viaRecord('eth-swing', 'abc12345', now)
  check('group via: the code is remembered for ITS room only, for a day, in this tab', VIA_KEY === 'pantessa.community.via' && readVia(v, 'eth-swing', now + VIA_TTL_MS) === 'abc12345' && readVia(v, 'eth-swing', now + VIA_TTL_MS + 1) === null && readVia(v, 'other-room', now) === null && viaRecord('eth-swing', 'x', now) === null && readVia('{', 'eth-swing', now) === null)
  check(
    'group via: stripVia returns the bare room and keeps everything else',
    stripVia('/g/eth-swing?via=abc12345') === '/g/eth-swing' && stripVia('/g/eth-swing?sort=new&via=abc12345#feed') === '/g/eth-swing?sort=new#feed' && stripVia('/g/eth-swing') === '/g/eth-swing' && stripVia('/g/eth-swing?a=1') === '/g/eth-swing?a=1',
  )

  const roomSrc = code(read('components', 'community', 'group', 'Room.tsx'))
  check(
    'group via: the room page moves ?via= into sessionStorage and puts the bare room back in the address bar with history.replaceState (never a router navigation that carries the query)',
    /window\.history\.replaceState\([^)]*stripVia\(/.test(roomSrc) && /storage\.set\(VIA_KEY/.test(roomSrc) && !/router\.(replace|push)\(/.test(roomSrc) && !/useRouter/.test(roomSrc),
  )
  check('group via: the invite is read from the address in an effect, never while rendering', !/^(?![\s\S]*useEffect)[\s\S]*window\.location/.test(roomSrc.slice(0, roomSrc.indexOf('useEffect('))))

  // ── the door: rule 6 ────────────────────────────────────────────────────
  const groupFiles = readdirSync(GROUP_DIR).filter((f) => /\.tsx?$/.test(f))
  const groupSrc = Object.fromEntries(groupFiles.map((f) => [f, code(readFileSync(join(GROUP_DIR, f), 'utf8'))]))
  const appG = ['app/g/page.tsx', 'app/g/new/page.tsx', 'app/g/[slug]/page.tsx'].map((p) => code(read(...p.split('/'))))
  const allSrc = [...Object.values(groupSrc), ...appG].join('\n')
  const join_ = groupSrc['JoinButton.tsx'] ?? ''
  check('group door: no door on a /g page names a destination (no redirectTo) and none is connect-only (a join needs a session the server can read)', !/redirectTo/.test(allSrc) && !/walletConnectOnly/.test(allSrc))
  check('group door: never raw RainbowKit (no openConnectModal / ConnectButton in the lane)', !/openConnectModal|ConnectButton|@rainbow-me/.test(allSrc))
  check(
    'group door: joining is never a signature (no signMessage / signTypedData / personal_sign / wagmi sign hook anywhere in the lane)',
    !/signMessage|signTypedData|personal_sign|useSignMessage|useSignTypedData|signMessageAsync/.test(allSrc),
  )
  check('group door: the chooser offers the unified door (CreateAccountButton when cdpEnabled, connectAndSignIn otherwise), landing read on press', /<CreateAccountButton /.test(join_) && /cdpEnabled \?/.test(join_) && /connectAndSignIn\(signInLandingHere\(\)\)/.test(join_) && /signIn\(signInLandingHere\(\)\)/.test(join_))
  check('group door: a stranger\'s tap HOLDS the join before the chooser opens, and closing the chooser drops it', /store\.set\(HELD_JOIN_KEY, heldJoinRecord\(slug, code, Date\.now\(\)\)\)\s*\n\s*setChooser\(/.test(join_) && /const closeChooser = \(\) => \{\s*\n\s*store\.set\(HELD_JOIN_KEY, null\)/.test(join_))
  check('group door: the held join runs once an identity is proven, for this room only, and is cleared first', /if \(!standing\.ready \|\| !standing\.proven\) return/.test(join_) && /held\.slug !== slug/.test(join_) && /store\.set\(HELD_JOIN_KEY, null\)\s*\n\s*setChooser\(null\)\s*\n\s*if \(standing\.member \|\| autoRan\.current\) return/.test(join_))
  check('group door: the join request carries the invite code and nothing else (who is acting is the server\'s read)', /body: JSON\.stringify\(code \? \{ via: code \} : \{\}\)/.test(join_) && !/wallet|address/i.test((join_.match(/method: 'POST'[\s\S]{0,260}/) ?? [''])[0]))
  check('group door: leaving is behind the Joined menu, never the first tap', /aria-haspopup="menu"/.test(join_) && /role="menuitem"[^>]*onClick=\{leave\}/.test(join_) && !/is-member[^>]*onClick=\{leave\}/.test(join_))
  check('group door: Telegram is the Telegram lane\'s own door through the seam (it hides itself with no bot); the plain link is the stand-in, only with a bot AND telegramReady (default off)', /telegramReady = false/.test(join_) && /\{TelegramJoin \? \(/.test(join_) && /<TelegramJoin slug=\{slug\} via=\{chooser\.via\} onSignedIn=\{onTelegram\} \/>/.test(join_) && /\) : telegramReady && telegram \? \(/.test(join_))
  const newForm = groupSrc['NewRoomForm.tsx'] ?? ''
  check('group new: a signed-out visitor keeps the whole form; the send becomes the unified door and the draft stays in this tab', /<CreateAccountButton [^>]*label="Sign in to start the room"/.test(newForm) && /sessionStorage\.setItem\(ROOM_DRAFT_KEY/.test(newForm) && /if \(problem \|\| !authed \|\| sending\) return/.test(newForm))

  // ── the member's link, the board, the words ─────────────────────────────
  const invite: MyMembership['invite'] = { code: 'abc12345', url: '/g/eth-swing?via=abc12345', uses: 3 }
  check(
    'group invite: the shared link is absolute (the API\'s own when absolute, else rebuilt on the page origin from the code)',
    inviteUrl('eth-swing', invite, 'https://www.pantessa.com') === 'https://www.pantessa.com/g/eth-swing?via=abc12345' &&
      inviteUrl('eth-swing', { ...invite, url: 'https://www.pantessa.com/g/eth-swing?via=abc12345' }, 'http://localhost:4503') === 'https://www.pantessa.com/g/eth-swing?via=abc12345' &&
      inviteUrl('eth-swing', { ...invite, url: '' }, 'http://localhost:4503/') === 'http://localhost:4503/g/eth-swing?via=abc12345' &&
      inviteUrl('eth-swing', null, 'https://www.pantessa.com') === 'https://www.pantessa.com/g/eth-swing',
  )
  const line = inviteLine('ETH Swing “Traders” — desk')
  check('group invite: the share line is plain ASCII and reads on its own', /^[\x20-\x7e]+$/.test(line) && line.startsWith('Join ETH Swing Traders desk on Pantessa.') && /^[\x20-\x7e]+$/.test(inviteLine('')), line)
  const tgHref = telegramShareHref('https://www.pantessa.com/g/eth-swing?via=abc12345', line)
  const xHref = xShareHref('https://www.pantessa.com/g/eth-swing?via=abc12345', line)
  check('group invite: Telegram and X get the link as their own url parameter, encoded whole (the ?via= survives)', new URL(tgHref).searchParams.get('url') === 'https://www.pantessa.com/g/eth-swing?via=abc12345' && new URL(tgHref).host === 't.me' && new URL(xHref).searchParams.get('url') === 'https://www.pantessa.com/g/eth-swing?via=abc12345')
  const board = [5, 3, 3, 1, 0].map((invited) => ({ invited })) as Pick<PublicMember, 'invited'>[]
  check(
    'group invite: a place is one more than the members who brought more (ties share), nobody brought = no place, a cut board says so',
    eq(inviteRank(3, board, 50), { place: 2, capped: false }) && eq(inviteRank(5, board, 50), { place: 1, capped: false }) && eq(inviteRank(1, board, 50), { place: 4, capped: false }) && inviteRank(0, board, 50) === null && eq(inviteRank(1, [{ invited: 9 }, { invited: 8 }], 2), { place: 3, capped: true }),
  )
  check('group invite: ordinals', eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 103, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd', '111th']))
  const invitePanel = groupSrc['InvitePanel.tsx'] ?? ''
  check('group invite: the panel promises no new money (it says invites are not paid and names the creator share that exists)', /Invites are not paid\./.test(invitePanel) && /creator share/.test(invitePanel) && !/earn|reward|bonus|\$\d/i.test(invitePanel.replace(/creator share/g, '')))

  // ── Telegram: the join link carries the invite ──────────────────────────
  const door = telegramDoor('@PantessaBot', 'rooms')
  const botOnly = telegramDoor('PantessaBot')
  check('group telegram: a bot name is shape-checked (no @, Telegram\'s charset), a bad one is no door', !!door && door.bot === 'PantessaBot' && door.app === 'rooms' && !!botOnly && botOnly.app === null && telegramDoor('') === null && telegramDoor(undefined) === null && telegramDoor('bad name') === null && telegramDoor('x/y') === null)
  const tgJoin = door ? telegramJoinHref(door, 'eth-swing', 'abc12345') : ''
  const tgStart = botOnly ? telegramJoinHref(botOnly, 'eth-swing', null) : ''
  check(
    'group telegram: the deep link carries the spec\'s join payload (room + invite), Mini App when one is named, /start otherwise',
    tgJoin === 'https://t.me/PantessaBot/rooms?startapp=g_eth-swing__abc12345' && tgStart === 'https://t.me/PantessaBot?start=g_eth-swing' && eq(parseJoinPayload(new URL(tgJoin).searchParams.get('startapp')), { slug: 'eth-swing', invite: 'abc12345' }) && eq(parseJoinPayload(new URL(tgStart).searchParams.get('start')), { slug: 'eth-swing', invite: null }),
  )

  // ── the card and the metadata ───────────────────────────────────────────
  const room: PublicCommunity = { slug: 'eth-swing', name: 'ETH Swing Traders', about: 'Daily levels on ETH.\nCalls are stamped.', symbols: ['ETH', 'BTC', 'HYPE', 'SOL', 'AAPL', 'NVDA', 'TSLA'], members: 128, postsWeek: 14, channels: [{ platform: 'telegram', title: 'ETH swing chat' }], ownerLabel: '@nate', createdAt: now }
  const card = roomCardText(room)
  check('group card: the room\'s card says the name, the about line on one line, "128 members", five markets and "+2", and its address', card.name === 'ETH Swing Traders' && card.about === 'Daily levels on ETH. Calls are stamped.' && card.members === '128 members' && eq(card.markets, ['ETH', 'BTC', 'HYPE', 'SOL', 'AAPL']) && card.moreMarkets === '+2' && card.url === 'pantessa.com/g/eth-swing')
  const lone = roomCardText({ ...room, members: 1, about: '', symbols: [], name: 'x'.repeat(80) })
  const none = roomCardText(null)
  check('group card: one member is "1 member", an empty room is "New room", no about falls to the default, long text is cut, a missing room gets an honest card', lone.members === '1 member' && roomCardText({ ...room, members: 0 }).members === 'New room' && lone.about === ROOM_DEFAULT_ABOUT && lone.name.length === 44 && lone.moreMarkets === null && none.name === 'A room on Pantessa' && none.url === 'pantessa.com/g')
  check('group card: a symbol that is not ticker-shaped never reaches the card', eq(roomCardText({ ...room, symbols: ['ETH', '<b>', 'ok then'] }).markets, ['ETH']))
  const meta = roomMeta(room, 'eth-swing')
  check('group meta: title is "<Name> on Pantessa", description is the about line; an internal room, a t- room and an unreadable one are never indexed', meta.title === 'ETH Swing Traders on Pantessa' && meta.description === 'Daily levels on ETH. Calls are stamped.' && meta.noindex === false && roomMeta(room, 't-group-x').noindex === true && roomMeta(room, 'eth-swing', true).noindex === true && roomMeta(null, 'eth-swing').noindex === true && roomMeta({ ...room, about: '' }, 'eth-swing').description === ROOM_DEFAULT_ABOUT)
  const og = code(read('app', 'g', '[slug]', 'opengraph-image.tsx'))
  check('group card: the OG image draws the Emerald mark and the pinned words, and falls to the honest card when the room cannot be read', /gemMarkSvg\(\)/.test(og) && /roomCardText\(room\)/.test(og) && /readRoom\(slug\)\.then\(\(r\) => r\.room, \(\) => null\)/.test(og) && /card\.members/.test(og) && /card\.markets\.map/.test(og))
  const page = code(read('app', 'g', '[slug]', 'page.tsx'))
  check('group page: an unknown room is notFound(), an unreadable store still renders (the browser asks the API), and the page is not force-dynamic', /if \(known && !room\) notFound\(\)/.test(page) && !/force-dynamic/.test(page) && /initial=\{room\}/.test(page))

  // ── the owner's checklist ───────────────────────────────────────────────
  check(
    'group checklist: a step ticks from the room\'s state alone (a second member, a linked chat per platform, a post)',
    eq(checklistDone({ members: 1, channels: [], postsWeek: 0 }), { invite: false, telegram: false, discord: false, post: false }) &&
      eq(checklistDone({ members: 2, channels: [{ platform: 'telegram', title: null }], postsWeek: 1 }), { invite: true, telegram: true, discord: false, post: true }) &&
      checklistDone({ members: 1, channels: [{ platform: 'discord', title: 'x' }], postsWeek: 0 }).discord === true,
  )
  const checklist = groupSrc['OwnerChecklist.tsx'] ?? ''
  check('group checklist: owner only, a card (no dialog role), dismissible, gone when every step is done', /me\.role !== 'owner'/.test(checklist) && !/role="dialog"|aria-modal/.test(checklist) && /if \(left === 0\) return null/.test(checklist) && /checklistKey\(slug\)/.test(checklist))

  // ── the seam to the bot lanes ───────────────────────────────────────────
  const seam = read('components', 'community', 'group', 'channel-panels.tsx')
  const joinSeam = read('components', 'community', 'group', 'join-lanes.tsx')
  for (const [lane, file, name, src] of [['telegram', 'TelegramPanel.tsx', 'TelegramPanel', seam], ['discord', 'DiscordPanel.tsx', 'DiscordPanel', seam], ['telegram', 'TelegramJoin.tsx', 'TelegramJoin', joinSeam]] as const) {
    const exists = existsSync(join(ROOT, 'components', 'community', lane, file))
    const imported = new RegExp(`from '@/components/community/${lane}/${name}'`).test(code(src))
    const empty = new RegExp(`export const ${name}: \\w+ = null`).test(code(src))
    check(`group seam: ${name} is ${exists ? 'WIRED now that the ' + lane + " lane's panel exists" : 'an empty seat while the ' + lane + " lane's panel is not in this tree (no import of a missing module)"}`, exists ? imported && !empty : !imported && empty)
  }

  // ── house rules ─────────────────────────────────────────────────────────
  const css = read('components', 'community', 'group', 'group.css')
  check('group css: no Tailwind opacity on a CSS variable in the lane (the three spellings that are never generated)', !/\[(?:color:)?var\(--[^\]]*\)\]\/\d/.test(allSrc))
  check('group css: 44px touch targets below 1024px for the join, the buttons, the tabs', /@media \(max-width: 1023px\)[\s\S]*\.grp-join--sm \{ min-height: 44px/.test(css) && /\.grp-btn, \.grp-join--md \{ min-height: 44px/.test(css) && /\.grp-board__tab, \.grp-sorts__tab \{ min-height: 44px/.test(css))
  const dashed = [...Object.entries(groupSrc), ['app/g/page', appG[0]], ['app/g/new/page', appG[1]], ['app/g/[slug]/page', appG[2]], ['opengraph-image', og]].filter(([, src]) => /—|–/.test(src as string)).map(([f]) => f)
  check('group copy: no em or en dash in anything the lane ships as copy', dashed.length === 0, dashed.join(' · '))
}

// ── served ─────────────────────────────────────────────────────────────────

const INTERNAL = { 'x-yf-internal-run': '1' }
const flat = (html: string) => html.replace(/<!--.*?-->/g, '')

function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function signIn(base: string, account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`, { headers: INTERNAL })
  const nonceCookie = cookieOf(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...INTERNAL, ...(nonceCookie ? { cookie: nonceCookie } : {}) }, body: JSON.stringify({ message, signature }) })
  const session = cookieOf(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

/** Delete every row this lane's served pins wrote (slugs t-group-*). */
async function cleanup(): Promise<number> {
  if (!process.env.DATABASE_URL) return -1
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const where = { communitySlug: { startsWith: 't-group-' } }
    await prisma.communityMember.deleteMany({ where })
    await prisma.communityInvite.deleteMany({ where })
    await prisma.communityChannel.deleteMany({ where })
    await prisma.channelLinkCode.deleteMany({ where })
    const { count } = await prisma.community.deleteMany({ where: { slug: { startsWith: 't-group-' } } })
    return count
  } finally {
    await prisma.$disconnect()
  }
}

/** Served pins: against a running `next start` (BASE) on the standard harness belt + the TEST DB.
 *  Every row written carries the internal-run header and is cleaned up. */
export async function communityGroupPinsServed(check: Check, base: string): Promise<void> {
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers: { ...INTERNAL, ...headers }, redirect: 'manual' })

  // A stranger: the directory and the form are pages, not walls.
  const dir = await get('/g')
  const dirHtml = flat(await dir.text())
  check('group served: a stranger gets 200 on /g with the directory seat and the way to start a room', dir.status === 200 && dirHtml.includes('Find a room') && /data-community-directory="full"/.test(dirHtml) && /href="\/g\/new"/.test(dirHtml), `status ${dir.status}`)
  const neu = await get('/g/new')
  const neuHtml = flat(await neu.text())
  check('group served: /g/new renders the form to a stranger (200, the fields are in the HTML, no redirect)', neu.status === 200 && /data-new-room/.test(neuHtml) && /data-field="name"/.test(neuHtml) && /data-field="slug"/.test(neuHtml) && neuHtml.includes('Start the room'), `status ${neu.status}`)

  // Does this tree have CORE's API? Everything below needs it.
  const probe = await get('/api/communities?limit=1')
  const coreUp = probe.status === 200 && (probe.headers.get('content-type') ?? '').includes('json')
  check('group served: lane CORE\'s API answers on this server (GET /api/communities) — the pins below need it', coreUp, coreUp ? '' : `status ${probe.status}: CORE is not merged into this tree, or the server is not running`)
  if (!coreUp) return

  const ghost = `t-group-ghost-${Math.random().toString(36).slice(2, 8)}`
  const miss = await get(`/g/${ghost}`)
  const missBad = await get('/g/Not_A_Room')
  check('group served: an unknown room is a real 404 (and so is an address that is not room-shaped)', miss.status === 404 && missBad.status === 404, `unknown ${miss.status} · malformed ${missBad.status}`)

  const slug = `t-group-${Math.random().toString(36).slice(2, 10)}`
  const name = `Group pins ${slug.slice(-4)}`
  const owner = privateKeyToAccount(generatePrivateKey())
  const guest = privateKeyToAccount(generatePrivateKey())
  try {
    const ownerCookie = await signIn(base, owner)
    const made = await fetch(`${base}/api/communities`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie, ...INTERNAL }, body: JSON.stringify({ slug, name, about: 'A room the group pins made. It is deleted when they finish.', symbols: ['ETH', 'HYPE'] }) })
    const madeBody = (await made.json().catch(() => null)) as { community?: PublicCommunity; error?: string } | null
    check('group served: a wallet session starts a room (POST /api/communities → 201)', made.status === 201 && madeBody?.community?.slug === slug, `status ${made.status} ${madeBody?.error ?? ''}`)
    if (made.status !== 201) return

    const mine = (await (await get(`/api/communities/${slug}`, { cookie: ownerCookie })).json()) as { community: PublicCommunity; me: MyMembership | null }
    const code_ = mine.me?.invite.code ?? ''
    check('group served: the owner is the first member, with an invite code the join route will credit', mine.me?.role === 'owner' && INVITE_CODE_RE.test(code_) && mine.community.members === 1, `role ${mine.me?.role} · code ${code_} · members ${mine.community.members}`)

    // The room page, as a stranger opens it from an invite link.
    const page = await get(`/g/${slug}?via=${code_}`)
    const html = flat(await page.text())
    check('group served: the room page carries the name, the member count and the join in its HTML', page.status === 200 && html.includes(name) && /data-room-members[^>]*>1</.test(html) && /data-join-state="join"/.test(html), `status ${page.status}`)
    const byLine = (html.match(/data-invited[^>]*>([\s\S]*?)<\/p>/) ?? [])[1]?.replace(/<[^>]+>/g, '') ?? ''
    check('group served: opened with ?via= it says WHO invited the visitor (the inviter\'s label, server-rendered)', /^You were invited by .+\. Joining takes one tap\.$/.test(byLine.trim()), byLine)
    const bogus = flat(await (await get(`/g/${slug}?via=zzzzzzzz`)).text())
    const bogusLine = (bogus.match(/data-invited[^>]*>([\s\S]*?)<\/p>/) ?? [])[1]?.replace(/<[^>]+>/g, '') ?? ''
    check('group served: a code that is not an invite of this room names nobody ("You were invited to <room>"), and a bare visit shows no invite line', bogusLine.trim() === `You were invited to ${name}. Joining takes one tap.` && !/data-invited/.test(flat(await (await get(`/g/${slug}`)).text())), bogusLine)
    const ogUrl = (html.match(/<meta property="og:image" content="([^"]+)"/) ?? [])[1] ?? ''
    check('group served: the page names its own og:image and twitter:image (the room card), titled "<Name> on Pantessa", never indexed for a t- room', ogUrl.includes(`/g/${slug}/opengraph-image`) && /<meta name="twitter:image" content="[^"]*\/g\/[^"]*twitter-image/.test(html) && html.includes(`<title>${name} on Pantessa</title>`) && /<meta name="robots" content="noindex/.test(html), ogUrl)
    const ogRes = await get(`/g/${slug}/opengraph-image`)
    const ogBytes = (await ogRes.arrayBuffer()).byteLength
    check('group served: the room card renders (200, image/png, a real image)', ogRes.status === 200 && (ogRes.headers.get('content-type') ?? '').includes('image/png') && ogBytes > 10_000, `status ${ogRes.status} · ${ogBytes} bytes`)
    const ogGhost = await get(`/g/${ghost}/opengraph-image`)
    check('group served: a card for a room that does not exist is still an image, never a 500', ogGhost.status === 200 && (ogGhost.headers.get('content-type') ?? '').includes('image/png'), `status ${ogGhost.status}`)

    // The invite: a second wallet joins through the owner's link.
    const stranger = await fetch(`${base}/api/communities/${slug}/join`, { method: 'POST', headers: { 'content-type': 'application/json', ...INTERNAL }, body: JSON.stringify({ via: code_ }) })
    const strangerBody = (await stranger.json().catch(() => null)) as { needsIdentity?: boolean } | null
    check('group served: a stranger\'s join is 401 { needsIdentity } (what re-opens the chooser)', stranger.status === 401 && strangerBody?.needsIdentity === true, `status ${stranger.status}`)
    const guestCookie = await signIn(base, guest)
    const joined = await fetch(`${base}/api/communities/${slug}/join`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: guestCookie, ...INTERNAL }, body: JSON.stringify({ via: code_ }) })
    const joinedBody = (await joined.json().catch(() => null)) as { joined?: boolean; me?: MyMembership; community?: PublicCommunity } | null
    check('group served: a proven wallet joins in one request and gets its own invite link back', joined.status === 200 && joinedBody?.joined === true && joinedBody.me?.role === 'member' && INVITE_CODE_RE.test(joinedBody.me?.invite.code ?? '') && joinedBody.me?.invite.code !== code_ && joinedBody.community?.members === 2, `status ${joined.status}`)
    const after = (await (await get(`/api/communities/${slug}`, { cookie: ownerCookie })).json()) as { me: MyMembership | null }
    const boardRes = (await (await get(`/api/communities/${slug}/members?sort=invites&limit=50`)).json()) as { members: PublicMember[] }
    check('group served: the join that carried the link is credited: the inviter reads "You brought 1" and leads the board', after.me?.invite.uses === 1 && boardRes.members[0]?.invited === 1 && boardRes.members[0]?.role === 'owner' && eq(inviteRank(1, boardRes.members, 50), { place: 1, capped: false }), `uses ${after.me?.invite.uses} · board top ${boardRes.members[0]?.invited}`)
    const idn = (await (await get('/api/me/identity', { cookie: guestCookie })).json()) as { key: string | null; communities: PublicCommunity[] }
    check('group served: GET /api/me/identity lists the room for the new member (one read lights every Join button on a page)', typeof idn.key === 'string' && idn.communities.some((c) => c.slug === slug))
    const memberPage = flat(await (await get(`/g/${slug}`, { cookie: guestCookie })).text())
    check('group served: the room page now counts two members', /data-room-members[^>]*>2</.test(memberPage))
    const left = await fetch(`${base}/api/communities/${slug}/join`, { method: 'DELETE', headers: { cookie: guestCookie, ...INTERNAL } })
    const ownerLeft = await fetch(`${base}/api/communities/${slug}/join`, { method: 'DELETE', headers: { cookie: ownerCookie, ...INTERNAL } })
    check('group served: a member can leave; the owner cannot (the button shows Owner, no leave menu)', left.status === 200 && ownerLeft.status >= 400, `member ${left.status} · owner ${ownerLeft.status}`)
  } finally {
    const removed = await cleanup().catch((e) => {
      console.warn('[group pins] cleanup failed:', e instanceof Error ? e.message : e)
      return -2
    })
    check('group served: the test rooms (t-group-*) are deleted at the end', removed >= 0, removed === -1 ? 'DATABASE_URL is not set for the pin process: rows left behind' : `${removed} room(s) removed`)
  }
}

if (process.argv[1]?.endsWith('community-group-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  // `--cleanup`: delete the lane's test rooms and nothing else (the drive calls it).
  if (process.argv.includes('--cleanup')) {
    cleanup()
      .then((n) => {
        console.log(n === -1 ? 'cleanup: DATABASE_URL is not set, nothing deleted' : `cleanup: ${n} t-group-* room(s) deleted`)
        process.exit(n === -1 ? 1 : 0)
      })
      .catch((e) => {
        console.error(e)
        process.exit(1)
      })
  } else
  Promise.resolve()
    .then(() => communityGroupPins(check))
    .then(() => (served ? communityGroupPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : '\nall green')
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
