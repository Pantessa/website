// Pins for the trader's loop (squad five-million, lane PERPS, 2026-11-03):
// alerts delivered to Telegram with the chip link (lib/telegram, the one
// notification path in lib/alerts-exec, the bell's line), the referral
// carried on every share and claimed from the server's own arrival record
// (lib/share-referral, the SIWE door, ShareLive, the creator page), and the
// HL creator-earnings rate. Three tiers, each skipped by name when its
// prerequisite is missing:
//   pure  — always (the composer, the command reader, the index, the sources)
//   db    — DATABASE_URL (the TEST DB): codes, links, the fan-out through a
//           mocked Bot API, the referral chain with fixtures (deleted after)
//   http  — BASE (a local `next start`): the three routes with a burner SIWE
//           session; the Telegram routes need TELEGRAM_BOT_TOKEN +
//           TELEGRAM_BOT_NAME + TELEGRAM_WEBHOOK_SECRET on BOTH the server
//           and this process.
// Called from scripts/test-api.ts (the `perps` block at its end), and alone:
//   npx tsx scripts/perps-pins.ts                       # pure + db
//   BASE=http://localhost:4441 npx tsx scripts/perps-pins.ts   # + http
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** The harness's organic escape: its fetch wrapper strips this header and
 *  withholds its internal-run stamp; a bare server ignores it. */
const ORGANIC_PROBE = 'x-yf-organic-probe'

function getCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

/** A SIWE session at BASE, the harness's own recipe (scripts/test-api.ts
 *  signIn), plus any extra cookies / headers the verify call should carry. */
async function siweSignIn(base: string, account: PrivateKeyAccount, extra: { cookies?: string[]; headers?: Record<string, string> } = {}): Promise<{ session: string | null; status: number; body: Record<string, unknown> }> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`)
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const cookies = [nonceCookie, ...(extra.cookies ?? [])].filter(Boolean).join('; ')
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies, ...(extra.headers ?? {}) },
    body: JSON.stringify({ message, signature }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { session: getCookie(res, 'yf_session'), status: res.status, body }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function perpsPins(check: Check, opts: { base?: string } = {}): Promise<void> {
  const T = await import('../lib/telegram')
  const R = await import('../lib/share-referral')
  const { viaIdOf, VIA_RE } = await import('../lib/share-receipts')
  const F = await import('../lib/fees')

  // ── pure: the message ─────────────────────────────────────────────────────
  const price = T.alertTelegramMessage({ symbol: 'AAPL', title: 'AAPL above $200 — hit $201.10', body: 'Your alert fired at $201.10.', actionAsk: 'Sell $50 of AAPL' })
  check(
    'telegram composer: a price alert → HTML text with the title bold, the body, the ready sentence in <code>, NO link in the text, and the ONE url = the symbol\'s chart on the canonical origin with a chart label',
    /^<b>AAPL above \$200 — hit \$201\.10<\/b>\nYour alert fired at \$201\.10\.\nReady to send: <code>Sell \$50 of AAPL<\/code>/.test(price.text) && !/https?:\/\//.test(price.text) && price.url === 'https://www.pantessa.com/t/AAPL' && price.label === 'Open the AAPL chart',
    `${price.url} | ${price.text.slice(0, 80)}`,
  )
  const print = T.alertTelegramMessage({ symbol: 'HYPE', title: 'Big print on HYPE', body: 'A $58.6K buy printed.', actionAsk: 'Long $25 of HYPE on Hyperliquid', href: '/live?m=HYPE' })
  check('telegram composer: a print alert\'s href (the tape filtered to its market) is THE url, labelled as the tape', print.url === 'https://www.pantessa.com/live?m=HYPE' && print.label === 'Open the tape')
  const hostile = T.alertTelegramMessage({ symbol: 'ETH', title: '<b>x</b> & y', body: 'b <i>', actionAsk: '<script>alert(1)</script> Sell $5 of ETH', href: 'https://evil.example/x' })
  check(
    'telegram composer: a user-authored ask, title and body are HTML-escaped (no raw tag reaches the Bot API), and a foreign href falls back to the chart',
    !hostile.text.includes('<script>') && hostile.text.includes('&lt;script&gt;') && hostile.text.includes('&lt;b&gt;x&lt;/b&gt; &amp; y') && hostile.url === 'https://www.pantessa.com/t/ETH',
    hostile.text.slice(0, 120),
  )
  const long = T.alertTelegramMessage({ symbol: 'ETH', title: 't', body: 'b', actionAsk: 'x'.repeat(5000) })
  const longer = T.alertTelegramMessage({ symbol: 'ETH', title: 't', body: 'y'.repeat(5000), actionAsk: null })
  check(`telegram composer: the text never exceeds the Bot API's ${T.TELEGRAM_TEXT_MAX} (a 5,000-char ask drops the ready line; a 5,000-char body is cut)`, long.text.length <= T.TELEGRAM_TEXT_MAX && !long.text.includes('Ready to send') && longer.text.length <= T.TELEGRAM_TEXT_MAX && longer.text.endsWith('…'))
  check('telegram composer: a newline in a title or an ask is folded to one line (the message is three lines, never more)', T.alertTelegramMessage({ symbol: 'ETH', title: 'a\nb', body: 'c\n\nd', actionAsk: 'e\nf' }).text.split('\n').length === 3)

  // ── pure: the webhook's reading ───────────────────────────────────────────
  const cmd = T.telegramCommand
  check(
    'telegram command: /start <code> · /start (bare) · /start@bot <code> · /stop · /STOP@bot · /help · anything else = help',
    JSON.stringify(cmd('/start abc123')) === JSON.stringify({ cmd: 'start', code: 'abc123' }) && JSON.stringify(cmd('/start')) === JSON.stringify({ cmd: 'start', code: null }) && JSON.stringify(cmd('/start@pantessa_bot abc')) === JSON.stringify({ cmd: 'start', code: 'abc' }) && cmd('/stop').cmd === 'stop' && cmd('/STOP@x').cmd === 'stop' && cmd('/help').cmd === 'help' && cmd('hello there').cmd === 'help' && cmd('').cmd === 'help',
  )
  const upd = T.parseTelegramUpdate
  check(
    'telegram update: a message (or an edited one) with a numeric chat id reads as { chatId (string), text }; a callback, a channel post, garbage and a non-integer chat read as null',
    JSON.stringify(upd({ update_id: 1, message: { chat: { id: -1001234 }, text: ' /start x ' } })) === JSON.stringify({ chatId: '-1001234', text: '/start x' }) && upd({ edited_message: { chat: { id: 7 }, text: 'hi' } })?.chatId === '7' && upd({ callback_query: { id: 1 } }) === null && upd({ channel_post: { chat: { id: 1 }, text: 'x' } }) === null && upd(null) === null && upd('x') === null && upd({ message: { chat: { id: 1.5 }, text: 'x' } }) === null && upd({ message: { chat: { id: 'abc' }, text: 'x' } }) === null && upd({ message: { chat: { id: 9 } } })?.text === '',
  )

  // ── pure: the env readers + the deep link ─────────────────────────────────
  const envSnap = { token: process.env.TELEGRAM_BOT_TOKEN, name: process.env.TELEGRAM_BOT_NAME, channel: process.env.TELEGRAM_CHANNEL_ID }
  delete process.env.TELEGRAM_BOT_TOKEN
  const offBefore = T.telegramEnabled()
  process.env.TELEGRAM_BOT_TOKEN = '123:abc'
  process.env.TELEGRAM_BOT_NAME = '@pantessa_alerts_bot'
  const nameOk = T.telegramBotName()
  process.env.TELEGRAM_BOT_NAME = 'noperson'
  const nameBad = T.telegramBotName()
  process.env.TELEGRAM_BOT_NAME = ''
  const nameEmpty = T.telegramBotName()
  process.env.TELEGRAM_CHANNEL_ID = '@yeetful'
  const chanHandle = T.telegramChannelId()
  process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
  const chanId = T.telegramChannelId()
  process.env.TELEGRAM_CHANNEL_ID = 'nope!'
  const chanBad = T.telegramChannelId()
  check(
    'telegram env: enabled iff TELEGRAM_BOT_TOKEN; the bot name must end in "bot" (a leading @ is tolerated, a non-bot name or an empty one reads null); a channel is an @handle or a numeric id; the deep link is https://t.me/<bot>?start=<code>',
    !offBefore && T.telegramEnabled() && nameOk === 'pantessa_alerts_bot' && nameBad === null && nameEmpty === null && chanHandle === '@yeetful' && chanId === '-1001234567890' && chanBad === null && T.telegramStartUrl('pantessa_alerts_bot', 'abc') === 'https://t.me/pantessa_alerts_bot?start=abc',
  )
  const sentNoToken: unknown[] = []
  delete process.env.TELEGRAM_BOT_TOKEN
  const noTokenResult = await T.sendTelegram('123', 'x', { fetchImpl: (async () => { sentNoToken.push(1); return new Response('{}') }) as typeof fetch })
  process.env.TELEGRAM_BOT_TOKEN = '123:abc'
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as unknown as typeof fetch
  const sentOk = await T.sendTelegram('-42', 'hello', { url: 'https://www.pantessa.com/t/ETH', label: 'Open', fetchImpl: mockFetch })
  const failing = (async () => new Response('{"ok":false}', { status: 400 })) as unknown as typeof fetch
  const throwing = (async () => { throw new Error('boom') }) as unknown as typeof fetch
  check(
    'telegram send: no token → false without a call; a send posts sendMessage with chat_id, HTML, previews off and ONE inline url button; a 400 and a thrown fetch both read false (never throw)',
    !noTokenResult && sentNoToken.length === 0 && sentOk && calls.length === 1 && calls[0].url === 'https://api.telegram.org/bot123:abc/sendMessage' && calls[0].body.chat_id === '-42' && calls[0].body.parse_mode === 'HTML' && calls[0].body.disable_web_page_preview === true && JSON.stringify(calls[0].body.reply_markup) === JSON.stringify({ inline_keyboard: [[{ text: 'Open', url: 'https://www.pantessa.com/t/ETH' }]] }) && (await T.sendTelegram('1', 'x', { fetchImpl: failing })) === false && (await T.sendTelegram('1', 'x', { fetchImpl: throwing })) === false && (await T.sendTelegram('not a chat', 'x', { fetchImpl: mockFetch })) === false,
    JSON.stringify(calls[0]?.body).slice(0, 200),
  )
  // restore the process env
  for (const [k, v] of [['TELEGRAM_BOT_TOKEN', envSnap.token], ['TELEGRAM_BOT_NAME', envSnap.name], ['TELEGRAM_CHANNEL_ID', envSnap.channel]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  // ── pure: the referral index ──────────────────────────────────────────────
  const w1 = '0x9Cc0B7A0DdB091E17647d689206e730131E9892A'
  const idx = R.viaIndex([w1, 'nope', w1.toLowerCase(), '0x0000000000000000000000000000000000000001'])
  check('referral index: via id → lowercased wallet, non-addresses dropped, a repeated wallet counted once, the id is viaIdOf', idx.size === 2 && idx.get(viaIdOf(w1)) === w1.toLowerCase() && VIA_RE.test(viaIdOf(w1)))
  check('referral slug: a share referral carries `via:<id>` in intent_link_slug (never a link), and the reader recognises only that shape', R.viaReferralSlug('abc123abcd') === 'via:abc123abcd' && R.isViaReferralSlug('via:abc123abcd') && !R.isViaReferralSlug('abc123abcd') && !R.isViaReferralSlug('via:NOT OK') && !R.isViaReferralSlug(null))
  check('referral: a malformed via never resolves and never claims', (await R.creatorForVia('NOT OK')) === null && (await R.claimShareReferral({ wallet: w1, via: 'NOT OK', internal: false })).outcome === 'bad-via' && (await R.claimShareReferral({ wallet: w1, via: 'abc123abcd', internal: true })).outcome === 'internal')

  // ── pure: the HL rate the referrer earns ──────────────────────────────────
  check(
    `fees: native-hl-exec is fee-bearing at the builder rate (${F.HL_BUILDER_FEE_TENTH_BPS / 10} bps) and the referrer's share of $100,000 of perp notional is half of it ($${F.creatorEarningsUsd(100_000, F.netFeeBpsFor('native-hl-exec')).toFixed(2)})`,
    F.NET_FEE_BPS_BY_BUILD_PATH['native-hl-exec'] === F.HL_BUILDER_FEE_TENTH_BPS / 10 && F.FEE_BEARING_BUILD_PATHS.has('native-hl-exec') && Math.abs(F.creatorEarningsUsd(100_000, F.netFeeBpsFor('native-hl-exec')) - 100_000 * (F.HL_BUILDER_FEE_TENTH_BPS / 10 / 10_000) * F.CREATOR_FEE_SPLIT) < 1e-9,
  )

  // ── sources ───────────────────────────────────────────────────────────────
  const exec = src('lib/alerts-exec.ts')
  check(
    'source: notifyAlertFired fans out to Telegram right after the mail, fire-and-forget; the fan-out answers 0 for an internal row or an unconfigured bot and sends ONE message per linked chat with the button',
    exec.indexOf('void telegramFanOut(n, telegramSendImpl)') > exec.indexOf('if (n.email && !n.isInternal)') && /if \(n\.isInternal \|\| !telegramEnabled\(\)\) return 0/.test(exec) && /chats\.map\(\(chatId\) => send\(chatId, m\.text, \{ url: m\.url, label: m\.label \}\)\)/.test(exec) && /await notifyAlertFired\(\{ owner: a\.owner, alertId: a\.id/.test(exec),
  )
  check('source: the channel post is behind TELEGRAM_CHANNEL_ID, only for a print alert (href on the tape), never carries the owner\'s chip, and cools per market', /const channel = telegramChannelId\(\)/.test(exec) && /isPrintAlertHref\(n\.href\) && channelPostDue\(n\.href!\)/.test(exec) && /actionAsk: null, href: n\.href/.test(exec) && /\/\^\\\/live\\\?m=\/\.test\(href\)/.test(exec))
  const bell = src('components/markets/shell/RailAlerts.tsx')
  const armedAt = bell.indexOf('aria-label="Armed alerts"')
  const lineAt = bell.indexOf('<TelegramLine open={open} />')
  const emptyAt = bell.indexOf('count === 0 && armed.length === 0')
  check(
    'source: the bell carries ONE Telegram line under the armed rules, inside the signed-in branch (a guest keeps the unified door), reading GET /api/alerts/telegram when the popover opens, minting on a tap with the tab opened INSIDE the tap, unlinking with DELETE, and hiding itself when the server has no bot',
    armedAt > 0 && lineAt > armedAt && emptyAt > lineAt && /fetch\('\/api\/alerts\/telegram', \{ cache: 'no-store' \}\)/.test(bell) && /fetch\('\/api\/alerts\/telegram', \{ method: 'POST' \}\)/.test(bell) && /fetch\('\/api\/alerts\/telegram', \{ method: 'DELETE' \}\)/.test(bell) && /window\.open\('', '_blank'\)/.test(bell) && /if \(!state \|\| !state\.enabled\) return null/.test(bell) && /Get these on Telegram/.test(bell) && /Telegram ✓/.test(bell) && !/handOff/.test(bell) && !/writeArrivalIntent/.test(bell),
  )
  const webhook = src('app/api/telegram/webhook/route.ts')
  check('source: the webhook refuses 401 on the secret header BEFORE reading the body (timing-safe), answers 200 to Telegram once in, links on /start <code>, unlinks on /stop, helps otherwise', webhook.indexOf("secretMatches(req.headers.get('x-telegram-bot-api-secret-token'))") < webhook.indexOf('await req.json()') && /timingSafeEqual\(a, b\)/.test(webhook) && /status: 401/.test(webhook) && /linkTelegramChat\(command\.code, inbound\.chatId\)/.test(webhook) && /unlinkTelegram\(\{ chatId: inbound\.chatId \}\)/.test(webhook))
  const tgRoute = src('app/api/alerts/telegram/route.ts')
  check('source: /api/alerts/telegram is owner-gated on all three verbs (getAuthAddress → 401), POST refuses 503 by name without a bot, and answers the t.me deep link', (tgRoute.match(/const addr = await getAuthAddress\(req\)/g) ?? []).length === 3 && (tgRoute.match(/status: 401/g) ?? []).length === 3 && /status: 503/.test(tgRoute) && /telegramStartUrl\(bot, code\)/.test(tgRoute))
  const envEx = src('.env.example')
  check('source: .env.example documents the four TELEGRAM names with the BotFather + setWebhook recipe aimed at https://www.pantessa.com/api/telegram/webhook with secret_token', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_NAME', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_CHANNEL_ID'].every((k) => envEx.includes(`# ${k}=`)) && /setWebhook/.test(envEx) && /url=https:\/\/www\.pantessa\.com\/api\/telegram\/webhook/.test(envEx) && /secret_token=/.test(envEx) && /BotFather/.test(envEx))
  const shareLive = src('components/live/ShareLive.tsx')
  check('source: the /live views\' share and the deck\'s share (ShareLive) carry the sharer\'s via on the link (withVia over shareUrlFor, useShareVia)', /const via = useShareVia\(\)/.test(shareLive) && /withVia\(`\$\{shareUrlFor\(view, list, since\)\}/.test(shareLive) && /\[chosen, markets, pick\.source, seat, settle, via, view\]/.test(shareLive))
  const creatorPage = src('app/l/[handle]/page.tsx')
  check(
    'source: the creator page is the referral door — its via is the CREATOR\'s (viaIdOf over the handle\'s wallet, server-side), the page seeds it for every visitor (ViaSeed), every link row and the share carry it (viaFixed, never the viewer\'s)',
    /const creatorVia = viaIdOf\(store\.creator\)/.test(creatorPage) && /<ViaSeed via=\{creatorVia\} \/>/.test(creatorPage) && /href=\{withVia\(`\/i\/\$\{l\.slug\}`, creatorVia\)\}/.test(creatorPage) && /url: withVia\(basePost\.url, creatorVia\)/.test(creatorPage) && /<ShareActions post=\{sharePost\}[^>]*viaFixed/.test(creatorPage),
  )
  const viaTracker = src('components/ViaTracker.tsx')
  check('source: ViaSeed and the ?via= tracker share ONE cookie writer with the first-touch rule (an existing yf_via is never overwritten)', /export function seedVia\(/.test(viaTracker) && /export function ViaSeed\(/.test(viaTracker) && (viaTracker.match(/seedVia\(via, pathname\)/g) ?? []).length === 2 && /if \(document\.cookie\.split\('; '\)\.some\(\(c\) => c\.startsWith\('yf_via='\)\)\) return false/.test(viaTracker))
  const verify = src('app/api/auth/verify/route.ts')
  check(
    'source: the SIWE door claims the share referral from the server\'s OWN arrival record (claimReferralFromArrival after the wallet_arrivals stamp), never from a body field, skips internal runs, and echoes only that a claim happened — no address',
    verify.indexOf('claimReferralFromArrival({ wallet: parsed.address.toLowerCase(), internal: isInternalRun(req.headers) })') > verify.indexOf('prisma.walletArrival.createMany') && !/body\.(via|referrer|creator|ref)\b/.test(verify) && /referral = 'share'/.test(verify) && !/creator/.test(verify.slice(verify.indexOf('return NextResponse.json({ address'))),
  )
  const referral = src('lib/share-referral.ts')
  check('source: the claim is write-once (createMany skipDuplicates), refuses a self-referral and an internal run, resolves the referrer from first-party records only (no request field), and the arrival reader selects only wallet_arrivals.via', /skipDuplicates: true/.test(referral) && /if \(creator === wallet\) return \{ outcome: 'self'/.test(referral) && /if \(input\.internal\) return \{ outcome: 'internal'/.test(referral) && /prisma\.walletArrival\.findUnique\(\{ where: \{ address: wallet \}, select: \{ via: true \} \}\)/.test(referral) && !/req\b|headers|cookies/.test(referral))

  // ── db ────────────────────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    console.log('  ⚪ perps (db): no DATABASE_URL in this process — the code/link/fan-out/referral fixtures are skipped')
  } else {
    const { default: prisma } = await import('../lib/db')
    const A = await import('../lib/alerts-exec')
    const rand = () => Math.random().toString(36).slice(2, 10)
    const owner = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    const chat = `-100${Date.now()}`
    const creator = privateKeyToAccount(generatePrivateKey())
    const creatorWallet = creator.address.toLowerCase()
    const creatorVia = viaIdOf(creatorWallet)
    const trader = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    const trader2 = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    const handle = `perps${rand()}`
    const sessionPrefix = `perps-pins-${rand()}`
    const envWas = { token: process.env.TELEGRAM_BOT_TOKEN, channel: process.env.TELEGRAM_CHANNEL_ID }
    try {
      // codes + links
      const { code } = await T.mintTelegramCode(owner)
      const { code: code2 } = await T.mintTelegramCode(owner)
      const firstGone = await prisma.telegramLink.findUnique({ where: { code } })
      check('telegram codes: a minted code is 24 hex; minting again sweeps the owner\'s pending code (one live link at a time)', T.TELEGRAM_CODE_RE.test(code) && T.TELEGRAM_CODE_RE.test(code2) && code !== code2 && firstGone === null)
      const bad = await T.linkTelegramChat('zzz', chat)
      const badChat = await T.linkTelegramChat(code2, 'abc')
      const unknown = await T.linkTelegramChat('0'.repeat(24), chat)
      const linked = await T.linkTelegramChat(code2, chat)
      const reused = await T.linkTelegramChat(code2, chat)
      const chats = await T.chatsForOwner(owner)
      check(
        'telegram links: a malformed code, a malformed chat and an unknown code refuse by name; /start <code> links the chat to the owner; the code is single-use (the same code again is unknown); chatsForOwner reads the chat back',
        !bad.ok && bad.reason === 'bad-code' && !badChat.ok && badChat.reason === 'bad-chat' && !unknown.ok && unknown.reason === 'unknown' && linked.ok && linked.owner === owner && !reused.ok && reused.reason === 'unknown' && chats.length === 1 && chats[0] === chat,
        JSON.stringify({ bad, badChat, unknown, linked, reused, chats }).slice(0, 200),
      )
      const { code: code3 } = await T.mintTelegramCode(owner)
      await prisma.telegramLink.updateMany({ where: { code: code3 }, data: { createdAt: new Date(Date.now() - T.TELEGRAM_CODE_TTL_MS - 1000) } })
      const expired = await T.linkTelegramChat(code3, '-424242')
      const expiredRow = await prisma.telegramLink.findUnique({ where: { code: code3 } })
      const stillLinked = await T.telegramStatus(owner)
      check(`telegram links: a code older than ${T.TELEGRAM_CODE_TTL_MS / 60_000} min is refused as expired and its row deleted; the earlier link is untouched (linked, 1 chat)`, !expired.ok && expired.reason === 'expired' && expiredRow === null && stillLinked.linked && stillLinked.chats === 1)
      const { code: code4 } = await T.mintTelegramCode(owner)
      const again = await T.linkTelegramChat(code4, chat)
      const stillOne = await T.chatsForOwner(owner)
      check('telegram links: /start from a chat already linked to that owner spends the code and keeps ONE row', again.ok && stillOne.length === 1 && (await prisma.telegramLink.count({ where: { owner } })) === 1)

      // the fan-out through a mocked Bot API
      process.env.TELEGRAM_BOT_TOKEN = '123:abc'
      delete process.env.TELEGRAM_CHANNEL_ID
      const sends: { chatId: string; text: string; opts?: { url?: string; label?: string } }[] = []
      const mockSend = (async (chatId: string, text: string, o?: { url?: string; label?: string }) => {
        sends.push({ chatId, text, opts: o })
        return true
      }) as typeof T.sendTelegram
      const n = await A.telegramFanOut({ owner, symbol: 'AAPL', title: 'AAPL above $200 — hit $201.10', body: 'Your alert fired at $201.10.', actionAsk: 'Sell $50 of AAPL', isInternal: false }, mockSend)
      const nInternal = await A.telegramFanOut({ owner, symbol: 'AAPL', title: 't', body: 'b', actionAsk: null, isInternal: true }, mockSend)
      const nNobody = await A.telegramFanOut({ owner: privateKeyToAccount(generatePrivateKey()).address, symbol: 'AAPL', title: 't', body: 'b', actionAsk: null, isInternal: false }, mockSend)
      check(
        'telegram fan-out: a linked owner\'s fired alert reaches sendTelegram once per chat with the HTML text and the chart button; an INTERNAL row sends nothing; an owner with no linked chat sends nothing',
        n === 1 && sends.length === 1 && sends[0].chatId === chat && /<b>AAPL above/.test(sends[0].text) && sends[0].opts?.url === 'https://www.pantessa.com/t/AAPL' && sends[0].opts?.label === 'Open the AAPL chart' && nInternal === 0 && nNobody === 0 && sends.length === 1,
        JSON.stringify(sends[0]).slice(0, 200),
      )
      process.env.TELEGRAM_CHANNEL_ID = '@perps_pins_channel'
      sends.length = 0
      await A.telegramFanOut({ owner, symbol: 'HYPE', title: 'Big print on HYPE', body: 'A $58.6K buy printed. HyperCore, through Dune\'s feed. The chip is ready to send — it moves nothing until you sign.', actionAsk: 'Long $25 of HYPE on Hyperliquid', isInternal: false, href: `/live?m=HYPE${rand()}` }, mockSend)
      const chanSend = sends.find((s) => s.chatId === '@perps_pins_channel')
      const ownerSend = sends.find((s) => s.chatId === chat)
      sends.length = 0
      await A.telegramFanOut({ owner, symbol: 'AAPL', title: 't', body: 'b', actionAsk: 'Sell $5 of AAPL', isInternal: false }, mockSend)
      const priceToChannel = sends.find((s) => s.chatId === '@perps_pins_channel')
      check(
        'telegram channel: with TELEGRAM_CHANNEL_ID a fired PRINT trigger is also posted to the channel — the market\'s sentence with the tape button, the owner\'s chip line stripped — while the owner\'s own message keeps the chip; a PRICE alert never reaches the channel',
        !!chanSend && !/Ready to send/.test(chanSend.text) && !/chip is ready/.test(chanSend.text) && chanSend.opts?.label === 'Open the tape' && !!ownerSend && /Ready to send: <code>Long \$25 of HYPE on Hyperliquid<\/code>/.test(ownerSend.text) && priceToChannel === undefined,
        JSON.stringify({ chanSend, ownerSend }).slice(0, 300),
      )
      delete process.env.TELEGRAM_CHANNEL_ID
      // end to end through the ONE notification path
      sends.length = 0
      A.setTelegramSendImpl(mockSend)
      let notifId: string | null = null
      try {
        notifId = await A.notifyAlertFired({ owner, alertId: `perps-${rand()}`, symbol: 'AAPL', title: 'AAPL above $200 — hit $201.10', body: 'Your alert fired at $201.10.', actionAsk: 'Sell $50 of AAPL', price: 201.1, isInternal: false, email: null })
        for (let i = 0; i < 40 && sends.length === 0; i++) await wait(50)
        check('telegram e2e: notifyAlertFired (the bell\'s write) delivers the same alert to the linked chat through the mocked Bot API within 2s', sends.length === 1 && sends[0].chatId === chat && /Sell \$50 of AAPL/.test(sends[0].text), `${sends.length} send(s) in ${notifId ? 'notified' : 'no row'}`)
      } finally {
        A.setTelegramSendImpl(null)
        if (notifId) await prisma.alertNotification.delete({ where: { id: notifId } }).catch(() => {})
      }
      const removed = await T.unlinkTelegram({ chatId: chat })
      check('telegram links: /stop from the chat unlinks it (every owner it was bound to); the owner reads unlinked', removed === 1 && !(await T.telegramStatus(owner)).linked)

      // the referral chain: a creator with a handle, a stranger who arrived on a share
      await prisma.creatorHandle.create({ data: { handle, creator: creatorWallet } })
      R.resetViaIndex()
      const resolved = await R.creatorForVia(creatorVia)
      const unresolved = await R.creatorForVia(viaIdOf(privateKeyToAccount(generatePrivateKey()).address))
      check('referral resolve: a creator who claimed a handle resolves from their via; a wallet the product never saw resolves to nobody', resolved === creatorWallet && unresolved === null, `${resolved} / ${unresolved}`)
      const internal = await R.claimShareReferral({ wallet: trader, via: creatorVia, internal: true })
      const claimed = await R.claimShareReferral({ wallet: trader, via: creatorVia, internal: false })
      const exists = await R.claimShareReferral({ wallet: trader, via: viaIdOf(privateKeyToAccount(generatePrivateKey()).address), internal: false })
      const self = await R.claimShareReferral({ wallet: creatorWallet, via: creatorVia, internal: false })
      const row = await prisma.referredWallet.findUnique({ where: { wallet: trader } })
      check(
        'referral claim: an internal run claims nothing; the stranger\'s first claim binds them to the sharer with the `via:` slug; a later via never re-claims (write-once, first sharer keeps it); the creator cannot refer themselves',
        internal.outcome === 'internal' && claimed.outcome === 'claimed' && claimed.creator === creatorWallet && exists.outcome === 'exists' && exists.creator === creatorWallet && self.outcome === 'self' && row?.creator === creatorWallet && row?.intentLinkSlug === R.viaReferralSlug(creatorVia) && (await prisma.referredWallet.findUnique({ where: { wallet: creatorWallet } })) === null,
        JSON.stringify({ internal, claimed, exists, self, slug: row?.intentLinkSlug }).slice(0, 240),
      )
      const noArrival = await R.claimReferralFromArrival({ wallet: trader2, internal: false })
      await prisma.walletArrival.create({ data: { address: trader2, via: creatorVia, landing: '/live' } })
      const fromArrival = await R.claimReferralFromArrival({ wallet: trader2, internal: false })
      check('referral from the arrival record: a wallet with no wallet_arrivals row claims nothing; one whose arrival names the creator\'s share is claimed from that record alone', noArrival === null && fromArrival?.outcome === 'claimed' && fromArrival.creator === creatorWallet)

      // the ledgered credit: the referred trader's HL order earns the creator 5 bps
      const notional = 1000
      await prisma.embedTurn.create({
        data: { embedKeyId: '', origin: 'https://www.pantessa.com', sessionId: `${sessionPrefix}-1`, prompt: '', outcome: 'signed', artifact: 'hl-order', chain: 'hyperliquid', valueUsd: notional, buildPath: 'native-hl-exec', originKind: 'chat', walletAddress: trader, isInternal: false, verification: 'attested', symbols: [] },
      })
      // a fee-free leg by the same wallet earns nothing; an internal row is never counted
      await prisma.embedTurn.create({
        data: { embedKeyId: '', origin: 'https://www.pantessa.com', sessionId: `${sessionPrefix}-2`, prompt: '', outcome: 'signed', artifact: 'tx', chain: 'arbitrum', valueUsd: 500, buildPath: 'native-hl-deposit', originKind: 'chat', walletAddress: trader, isInternal: false, verification: 'attested', symbols: [] },
      })
      await prisma.embedTurn.create({
        data: { embedKeyId: '', origin: 'https://www.pantessa.com', sessionId: `${sessionPrefix}-3`, prompt: '', outcome: 'signed', artifact: 'hl-order', chain: 'hyperliquid', valueUsd: 9999, buildPath: 'native-hl-exec', originKind: 'chat', walletAddress: trader, isInternal: true, verification: 'attested', symbols: [] },
      })
      const expectedUsd = F.creatorEarningsUsd(notional, F.netFeeBpsFor('native-hl-exec'))
      if (opts.base) {
        const { session } = await siweSignIn(opts.base, creator)
        const earn = session ? ((await (await fetch(`${opts.base}/api/intent-links`, { headers: { cookie: session } })).json()) as { earnings?: { referredWallets?: number; referredEarnedUsd?: number; referredSignedUsd?: number; totalEarnedUsd?: number } }) : {}
        const e = earn.earnings
        check(
          `referral credit (served): the creator's /chat?tab=links earnings read (GET /api/intent-links) — a creator with NO links of their own — counts the two referred wallets and credits $${expectedUsd.toFixed(2)} on the referred trader's $${notional} HL order; the deposit leg and the internal row earn nothing`,
          !!session && e?.referredWallets === 2 && Math.abs((e?.referredEarnedUsd ?? -1) - expectedUsd) < 1e-9 && Math.abs((e?.referredSignedUsd ?? -1) - (notional + 500)) < 1e-9 && Math.abs((e?.totalEarnedUsd ?? -1) - expectedUsd) < 1e-9,
          JSON.stringify(e ?? earn).slice(0, 240),
        )
      } else {
        console.log('  ⚪ referral credit (served): no BASE — the earnings read over HTTP is skipped (the fixtures above prove the chain to the row)')
      }
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = envWas.token
      if (envWas.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
      if (envWas.channel === undefined) delete process.env.TELEGRAM_CHANNEL_ID
      else process.env.TELEGRAM_CHANNEL_ID = envWas.channel
      await prisma.telegramLink.deleteMany({ where: { owner } }).catch(() => {})
      await prisma.embedTurn.deleteMany({ where: { sessionId: { startsWith: sessionPrefix } } }).catch(() => {})
      await prisma.referredWallet.deleteMany({ where: { wallet: { in: [trader, trader2] } } }).catch(() => {})
      await prisma.walletArrival.deleteMany({ where: { address: { in: [trader, trader2, creatorWallet] } } }).catch(() => {})
      await prisma.creatorHandle.deleteMany({ where: { handle } }).catch(() => {})
      R.resetViaIndex()
    }
  }

  // ── http ──────────────────────────────────────────────────────────────────
  if (!opts.base) {
    console.log('  ⚪ perps (http): no BASE — the three routes are not driven')
    return
  }
  const base = opts.base
  const burner = privateKeyToAccount(generatePrivateKey())
  const noAuth = await fetch(`${base}/api/alerts/telegram`)
  const noAuthPost = await fetch(`${base}/api/alerts/telegram`, { method: 'POST' })
  const noAuthDel = await fetch(`${base}/api/alerts/telegram`, { method: 'DELETE' })
  check('http: /api/alerts/telegram refuses a stranger on every verb (401)', noAuth.status === 401 && noAuthPost.status === 401 && noAuthDel.status === 401, `${noAuth.status}/${noAuthPost.status}/${noAuthDel.status}`)
  const hookNoSecret = await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { chat: { id: 1 }, text: '/start x' } }) })
  const hookWrong = await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'not-the-secret' }, body: JSON.stringify({ message: { chat: { id: 1 }, text: '/start x' } }) })
  check('http: the webhook refuses 401 without the secret header and with a wrong one', hookNoSecret.status === 401 && hookWrong.status === 401, `${hookNoSecret.status}/${hookWrong.status}`)
  const { session } = await siweSignIn(base, burner)
  const statusRes = await fetch(`${base}/api/alerts/telegram`, { headers: { cookie: session ?? '' } })
  const status = (await statusRes.json()) as { enabled?: boolean; bot?: string | null; linked?: boolean; chats?: number }
  check('http: the owner reads their Telegram status (200, linked:false, chats:0)', statusRes.status === 200 && status.linked === false && status.chats === 0, JSON.stringify(status))
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!status.enabled || !secret) {
    const mintOff = await fetch(`${base}/api/alerts/telegram`, { method: 'POST', headers: { cookie: session ?? '' } })
    check('http: with no bot on the server the mint refuses 503 by name', mintOff.status === 503 && /TELEGRAM_BOT_TOKEN/.test(((await mintOff.json()) as { error?: string }).error ?? ''))
    console.log(`  ⚪ perps (http): the server has no bot (enabled=${status.enabled}) or this process has no TELEGRAM_WEBHOOK_SECRET — the link round-trip over the webhook is skipped`)
  } else {
    const mint = await fetch(`${base}/api/alerts/telegram`, { method: 'POST', headers: { cookie: session ?? '' } })
    const minted = (await mint.json()) as { url?: string; bot?: string; expiresInSec?: number }
    const code = minted.url?.match(/\?start=([a-f0-9]{24})$/)?.[1] ?? null
    check('http: POST mints the deep link https://t.me/<bot>?start=<24-hex code> (201)', mint.status === 201 && !!code && minted.url === `https://t.me/${status.bot}?start=${code}` && minted.expiresInSec === T.TELEGRAM_CODE_TTL_MS / 1000, JSON.stringify(minted))
    const chat = `-100${Date.now()}`
    const hook = (text: string, chatId = chat) => fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: Number(chatId) }, text } }) })
    const startRes = await hook(`/start ${code}`)
    const started = (await startRes.json()) as { ok?: boolean; action?: string }
    const afterLink = (await (await fetch(`${base}/api/alerts/telegram`, { headers: { cookie: session ?? '' } })).json()) as { linked?: boolean; chats?: number }
    check('http: /start <code> through the webhook links the chat (200, linked) and the owner now reads linked:true, chats:1', startRes.status === 200 && started.action === 'linked' && afterLink.linked === true && afterLink.chats === 1, `${JSON.stringify(started)} ${JSON.stringify(afterLink)}`)
    const reuse = (await (await hook(`/start ${code}`, `-100${Date.now() + 7}`)).json()) as { action?: string }
    const bareStart = (await (await hook('/start')).json()) as { action?: string }
    const chatter = (await (await hook('what is this')).json()) as { action?: string }
    const ignored = await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ update_id: 2, callback_query: { id: 'x' } }) })
    check('http: the same code again is refused (single-use); a bare /start and chatter get help; a non-message update is acknowledged untouched (200)', reuse.action === 'refused' && bareStart.action === 'help' && chatter.action === 'help' && ignored.status === 200 && ((await ignored.json()) as { action?: string }).action === 'ignored', JSON.stringify({ reuse, bareStart, chatter }))
    const stop = (await (await hook('/stop')).json()) as { action?: string }
    const afterStop = (await (await fetch(`${base}/api/alerts/telegram`, { headers: { cookie: session ?? '' } })).json()) as { linked?: boolean }
    check('http: /stop unlinks the chat and the owner reads linked:false', stop.action === 'unlinked' && afterStop.linked === false)
    const mint2 = (await (await fetch(`${base}/api/alerts/telegram`, { method: 'POST', headers: { cookie: session ?? '' } })).json()) as { url?: string }
    const code2 = mint2.url?.match(/\?start=([a-f0-9]{24})$/)?.[1] ?? ''
    await hook(`/start ${code2}`)
    const del = (await (await fetch(`${base}/api/alerts/telegram`, { method: 'DELETE', headers: { cookie: session ?? '' } })).json()) as { ok?: boolean; removed?: number }
    const afterDel = (await (await fetch(`${base}/api/alerts/telegram`, { headers: { cookie: session ?? '' } })).json()) as { linked?: boolean }
    check('http: DELETE from the bell unlinks every chat of the owner', del.ok === true && del.removed === 1 && afterDel.linked === false, JSON.stringify(del))
  }

  // the referral over the SIWE door, against the served route
  if (!process.env.DATABASE_URL) {
    console.log('  ⚪ perps (http): no DATABASE_URL — the served referral claim (needs a creator fixture) is skipped')
  } else {
    const { default: prisma } = await import('../lib/db')
    const creator = privateKeyToAccount(generatePrivateKey())
    const creatorWallet = creator.address.toLowerCase()
    const creatorVia = viaIdOf(creatorWallet)
    const handle = `perpsh${Math.random().toString(36).slice(2, 8)}`
    const stranger = privateKeyToAccount(generatePrivateKey())
    const insider = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    try {
      await prisma.creatorHandle.create({ data: { handle, creator: creatorWallet } })
      const organic = { headers: { [ORGANIC_PROBE]: '1' } }
      const first = await siweSignIn(base, stranger, { cookies: [`yf_via=${creatorVia}`, 'yf_via_landing=/live'], ...organic })
      const row = await prisma.referredWallet.findUnique({ where: { wallet: stranger.address.toLowerCase() } })
      check(
        'http referral: a stranger whose first sign-in carries the creator\'s share cookie is stamped (via echoed) AND claimed for that creator from the arrival record (referral:"share"; the row carries the via: slug; no address in the response)',
        first.status === 200 && first.body.via === creatorVia && first.body.referral === 'share' && !JSON.stringify(first.body).includes(creatorWallet) && row?.creator === creatorWallet && row?.intentLinkSlug === R.viaReferralSlug(creatorVia),
        `${first.status} ${JSON.stringify(first.body)} row=${row?.intentLinkSlug ?? 'none'}`,
      )
      const second = await siweSignIn(base, stranger, { cookies: [`yf_via=${viaIdOf(other.address)}`], ...organic })
      check('http referral: a later sign-in with somebody else\'s cookie neither re-stamps nor re-claims (first sharer keeps the stranger for life)', second.status === 200 && second.body.via === undefined && second.body.referral === undefined && (await prisma.referredWallet.findUnique({ where: { wallet: stranger.address.toLowerCase() } }))?.creator === creatorWallet)
      const internal = await siweSignIn(base, insider, { cookies: [`yf_via=${creatorVia}`], headers: { 'x-yf-internal-run': '1' } })
      check('http referral: an INTERNAL run\'s sign-in with the cookie stamps the (analytics) arrival but never claims a referral', internal.status === 200 && internal.body.via === creatorVia && internal.body.referral === undefined && (await prisma.referredWallet.findUnique({ where: { wallet: insider.address.toLowerCase() } })) === null, JSON.stringify(internal.body))
      const selfIn = await siweSignIn(base, creator, { cookies: [`yf_via=${creatorVia}`], ...organic })
      check('http referral: the creator signing in on their own share is never their own referral', selfIn.status === 200 && selfIn.body.referral === undefined && (await prisma.referredWallet.findUnique({ where: { wallet: creatorWallet } })) === null)
    } finally {
      await prisma.referredWallet.deleteMany({ where: { wallet: { in: [stranger.address.toLowerCase(), insider.address.toLowerCase(), creatorWallet] } } }).catch(() => {})
      await prisma.walletArrival.deleteMany({ where: { address: { in: [stranger.address.toLowerCase(), insider.address.toLowerCase(), creatorWallet] } } }).catch(() => {})
      await prisma.creatorHandle.deleteMany({ where: { handle } }).catch(() => {})
    }
  }
}

if (process.argv[1]?.endsWith('perps-pins.ts')) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    ok ? pass++ : fail++
  }
  const base = process.env.BASE || process.argv.find((a) => a.startsWith('--base='))?.slice(7) || undefined
  console.log(`— perps pins${base ? ` @ ${base}` : ''}`)
  perpsPins(check, { base })
    .then(() => {
      console.log(`\n${pass} passed, ${fail} failed\n`)
      process.exit(fail ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
