// Pins for the share that carries the pick (GTM squad 2026-10-13, lane CARD):
// lib/live-share (the URL, the card's URL, the words, the rows), the card
// route's and the page's source rules, and — behind `--serve` — a running
// `next start`: the card answers PNGs, garbage answers the generic card, and
// /live's metadata points at the route only when `t` names a market.
//
//   npm run pins:card                                   pure + source
//   npm run pins:card -- --serve [--base http://localhost:4044] [--baseline og.txt] [--save card.png]
//
// `--baseline` is a sorted list of /live's og/twitter <meta> lines from the
// build before this lane (the generic page must be byte-identical); `--save`
// writes the `?view=front&t=HYPE,ETH,SOL` card to look at.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_WINDOW, MAX_ARMIES } from '../lib/battle'
import {
  ARMY_INKS, CARD_PATH, MAX_T_CHARS,
  cardAlt, cardEyebrow, cardPathFor, shareText, cardRankNote, cardRowHeight, cardRows, cardUrlFor, firstParam, groundShare, headlineSize, listWords, liveSharePath, matchVenue, parseLiveShare, shareDescription, shareTitle, shareUrlFor,
  type VenueRow,
} from '../lib/live-share'
import { MAX_PICK, parsePickParam } from '../lib/market-pick'
import { SITE_URL } from '../lib/site-url'

let pass = 0
let fail = 0
function pin(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} card: ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const src = (p: string) => readFileSync(p, 'utf8')
const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function pure() {
  // ── the inks are the battle views' own ──
  const css = src('components/live/battle.css')
  const darkBlock = css.slice(css.indexOf('.battle {'), css.indexOf('}', css.indexOf('.battle {')))
  const darkInks = [1, 2, 3, 4, 5].map((n) => (darkBlock.match(new RegExp(`--army-${n}:\\s*(#[0-9a-fA-F]{6})`)) ?? [])[1]?.toLowerCase())
  pin('the card\'s five inks are battle.css\'s dark --army-1..5', eq([...ARMY_INKS], darkInks), `card ${ARMY_INKS.join(',')} vs css ${darkInks.join(',')}`)

  // ── the share URL ──
  pin('a pasted link reads plainly: literal commas and the dex colon', shareUrlFor('siege', ['ZK', 'xyz:NVDA'], '4h', 'https://x.test') === 'https://x.test/live?view=siege&t=ZK,xyz:NVDA&since=4h')
  const u = new URL(shareUrlFor('front', ['ZK', 'OP', 'AZTEC'], '4h'))
  pin('the share URL is absolute on the canonical origin, /live', u.origin === new URL(SITE_URL).origin && u.pathname === '/live', u.href)
  pin('the share URL round-trips through parsePickParam (t), carries view + a battle window', eq(parsePickParam(u.searchParams.get('t')), ['ZK', 'OP', 'AZTEC']) && u.searchParams.get('view') === 'front' && u.searchParams.get('since') === '4h', u.search)
  const stock = new URL(shareUrlFor('siege', ['HYPE', 'xyz:NVDA']))
  pin('a stock perp keeps its xyz: spelling; the default window is not spelled out', eq(parsePickParam(stock.searchParams.get('t')), ['HYPE', 'xyz:NVDA']) && !stock.searchParams.has('since'), stock.search)
  const tape = new URL(shareUrlFor('tape', ['UNI', 'ETH'], '4h'))
  pin('the tape drops view and since (it has no window)', !tape.searchParams.has('view') && !tape.searchParams.has('since') && tape.searchParams.get('t') === 'UNI,ETH', tape.search)
  const many = Array.from({ length: 12 }, (_, i) => `M${i}`)
  pin('the share caps at MAX_PICK and drops bad shapes', parsePickParam(new URL(shareUrlFor('front', [...many, '0xdead', 'bad token'])).searchParams.get('t')).length === MAX_PICK && !shareUrlFor('front', ['ETH', '<b>', 'ETH']).includes('%3Cb'))
  pin('an empty pick shares the bare view (the generic card unfurls)', liveSharePath('front', []) === '/live?view=front' && liveSharePath('tape', []) === '/live')
  pin('an origin with a trailing slash still makes one slash', shareUrlFor('tape', ['ETH'], DEFAULT_WINDOW, 'http://localhost:4044/') === 'http://localhost:4044/live?t=ETH')

  // ── what the card reads ──
  pin('no t → no share (generic card)', parseLiveShare({}) === null && parseLiveShare({ view: 'front' }) === null && parseLiveShare({ t: '' }) === null)
  pin('garbage t → no share', parseLiveShare({ t: '<script>alert(1)</script>' }) === null && parseLiveShare({ t: '0xdead,,,' }) === null && parseLiveShare({ t: '../../etc' }) === null)
  pin(`a t longer than ${MAX_T_CHARS} chars → no share (bounded before it is split)`, parseLiveShare({ t: 'A,'.repeat(200) }) === null && parseLiveShare({ t: 'ETH,'.repeat(10) })?.pick.length === 1)
  const eight = parseLiveShare({ view: 'front', t: 'A,B,C,D,E,F,G,H', since: '15m' })
  pin('a battle draws the first five; the pick keeps all eight; the window parses', !!eight && eight.markets.length === MAX_ARMIES && eight.pick.length === 8 && eight.since === '15m')
  const tp = parseLiveShare({ view: 'tape', t: 'a,b,c,d,e,f,g,h', since: '4h' })
  pin('the tape draws the whole pick and has no window', !!tp && tp.markets.length === 8 && tp.since === DEFAULT_WINDOW && eq(tp.markets.slice(0, 2), ['A', 'B']))
  pin('unknown view → tape; unknown window → the default; a repeated key reads its first', parseLiveShare({ view: 'nope', t: 'ETH' })?.view === 'tape' && parseLiveShare({ view: 'map', t: 'ETH', since: '7y' })?.since === DEFAULT_WINDOW && parseLiveShare({ t: ['HYPE', 'ETH'] })?.pick[0] === 'HYPE' && firstParam([]) === null)
  const back = new URLSearchParams(cardPathFor({ view: 'siege', pick: ['ZK', 'xyz:NVDA'], since: '24h' }).split('?')[1])
  const reread = parseLiveShare({ view: back.get('view'), t: back.get('t'), since: back.get('since') })
  pin('the card path round-trips: what the page writes, the card reads', cardPathFor({ view: 'siege', pick: ['ZK'], since: '1h' }).startsWith(`${CARD_PATH}?`) && !!reread && reread.view === 'siege' && eq(reread.pick, ['ZK', 'xyz:NVDA']) && reread.since === '24h')
  pin('the card URL is absolute', cardUrlFor({ view: 'front', pick: ['ETH'], since: '1h' }).startsWith(`${SITE_URL}${CARD_PATH}?view=front&t=ETH`))

  // ── the words ──
  pin('the title names the markets, the view and the window', shareTitle('front', ['ZK', 'OP', 'AZTEC'], '1h') === 'ZK · OP · AZTEC on The Front · 1h' && shareTitle('siege', ['HYPE'], 'open') === 'HYPE on The Siege · since open' && shareTitle('tape', ['xyz:NVDA', 'ETH']) === 'NVDA · ETH on the live tape')
  pin('a battle share carries ARENA\'s challenge + the view; the tape keeps the plain line', shareText('front', ['ZK', 'OP', 'AZTEC'], '1h') === "ZK vs OP vs AZTEC · 1h · who's winning on The Front" && shareText('siege', ['ZK'], '4h') === 'ZK · 4h · where it stands on The Siege' && shareText('map', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], '1h') === "A vs B vs C vs D vs E +3 · 1h · who's winning on The Map" && shareText('tape', ['UNI']) === 'UNI on the live tape')
  pin('list words', listWords(['ZK']) === 'ZK' && listWords(['ZK', 'OP']) === 'ZK and OP' && listWords(['ZK', 'OP', 'AZTEC']) === 'ZK, OP and AZTEC' && listWords([]) === '')
  pin('a battle\'s alt says the 24h proxy, never the live window', /ranked by the venue's 24h move/.test(cardAlt('front', ['ZK', 'OP'])) && /Hyperliquid/.test(cardAlt('front', ['ZK'])) && !/\b1h\b|live window|since open/.test(cardAlt('front', ['ZK'])))
  pin('the tape\'s alt names what it draws', cardAlt('tape', ['UNI']) === 'Pantessa Live — the tape for UNI: last price, 24h move and open interest from Hyperliquid.')
  pin('the card says "24H" on a battle and names the window as the browser\'s', /STANDINGS BY THE VENUE'S 24H MOVE/.test(cardRankNote('front', '1h')[0]) && cardRankNote('front', '1h')[1] === 'THE 1H FIGHT ITSELF RUNS LIVE IN YOUR BROWSER' && cardRankNote('siege', 'open')[1] === 'THE FIGHT ITSELF RUNS LIVE IN YOUR BROWSER' && cardEyebrow('map', '4h') === 'THE MAP · 4H WINDOW' && cardEyebrow('front', 'open') === 'THE FRONT · SINCE OPEN')
  pin('descriptions name every market and never credit a feed for the card\'s numbers', /ZK, OP and AZTEC/.test(shareDescription('front', ['ZK', 'OP', 'AZTEC'], '1h')) && /over the last hour/.test(shareDescription('front', ['ZK'], '1h')) && !/Dune/.test(shareDescription('front', ['ZK'], '1h') + shareDescription('tape', ['ZK'])))
  pin('everything the card and the metadata print is ASCII-safe for a bot (no control chars)', ![shareTitle('front', ['ZK'], '1h'), cardAlt('front', ['ZK']), shareDescription('map', ['ZK'], '24h')].some((s) => /[\u0000-\u001f]/.test(s)))

  // ── the rows ──
  const venue: VenueRow[] = [
    { name: 'kPEPE', markPx: 0.01, prevDayPx: 0.008, openInterest: 1e9 },
    { name: 'ZK', markPx: 0.05, prevDayPx: 0.05, openInterest: 2e6 },
    { name: 'OP', markPx: 1.1, prevDayPx: 1, openInterest: 3e6 },
    { name: 'AZTEC', markPx: 2, prevDayPx: 2.5, openInterest: 1e5 },
  ]
  pin('venue names match case-insensitively (?t= upper-cases kPEPE)', matchVenue(['KPEPE', 'NOPE'], venue)[0]?.name === 'kPEPE' && matchVenue(['NOPE'], venue)[0] === null)
  const rows = cardRows({ view: 'front', markets: ['ZK', 'OP', 'AZTEC', 'NOPE'] }, venue)
  pin('a battle ranks by the 24h move; an unlisted market sorts last with no rank and keeps its slot ink', eq(rows.map((r) => [r.market, r.rank, r.slot]), [['OP', 1, 2], ['ZK', 2, 1], ['AZTEC', 3, 3], ['NOPE', null, 4]]) && rows[3].listed === false && rows[3].last === null)
  pin('the numbers are the venue\'s: 24h from prevDayPx, OI in dollars (coins × mark)', Math.abs((rows[0].chgPct ?? 0) - 10) < 1e-9 && Math.abs((rows[0].oiUsd ?? 0) - 3.3e6) < 1e-6 && Math.abs((rows[2].chgPct ?? 0) + 20) < 1e-9)
  const tapeRows = cardRows({ view: 'tape', markets: ['AZTEC', 'OP'] }, venue)
  pin('the tape keeps the pick\'s order and no rank', eq(tapeRows.map((r) => r.market), ['AZTEC', 'OP']) && tapeRows.every((r) => r.rank === null))
  const miss = cardRows({ view: 'front', markets: ['ZK', 'OP'] }, null)
  pin('a feed miss draws every number as a dash (nulls), never a guess', miss.every((r) => r.last === null && r.chgPct === null && r.oiUsd === null && !r.listed && r.rank === null) && miss.length === 2)
  pin('a bad venue number is no number', cardRows({ view: 'tape', markets: ['X'] }, [{ name: 'X', markPx: -1, prevDayPx: Number.NaN, openInterest: 5 }])[0].last === null)
  pin('a ground bar is the signed move over the largest |move| on the card, bounded −1..1', Math.abs(groundShare(10, rows) - 0.5) < 1e-9 && Math.abs(groundShare(-20, rows) + 1) < 1e-9 && groundShare(1e6, rows) === 1 && groundShare(-1e6, rows) === -1 && groundShare(null, rows) === 0 && groundShare(5, miss) === 0)
  pin('rows share the panel inside a band per view', cardRowHeight('front', 2) === 96 && cardRowHeight('front', 5) === 72 && cardRowHeight('tape', 8) === 45 && cardRowHeight('tape', 1) === 58 && cardRowHeight('map', 0) === 96 && 5 * cardRowHeight('siege', 5) <= 360 && 8 * cardRowHeight('tape', 8) <= 360)
  pin('the headline shrinks as the names grow, never below 38', headlineSize(['ZK', 'OP'], true) === 88 && headlineSize(['FARTCOIN', 'GRIFFAIN', 'AZTEC'], true) < 88 && headlineSize(Array.from({ length: 8 }, () => 'ABCDEFGHIJKL'), false) === 38)

  // ── source rules ──
  const route = src('app/api/og/live/route.tsx')
  pin('the route reads the venue once with a timeout, the xyz dex only for a stock perp', /metaAndAssetCtxs/.test(route) && /AbortSignal\.timeout\(/.test(route) && /wantXyz/.test(route) && !/wss:/.test(route))
  pin('the route never 500s: a throw falls to the generic card, a generic throw redirects to /live\'s own; a pick the venue lists none of is generic', /catch \{\s*return generic\(\)/.test(route) && /if \(!out\) return generic\(\)/.test(route) && /!rows\.some\(\(r\) => r\.listed\)/.test(route) && /status: 307/.test(route) && /\/live\/opengraph-image/.test(route) && !/status: 5\d\d/.test(route))
  pin('a live card holds ~60s, a warming one 15s; the miss says so', /max-age=60/.test(route) && /max-age=15/.test(route) && /FEED WARMING UP/.test(route) && /24H MOVE/.test(route) && /cardRankNote\(/.test(route))
  pin('the card credits only Hyperliquid for its numbers', /PRICES · HYPERLIQUID/.test(route) && !/Dune/i.test(route.replace(/^\s*\/\/.*$/gm, '')))
  const page = src('app/live/page.tsx')
  pin('/live: generateMetadata reads searchParams, no static metadata export, still force-dynamic, never fetches', /export async function generateMetadata\(\{ searchParams \}/.test(page) && !/export const metadata/.test(page) && /export const dynamic = 'force-dynamic'/.test(page) && !/fetch\(/.test(page.slice(page.indexOf('generateMetadata'), page.indexOf('export const dynamic'))))
  pin('/live: no share → the page\'s own metadata, no images key (the file card stays)', /if \(!share\) return BASE/.test(page) && !/images/.test(page.slice(page.indexOf('const BASE'), page.indexOf('\n}\n', page.indexOf('const BASE')))))
  const share = src('components/live/ShareLive.tsx')
  pin('the share control: a journey label per view, the URL from lib/live-share, the window read on press', /data-journey=\{`Share \$\{view\}`\}/.test(share) && /shareUrlFor\(/.test(share) && /window\.location\.search/.test(share.slice(share.indexOf('const onShare'), share.indexOf('const word'))) && !/useSearchParams/.test(share))
  pin('the share control: clipboard with a Copied state, navigator.share under a coarse pointer, 44px under a thumb', /navigator\.clipboard/.test(share) && /'Copied'/.test(share) && /navigator\.share\(/.test(share) && /pointer: coarse/.test(share) && /inset: -4px/.test(share) && /hover: none/.test(share))
  pin('the share control renders nothing market-shaped (the server HTML and the first client render agree)', !/\{list|\{chosen|\{markets|\{pick\.markets/.test(share.slice(share.indexOf('return (\n    <>'))))
}

async function serve() {
  const BASE = (arg('--base') ?? 'http://localhost:4044').replace(/\/$/, '')
  const BOT = { 'user-agent': 'Twitterbot/1.0' }
  const get = (p: string, headers: Record<string, string> = {}) => fetch(`${BASE}${p}`, { headers, signal: AbortSignal.timeout(45_000) })
  const pngOf = async (p: string) => {
    const r = await get(p)
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, type: r.headers.get('content-type') ?? '', cache: r.headers.get('cache-control') ?? '', card: r.headers.get('x-pantessa-card') ?? '', buf, magic: buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' }
  }
  const ogLines = (html: string) => (html.match(/<meta (property|name)="(og|twitter):[^"]*" content="[^"]*"/g) ?? []).sort()
  const ogOf = (html: string, key: string) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&') ?? null

  const card = await pngOf('/api/og/live?view=front&t=HYPE,ETH,SOL')
  pin(`serve: ?view=front&t=HYPE,ETH,SOL → 200 PNG, non-trivial (${card.buf.length} B, ${card.cache})`, card.status === 200 && card.type === 'image/png' && card.magic && card.buf.length > 20_000 && /max-age=(60|15)/.test(card.cache))
  const save = arg('--save')
  if (save && card.magic) {
    writeFileSync(save, card.buf)
    console.log(`  · saved ${save}`)
  }
  const two = await pngOf('/api/og/live?t=HYPE,ETH&view=front')
  pin(`serve: ?t=HYPE,ETH&view=front → 200 PNG (${two.buf.length} B)`, two.status === 200 && two.type === 'image/png' && two.magic && two.buf.length > 20_000)
  const tapeCard = await pngOf('/api/og/live?t=xyz:NVDA,KPEPE,UNI')
  pin(`serve: a tape card with a stock perp and a k-coin → 200 PNG (${tapeCard.buf.length} B)`, tapeCard.status === 200 && tapeCard.magic && tapeCard.buf.length > 20_000)
  pin(`serve: a real pick is the pick composition (x-pantessa-card: ${card.card})`, card.card === 'pick' || card.card === 'warming')
  // QA's gate probes, verbatim shapes: garbage, a 10KB t, fifty unlisted markets, no input, a hostile view.
  const garbage = await pngOf('/api/og/live?t=%3Cscript%3Ealert(1)%3C%2Fscript%3E,%00,../../etc,%F0%9F%92%A9&view=%22onload')
  const bare = await pngOf('/api/og/live')
  const long = await pngOf(`/api/og/live?t=${'A'.repeat(10240)}&view=map`)
  const fifty = await pngOf(`/api/og/live?t=${Array.from({ length: 50 }, (_, i) => `M${i}`).join(',')}&view=siege`)
  const hostile = await pngOf(`/api/og/live?view=${encodeURIComponent('"><svg/onload=alert(1)>')}&t=${encodeURIComponent('<img src=x onerror=alert(1)>,"><script>alert(2)</script>')}`)
  const generics = { garbage, bare, long, fifty, hostile }
  pin(
    `serve: garbage / no input / a 10KB t / fifty unlisted markets / a hostile view → 200, the generic composition (${Object.entries(generics).map(([k, r]) => `${k} ${r.status} ${r.card} ${r.buf.length}B`).join(' · ')})`,
    Object.values(generics).every((r) => r.status === 200 && r.type === 'image/png' && r.magic && r.buf.length > 20_000 && r.card === 'generic'),
  )
  const noView = await pngOf('/api/og/live?t=HYPE')
  pin(`serve: no view is the tape's pick card (${noView.card})`, noView.status === 200 && noView.magic && (noView.card === 'pick' || noView.card === 'warming'))

  const withT = await (await get('/live?t=HYPE', BOT)).text()
  const img = ogOf(withT, 'og:image')
  const tw = ogOf(withT, 'twitter:image')
  pin(`serve: /live?t=HYPE carries og:image + twitter:image at the route (${img})`, !!img && img.includes(`${CARD_PATH}?view=tape&t=HYPE`) && !!tw && tw.includes(`${CARD_PATH}?view=tape&t=HYPE`) && /HYPE on the live tape · Pantessa Live/.test(ogOf(withT, 'og:title') ?? ''))
  pin('serve: /live?t=HYPE carries no generic file card beside it', !/\/live\/opengraph-image|\/live\/twitter-image/.test(withT.match(/<head>[\s\S]*?<\/head>/)?.[0] ?? withT))
  const front = await (await get('/live?view=front&t=ZK,OP,AZTEC&since=4h', BOT)).text()
  pin('serve: a battle share names the markets, the view and the window', (ogOf(front, 'og:title') ?? '').replace(/&#x27;/g, "'") === "ZK vs OP vs AZTEC · 4h · who's winning on The Front · Pantessa Live" && (ogOf(front, 'og:image') ?? '').includes(`${CARD_PATH}?view=front&t=ZK%2COP%2CAZTEC&since=4h`) && /ranked by the venue&#x27;s 24h move|ranked by the venue's 24h move/.test(front))
  if (img) {
    const path = new URL(img).pathname + new URL(img).search
    const followed = await pngOf(path)
    pin(`serve: the og:image the page names answers a PNG here (${path})`, followed.status === 200 && followed.magic)
  }
  const plain = await (await get('/live', BOT)).text()
  const plainOg = ogLines(plain)
  const baseline = arg('--baseline')
  if (baseline && existsSync(baseline)) {
    const before = readFileSync(baseline, 'utf8').trim().split('\n').sort()
    pin(`serve: /live without t — og/twitter tags byte-identical to the pre-change build (${plainOg.length} tags)`, eq(plainOg, before), plainOg.filter((l) => !before.includes(l)).join(' | '))
  } else {
    pin('serve: /live without t keeps the file card and the page title', /\/live\/opengraph-image/.test(ogOf(plain, 'og:image') ?? '') && ogOf(plain, 'og:title') === 'Live feed — every print is a button')
  }
  const junk = await (await get(`/live?t=${encodeURIComponent('<b>')}`, BOT)).text()
  pin('serve: /live with a garbage t is the generic page', eq(ogLines(junk), plainOg))
  if (existsSync('.next/prerender-manifest.json')) {
    const m = JSON.parse(readFileSync('.next/prerender-manifest.json', 'utf8')) as { routes?: Record<string, { initialRevalidateSeconds?: number | false }> }
    const root = m.routes?.['/']
    pin(`serve: / is still prerendered ISR (revalidate ${root?.initialRevalidateSeconds})`, !!root && typeof root.initialRevalidateSeconds === 'number' && root.initialRevalidateSeconds > 0)
  }
}

async function main() {
  pure()
  if (process.argv.includes('--serve')) await serve()
  console.log(`\ncard pins: ${pass} passed / ${fail} failed`)
  if (fail) process.exit(1)
}
main().catch((err) => {
  console.error(err)
  process.exit(1)
})
