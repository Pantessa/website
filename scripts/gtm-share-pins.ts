// Pins for the share lane (GTM squad, 2026-10-05): the words and address of
// every pre-written post (lib/share-posts), the sharer id's two
// implementations, and two source fences: no page unfurls without a picture,
// and no share intent is hand-rolled outside the one rulebook.
// Pure: no server, no chain, no DB.  npx tsx scripts/gtm-share-pins.ts
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { X_MENTION } from '../lib/social'
import { SITE_URL } from '../lib/site-url'
import {
  LIST_CARD_ROWS,
  VIA_SALT,
  creatorPagePost,
  intentLinkPost,
  intentLinkPostAt,
  intentLinkXHref,
  listCardRows,
  listPost,
  marketsPost,
  maskAddresses,
  postHref,
  quoteForPost,
  sitePost,
  symbolPost,
  viaIdOfBrowser,
  withVia,
  xIntentHref,
  type SharePost,
} from '../lib/share-posts'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const ADDR = '0x9Cc09AD0D6832FfbBFb1B70F1D9e5d0a6d00892a'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

export async function gtmSharePins(check: Check): Promise<void> {
  // ── the sharer id ─────────────────────────────────────────────────────────
  const nodeVia = createHash('sha256').update(`${VIA_SALT}|${ADDR.toLowerCase()}`).digest('hex').slice(0, 10)
  const receipts = readFileSync(join(ROOT, 'lib/share-receipts.ts'), 'utf8')
  check('via: the browser id is the server id (same salt, same hash, same ten characters)', (await viaIdOfBrowser(ADDR)) === nodeVia && receipts.includes(`\`${VIA_SALT}|\${wallet.toLowerCase()}\``), `${await viaIdOfBrowser(ADDR)} vs ${nodeVia}`)
  check('via: the id is case-blind and never a fragment of the address', (await viaIdOfBrowser(ADDR.toUpperCase().replace('0X', '0x'))) === nodeVia && !ADDR.toLowerCase().includes(nodeVia))

  // ── withVia ───────────────────────────────────────────────────────────────
  check('via: rides on our own links, as the first or a later param, before any hash', withVia(`${SITE_URL}/t/AAPL`, 'abc123') === `${SITE_URL}/t/AAPL?via=abc123` && withVia(`${SITE_URL}/t/AAPL?tf=1d#x`, 'abc123') === `${SITE_URL}/t/AAPL?tf=1d&via=abc123#x` && withVia('/lists/tech', 'abc123') === '/lists/tech?via=abc123')
  check('via: never overwrites one already on the link (first sharer keeps it)', withVia(`${SITE_URL}/r/x?via=first00001`, 'second0002') === `${SITE_URL}/r/x?via=first00001`)
  check('via: a malformed id or a foreign origin leaves the link alone', withVia(`${SITE_URL}/t/AAPL`, 'NOT OK') === `${SITE_URL}/t/AAPL` && withVia(`${SITE_URL}/t/AAPL`, null) === `${SITE_URL}/t/AAPL` && withVia('https://example.com/x', 'abc123') === 'https://example.com/x' && withVia(`${SITE_URL}.evil.com/x`, 'abc123') === `${SITE_URL}.evil.com/x`)

  // ── the rulebook, over every post we pre-write ────────────────────────────
  const posts: Record<string, SharePost> = {
    symbol: symbolPost('aapl', { name: 'Apple', changePct: 1.234 }),
    symbolFlat: symbolPost('ETH'),
    markets: marketsPost(),
    list: listPost({ slug: 'tech', name: 'Big tech', symbols: ['AAPL', 'msft', 'NVDA', 'TSLA', 'AMD', 'COIN'] }),
    listEmpty: listPost({ slug: 'empty', name: 'Later', symbols: [] }),
    link: intentLinkPost({ slug: 'buy-aapl', ask: 'Buy $25 of AAPL' }),
    creator: creatorPagePost('yeet'),
    site: sitePost(),
  }
  const bad = Object.entries(posts).filter(([, p]) => /^\s*@/.test(p.text) || p.text.includes('#') || p.text.split(X_MENTION).length !== 2 || /https?:\/\//.test(p.text) || !p.url.startsWith(SITE_URL) || !p.title.trim())
  check('posts: never an @mention first, no hashtag, the account named exactly once, the link only in `url`, on our origin', bad.length === 0, bad.map(([k]) => k).join(','))
  check('posts: a symbol leads as a cashtag once, uppercased, with the move only when one was given', posts.symbol.text.startsWith('$AAPL +1.23% today.') && posts.symbol.text.split('$AAPL').length === 2 && posts.symbolFlat.text.startsWith('$ETH Live chart') && posts.symbol.url === `${SITE_URL}/t/AAPL`)
  check('posts: a list leads with at most four cashtags and counts the rest; an empty list leads with its name', posts.list.text.startsWith('$AAPL $MSFT $NVDA $TSLA +2\n\n') && posts.listEmpty.text.startsWith('"Later"'))
  check('posts: a creator page never @-mentions the Pantessa handle (on X that name is somebody else)', !posts.creator.text.includes('@yeet') && posts.creator.text.includes('yeet') && posts.creator.url === `${SITE_URL}/l/yeet`)
  const href = postHref(posts.link, 'abc1234567')
  const parsed = new URL(href)
  check('posts: the X intent carries text and url as two params, and the sharer id on the link', parsed.origin + parsed.pathname === 'https://twitter.com/intent/tweet' && parsed.searchParams.get('url') === `${SITE_URL}/i/buy-aapl?via=abc1234567` && parsed.searchParams.get('text') === posts.link.text && xIntentHref('a b', 'https://x.y/z?q=1&r=2').includes('url=https%3A%2F%2Fx.y%2Fz%3Fq%3D1%26r%3D2'))

  // ── privacy: what a post may quote ────────────────────────────────────────
  const transfer = intentLinkPost({ slug: 's', ask: `Send 5 USDC to ${ADDR} on Base` })
  check('privacy: an address inside a quoted ask is masked before it leaves', !transfer.text.includes(ADDR) && transfer.text.includes('0x9Cc0…892a') && !transfer.title.includes(ADDR))
  check('privacy: a 64-hex hash is cut too, and plain text is untouched', maskAddresses(`tx 0x${'ab'.repeat(32)} done`) === 'tx 0xabababab… done' && maskAddresses('Buy $25 of AAPL') === 'Buy $25 of AAPL')
  const long = quoteForPost(`Buy   $25 of AAPL\n${'and then some '.repeat(30)}`)
  check('quote: one line, cut on the budget with an ellipsis', !/\s{2,}|\n/.test(long) && long.length <= 160 && long.endsWith('…'))
  const chatSrc = readFileSync(join(ROOT, 'lib/shared-chat.ts'), 'utf8')
  check('privacy: the shared-chat and receipt posts quote through quoteForPost (masked), never the raw ask', /sharePostOf[\s\S]{0,400}quoteForPost\(raw/.test(chatSrc) && /receiptPost[\s\S]{0,300}quoteForPost\(receipt\.ask/.test(receipts))

  // ── intent links by path ──────────────────────────────────────────────────
  check('links: a path, a URL or a bare slug all name the same link', ['/i/abc', 'i/abc', 'abc', `${SITE_URL}/i/abc?x=1`].every((p) => intentLinkPostAt('Buy $5 of ETH', p).url === `${SITE_URL}/i/abc`) && new URL(intentLinkXHref('Buy $5 of ETH', '/i/abc')).searchParams.get('url') === `${SITE_URL}/i/abc`)

  // ── the list card ─────────────────────────────────────────────────────────
  const many = Array.from({ length: 23 }, (_, i) => `S${i}`)
  check('list card: draws the first rows and says how many follow', listCardRows(many).rows.length === LIST_CARD_ROWS && listCardRows(many).more === 23 - LIST_CARD_ROWS && listCardRows(['A']).more === 0 && listCardRows([]).rows.length === 0)

  // ── source fence 1: no routed page unfurls without a picture ──────────────
  // Next REPLACES the root's openGraph/twitter object with a page's own, and
  // the root's file-based image does not ride into it (lib/og-defaults). A
  // page that names its own block needs an image file in its own segment, or
  // an `images` entry.
  const app = join(ROOT, 'app')
  const bare: string[] = []
  for (const file of walk(app)) {
    if (!/\/(page|layout)\.tsx$/.test(file) || /\/_[^/]+\//.test(file) || file.includes('/api/')) continue
    const src = readFileSync(file, 'utf8')
    const dir = dirname(file)
    for (const [key, img] of [['openGraph', 'opengraph-image.tsx'], ['twitter', 'twitter-image.tsx']] as const) {
      if (existsSync(join(dir, img))) continue
      const re = new RegExp(`\\b${key}: \\{`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        let k = m.index + m[0].length
        let depth = 1
        while (depth && k < src.length) {
          if (src[k] === '{') depth++
          else if (src[k] === '}') depth--
          k++
        }
        if (!/\bimages\b/.test(src.slice(m.index, k))) bare.push(`${file.slice(ROOT.length + 1)}:${key}`)
      }
    }
  }
  check('cards: every page that sets its own openGraph/twitter block has a picture (a file in its segment, or `images`)', bare.length === 0, bare.join(' '))
  check('cards: /pricing, /compare and /lists carry both an og and a twitter image file', ['pricing', 'compare', 'lists/[slug]'].every((d) => existsSync(join(app, d, 'opengraph-image.tsx')) && existsSync(join(app, d, 'twitter-image.tsx'))))
  const compareCard = readFileSync(join(app, 'compare/opengraph-image.tsx'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  check('cards: the compare card names no competitor (rule 7: body copy only)', !/tradingview/i.test(compareCard))
  const layout = readFileSync(join(app, 'layout.tsx'), 'utf8')
  check('cards: the root fallback title is the current line, not the pre-pivot one', layout.includes('const TITLE = HOME_TITLE') && layout.includes('const DESCRIPTION = HOME_DESCRIPTION'))

  // ── source fence 2: one rulebook for share intents ────────────────────────
  const ALLOWED = new Set(['lib/share-posts.ts', 'lib/chart-calls.ts', 'components/MosaicStudio.tsx', 'scripts/gtm-share-pins.ts'])
  const rolled = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'lib'))]
    .map((f) => f.slice(ROOT.length + 1))
    .filter((f) => !ALLOWED.has(f) && /twitter\.com\/intent|x\.com\/intent/.test(readFileSync(join(ROOT, f), 'utf8')))
  check('intents: no component hand-rolls an X intent (lib/share-posts is the one composer)', rolled.length === 0, rolled.join(' '))

  // ── the share control is mounted where a visitor lands ────────────────────
  const mounts: [string, RegExp][] = [
    ['app/p/[slug]/page.tsx', /<ShareActions post=\{sharePost\}[^>]*viaFixed/],
    ['app/r/[slug]/page.tsx', /<ShareActions post=\{sharePost\}[^>]*viaFixed/],
    ['app/l/[handle]/page.tsx', /<ShareActions post=\{sharePost\}/],
    ['app/lists/[slug]/page.tsx', /<ShareActions post=\{listPost\(/],
    ['components/IntentRuntime.tsx', /data-link-share="splash">\s*<ShareActions/],
    ['components/IntentRuntime.tsx', /data-link-share="signed"[\s\S]{0,900}<ShareActions/],
    ['components/MintLinkForm.tsx', /<ShareActions post=\{intentLinkPostAt\(minted\.ask, minted\.url\)\}/],
    ['components/MintLinkModal.tsx', /<ShareActions post=\{intentLinkPostAt\(minted\.ask, minted\.url\)\}/],
  ]
  const unmounted = mounts.filter(([f, re]) => !re.test(readFileSync(join(ROOT, f), 'utf8'))).map(([f]) => f)
  check('mounts: /p /r /l /lists, the /i door and its signed bar, and both mint moments carry the share control', unmounted.length === 0, unmounted.join(' '))
  // ── a dead shared link lands on the product, not on the site 404 ──────────
  const gone = ['lists/[slug]', 'c/[id]', 'r/[slug]', 'p/[slug]'].filter((d) => !existsSync(join(app, d, 'not-found.tsx')) || !/SharedGone/.test(readFileSync(join(app, d, 'not-found.tsx'), 'utf8')))
  const goneSrc = readFileSync(join(ROOT, 'components/SharedGone.tsx'), 'utf8')
  check('gone: /lists /c /r /p answer a missing object with their own page, and it leads with Markets', gone.length === 0 && /href="\/markets"[^>]*border-\[var\(--accent\)\]/.test(goneSrc), gone.join(' '))

  // ── the chart dialog and the signed moment ────────────────────────────────
  const chartShare = readFileSync(join(ROOT, 'components/markets/chart/ChartShare.tsx'), 'utf8')
  check('chart: the share dialog always offers the chart link (copy), shares a link where a file cannot go, and carries the sharer id', /copyLink\(chartUrl\)/.test(chartShare) && /canNativeShare \|\| canShareLink/.test(chartShare) && /withVia\(absoluteUrl\(`\/t\/\$\{symbol\}/.test(chartShare) && /chartTweetHref\(symbol, tfLabel, chartUrl\)/.test(chartShare))
  check('chart: the dialog offers the share that pays (the symbol\'s own lead ask as an intent link), composed by the header strip\'s grammar', /execAsks\(pair, \{ usd: 25 \}\)\.find\(\(a\) => a\.tone === 'buy'\)/.test(chartShare) && /linksStudioHref\(\{ ask: earnAsk \}\)/.test(chartShare) && /data-share-earn/.test(chartShare))
  const tCard = readFileSync(join(app, 't/[symbol]/opengraph-image.tsx'), 'utf8')
  check('cards: a symbol card says what the link does (trade from the chart), only for a chartable symbol', /seo\.pair && \([\s\S]{0,400}Trade from this chart/.test(tCard))
  check('landing: the share band carries the share control', /<ShareActions post=\{sitePost\(\)\}/.test(readFileSync(join(ROOT, 'components/landing/ShareBand.tsx'), 'utf8')))
  const receiptBtn = readFileSync(join(ROOT, 'components/ShareReceiptButton.tsx'), 'utf8')
  const chatUi = readFileSync(join(ROOT, 'components/ChatInterface.tsx'), 'utf8')
  check('signed moment: a minted receipt offers the full share control, and a connect-only wallet is offered the sign-in instead of nothing', /data-receipt-shared>[\s\S]{0,700}<ShareActions/.test(receiptBtn) && /if \(!signInFirst \|\| !walletAddress\) return null/.test(receiptBtn) && /data-signed-share="sign-in">[\s\S]{0,300}<ShareReceiptButton kind="tx" signInFirst \/>/.test(chatUi) && /!msg\.dbId &&\s*!embedded && \(/.test(chatUi))
  const rail = readFileSync(join(ROOT, 'components/markets/watchlist/WatchlistRail.tsx'), 'utf8')
  check('watchlist: sharing a list tries the share sheet with the pre-written words, then the clipboard', /navigator\.share\(\{ title: post\.title, text: post\.text, url \}\)/.test(rail) && /passOn\(slug, active\.name, active\.symbols\)/.test(rail))

  const runtime = readFileSync(join(ROOT, 'components/IntentRuntime.tsx'), 'utf8')
  check('mounts: an addressed or allowlisted link is never offered for sharing', /!recipient && !restricted && \(\s*<div className="mt-6[^>]*data-link-share="splash"/.test(runtime) && /signed && !recipient && !restricted && \(/.test(runtime))
}

if (require.main === module) {
  let pass = 0
  let fail = 0
  void gtmSharePins((name, ok, extra) => {
    if (ok) pass++
    else fail++
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra ? ` — ${extra}` : ''}`)
  }).then(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
}
