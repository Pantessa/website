// NEWS SOURCES pins (2026-11-18) — the News tab reads a dozen publishers.
//
// Nate, 2026-11-18: "our news section right now only grabs cointelegraph, can
// we also aggregate from other news sources like reddit does where users can
// add articles … forbes, maybe even a section from X that pulls the $ latest
// and best … do we pull these fresh from a user click of an asset or are we
// indexing these?" What is pinned here is every RULE that answer rests on:
//
//   · every feed is read and merged (no ladder, no first-feed-wins);
//   · a site feed's story is filed under the symbols its HEADLINE names, by
//     rules that know "Optimism" the mood from Optimism the chain;
//   · a feed asked about one symbol keeps only headlines that name it;
//   · the same story from two feeds is one row, the publisher's own;
//   · stories are INDEXED (Postgres, a cron every 10 minutes), a click reads;
//   · readers add articles and vote on them (the community feed's own rows);
//   · the X section never spends from a page view, is OFF until a daily
//     budget is set, and reserves a pull's cost before asking X.
//
//   npx tsx scripts/news-sources-pins.ts                              # the pure half
//   BASE=http://localhost:4730 npx tsx scripts/news-sources-pins.ts   # + the served half
//
// Both halves run inside `npm run test:api`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NEWS_FEED_LABELS, sourceCounts, type NewsItem, type NewsResponse } from '../lib/news-shared'
import { MAJOR_SITES, SITE_FEEDS, headlineTestFor, mergeNews, symbolsInText, titleKey } from '../lib/news-sources'
import { hopItems, isQuotePage, newsFeedsFor, siteItems, type RssItem } from '../lib/news'
import { cashtagOf, fixtureXPosts, keepXPost, mapRecentSearch, orderXPosts, recentSearchUrl, worstPullUsd, xNewsConfig, xSearchLinks } from '../lib/news-x'
import { additiveRefusal } from './run-ddl'

type Check = (name: string, ok: boolean, extra?: string) => void

const code = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
const T0 = 1_800_000_000
const item = (over: Partial<NewsItem> & { id: string; title: string }): NewsItem => ({ url: `https://example.com/${over.id}`, source: 'Wire', publishedAt: T0, ...over })
const rss = (title: string, link: string, over: Partial<RssItem> = {}): RssItem => ({ title, link, publishedAt: T0, description: '', source: '', tickers: '', ...over })
const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join()

export function newsSourcesPins(check: Check): void {
  // ── the registry ──
  const keys = SITE_FEEDS.map((f) => f.key)
  check(
    'news sources: a dozen site feeds, each with its own key, an https URL and a publisher label; Forbes is one; Blockworks (stale) and Reddit (refuses) are not',
    SITE_FEEDS.length >= 12 && new Set(keys).size === keys.length && SITE_FEEDS.every((f) => f.url.startsWith('https://') && !!NEWS_FEED_LABELS[f.feed]) &&
      keys.includes('forbes') && keys.includes('coindesk') && keys.includes('decrypt') && keys.includes('theblock') && !SITE_FEEDS.some((f) => /blockworks|reddit/.test(f.url)),
    `${SITE_FEEDS.length} feeds`,
  )
  check('news sources: the majors search names Forbes, Reuters and Bloomberg by site', ['forbes.com', 'reuters.com', 'bloomberg.com'].every((s) => (MAJOR_SITES as readonly string[]).includes(s)))

  // ── which symbols a headline names ──
  const c = (t: string) => symbolsInText(t, 'crypto')
  check(
    'news sources: a crypto desk\'s headline is filed under the coins it names, by name, by ticker in capitals, or by cashtag',
    same(c('Bitcoin drops as Nvidia earnings drive stock index futures'), ['BTC']) && same(c('LINK and NEAR lead the altcoin bounce'), ['LINK', 'NEAR']) &&
      same(c('Maple’s SYRUP Loses Half Its Value, Lagging BTC and ETH'), ['SYRUP', 'BTC', 'ETH']) && same(c('Traders pile into $OP after the upgrade'), ['OP']) && same(c('Dogecoin jumps 12%'), ['DOGE']),
    JSON.stringify([c('LINK and NEAR lead the altcoin bounce'), c('Maple’s SYRUP Loses Half Its Value, Lagging BTC and ETH')]),
  )
  check(
    'news sources: a word that is also a coin is not the coin (Optimism the mood, compound interest, an APT hacking group, the DOGE office, ETHDenver, a ticker in lower case)',
    c('Optimism returns to crypto markets as rates fall').length === 0 && c('The magic of compound interest in DeFi').length === 0 && c('North Korean APT group drains exchange').length === 0 &&
      c('DOGE staff cuts reach the SEC').length === 0 && c('ETHDenver recap: what builders shipped').length === 0 && c('A near miss for the bill, and a link to the vote').length === 0 &&
      same(c('OP Stack upgrade ships on OP Mainnet'), ['OP']) && same(c('Compound Finance votes on a new market'), ['COMP']),
    JSON.stringify([c('Optimism returns to crypto markets as rates fall'), c('DOGE staff cuts reach the SEC'), c('OP Stack upgrade ships on OP Mainnet')]),
  )
  const m = (t: string) => symbolsInText(t, 'markets')
  check(
    'news sources: a markets desk\'s headline is filed under the stocks it names (name, alias, $T, (T), NASDAQ: T) and the household coins; a company named like a plain word needs its ticker',
    same(m('Apple (AAPL) beats on services revenue'), ['AAPL']) && same(m('Nvidia stock jumps after earnings'), ['NVDA']) && same(m('MicroStrategy adds to its Bitcoin stack'), ['MSTR', 'BTC']) &&
      m('Strategy matters more than ever for retailers').length === 0 && m('Zoom fatigue is back, and Snap judgments with it').length === 0 && same(m('Why $SNAP is moving today'), ['SNAP']) &&
      m('Uniswap fee switch passes').length === 0,
    JSON.stringify([m('MicroStrategy adds to its Bitcoin stack'), m('Zoom fatigue is back, and Snap judgments with it')]),
  )

  // ── a feed asked about ONE symbol ──
  const btc = headlineTestFor('BTC', 'coin')
  check(
    'news sources: a search feed\'s headline must name the symbol (the majors search answered "Bitcoin" with U.K. inflation); a coin or company we hold no name for is kept whole',
    !!btc && btc('Bitcoin steadies after Nvidia’s earnings beat') && !btc('Contained U.K. Inflationary Pressures Could Support Growth') && headlineTestFor('ZRO', 'coin') === null &&
      !!headlineTestFor('MSTR', 'stock') && headlineTestFor('ZM', 'stock') === null && headlineTestFor('NVDA', 'stock')!('Is Red Cat Stock a Buy After Its Nov. 16 Earnings Report?') === false,
  )
  const btcFeeds = newsFeedsFor({ symbol: 'BTC', source: 'coinbase', pair: 'BTC-USD', label: 'BTC / USD' })
  const majors = btcFeeds.find((h) => h.feed === 'google-majors')
  check(
    'news sources: a coin is asked of Cointelegraph\'s tag feed, Google News, the majors and Yahoo, ALL read; the majors feed names its sites and drops a headline that does not name the coin',
    btcFeeds.map((h) => h.feed).join('+') === 'cointelegraph+google-news+google-majors+yahoo' && !!majors && /site:forbes\.com/.test(decodeURIComponent(majors.url)) &&
      majors.keep!(rss('Wall Street prepares for an IPO frenzy', 'https://example.com/a')) === false && majors.keep!(rss('Bitcoin ETFs lose $240M', 'https://example.com/b')) === true &&
      /s=BTC-USD/.test(btcFeeds[3].url) && new Set(btcFeeds.map((h) => h.key)).size === btcFeeds.length,
  )
  check(
    'news sources: a fund\'s daily holdings line and an exchange\'s price page are not headlines',
    isQuotePage('What ProShares Ultra QQQ 2x Shares (QLD) Bought: Apple Leads on Nov. 16') && isQuotePage('Invesco QQQ (QQQ) Buys $23.2 Million More Apple on Nov. 16') &&
      isQuotePage('Maple Finance Price, SYRUP Price, Live Charts, and Marketcap') && !isQuotePage('Apple (AAPL) Buys a chip designer in its biggest deal since Beats'),
  )

  // ── a site feed's rows ──
  const coindesk = SITE_FEEDS.find((f) => f.key === 'coindesk')!
  const bm = SITE_FEEDS.find((f) => f.key === 'bitcoin-magazine')!
  const filed = siteItems(coindesk, [
    rss('Ethereum fees hit a five-year low', 'https://www.coindesk.com/a', { source: 'Some Author', description: 'Bitcoin was flat.' }),
    rss('Regulators publish a new stablecoin rule', 'https://www.coindesk.com/b'),
    rss('Solana and Sui lead weekly inflows', 'https://www.coindesk.com/c'),
  ])
  check(
    'news sources: a site story is filed by its HEADLINE (a coin named only in the summary is not it), wears the publisher\'s name, and a story naming no symbol is dropped; a single-subject publisher files everything under its subject',
    filed.length === 2 && same(filed[0].symbols, ['ETH']) && same(filed[1].symbols, ['SOL', 'SUI']) && filed.every((f) => f.source === 'CoinDesk' && f.feed === 'coindesk') &&
      same(siteItems(bm, [rss('The case for self custody', 'https://bitcoinmagazine.com/a')])[0]?.symbols ?? [], ['BTC']),
    JSON.stringify(filed.map((f) => [f.title.slice(0, 20), f.symbols])),
  )
  check(
    'news sources: one feed\'s rows are de-duplicated by URL, newest first, and each carries its feed',
    (() => {
      const rows = hopItems({ feed: 'decrypt' }, [rss('Old', 'https://decrypt.co/1', { publishedAt: T0 - 60 }), rss('New', 'https://decrypt.co/2'), rss('New again', 'https://decrypt.co/2')])
      return rows.length === 2 && rows[0].title === 'New' && rows.every((r) => r.feed === 'decrypt')
    })(),
  )

  // ── one story, once ──
  const story = 'Bitcoin steadies after Nvidia’s earnings beat as $60K bids stand out'
  const merged = mergeNews([
    item({ id: 'g1', title: story, feed: 'google-news', source: 'Cointelegraph', publishedAt: T0 + 30 }),
    item({ id: 'c1', title: `${story}!`, feed: 'cointelegraph', source: 'Cointelegraph', imageUrl: 'https://img.example.com/a.png', publishedAt: T0 }),
    item({ id: 'y1', title: 'Markets wrap', feed: 'yahoo', publishedAt: T0 + 90 }),
    item({ id: 'b1', title: 'Markets wrap', feed: 'benzinga', publishedAt: T0 + 80 }),
    item({ id: 'c1', title: `${story}!`, feed: 'cointelegraph', source: 'Cointelegraph', publishedAt: T0 }),
  ])
  check(
    'news sources: a story two feeds carry is ONE row (the publisher\'s own over an aggregator\'s, the pictured one), a short column title never merges two rows, the page is newest first',
    merged.map((x) => x.id).join() === 'y1,b1,c1' && merged[2].imageUrl === 'https://img.example.com/a.png' && titleKey('  Bitcoin’s  $60K—bids! ') === 'bitcoin s 60k bids',
    merged.map((x) => x.id).join(),
  )
  check(
    'news sources: the publishers on a page are counted, most stories first',
    JSON.stringify(sourceCounts([{ source: 'B' }, { source: 'A' }, { source: 'B' }, { source: 'C' }])) === JSON.stringify([{ source: 'B', count: 2 }, { source: 'A', count: 1 }, { source: 'C', count: 1 }]),
  )

  // ── indexed, not fetched per click ──
  const lib = code('lib/news.ts')
  const index = code('lib/news-index.ts')
  const vercel = JSON.parse(code('vercel.json')) as { crons: { path: string; schedule: string }[] }
  check(
    'news index: a page is read from Postgres; a feed is fetched only by whoever claims it (one conditional upsert), a reader is served what the index holds while stale feeds finish, and with no database the feeds are read directly',
    /const items = mergeNews\(await readSymbol\(pair\.symbol\)\)/.test(lib) && /if \(!\(await claimFeed\(hop\.key, staleSec\)\)\) return 0/.test(lib) && /ON CONFLICT \(feed_key\) DO UPDATE SET claimed_at = now\(\)\s+WHERE/.test(index) &&
      /Promise\.race\(\[all\.then\(\(\) => true as const\), sleep\(/.test(lib) && /defer\?\.\(all\)/.test(lib) && /return loadDirect\(pair\)/.test(lib) && /after\(\(\) => work\)/.test(code('app/api/news/route.ts')),
  )
  check(
    'news index: the cron re-reads the site feeds every 10 minutes behind CRON_SECRET, and never touches X unless the X budget is on',
    vercel.crons.some((x) => x.path === '/api/cron/news' && x.schedule === '*/10 * * * *') && /if \(!secret\) return false/.test(code('app/api/cron/news/route.ts')) && /refreshSiteFeeds\(\)/.test(code('app/api/cron/news/route.ts')),
  )
  const ddl = code('prisma/ddl/2026-11-18-news-index.sql').replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  check('news index: its DDL is additive only (five tables, their indexes)', ddl.length === 9 && ddl.every((st) => additiveRefusal(st) === null), ddl.map((st) => additiveRefusal(st)).filter(Boolean).join('; '))

  // ── on X ──
  const off = xNewsConfig({})
  check(
    'news x: OFF until a daily budget is set (NEWS_X_DAILY_USD defaults to 0); three symbols, every 8 hours, 20 posts a pull = at most $0.10 a pull',
    off.dailyUsd === 0 && off.symbols.join() === 'BTC,ETH,SOL' && off.pullHours === 8 && off.postsPerPull === 20 && worstPullUsd(off.postsPerPull) === 0.1 &&
      xNewsConfig({ NEWS_X_DAILY_USD: '2', NEWS_X_SYMBOLS: 'btc, hype,not a symbol,BTC', NEWS_X_POSTS_PER_PULL: '5' }).symbols.join() === 'BTC,HYPE' && xNewsConfig({ NEWS_X_POSTS_PER_PULL: '5' }).postsPerPull === 10 &&
      xNewsConfig({ NEWS_X_DAILY_USD: '999' }).dailyUsd === 50,
  )
  const xlib = code('lib/news-x.ts')
  check(
    'news x: a pull is reserved against the day\'s ceiling, under a lock, BEFORE X is asked; a refusal settles at $0; a page view never asks X anything',
    xlib.indexOf('const pullId = await reservePull(') > 0 && xlib.indexOf('const pullId = await reservePull(') < xlib.indexOf('await fetch(recentSearchUrl(') && /pg_advisory_xact_lock/.test(xlib) &&
      /\+ \$\{worstUsd\}::double precision <= \$\{capUsd\}::double precision/.test(xlib) && /await settlePull\(pullId, 0, 0, 0, status\)/.test(xlib) && /\(!fake && cfg\.dailyUsd <= 0\)/.test(xlib) &&
      !/pullXSymbol|pullDueXSymbols|api\.x\.com|fetch\(/.test(code('app/api/news/x/route.ts')),
  )
  const q = new URL(recentSearchUrl('$BTC', 20))
  check(
    'news x: the search asks for original English posts carrying the cashtag, in X\'s own relevance order, never more than the pull allows; an index has no cashtag',
    q.origin + q.pathname === 'https://api.x.com/2/tweets/search/recent' && q.searchParams.get('query') === '$BTC -is:retweet -is:reply lang:en' && q.searchParams.get('max_results') === '20' && q.searchParams.get('sort_order') === 'relevancy' &&
      new URL(recentSearchUrl('$BTC', 500)).searchParams.get('max_results') === '100' && cashtagOf({ symbol: 'BTC', source: 'coinbase' }) === '$BTC' && cashtagOf({ symbol: 'US10Y', source: 'index' }) === null &&
      xSearchLinks('$BTC').latest === 'https://x.com/search?q=%24BTC&f=live',
  )
  const fx = fixtureXPosts('BTC', Date.UTC(2026, 10, 18, 12))
  const body = {
    data: [
      { id: fx[0].id, text: 'short', note_tweet: { text: fx[0].text }, created_at: new Date(fx[0].postedAt * 1000).toISOString(), public_metrics: { like_count: 412, retweet_count: 51, reply_count: 20 } },
      { id: fx[1].id, text: fx[1].text, created_at: '2020-01-01T00:00:00Z', public_metrics: { like_count: 9 } },
      { id: 'not-an-id', text: 'x', created_at: new Date().toISOString() },
      { id: fx[2].id, created_at: new Date(fx[2].postedAt * 1000).toISOString() },
    ],
  }
  const mapped = mapRecentSearch(body)
  check(
    'news x: X bills every row it returns, and only a real post is kept (its long text, its own time, its counts); a row whose time disagrees with its id is not a post',
    mapped.returned === 4 && mapped.posts.length === 1 && mapped.posts[0].text === fx[0].text && mapped.posts[0].likes === 412 && mapped.posts[0].reposts === 51 && mapped.posts[0].url === `https://x.com/i/status/${fx[0].id}` &&
      mapRecentSearch(null).returned === 0,
    JSON.stringify([mapped.returned, mapped.posts.length]),
  )
  check(
    'news x: a post earns a seat with enough likes, words of its own and no cashtag pile; "best" is most liked, "latest" is newest',
    keepXPost({ text: 'The range held again on $BTC and the bid is still there.', likes: 40 }, 5) && !keepXPost({ text: 'The range held again on $BTC and the bid is still there.', likes: 2 }, 5) &&
      !keepXPost({ text: '$BTC $ETH $SOL $XRP $DOGE all pumping, join the group for signals now', likes: 900 }, 5) && !keepXPost({ text: '$BTC https://t.co/abc #crypto', likes: 900 }, 5) &&
      orderXPosts(fx, 'best')[0].likes === 412 && orderXPosts(fx, 'latest')[0].postedAt === Math.max(...fx.map((p) => p.postedAt)),
  )

  // ── the page ──
  const tab = code('components/markets/news/NewsTab.tsx')
  const css = code('components/markets/news/news.css')
  check(
    'news page: the strip names every publisher with its count, a tap keeps that publisher\'s stories and deals the page again, and a picked publisher that left the page clears itself',
    /data-news="sources"/.test(tab) && /const shown = useMemo\(\(\) => \(picked \? \(news\?\.items \?\? \[\]\)\.filter\(\(it\) => it\.source === picked\)/.test(tab) && /const page = useMemo\(\(\) => frontPage\(shown\), \[shown\]\)/.test(tab) &&
      /const picked = only && sources\.some\(\(s\) => s\.source === only\) \? only : null/.test(tab) && /aria-pressed=\{picked === s\.source\}/.test(tab) && /\.gaz__srcchip\.is-on \{/.test(css),
  )
  check(
    'news page: readers add an article through the board\'s own door and vote on it (the community feed\'s link rows, hottest first, the feed\'s own vote buttons); a reader\'s link is marked ugc and is not stretched over the votes',
    /\/api\/feed\?symbol=\$\{encodeURIComponent\(symbol\)\}&kind=link&sort=hot&window=all/.test(tab) && /<VoteButtons postId=\{p\.id\} score=\{p\.score\} myVote=\{p\.myVote\}/.test(tab) && /body: JSON\.stringify\(\{ symbol, kind: 'link', linkUrl: url\.trim\(\), title: title\.trim\(\) \}\)/.test(tab) &&
      /className="gaz__link gaz__link--inline" href=\{p\.linkUrl\} target="_blank" rel="noopener noreferrer nofollow ugc"/.test(tab) && /\.gaz__link--inline::after \{ content: none; \}/.test(css) && /<CreateAccountButton className="mkc__cta" label="Sign in to add"/.test(tab),
  )
  check(
    'news page: "On X" reads what the server holds (never X itself), orders it best or latest, shows a post as text behind one link, and always offers X\'s own search',
    /fetch\(`\/api\/news\/x\?symbol=\$\{encodeURIComponent\(symbol\)\}`\)/.test(tab) && /if \(!x\?\.cashtag \|\| !x\.links\) return null/.test(tab) && /href=\{p\.url\} target="_blank" rel="noopener noreferrer nofollow ugc"/.test(tab) &&
      /href=\{x\.links\.latest\}/.test(tab) && /href=\{x\.links\.top\}/.test(tab) && !/dangerouslySetInnerHTML/.test(tab),
  )
}

export async function newsSourcesServedPins(check: Check, BASE: string): Promise<void> {
  try {
    const r = await fetch(`${BASE}/api/news?symbol=BTC&limit=80`)
    const d = (await r.json()) as NewsResponse
    if (r.ok && d.items.length === 0) {
      console.log('  ⚠️  news sources: every feed empty for BTC right now — live feeds down, not the diff; skipping the page checks')
    } else {
      const keys = d.items.map((i) => titleKey(i.title)).filter((k) => k.length >= 16)
      check(
        'news sources (served): BTC\'s page comes from more than one feed and more than one publisher, every row names its feed, the counts add up, no story is on it twice, newest first',
        r.ok && (d.feeds?.length ?? 0) >= 2 && (d.sources?.length ?? 0) >= 2 && d.items.every((i) => !!i.feed && i.url.startsWith('https://')) && (d.sources ?? []).reduce((n, s) => n + s.count, 0) === d.items.length &&
          new Set(keys).size === keys.length && new Set(d.items.map((i) => i.id)).size === d.items.length && d.items.every((i, k) => k === 0 || d.items[k - 1].publishedAt >= i.publishedAt) && d.feed === d.feeds?.[0],
        `via=${d.via} feeds=${d.feeds?.join(',')} publishers=${d.sources?.length} n=${d.items.length}`,
      )
      check('news sources (served): BTC\'s page names Bitcoin in every search-feed headline', d.items.filter((i) => i.feed === 'google-majors' || i.feed === 'yahoo').every((i) => /bitcoin|\bBTC\b/i.test(i.title)), d.items.find((i) => (i.feed === 'google-majors' || i.feed === 'yahoo') && !/bitcoin|\bBTC\b/i.test(i.title))?.title)
    }
    const x = await fetch(`${BASE}/api/news/x?symbol=BTC`)
    const xd = (await x.json()) as { cashtag?: string | null; posts?: unknown[]; links?: { latest: string; top: string } | null }
    const ix = (await (await fetch(`${BASE}/api/news/x?symbol=US10Y`)).json()) as { cashtag?: string | null; posts?: unknown[] }
    check(
      'news x (served): a symbol answers its cashtag, its posts and X\'s own search links; an index has no cashtag; a chartless symbol is refused',
      x.ok && xd.cashtag === '$BTC' && Array.isArray(xd.posts) && /^https:\/\/x\.com\/search\?q=%24BTC/.test(xd.links?.latest ?? '') && ix.cashtag === null && (ix.posts ?? []).length === 0 &&
        (await fetch(`${BASE}/api/news/x?symbol=USDC`)).status === 400,
    )
    check('news index (served): the cron is closed without its secret', (await fetch(`${BASE}/api/cron/news`)).status === 401)
    if (process.env.CRON_SECRET) {
      const c = await fetch(`${BASE}/api/cron/news`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'x-yf-internal-run': '1' } })
      const cd = (await c.json()) as { feeds?: { read: string[]; failed: string[] }; x?: { enabled?: boolean; pulls?: { status: string; costUsd: number }[] }; index?: { items: number }; skipped?: string }
      check(
        'news index (served): the cron answers what it read and what the index holds; any X pull it made cost nothing here (fake mode or off)',
        c.ok && (!!cd.skipped || (Array.isArray(cd.feeds?.read) && typeof cd.index?.items === 'number' && (cd.x?.pulls ?? []).every((p) => p.costUsd === 0))),
        JSON.stringify(cd).slice(0, 220),
      )
    } else {
      console.log('  ⚪ news index: CRON_SECRET not in harness env — the cron pass check skipped')
    }
    const html = await (await fetch(`${BASE}/t/BTC?tab=news`)).text()
    check('news page (served): /t/BTC?tab=news renders the readers\' section on the server', /data-news="readers"/.test(html) && /From readers/.test(html))
  } catch (err) {
    check('news sources (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('news-sources-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    newsSourcesPins(check)
    if (process.env.BASE) await newsSourcesServedPins(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} news sources pins failed` : `\nall ${n} news sources pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
