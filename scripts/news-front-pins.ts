// NEWS FRONT PAGE pins (2026-11-17) — the News tab set as a newspaper.
//
// Nate, 2026-11-17: "redesign the news section to look and feel like a
// newspaper with images and headers not just a list … pretty is key,
// readability also important and clickable." What is pinned here is every
// RULE that keeps the page honest and whole:
//
//   · the feed (newest first) is DEALT into the page's seats in its own
//     order — every story lands once, none is dropped, none is ranked;
//   · "since" is the move from the price when a story ran to the last price,
//     read off the tape (inside an open bar, at the close of a shut one) and
//     absent where the tape does not reach;
//   · the plate marks the story where it ran and colours the line after it
//     by what that line drew;
//   · a quote page is not a headline (the stock feed's filter);
//   · every story is one link, opened in a new tab, with the pin above it.
//
//   npx tsx scripts/news-front-pins.ts                              # the pure half
//   BASE=http://localhost:4730 npx tsx scripts/news-front-pins.ts   # + the served half
//
// Both halves run inside `npm run test:api`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewsItem } from '../lib/news-shared'
import { isQuotePage, newsLadderFor } from '../lib/news'
import {
  DAY_SEC,
  FRONT_BRIEFS,
  FRONT_FEATURES,
  FRONT_SECONDS,
  HOUR_SEC,
  frontPage,
  nameplate,
  plateDir,
  plateFor,
  platePath,
  priceAt,
  sinceLabel,
  sinceMove,
  type Bar,
} from '../lib/news-front'

type Check = (name: string, ok: boolean, extra?: string) => void

const code = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
const item = (i: number): NewsItem => ({ id: `id${i}`, title: `Story ${i}`, url: `https://example.com/${i}`, source: 'Wire', publishedAt: 1_800_000_000 - i * 3600 })
const feed = (n: number) => Array.from({ length: n }, (_, i) => item(i))

export function newsFrontPins(check: Check): void {
  // ── the deal ──
  const seated = (n: number) => {
    const p = frontPage(feed(n))
    return [...(p.lead ? [p.lead] : []), ...p.seconds, ...p.briefs, ...p.features, ...p.archive].map((x) => x.id)
  }
  const sizes = [0, 1, 2, 3, 4, 7, 8, 9, 10, 15, 16, 30, 50]
  check(
    'news front: every story lands in exactly one seat, in the feed\'s own order, at every feed length',
    sizes.every((n) => seated(n).join() === feed(n).map((x) => x.id).join()),
    sizes.filter((n) => seated(n).join() !== feed(n).map((x) => x.id).join()).join(','),
  )
  const full = frontPage(feed(30))
  check(
    'news front: a full feed seats 1 lead, 2 seconds, 4 in brief, 8 pictures and the rest in the archive',
    full.lead?.id === 'id0' && full.seconds.length === FRONT_SECONDS && full.briefs.length === FRONT_BRIEFS && full.features.length === FRONT_FEATURES && full.archive.length === 30 - 1 - FRONT_SECONDS - FRONT_BRIEFS - FRONT_FEATURES,
  )
  const thin = frontPage(feed(9))
  check(
    'news front: a picture row of one or two is a leftover and joins the archive; an empty feed seats nothing',
    thin.features.length === 0 && thin.archive.length === 2 && frontPage(feed(10)).features.length === 3 && frontPage([]).lead === null && frontPage([]).archive.length === 0,
    `${thin.features.length}/${thin.archive.length}`,
  )
  check(
    'news front: the nameplate reads "The <name> Edition", drops the corporate tail and never doubles "The"',
    nameplate('Ethereum') === 'The Ethereum Edition' && nameplate('Apple Inc.') === 'The Apple Edition' && nameplate('Applovin Corporation') === 'The Applovin Edition' &&
      nameplate('The Trade Desk Inc.') === 'The Trade Desk Edition' && nameplate('Nasdaq 100') === 'The Nasdaq 100 Edition' && nameplate('') === 'The Edition',
    [nameplate('Apple Inc.'), nameplate('The Trade Desk Inc.')].join(' | '),
  )

  // ── since ──
  const T0 = 1_800_000_000 - (1_800_000_000 % DAY_SEC)
  const hourly: Bar[] = Array.from({ length: 48 }, (_, i) => ({ t: T0 + i * HOUR_SEC, o: 100 + i, c: 101 + i }))
  const daily: Bar[] = Array.from({ length: 30 }, (_, i) => ({ t: T0 - (29 - i) * DAY_SEC, o: 50 + i, c: 51 + i }))
  check(
    'news front: the price when a story ran is on the open-to-close line inside its bar and the close once the bar has shut',
    priceAt(T0, hourly, daily) === 100 && priceAt(T0 + HOUR_SEC / 2, hourly, daily) === 100.5 && priceAt(T0 + 47 * HOUR_SEC + 2 * HOUR_SEC, hourly, daily) === 148,
    `${priceAt(T0 + HOUR_SEC / 2, hourly, daily)}`,
  )
  check(
    'news front: before the hourly tape the daily one answers; before both, nothing does',
    priceAt(T0 - 5 * DAY_SEC, hourly, daily) === 74 && priceAt(T0 - 60 * DAY_SEC, hourly, daily) === null && priceAt(T0, [], []) === null,
    `${priceAt(T0 - 5 * DAY_SEC, hourly, daily)}`,
  )
  const up = sinceMove(T0, 110, hourly, [])
  const down = sinceMove(T0, 95, hourly, [])
  const flat = sinceMove(T0, 100.02, hourly, [])
  check(
    'news front: "since" is the percent from the story\'s price to the last, signed in plain ASCII, "flat" under 0.05%',
    !!up && up.dir === 'up' && sinceLabel(up) === '+10%' && !!down && down.dir === 'down' && sinceLabel(down) === '-5.0%' && !!flat && flat.dir === 'flat' && sinceLabel(flat) === 'flat' &&
      [up, down].every((s) => /^[\x20-\x7e]+$/.test(sinceLabel(s!))),
    [up && sinceLabel(up), down && sinceLabel(down), flat && sinceLabel(flat)].join(' '),
  )
  check(
    'news front: no last price, or a story older than the tape, has no "since" at all',
    sinceMove(T0, null, hourly, []) === null && sinceMove(T0, 0, hourly, []) === null && sinceMove(T0 - DAY_SEC, 110, hourly, []) === null,
  )
  const tab = code('components/markets/news/NewsTab.tsx')
  check(
    'news front: the tab reads "since" off the HOURLY tape only and never in the archive (past a week the number is the trend, not the story)',
    /seat !== 'archive' \? sinceMove\(item\.publishedAt, tape\.last, tape\.hourly, NO_BARS\)/.test(tab),
  )

  // ── the plate ──
  const t = T0 + 30 * HOUR_SEC + HOUR_SEC / 2
  const plate = plateFor(t, hourly, daily)
  check(
    'news front: the plate is the hourly tape around the story with the mark between the bar it ran in and the next',
    // 24 hours back from T0+30.5h starts at the bar that opened at T0+7h: 41 bars to the end, the story half way through the 24th.
    !!plate && plate.grain === 'hour' && plate.closes.length === 41 && Math.abs(plate.mark - 23.5) < 1e-9,
    plate ? `${plate.closes.length} @ ${plate.mark}` : 'null',
  )
  const old = plateFor(T0 - 10 * DAY_SEC, hourly, daily)
  check(
    'news front: an older story falls to daily bars; a story the tape cannot frame has no plate',
    !!old && old.grain === 'day' && plateFor(T0 - 29 * DAY_SEC - 1, hourly, daily) === null && plateFor(t, hourly.slice(0, 3), []) === null,
    old ? `${old.grain} ${old.closes.length}` : 'null',
  )
  const path = plate ? platePath(plate, 320, 120, 14) : null
  const falling = { closes: [10, 9, 8, 7, 6, 5, 4], mark: 2, grain: 'hour' as const }
  check(
    'news front: the plate\'s paths stay inside the box, the tail starts at the mark, and the tail is coloured by what it drew',
    !!path && path.x > 0 && path.x < 320 && path.y >= 14 && path.y <= 106 && path.tail.startsWith(`M${path.x} ${path.y}`) && path.area.endsWith('Z') && !/NaN/.test(path.line + path.tail + path.area) &&
      plateDir(plate!) === 'up' && plateDir(falling) === 'down' && plateDir({ closes: [5, 5, 5, 5, 5, 5], mark: 1, grain: 'day' }) === 'flat' &&
      !/NaN/.test(platePath({ closes: [5, 5, 5, 5, 5, 5], mark: 1, grain: 'day' }, 320, 120).line),
  )
  check(
    'news front: only the LEAD wears a plate (stories cluster in time: a plate on every seat is one chart a dozen times)',
    /seat === 'lead' && !photo && tape\.ready \? plateFor\(/.test(tab),
  )

  // ── the feed ──
  check(
    'news front: a quote page is not a headline (an option chain, a "Stock Price, News, Quote & History" page), a story is',
    isQuotePage('AAPL Nov 2026 510.000 call (AAPL261118C00510000) Stock Price, News, Quote & History') && isQuotePage('Apple Inc. (AAPL) Stock Price, News, Quote & History') &&
      isQuotePage('AAPL Nov 2026 355.000 put (AAPL261118P00355000)') && !isQuotePage('Apple to stand trial in France over iPhone repair restrictions: report (AAPL:NASDAQ)') &&
      !isQuotePage('Apple puts a call option on its own history'),
  )
  const stock = newsLadderFor({ symbol: 'AAPL', source: 'robinhood', pair: 'AAPL', label: 'AAPL / USD' })
  const quote = { title: 'AAPL Nov 2026 510.000 call (AAPL261118C00510000) Stock Price, News, Quote & History', link: '', publishedAt: 1, description: '', source: '', tickers: '' }
  check(
    'news front: the stock ladder\'s search hop drops quote pages and keeps stories',
    stock[0].feed === 'google-news' && stock[0].keep?.(quote) === false && stock[0].keep?.({ ...quote, title: 'Apple names a new head of Apple Pay' }) === true,
  )

  // ── the page ──
  const css = code('components/markets/news/news.css')
  check(
    'news front: every story is ONE link, opened in a new tab, stretched over its block, with the pin above it',
    /<a className="gaz__link" href=\{item\.url\} target="_blank" rel="noopener noreferrer nofollow">/.test(tab) && /\.gaz__link::after \{ content: ''; position: absolute; inset: 0; z-index: 1; \}/.test(css) &&
      /\.gaz__pin \{\s*position: relative; z-index: 2;/.test(css) && /\.gaz__story \{ position: relative;/.test(css),
  )
  check(
    'news front: a picture is the feed\'s own, right-sized through next/image, and a broken one falls back instead of a hole',
    /import Image from 'next\/image'/.test(tab) && /<Image className="gaz__img" src=\{photo\} alt="" fill sizes=\{SIZES\[seat\]\}/.test(tab) && /onError=\{\(\) => setBroken\(true\)\}/.test(tab) &&
      /const photo = item\.imageUrl && !broken \? item\.imageUrl : null/.test(tab) && !/<img\b/.test(tab),
  )
  check(
    'news front: "Show on chart" still publishes the story to the chart, and the count links back to the chart',
    /toggleChartMarker\(symbol, \{ id: item\.id, t: item\.publishedAt, label: `\$\{item\.source\}: \$\{item\.title\}`, url: item\.url \}\)/.test(tab) && /aria-pressed=\{on\}/.test(tab) &&
      /onShowChart && \(/.test(tab) && /<NewsTab symbol=\{sym\} pair=\{pair\} onShowChart=\{showAChartTab\} \/>/.test(code('components/markets/shell/SymbolPage.tsx')),
  )
  check(
    'news front: the page keys off its own width (a container, never the viewport), headlines are upright serif, and the dateline is set after mount',
    /\.gaz \{\s*container: gaz \/ inline-size;/.test(css) && !/@media \((min|max)-width/.test(css) && /@container gaz \(min-width: 1180px\)/.test(css) &&
      /--gaz-serif: 'Fraunces'/.test(css) && !/font-style: italic/.test(css) && /useEffect\(\(\) => \{\s*setToday\(editionDate\(new Date\(\)\)\)/.test(tab),
  )
  // The prefix is this sheet's alone (Next's CSS is global once a chunk loads).
  const others = ['app/globals.css', 'app/x402-design.css', 'components/markets/markets.css', 'components/markets/comm.css', 'components/markets/chart/tape-view.css']
  const clash = others.filter((f) => /\.gaz(__|--|\b)/.test(code(f)))
  check('news front: the `gaz` prefix appears in no other stylesheet', clash.length === 0, clash.join(', '))
}

export async function newsFrontServedPins(check: Check, BASE: string): Promise<void> {
  try {
    const html = await (await fetch(`${BASE}/t/ETH?tab=news`)).text()
    check(
      'news front (served): /t/ETH?tab=news renders the nameplate, the refresh and the community pin section on the server',
      /<div class="gaz" data-news="front-page">/.test(html) && /<h2 class="gaz__name">The Ethereum Edition<\/h2>/.test(html) && /aria-label="Refresh headlines"/.test(html) && /Pinned by the community/.test(html),
    )
    const stock = await (await fetch(`${BASE}/t/AAPL?tab=news`)).text()
    check('news front (served): a stock wears its company\'s name without the corporate tail', /<h2 class="gaz__name">The Apple Edition<\/h2>/.test(stock))
    const r = await fetch(`${BASE}/api/news?symbol=AAPL&limit=50`)
    const d = (await r.json()) as { items?: NewsItem[] }
    const quotes = (d.items ?? []).filter((i) => isQuotePage(i.title))
    check('news front (served): the stock feed carries no quote page', r.ok && quotes.length === 0, quotes.map((q) => q.title).slice(0, 2).join(' | '))
  } catch (err) {
    check('news front (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('news-front-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    newsFrontPins(check)
    if (process.env.BASE) await newsFrontServedPins(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} news front pins failed` : `\nall ${n} news front pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
