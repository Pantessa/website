// Pins for squad landing, lane SIDES-A (2026-11-10): the Charts, Ask, Links and Earn panels.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-sides-a-pins.ts            (npm run pins:landing-sides-a)
//   BASE=http://localhost:PORT npx tsx scripts/landing-sides-a-pins.ts --served
//
// What is pinned, and why each would go red:
//   • every sentence a panel can produce is the product's own composer's and
//     passes the venue gate with no verdicts (a hand-written sentence, or a
//     side the ticket does not offer, fails);
//   • the link split's arithmetic, from fee-line-shaped input, against
//     lib/fees' own creator math (a typed rate or a rounding drift fails);
//   • the ladder is the Earn board's own order and a row's sentence is the
//     board's own for the amount (a re-rank or a rewritten sentence fails);
//   • each panel's wiring, read from source: the hands it uses, the read it
//     polls and when, what it shows with nothing read.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MINI_DEFAULT_USD, MINI_LEVERAGE, MINI_SIZES, MINI_SYMBOLS, acceptMiniMarket, miniMarketUrl, miniMarkets, miniSideLabel, miniTicket, miniUnits, splitAtAmount } from '../components/home/tour/sides/a/mini-market'
import { LADDER_AMOUNTS, LADDER_DEFAULT_USD, LADDER_ROWS, LADDER_URL, acceptLadder, fmtAsOfUtc, ladderBarPct, ladderFromLive, ladderFromSeed, yearlyUsd } from '../components/home/tour/sides/a/ladder'
import { LINK_DEFAULT_READERS, LINK_READER_CHOICES, fmtRoundUsd, fmtSplitUsd, linkSplit, shareWords } from '../components/home/tour/sides/a/split'
import { FIRST_PARTY_APP_SLUGS, askAppSlugs } from '../lib/ask-apps'
import { moneyShaped } from '../lib/ask-failure-shape'
import { EARN_AMOUNTS, EARN_DEFAULT_USD, aaveRows, lidoRow, morphoRows, rankEarnRows, rowsFromWire, rowsToWire, yieldLadder } from '../lib/earn'
import { EXAMPLE_PROMPTS } from '../lib/examples'
import { CREATOR_FEE_SPLIT, LINK_SWAP_FEE_BPS, creatorEarningsUsd } from '../lib/fees'
import { HOME_APPS } from '../lib/home-apps'
import { EMPTY_TOUR, tourBody, tourFacts, type TourEarnRow } from '../lib/home-tour'
import { meta as askMeta } from '../lib/home-tour/ask'
import { meta as chartsMeta } from '../lib/home-tour/charts'
import { meta as earnMeta } from '../lib/home-tour/earn'
import { meta as linksMeta } from '../lib/home-tour/links'
import { tourFees } from '../lib/home-tour-server'
import { TICKET_DEFAULT_USD, TICKET_LEVERAGE_PRESETS, TICKET_USD_PRESETS, composeTicketAsk, freshTicket, ticketSidesFor } from '../lib/order-ticket'
import { canTradeAsk } from '../lib/trade-venue-gate'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source with comments removed, so a rule is read from code and never from prose. */
const code = (p: string) =>
  read(p)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const SIDES = 'components/home/tour/sides'

/** A wire body built by the Earn board's own row builders (lib/earn), so the
 *  fixture is the route's real shape and its sentences are the board's own. */
function earnFixture() {
  const HEX = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
  const ethUsd = 2000
  const rows = [
    ...aaveRows([
      { asset: { symbol: 'USDT' }, active: true, canSupply: true, supplyApyPct: 8.97, suppliedUsd: '$1,000,000', spoke: 'Main' },
      { asset: { symbol: 'USDT' }, active: true, canSupply: true, supplyApyPct: 3.1, suppliedUsd: '$400,000', spoke: 'Lido' },
      { asset: { symbol: 'USDC' }, active: true, canSupply: true, supplyApyPct: 3.4, suppliedUsd: '$9,000,000', spoke: 'Main' },
      { asset: { symbol: 'WBTC' }, active: true, canSupply: true, supplyApyPct: 0, suppliedUsd: '$5,000,000', spoke: 'Main' },
      { asset: { symbol: 'DAI' }, active: false, canSupply: true, supplyApyPct: 9.9, suppliedUsd: '$1', spoke: 'Main' },
    ]),
    lidoRow(2.32, 20_000_000_000, ethUsd),
    ...morphoRows(
      [
        { marketId: HEX(1), curated: true, loan: 'USDC', collateral: 'cbBTC', supplyApy: '5.33%', totalSupplyUsd: 90_000_000 },
        { marketId: HEX(2), curated: true, loan: 'USDC', collateral: 'WETH', supplyApy: '9.99%', totalSupplyUsd: 1_000_000 },
        { marketId: HEX(3), curated: true, loan: 'WETH', collateral: 'wstETH', supplyApy: '1.9%', totalSupplyUsd: 50_000_000 },
      ],
      8453,
    ),
    ...morphoRows([{ marketId: HEX(4), curated: true, loan: 'APXUSD', collateral: 'WETH', supplyApy: '6.85%', totalSupplyUsd: 2_000_000 }], 1),
  ]
  return { rows: rowsToWire(rows, ethUsd), failed: [], ethUsd, asOf: '2026-11-10T14:32:10.000Z' }
}

export function landingSidesAPins(check: Check): void {
  // ── CHARTS: the ticket in miniature ──
  const markets = miniMarkets()
  check(
    'sides-a charts: the miniature shows a stock, a coin and a perp (one of each kind the app charts), each with the opening sides its OWN order ticket offers — a stock buys, a coin buys or longs, a perp longs',
    markets.map((m) => m.symbol).join() === MINI_SYMBOLS.join() &&
      markets.map((m) => m.kind).join() === 'stock,coin,perp' &&
      markets.every((m) => m.sides.length > 0 && m.sides.every((s) => ticketSidesFor(m.pair).includes(s))) &&
      markets[0].sides.join() === 'buy' &&
      markets[1].sides.join() === 'buy,long' &&
      markets[2].sides.join() === 'long' &&
      miniMarkets(['NOPE_NOT_A_SYMBOL_', 'US10Y']).length === 0,
    markets.map((m) => `${m.symbol}:${m.kind}:${m.sides.join('+')}`).join(' '),
  )
  check(
    "sides-a charts: the sizes are the order ticket's own presets from its default up, the default is the ticket's, and the long's leverage is the ticket's own preset",
    MINI_SIZES.join() === TICKET_USD_PRESETS.filter((n) => n >= TICKET_DEFAULT_USD).join() && MINI_SIZES.length >= 3 && MINI_DEFAULT_USD === TICKET_DEFAULT_USD && MINI_SIZES.includes(MINI_DEFAULT_USD) && (TICKET_LEVERAGE_PRESETS as readonly number[]).includes(MINI_LEVERAGE) && MINI_LEVERAGE > 1 && miniSideLabel('long') === `Long ${MINI_LEVERAGE}x` && miniSideLabel('buy') === 'Buy',
    `sizes ${MINI_SIZES.join('/')} · ${MINI_LEVERAGE}x`,
  )
  const produced: string[] = []
  const bad: string[] = []
  for (const m of markets) {
    for (const side of m.sides) {
      for (const usd of MINI_SIZES) {
        // No live price on purpose: a sentence must exist on the server's first frame.
        const t = miniTicket(m.pair, side, usd, null)
        const own = composeTicketAsk(m.pair, { ...freshTicket(m.pair, side, { usd }), leverage: side === 'long' ? MINI_LEVERAGE : 1 }, null)
        const shape = side === 'buy' ? new RegExp(`^Buy \\$${usd} of ${m.symbol}$`) : new RegExp(`^${MINI_LEVERAGE}x Long \\$${usd} of ${m.symbol} on Hyperliquid$`)
        if (!t.ok || !own.ok || t.ask !== own.ask || !shape.test(t.ask) || !canTradeAsk(t.ask, null) || !canTradeAsk(t.ask, {}) || /[^\x20-\x7e]/.test(t.ask)) bad.push(`${m.symbol}/${side}/${usd}`)
        else produced.push(t.ask)
        const parts = t.ok ? splitAtAmount(t.ask, usd) : null
        if (!parts || parts.amount !== `$${usd}` || `${parts.before}${parts.amount}${parts.after}` !== (t.ok ? t.ask : '')) bad.push(`split ${m.symbol}/${side}/${usd}`)
      }
    }
  }
  check(
    "sides-a charts: every sentence the ticket can produce (market x side x size) is the order ticket's own composer's, in the grammar the layers read, plain ASCII, passes the venue gate with no verdicts, and splits cleanly around its amount",
    bad.length === 0 && produced.length === markets.reduce((n, m) => n + m.sides.length, 0) * MINI_SIZES.length,
    bad.join(' ') || `${produced.length} sentences`,
  )
  check(
    'sides-a charts: changing the size changes the sentence (the claim) — every size of a market and side is a different sentence, and no two cells of the grid share one',
    new Set(produced).size === produced.length,
    `${new Set(produced).size}/${produced.length} distinct`,
  )
  check(
    "sides-a charts: the side's words-file sentences are ones its own ticket produces at the default size (the audit covers what the panel offers)",
    chartsMeta.asks.length > 0 && chartsMeta.asks.every((a) => produced.includes(a.ask) && a.ask.includes(`$${MINI_DEFAULT_USD} `)),
    chartsMeta.asks.map((a) => a.ask).join(' | '),
  )
  check(
    'sides-a charts: a spot buy states its estimate in units only with a live price; a perp never states one (its size is the venue\'s to say)',
    miniUnits('buy', 25, 348.63) === '0.07171' && miniUnits('buy', 25, null) === null && miniUnits('buy', 25, 0) === null && miniUnits('long', 25, 72) === null,
  )
  const cand = (n: number, from = 100) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 3600, o: 1, h: 1, l: 1, c: from + i, v: 1 }))
  const mm = acceptMiniMarket({ candles: cand(5), last: 104.5, changePct24h: -1.25 })
  check(
    "sides-a charts: the candles route's body becomes a market only when it is an answer — an error body, fewer than two bars, a non-positive close or junk is NULL (the tile shows a dash, never a made-up price); a missing `last` falls back to the last close and a missing change stays unstated",
    mm !== null &&
      mm.last === 104.5 &&
      mm.chg === -1.25 &&
      mm.points.length === 5 &&
      mm.points[0][1] === 100 &&
      acceptMiniMarket({ candles: cand(3) })?.last === 102 &&
      acceptMiniMarket({ candles: cand(3) })?.chg === null &&
      acceptMiniMarket({ candles: cand(1) }) === null &&
      acceptMiniMarket({ candles: cand(5), error: 'feed down' }) === null &&
      acceptMiniMarket({ candles: [{ t: 1, c: 0 }, { t: 2, c: -4 }, { t: 3, c: 'x' }] }) === null &&
      acceptMiniMarket(null) === null &&
      acceptMiniMarket('nope') === null &&
      acceptMiniMarket({}) === null &&
      miniMarketUrl('AAPL') === '/api/charts/candles?symbol=AAPL&tf=1h',
  )
  const charts = code(`${SIDES}/Charts.tsx`)
  check(
    'sides-a charts (source): the sentence comes from miniTicket and nowhere else, the button runs it through act() only when canAct says its venue can, each market reads the candles route through the gated poll (on screen + tab visible), and the door to the full chart is the one LandingLink',
    /miniTicket\(market\.pair, side, usd, last\)/.test(charts) &&
      /const runnable = ask !== null && canAct\(ask\)/.test(charts) &&
      /onClick=\{\(\) => act\(ask\)\}/.test(charts) &&
      (charts.match(/usePolled\(miniMarketUrl\(/g) ?? []).length === 3 &&
      (charts.match(/active && MARKETS\.length > \d/g) ?? []).length === 3 &&
      /useOnScreen<HTMLDivElement>\(\)/.test(charts) &&
      /<LandingLink href=\{`\/t\/\$\{market\.symbol\}`\}/.test(charts) &&
      !/`(?:Buy|Long|\d+x) \$/.test(charts) &&
      !/['"`](?:Buy|Sell|Long|Short) \$\{?/.test(charts),
  )

  // ── ASK: the composer ──
  const askBad = askMeta.asks.filter((a) => !canTradeAsk(a.ask, null) || !moneyShaped(a.ask) || !FIRST_PARTY_APP_SLUGS.has(askAppSlugs(a.ask)[0] ?? ''))
  check(
    'sides-a ask: every example row is an ORDER (money-shaped) that passes the venue gate with no verdicts, and the first app its sentence composes is a first-party one (the mark beside the row is that app\'s)',
    askMeta.asks.length >= 3 && askBad.length === 0,
    askBad.map((a) => a.ask).join(' | ') || askMeta.asks.map((a) => askAppSlugs(a.ask)[0]).join(' '),
  )
  const question = EXAMPLE_PROMPTS.find((p) => p.prompt.endsWith('?') && !/\bmy\b/i.test(p.prompt))
  check(
    "sides-a ask: the question row is the chat's own no-wallet example (lib/examples) — a read, not money-shaped, and not about the visitor's own wallet",
    !!question && !moneyShaped(question.prompt) && question.prompt.length <= 120,
    question?.prompt ?? 'none found',
  )
  const ask = code(`${SIDES}/Ask.tsx`)
  const submit = ask.slice(ask.indexOf('const submit'), ask.indexOf('return (', ask.indexOf('const submit')))
  check(
    'sides-a ask (source): typed words open in the Ask door as a DRAFT (fill) and never go through the wallet gate (a question needs no wallet); an example row runs through act() and is offered only when canAct; the question row is a draft too',
    /fill\(draft\)/.test(submit) &&
      !/\bact\(/.test(submit) &&
      /const rows = meta\.asks\.filter\(\(a\) => canAct\(a\.ask\)\)/.test(ask) &&
      /onClick=\{\(\) => act\(a\.ask\)\}/.test(ask) &&
      /onClick=\{\(\) => fill\(QUESTION\.prompt\)\}/.test(ask) &&
      !/useAskDoor|openDoor/.test(ask),
  )
  const askCss = read(`${SIDES}/ask.css`)
  check(
    'sides-a ask (source): the input is a real one at 16px (--fs-input; iOS zooms anything smaller), labelled, and marked so the floating Ask pill steps aside while it is in view; the fleet is the apps row\'s own table, each mark a LandingLink into the chat with that app on',
    /<input id=\{inputId\}.*type="text".*data-ask-door-yield/.test(ask) &&
      /<label className="sr-only" htmlFor=\{inputId\}>/.test(ask) &&
      /\.tk__input \{[^}]*font-size: var\(--fs-input\)/.test(askCss) &&
      /HOME_APPS\.map\(\(app\)/.test(ask) &&
      /<LandingLink href=\{homeAppHref\(app\.slug\)\}/.test(ask) &&
      /<LandingLink href=\{HOME_APPS_ALL_HREF\}/.test(ask) &&
      HOME_APPS.length >= 8,
  )

  // ── LINKS: who gets what ──
  const fees = tourFees()
  const split = (usd: number, readers: number, linkBps = fees.linkBps, creatorSplit = fees.creatorSplit) => linkSplit({ usd, readers, linkBps, creatorSplit })
  const table: Array<[usd: number, readers: number, bps: number, share: number, volume: number, fee: number, creator: number, house: number]> = [
    [25, 1, 50, 0.5, 25, 0.125, 0.0625, 0.0625],
    [50, 100, 50, 0.5, 5000, 25, 12.5, 12.5],
    [100, 1000, 50, 0.5, 100000, 500, 250, 250],
    [100, 10, 20, 0.5, 1000, 2, 1, 1],
    [50, 10, 50, 0.4, 500, 2.5, 1, 1.5],
    [25, 100, 0, 0.5, 2500, 0, 0, 0],
    [33, 7, 50, 0.5, 231, 1.155, 0.5775, 0.5775],
  ]
  const tableBad = table.filter(([usd, readers, bps, share, volume, fee, creator, house]) => {
    const s = linkSplit({ usd, readers, linkBps: bps, creatorSplit: share })
    return !s || s.volumeUsd !== volume || s.feeUsd !== fee || s.creatorUsd !== creator || s.houseUsd !== house || s.creatorShare !== share
  })
  check('sides-a links: the split\'s arithmetic on a table of cases — the fee is the link rate on what the readers signed, the creator\'s part is its share of the fee, and Pantessa keeps the rest', tableBad.length === 0, tableBad.map((r) => r.slice(0, 4).join('/')).join(' ') || `${table.length} cases`)
  const grid: string[] = []
  for (const usd of MINI_SIZES) {
    for (const readers of LINK_READER_CHOICES) {
      const s = split(usd, readers)
      const want = creatorEarningsUsd(usd * readers, LINK_SWAP_FEE_BPS)
      if (!s || Math.abs(s.creatorUsd - want) > 1e-9 || Math.abs(s.creatorUsd + s.houseUsd - s.feeUsd) > 1e-9 || s.creatorShare !== CREATOR_FEE_SPLIT || Math.abs(s.feeUsd - (usd * readers * LINK_SWAP_FEE_BPS) / 10_000) > 1e-9) grid.push(`${usd}x${readers}`)
    }
  }
  check(
    "sides-a links: on every cell the calculator can show (size x readers) with the snapshot's own fee line, the creator's dollars equal lib/fees creatorEarningsUsd at the link rate, and the two parts add up to the fee exactly",
    grid.length === 0 && fees.linkBps === LINK_SWAP_FEE_BPS && fees.creatorSplit === CREATOR_FEE_SPLIT && LINK_READER_CHOICES.includes(LINK_DEFAULT_READERS),
    grid.join(' ') || `${MINI_SIZES.length * LINK_READER_CHOICES.length} cells`,
  )
  check(
    'sides-a links: the split refuses what is not a real case — no size, no reader, half a reader, a share over the whole, a rate over 100%, a number that is not one — rather than draw a bar for it',
    [split(0, 10), split(-5, 10), split(50, 0), split(50, 2.5), split(50, 10, 50, 1.2), split(50, 10, 50, -0.1), split(50, 10, 10_001), split(50, 10, -1), split(Number.NaN, 10), split(50, Number.POSITIVE_INFINITY)].every((s) => s === null),
  )
  check(
    'sides-a links: money prints honestly — whole cents from a dollar up, the real fraction under a dollar (an eighth of a dollar is never rounded up to 13 cents), a round figure without stray cents, and the share in words',
    fmtSplitUsd(12.5) === '$12.50' && fmtSplitUsd(1250) === '$1,250.00' && fmtSplitUsd(0.125) === '$0.125' && fmtSplitUsd(0.0625) === '$0.0625' && fmtSplitUsd(0.25) === '$0.25' && fmtSplitUsd(0.5) === '$0.50' && fmtSplitUsd(0) === '$0.00' && fmtSplitUsd(Number.NaN) === '$0.00' && fmtRoundUsd(5000) === '$5,000' && fmtRoundUsd(25) === '$25' && fmtRoundUsd(12.5) === '$12.50' && shareWords(0.5) === 'half' && shareWords(0.4) === '40%',
  )
  const links = code(`${SIDES}/Links.tsx`)
  check(
    "sides-a links (source): no rate is typed — the panel reads the snapshot's linkBps, creatorSplit and linkPct, computes through linkSplit, and with no fee line draws no number; the sentence is the ticket's own (a stock buy); the link card is a specimen tagged Example and is never an anchor",
    /linkSplit\(\{ usd, readers, linkBps: fees\.linkBps, creatorSplit: fees\.creatorSplit \}\)/.test(links) &&
      /const split = fees \? linkSplit/.test(links) &&
      /\{split && fees \? \(/.test(links) &&
      /\{fees\.linkPct\}/.test(links) &&
      !/\d+(?:\.\d+)?\s*%/.test(links) &&
      !/\bbps\s*[:=]\s*\d|0\.\d+/.test(links) &&
      /miniTicket\(STOCK\.pair, 'buy', usd, null\)/.test(links) &&
      /data-specimen/.test(links) &&
      /<span className="ta-tag mono">Example<\/span>/.test(links) &&
      !/href=/.test(links) &&
      !/<a[\s>]/.test(links),
  )

  // ── EARN: the ladder ──
  const wire = earnFixture()
  const live = acceptLadder(wire)
  const boards = yieldLadder(rankEarnRows(rowsFromWire(wire.rows)), LADDER_ROWS)
  const apys = (live?.ladder ?? []).map((r) => r.apyPct ?? 0)
  check(
    "sides-a earn: the ladder is the Earn board's own (lib/earn yieldLadder over the route's rows) — best rate per asset, drawn highest first, one bar per asset, nothing under the board's floor, at most the board's count; a body that is not an answer is NULL",
    live !== null &&
      live.ladder.map((r) => r.id).join() === boards.map((r) => r.id).join() &&
      live.ladder.length > 0 &&
      live.ladder.length <= LADDER_ROWS &&
      apys.every((a, i) => i === 0 || apys[i - 1] >= a) &&
      new Set(live.ladder.map((r) => r.asset)).size === live.ladder.length &&
      live.ladder.find((r) => r.asset === 'USDC')?.venue === 'morpho' &&
      !live.ladder.some((r) => r.asset === 'WBTC' || r.asset === 'DAI') &&
      live.ways === wire.rows.length &&
      acceptLadder(null) === null &&
      acceptLadder({ rows: 'x' }) === null &&
      acceptLadder({}) === null &&
      acceptLadder({ rows: [] })?.ladder.length === 0,
    (live?.ladder ?? []).map((r) => `${r.asset}/${r.venue} ${r.apyPct}`).join(' · '),
  )
  const earnBad: string[] = []
  for (const usd of LADDER_AMOUNTS) {
    const rows = ladderFromLive(live?.ladder ?? [], usd)
    rows.forEach((r, i) => {
      const own = live?.ladder[i]?.askFor(usd) ?? null
      if (r.ask !== own || !r.ask || !canTradeAsk(r.ask, null) || !canTradeAsk(r.ask, {}) || !/^(Stake|Supply|Lend) /.test(r.ask)) earnBad.push(`${r.asset}@${usd}: ${r.ask}`)
    })
  }
  const at = (usd: number) => ladderFromLive(live?.ladder ?? [], usd)
  check(
    "sides-a earn: a row's sentence is the board's own composer for the amount picked (the row's askFor), passes the venue gate with no verdicts, and the amount is in it — the amounts are the board's, the default the board's",
    earnBad.length === 0 &&
      LADDER_AMOUNTS.join() === EARN_AMOUNTS.join() &&
      LADDER_DEFAULT_USD === EARN_DEFAULT_USD &&
      at(10).find((r) => r.asset === 'USDT')?.ask === 'Supply $10 of USDT to Aave at the best rate' &&
      at(100).find((r) => r.asset === 'USDC')?.ask === 'Lend $100 of USDC on Morpho on Base' &&
      at(25).find((r) => r.asset === 'ETH')?.ask === 'Stake 0.0125 ETH on Lido' &&
      at(100).find((r) => r.asset === 'ETH')?.ask === 'Stake 0.05 ETH on Lido',
    earnBad.join(' | ') || `${at(25).length} rows x ${LADDER_AMOUNTS.length} amounts`,
  )
  const seed: TourEarnRow[] = [
    { asset: 'USDT', venue: 'Aave', chain: 'Ethereum', apy: 8.97, ask: 'Supply $25 of USDT to Aave at the best rate' },
    { asset: 'ETH', venue: 'Lido', chain: 'Ethereum', apy: 2.32, ask: 'Stake 0.0121 ETH on Lido' },
    { asset: 'ZERO', venue: 'Aave', chain: 'Ethereum', apy: 0, ask: 'x' },
  ]
  const seeded = ladderFromSeed(seed, LADDER_DEFAULT_USD)
  check(
    "sides-a earn: a snapshot row carries ONE sentence, composed at the board's default amount — it is offered at that amount and at no other (never rewritten for another size); a row with no rate is not a bar; with no rows the ladder is empty, never a hole; both sources give a row the same id",
    seeded.length === 2 &&
      seeded[0].ask === seed[0].ask &&
      seeded[1].ask === seed[1].ask &&
      LADDER_AMOUNTS.filter((a) => a !== LADDER_DEFAULT_USD).every((a) => ladderFromSeed(seed, a).every((r) => r.ask === null) && ladderFromSeed(seed, a).length === 2) &&
      ladderFromSeed([], LADDER_DEFAULT_USD).length === 0 &&
      ladderFromSeed(EMPTY_TOUR.earn, LADDER_DEFAULT_USD).length === 0 &&
      seeded[0].id === at(25).find((r) => r.asset === 'USDT')?.id &&
      seeded[1].id === at(25).find((r) => r.asset === 'ETH')?.id,
  )
  check(
    'sides-a earn: the arithmetic beside a row — a year at a rate that holds is amount x rate, a bar is its share of the best rate with a floor so a small rate still shows, the stamp reads in UTC',
    yearlyUsd(25, 8.97) === 2.2425 && yearlyUsd(100, 2.32) === 2.32 && yearlyUsd(0, 5) === 0 && yearlyUsd(25, 0) === 0 && ladderBarPct(8.97, 8.97) === 100 && ladderBarPct(4.485, 8.97) === 50 && ladderBarPct(0.1, 8.97) === 4 && ladderBarPct(5, 0) === 0 && fmtAsOfUtc(wire.asOf) === '14:32 UTC' && fmtAsOfUtc(null) === '' && fmtAsOfUtc('not a date') === '',
  )
  const earn = code(`${SIDES}/Earn.tsx`)
  check(
    "sides-a earn (source): the first frame is the server snapshot (data.earn), the live route takes over once it has rows and is read only through the gated poll (on screen + tab visible); a row is picked, then ONE button runs its sentence through act() when canAct; with nothing read the panel says so and draws no row",
    /ladderFromSeed\(data\.earn, usd\)/.test(earn) &&
      /ladderFromLive\(live\.data\.ladder, usd\)/.test(earn) &&
      /usePolled\(LADDER_URL, LADDER_REFRESH_MS, active, acceptLadder\)/.test(earn) &&
      /const runnable = !!row\?\.ask && canAct\(row\.ask\)/.test(earn) &&
      /onClick=\{\(\) => act\(row\.ask as string\)\}/.test(earn) &&
      /onClick=\{\(\) => setPicked\(r\.id\)\}/.test(earn) &&
      /state === 'reading'/.test(earn) &&
      LADDER_URL === '/api/markets/earn' &&
      !/\d+(?:\.\d+)?\s*%/.test(earn) &&
      !/['"`](?:Stake|Supply|Lend) /.test(earn),
  )

  // ── All four: nothing read, nothing broken ──
  const metas = [chartsMeta, askMeta, linksMeta, earnMeta]
  const holes = metas.filter((m) => /[{}]/.test(tourBody(m, EMPTY_TOUR)) || tourFacts(m, EMPTY_TOUR).some((f) => /[{}]/.test(f)) || /\s{2,}/.test(tourBody(m, EMPTY_TOUR)))
  const sources = ['Charts', 'Ask', 'Links', 'Earn'].map((n) => ({ n, c: code(`${SIDES}/${n}.tsx`) }))
  check(
    'sides-a panels: against a snapshot with nothing read, no side shows a brace or a hole in its words, the Links split is not computed (no fee line, no number), the Earn ladder is empty and says it is reading, and Charts composes its sentence with no price at all',
    holes.length === 0 && linkSplit({ usd: 50, readers: 100, linkBps: Number.NaN, creatorSplit: 0.5 }) === null && EMPTY_TOUR.fees === null && ladderFromSeed(EMPTY_TOUR.earn, 25).length === 0 && miniTicket(markets[0].pair, 'buy', MINI_DEFAULT_USD, null).ok,
    holes.map((m) => m.id).join(',') || 'clean',
  )
  const wiringBad = sources.filter(({ n, c }) => !new RegExp(`<TourPanel side=\\{(?:COPY|meta)\\}`).test(c) || !/data-tour-mini="/.test(c) || !/tourJourney\(meta\.id, what\)/.test(c) || /useAskDoor|useConnectToAct|next\/link|localStorage|sessionStorage/.test(c) || (n !== 'Links' && !/const COPY = \{ \.\.\.meta, asks: \[\] \}/.test(c)))
  check(
    "sides-a panels (source): each is the shared TourPanel around its own miniature, names its miniature for a drive (data-tour-mini), labels every control for the journey log through tourJourney, and reaches the wallet only through the tour's hands",
    wiringBad.length === 0,
    wiringBad.map((s) => s.n).join(',') || 'all four',
  )
  const live2 = code(`${SIDES}/a/useLive.ts`)
  check(
    'sides-a live reads (source): a panel reads only while it is on screen AND the tab is visible, keeps the last good answer on a failed read, and opens no stream',
    /IntersectionObserver/.test(live2) && /document\.visibilityState === 'visible'/.test(live2) && /return \[ref, seen && tab\]/.test(live2) && /if \(!active\) return/.test(live2) && /if \(next === null\) setFailed\(true\)/.test(live2) && !/WebSocket|EventSource/.test(live2),
  )
}

export async function landingSidesAPinsServed(check: Check, base: string): Promise<void> {
  const HDR = { 'x-yf-internal-run': '1' }
  // The first side is in the server HTML: a crawler and a first paint get the ticket and its sentence.
  const html = await (await fetch(`${base}/`, { headers: HDR })).text()
  const first = miniTicket(miniMarkets()[0].pair, miniMarkets()[0].sides[0], MINI_DEFAULT_USD, null)
  const want = first.ok ? first.ask : ''
  check(
    "sides-a (served): the Charts miniature is in the home's server HTML — three market tiles, the default sentence composed with no price, and the button that runs it",
    html.includes('data-tour-mini="charts"') && MINI_SYMBOLS.every((s) => html.includes(`data-mini-tile="${s}"`)) && want.length > 0 && html.includes(`data-mini-ask="${want}"`) && html.includes(`data-ask="${want}"`),
    want,
  )
  // The reads behind the miniatures answer in the shape the panels accept (a feed miss is a dash, never a crash).
  const shapes: string[] = []
  for (const s of MINI_SYMBOLS) {
    try {
      const res = await fetch(`${base}${miniMarketUrl(s)}`, { headers: HDR })
      const body: unknown = await res.json()
      const ok = res.status === 200 && (acceptMiniMarket(body) !== null || (typeof body === 'object' && body !== null && ('error' in body || 'candles' in body)))
      if (!ok) shapes.push(`${s} ${res.status}`)
    } catch (e) {
      shapes.push(`${s} ${(e as Error).message}`)
    }
  }
  check("sides-a (served): the candles route answers for the miniature's three markets with a body the panel can read (an answer, or a named miss — never a crash page)", shapes.length === 0, shapes.join(' | ') || MINI_SYMBOLS.join(' '))
  try {
    const res = await fetch(`${base}${LADDER_URL}`, { headers: HDR })
    const live = acceptLadder(await res.json())
    const bad: string[] = []
    for (const usd of LADDER_AMOUNTS) for (const r of ladderFromLive(live?.ladder ?? [], usd)) if (r.ask && !canTradeAsk(r.ask, null)) bad.push(`${r.asset}@${usd}`)
    check(
      "sides-a (served): the Earn route answers in the ladder's shape, the ladder is highest first, and every sentence a row can offer at every amount passes the venue gate",
      res.status === 200 && live !== null && bad.length === 0 && (live?.ladder ?? []).every((r, i, a) => i === 0 || (a[i - 1].apyPct ?? 0) >= (r.apyPct ?? 0)),
      bad.join(' ') || `${live?.ladder.length ?? 0} rows · ${live?.failed.length ? `not answering: ${live.failed.join(',')}` : 'all venues'}`,
    )
  } catch (e) {
    check("sides-a (served): the Earn route answers in the ladder's shape", false, (e as Error).message)
  }
}

if (process.argv[1]?.endsWith('landing-sides-a-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingSidesAPins(check))
    .then(() => (served ? landingSidesAPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
