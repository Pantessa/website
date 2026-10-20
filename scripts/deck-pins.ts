// Pins for THE DECK (lib/deck — the band at the top of `/` grown into a bar of
// four channels with the streaming-order-book switch, 2026-10-13): the
// channels and their doors, the switch's memory, which market the ladder
// follows and where its door goes, the ladder's bins over a fixture book, the
// prints and their fade, the words, the SSR frame (the CSS heights equal the
// lib constants) and the wiring (the deck mounts the band in its stage seat,
// the battle's stage seat touches no URL, every act goes through the
// connect-to-act door). Pure: no server, no socket, no DB.
//   npx tsx scripts/deck-pins.ts      (npm run pins:deck)
import { readFileSync } from 'node:fs'
import {
  DECK_BOOK_KEY,
  DECK_BOOK_W,
  DECK_CHANNELS,
  DECK_DEFAULT_CHANNEL,
  DECK_LADDER_RUNGS,
  DECK_PRINT_FADE_MS,
  DECK_PRINT_ROWS,
  DECK_STAGE_MIN_H,
  deckBookDoor,
  deckBookMarket,
  deckBookWords,
  deckChannelsMatchViews,
  deckHref,
  deckLadder,
  deckLadderFoot,
  deckPrintRung,
  deckPrints,
  deckSourceLine,
  deckSwitchWords,
  fmtLadderPrice,
  fmtLadderUsd,
  isDeckBattle,
  isDeckFullSize,
  parseDeckBook,
  parseDeckChannel,
  serializeDeckBook,
} from '../lib/deck'
import { LIVE_VIEWS } from '../lib/battle'
import { PRINT_FADE_MS, bookFromLevels } from '../lib/depth'
import type { TapeFill } from '../lib/tape'

type Check = (name: string, ok: boolean, extra?: string) => void

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

// ── A fixture book: UNI-shaped, a level every few ticks, two levels past the ±2% window ──
const BIDS = [
  { px: 7.3581, size: 11.3 },
  { px: 7.3551, size: 112.3 },
  { px: 7.34, size: 50 },
  { px: 7.3, size: 200 },
  { px: 7.25, size: 300 },
  { px: 7.2, size: 400 }, // outside: 7.35955 × 0.98 = 7.2124
]
const ASKS = [
  { px: 7.361, size: 7.1 },
  { px: 7.3645, size: 72 },
  { px: 7.4, size: 60 },
  { px: 7.45, size: 150 },
  { px: 7.5, size: 250 },
  { px: 7.52, size: 500 }, // outside: 7.35955 × 1.02 = 7.5067
]
const BOOK = bookFromLevels(BIDS, ASKS, 1_791_898_000_000)

const NOW = 1_791_898_000_000
const fill = (id: string, agoMs: number, over: Partial<TapeFill> = {}): TapeFill => ({
  id,
  market: 'UNI',
  side: 'buy',
  size: 1,
  price: 7.3645,
  usd: 7.36,
  at: NOW - agoMs,
  taker: null,
  maker: null,
  hash: null,
  effect: null,
  block: null,
  source: 'dune',
  venue: 'hyperliquid',
  chainId: null,
  ...over,
})
/** Newest first — lib/tape mergeFills' order. */
const FILLS: TapeFill[] = [fill('a', 1_000), fill('h', 3_000, { market: 'HYPE', price: 81.3 }), fill('b', 5_000, { side: 'sell', price: 7.3581 }), fill('c', 9_000)]

export function deckPins(check: Check): void {
  // ── The channels ──────────────────────────────────────────────────────
  check(
    "deck: five channels in bar order — Pulse · Tape · The Front · The Siege · The Flyover (RE-PINNED 2026-10-15 (deck full size): Nate: add the flyover to the tab) — each with a word, a blurb and a door, each a door to a /live view under that view's own label; The Map is deliberately not one (Nate, 2026-10-13); the default is the pulse and an unknown word is the pulse",
    DECK_CHANNELS.map((c) => c.id).join() === 'pulse,tape,front,siege,flyover' &&
      DECK_CHANNELS.every((c) => c.label.length > 0 && c.blurb.length > 0 && c.door.length > 0) &&
      deckChannelsMatchViews() &&
      !DECK_CHANNELS.some((c) => c.view === 'map') &&
      LIVE_VIEWS.some((v) => v.id === 'map') &&
      DECK_DEFAULT_CHANNEL === 'pulse' &&
      parseDeckChannel('siege') === 'siege' &&
      parseDeckChannel('map') === 'pulse' &&
      parseDeckChannel(null) === 'pulse' &&
      isDeckBattle('front') &&
      isDeckBattle('siege') &&
      !isDeckBattle('tape') &&
      !isDeckBattle('flyover') &&
      parseDeckChannel('flyover') === 'flyover' &&
      deckHref('flyover') === '/live?view=flyover',
  )
  check(
    "deck: a channel's door is a real /live link — the pulse and tape doors carry the pulse's pick as /live's ?m= (lib/pulse pulseLiveHref), the battle doors are the views' own URLs",
    deckHref('pulse') === '/live' && deckHref('tape', 'xyz:SNDK') === '/live?m=xyz%3ASNDK' && deckHref('pulse', 'ETH') === '/live?m=ETH' && deckHref('front') === '/live?view=front' && deckHref('siege', 'ETH') === '/live?view=siege',
  )

  // ── The switch ────────────────────────────────────────────────────────
  check(
    'deck: the switch is remembered per browser under a versioned key — on only when the memory says on; off, missing or junk is off',
    DECK_BOOK_KEY === 'pantessa.home.book.v1' && parseDeckBook('on') && !parseDeckBook('off') && !parseDeckBook(null) && !parseDeckBook(undefined) && !parseDeckBook('yes') && serializeDeckBook(true) === 'on' && serializeDeckBook(false) === 'off',
  )

  // ── Which market, which door ──────────────────────────────────────────
  check(
    "deck: the ladder follows the first usable venue market in the caller's order (the pick, then the hot market or the leader) and none until one is measured; its door is the symbol page's Depth view for a coin Coinbase lists or a Hyperliquid perp, the plain page for a tokenized stock (no resting book on Robinhood Chain), nothing for a market with no page (gold, a k-prefixed coin)",
    deckBookMarket([null, undefined, 'ETH', 'HYPE']) === 'ETH' &&
      deckBookMarket(['xyz:SNDK']) === 'xyz:SNDK' &&
      deckBookMarket([null, '']) === null &&
      deckBookMarket(['bad market!']) === null &&
      deckBookDoor('HYPE') === '/t/HYPE?view=depth' &&
      deckBookDoor('ETH') === '/t/ETH?view=depth' &&
      deckBookDoor('xyz:SNDK') === '/t/SNDK' &&
      deckBookDoor('xyz:GOLD') === null &&
      deckBookDoor('kPEPE') === null,
    `${deckBookDoor('HYPE')} ${deckBookDoor('ETH')} ${deckBookDoor('xyz:SNDK')} ${deckBookDoor('xyz:GOLD')} ${deckBookDoor('kPEPE')}`,
  )

  // ── The ladder ────────────────────────────────────────────────────────
  const l = deckLadder(BOOK)
  const mid = (7.3581 + 7.361) / 2
  const bidFar = 11.3 * 7.3581 + 112.3 * 7.3551 + 50 * 7.34 + 200 * 7.3 + 300 * 7.25 + 400 * 7.2
  const askFar = 7.1 * 7.361 + 72 * 7.3645 + 60 * 7.4 + 150 * 7.45 + 250 * 7.5 + 500 * 7.52
  check(
    `deck ladder: the nearest ${DECK_LADDER_RUNGS} resting levels a side (a rung IS a level — Hyperliquid's coarse book holds one per tick; a six-level side gives six rungs), dollars cumulated from the mid outward (the Depth view's rule) — the asks read far to near, the bids near to far, the taller side's far rung is the full bar, the reach is the further side in percent to a tenth, the spread is best ask − best bid`,
    !!l &&
      l.asks.length === 6 &&
      l.bids.length === 6 &&
      near(l.mid, mid) &&
      near(l.asks[5].px, 7.361) &&
      near(l.asks[0].px, 7.52) &&
      near(l.bids[0].px, 7.3581) &&
      near(l.bids[5].px, 7.2) &&
      near(l.asks[5].usd, 7.1 * 7.361, 1e-6) &&
      near(l.asks[4].usd, 72 * 7.3645, 1e-6) &&
      near(l.bids[0].usd, 11.3 * 7.3581, 1e-6) &&
      near(l.bids[1].usd, 112.3 * 7.3551, 1e-6) &&
      near(l.bids[5].cumUsd, bidFar, 1e-6) &&
      near(l.asks[0].cumUsd, askFar, 1e-6) &&
      l.bids.every((r, i) => i === 0 || r.cumUsd >= l.bids[i - 1].cumUsd) &&
      l.asks.every((r, i) => i === 0 || r.cumUsd <= l.asks[i - 1].cumUsd) &&
      near(l.maxCumUsd, Math.max(bidFar, askFar), 1e-6) &&
      near(l.bids[5].share, bidFar / Math.max(bidFar, askFar), 1e-6) &&
      near(l.asks[0].share, askFar / Math.max(bidFar, askFar), 1e-6) &&
      near(l.bidUsd, bidFar, 1e-6) &&
      near(l.askUsd, askFar, 1e-6) &&
      near(l.spread!, 7.361 - 7.3581, 1e-9) &&
      l.pct === 2.2 &&
      deckLadder(BOOK, 3)?.asks.length === 3 &&
      near(deckLadder(BOOK, 3)!.asks[0].px, 7.4),
    l ? `asks ${l.asks.map((r) => `${fmtLadderPrice(r.px)}:${Math.round(r.usd)}`).join(' ')} · bids ${l.bids.map((r) => `${fmtLadderPrice(r.px)}:${Math.round(r.usd)}`).join(' ')} · ±${l.pct}%` : 'no ladder',
  )
  check(
    'deck ladder: a book with no mid or an empty side has no ladder; a print lands on the nearest level at or past its price on its side of the mid (0 = nearest the mid; the mid itself counts as an ask), past the ladder on none',
    deckLadder(bookFromLevels([], ASKS)) === null &&
      deckLadder(bookFromLevels(BIDS, [])) === null &&
      !!l &&
      JSON.stringify(deckPrintRung(l, 7.3645)) === '{"side":"ask","index":1}' &&
      JSON.stringify(deckPrintRung(l, 7.3620)) === '{"side":"ask","index":1}' &&
      JSON.stringify(deckPrintRung(l, 7.4)) === '{"side":"ask","index":2}' &&
      JSON.stringify(deckPrintRung(l, 7.3)) === '{"side":"bid","index":3}' &&
      JSON.stringify(deckPrintRung(l, 7.3)) === '{"side":"bid","index":3}' &&
      JSON.stringify(deckPrintRung(l, 7.31)) === '{"side":"bid","index":3}' &&
      JSON.stringify(deckPrintRung(l, mid)) === '{"side":"ask","index":0}' &&
      deckPrintRung(l, 7.6) === null &&
      deckPrintRung(l, 7.1) === null &&
      deckPrintRung(l, Number.NaN) === null,
  )

  // ── The prints ────────────────────────────────────────────────────────
  const p = deckPrints(FILLS, 'UNI', NOW)
  check(
    `deck prints: the last prints of one market from the newest-first buffer, inside the ${DECK_PRINT_FADE_MS / 1000}s fade (the Depth view's own), newest first with their alpha, other markets skipped, the strip capped at ${DECK_PRINT_ROWS}`,
    DECK_PRINT_FADE_MS === PRINT_FADE_MS &&
      p.length === 2 &&
      p[0].fill.id === 'a' &&
      near(p[0].alpha, 1 - 1_000 / PRINT_FADE_MS) &&
      p[1].fill.id === 'b' &&
      near(p[1].alpha, 1 - 5_000 / PRINT_FADE_MS) &&
      deckPrints(FILLS, 'UNI', NOW, 1).length === 1 &&
      deckPrints(FILLS, 'HYPE', NOW).length === 1 &&
      deckPrints([], 'UNI', NOW).length === 0 &&
      deckPrints(FILLS, 'UNI', NOW + 20_000).length === 0,
    `${p.map((x) => `${x.fill.id}@${x.alpha.toFixed(3)}`).join(',')}`,
  )

  // ── The words ─────────────────────────────────────────────────────────
  check(
    "deck words: the foot's source line is the pulse's own status words after the transport (a battle view names its mids too); the switch says off / on with the ticker / waiting; the ladder's status is lib/depth's book words for Hyperliquid; the ladder's foot reads the window's own dollars, whose book it is and whose prints",
    deckSourceLine('pulse', { status: 'live', source: 'dune', markets: 12, hidden: false }) === 'Dune · live · 12 markets' &&
      deckSourceLine('tape', { status: 'connecting', source: 'hyperliquid', markets: 0, hidden: false }) === 'Hyperliquid · connecting' &&
      deckSourceLine('front', { status: 'live', source: 'dune', markets: 3, hidden: false }) === 'Dune fills · Hyperliquid mids · live · 3 markets' &&
      deckSourceLine('siege', { status: 'closed', source: 'dune', markets: 3, hidden: true }) === 'Dune fills · Hyperliquid mids · paused · tab in the background' &&
      deckSwitchWords(false, 'ETH') === 'off · flick to watch the book' &&
      deckSwitchWords(true, 'xyz:SNDK') === 'on · SNDK' &&
      deckSwitchWords(true, null) === 'on · waiting for a market' &&
      deckBookWords('live', 'ETH') === 'book · Hyperliquid l2Book · live' &&
      deckBookWords('polling', 'ETH') === 'book · Hyperliquid l2Book · every 5s' &&
      deckBookWords('live', null) === 'book · waiting for a market' &&
      !!l &&
      deckLadderFoot(l, 'dune', 2) === `${fmtLadderUsd(bidFar)} bids · ${fmtLadderUsd(askFar)} asks on the nearest 6 levels a side (±2.2%) · the book is Hyperliquid's · the prints landing on it are Dune's` &&
      /no print on this feed yet/.test(deckLadderFoot(l, 'dune', 0)) &&
      /the venue's own/.test(deckLadderFoot(l, 'hyperliquid', 1)) &&
      deckLadderFoot(null, 'dune', 0) === "the book is Hyperliquid's · the prints landing on it are Dune's" &&
      fmtLadderUsd(4911.13) === '$4.9K' &&
      fmtLadderUsd(582.5) === '$583' &&
      fmtLadderUsd(1_530_000) === '$1.53M' &&
      fmtLadderUsd(2.4e9) === '$2.40B' &&
      fmtLadderUsd(-1) === '—' &&
      fmtLadderPrice(mid) === '7.3596' &&
      fmtLadderPrice(2515) === '2515.00' &&
      fmtLadderPrice(83391.7) === '83392' &&
      fmtLadderPrice(0.0842) === '0.084200',
    l ? deckLadderFoot(l, 'dune', 2) : 'no ladder',
  )

  // ── The frame and the wiring ──────────────────────────────────────────
  const css = readFileSync('components/home/deck.css', 'utf8')
  const cssRules = css.replace(/\/\*[^]*?\*\//g, '')
  const deck = readFileSync('components/home/Deck.tsx', 'utf8')
  const ladder = readFileSync('components/home/BookLadder.tsx', 'utf8')
  const tape = readFileSync('components/home/TapeStage.tsx', 'utf8')
  const flyover = readFileSync('components/live/Flyover.tsx', 'utf8')
  check(
    "deck: every channel but the pulse plays at /live's own size (Nate 2026-10-15: \"same size as we do on the live page\") — the battle fields carry battle.css's page-seat heights, the tape stage holds as tall as The Front's field with twenty rows (ten on a phone), The Flyover rides its own stage height in a stage seat (no rail, no URL mirror, loaded only when picked); the pulse keeps the band's height (the SSR frame)",
    !isDeckFullSize('pulse') && isDeckFullSize('tape') && isDeckFullSize('front') && isDeckFullSize('siege') && isDeckFullSize('flyover') &&
      cssRules.includes('.deck__chan .battle--stage .battle__stage { height: clamp(420px, calc(100dvh - 400px), 760px); }') &&
      cssRules.includes('.deck__chan .battle--stage[data-view="siege"] .battle__stage { height: clamp(460px, calc(100dvh - 400px), 820px); }') &&
      cssRules.includes('.deck[data-channel="tape"] .deck__tapestage { display: flex; flex-direction: column; min-height: clamp(420px, calc(100dvh - 400px), 760px); }') &&
      !/\.battle__stage \{ height: (200|240)px/.test(cssRules) &&
      /const Flyover = dynamic\(\(\) => import\('@\/components\/live\/Flyover'\), \{ ssr: false/.test(deck) &&
      /<Flyover tradable=\{tradable\} seat="stage" onReport=\{setReport\} onBookMarket=\{setHot\} \/>/.test(deck) &&
      /if \(typeof window === 'undefined' \|\| !onPage\) return/.test(flyover) &&
      /\{onPage && \(\s*<MarketsSide label="Continents">/.test(flyover),
  )
  const home = readFileSync('components/home/HomeSurface.tsx', 'utf8')
  const pulse = readFileSync('components/home/PulseSlot.tsx', 'utf8')
  const battle = readFileSync('components/live/Battle.tsx', 'utf8')
  const zIndexes = [...cssRules.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => Number(m[1]))
  check(
    `deck: the SSR frame is the final frame — deck.css stage min-heights equal lib/deck DECK_STAGE_MIN_H (${DECK_STAGE_MIN_H.desktop} / ${DECK_STAGE_MIN_H.phone}), the ladder column DECK_BOOK_W, the deck starts on the pulse with the book off and reads the switch's memory after mount (try/catch); nothing sticky and no layer at z-index 20 or above`,
    new RegExp(`\\.deck__stage \\{[^}]*min-height: ${DECK_STAGE_MIN_H.desktop}px`).test(cssRules) &&
      new RegExp(`@media \\(max-width: 640px\\) \\{[^]*?\\.deck__stage \\{ min-height: ${DECK_STAGE_MIN_H.phone}px; \\}`).test(cssRules) &&
      new RegExp(`grid-template-columns: minmax\\(0, 1fr\\) ${DECK_BOOK_W}px`).test(cssRules) &&
      /useState<DeckChannel>\(DECK_DEFAULT_CHANNEL\)/.test(deck) &&
      /const \[book, setBook\] = useState\(false\)/.test(deck) &&
      /useEffect\(\(\) => \{\s*try \{\s*setBook\(parseDeckBook\(window\.localStorage\.getItem\(DECK_BOOK_KEY\)\)\)/.test(deck) &&
      // RE-PINNED 2026-10-14 (polish sweep): the polish squad's MARKETS-MOBILE made the bar's Share + alert
      // chips sticky at the bar's right edge INSIDE the bar's own horizontal scroller (so a phone sees them without
      // scrolling the row) — a sticky inside an overflow-x:auto row is not the body-overflow bug this fence guards
      // against (memory sticky-dead-body-overflow). Nothing else in deck.css may be sticky.
      cssRules.split(/position:\s*sticky/).length - 1 === 2 &&
      /\.deck__bar > \.lshare--deck \{ position: sticky; right: 0;/.test(cssRules) &&
      /\.deck__bar > \.armalert--deck \{ position: sticky; right: 42px;/.test(cssRules) &&
      zIndexes.every((z) => z < 20),
    `z-index values: ${zIndexes.join(',') || 'none'}`,
  )
  check(
    "deck: the channels are real links (next/link, prefetch off, role=tab) whose plain click switches the stage in place and whose modified click keeps the link; the switch is a button with role=switch and aria-checked; the foot's door is the channel's own href; the deck, the ladder and the tape stage never call the chat route",
    /href=\{deckHref\(c\.id, pick\)\}/.test(deck) &&
      /prefetch=\{false\}/.test(deck) &&
      /role="tab"/.test(deck) &&
      /aria-selected=\{on\}/.test(deck) &&
      /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey \|\| e\.button !== 0/.test(deck) &&
      /e\.preventDefault\(\)/.test(deck) &&
      /role="switch"/.test(deck) &&
      /aria-checked=\{book\}/.test(deck) &&
      /<Link href=\{href\} className="deck__door" prefetch=\{false\}/.test(deck) &&
      !/fetch\(['"`]\/api\/chat/.test(deck + ladder + tape),
  )
  check(
    'deck: the stage mounts the band in its stage seat (the band draws its own head and foot only in its band seat), the tape stage, and the battle views keyed by view in their stage seat; the ladder only while the switch is on; HomeSurface seats the deck right after the sent-home notice',
    /<PulseSlot seat="stage" onReport=\{setReport\} onFills=\{onFills\} onBookMarket=\{setHot\} onPick=\{setPick\} \/>/.test(deck) &&
      /<TapeStage onReport=\{setReport\} onFills=\{onFills\} onBookMarket=\{setHot\} \/>/.test(deck) &&
      /<Battle key=\{ch\} view=\{ch\} tradable=\{tradable\} seat="stage" onReport=\{setReport\} onFills=\{onFills\} onLeader=\{setHot\} \/>/.test(deck) &&
      /\{book && <BookLadder market=\{bookMarket\} fillsRef=\{fillsRef\} source=\{report\.source\} \/>\}/.test(deck) &&
      /<SentHomeNotice \/>\s*<Deck \/>/.test(home) &&
      (pulse.match(/\{seat === 'band' && \(/g) ?? []).length === 2 &&
      /data-seat=\{seat\}/.test(pulse) &&
      /export default function PulseSlot\(\{ seat = 'band', onReport, onFills, onBookMarket, onPick \}: PulseSlotProps = \{\}\)/.test(pulse),
  )
  check(
    "deck: the battle's stage seat rewrites no URL (`/?t=` is nobody's) and reads none, keeps the hand-set memory shared with /live, mounts no war-log rail and no page title, and reports its feed, its buffer and the leader as they change",
    /if \(!onPage \|\| typeof window === 'undefined'( \|\| !pick\.ready)?\) return/.test(battle) /* RE-PINNED 2026-10-13 (gtm3h): nothing written before the pick paints */ &&
      /* RE-PINNED 2026-10-13 (gtm3h): the armies are the one pick's first five; the store's stage seat reads and writes no URL */
      /const pick = useMarketPick\(\{ seat \}\)/.test(battle) && /armiesOf\(pick\.markets\)/.test(battle) && /const onPage = \(opts\.seat \?\? 'stage'\) === 'page'/.test(readFileSync('lib/use-market-pick.ts', 'utf8')) &&
      /onPage \? initialWindow\(\) : parseFrontWindow\(null\)/.test(battle) &&
      /\{onPage && \(\s*<MarketsSide label="War log">/.test(battle) &&
      /className="battle battle--stage"/.test(battle) &&
      /\{onPage \? \(\s*<>\s*<h1 className="sr-only">\{viewDef\.label\}<\/h1>/.test(battle) &&
      /if \(leader !== reportedLeaderRef\.current\) \{\s*reportedLeaderRef\.current = leader\s*onLeaderRef\.current\?\.\(leader\)/.test(battle) &&
      /onFillsRef\.current\?\.\(fillsRef\.current\)/.test(battle) &&
      /onReportRef\.current\?\.\(\{ status: s, detail: d, source: tapeSourceRef\.current/.test(battle) &&
      !/localStorage|writeArmyMemory/.test(battle) /* RE-PINNED 2026-10-13 (gtm3h): the memory is the store's, shared by every surface */,
  )
  check(
    "deck: the ladder is Hyperliquid's l2Book over the Depth view's own feed (openBookFeed: the venue's keyless socket, the book route when a socket is refused), re-aimed after a settle so a flickering hot market never thrashes the socket, repainted at most four times a second, its prints read from the stage's buffer and faded on the second hand; a market that never answers is said so; its door is lib/deck's",
    /openBookFeed\(\s*'hyperliquid',\s*\{ symbol: aim, source: 'hyperliquid', pair: aim \}/.test(ladder) &&
      /const SETTLE_MS = 1500/.test(ladder) &&
      /const FLUSH_MS = 250/.test(ladder) &&
      /setStatus\('missing'\)/.test(ladder) &&
      /deckPrints\(fillsRef\.current \?\? \[\], aim, now\)/.test(ladder) &&
      /deckPrintRung\(ladder, p\.fill\.price\)/.test(ladder) &&
      /deckBookDoor\(aim\)/.test(ladder) &&
      /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/.test(ladder),
  )
  check(
    "deck: the tape stage is the /live pattern — connectTape on /live's own pick (pickTapeMarkets; the fallback list first, the same socket re-aimed), Dune's perp venues filtered, the chip lib/tape followAsk gated by canTradeAsk with the measured verdicts (useTradable), every act through the connect-to-act door into the ask door's sheet, twenty rows (RE-PINNED 2026-10-15 (deck full size))",
    /pickTapeMarkets\(main, xyz\)/.test(tape) &&
      /useState<readonly string\[\]>\(FALLBACK_MARKETS\)/.test(tape) &&
      /connectTape\(markets, \{/.test(tape) &&
      /handleRef\.current\?\.setMarkets\(markets\)/.test(tape) &&
      /\{ venues: PERP_VENUES, filter: true \}/.test(tape) &&
      /const chip = followAsk\(f\)/.test(tape) &&
      /canTradeAsk\(chip\.ask, tradable\)/.test(tape) &&
      /useTradable\(\)/.test(tape) &&
      /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(tape) &&
      /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(tape) &&
      /\{door\}/.test(tape) &&
      /export const TAPE_STAGE_ROWS = 20/.test(tape),
  )
  check(
    "deck: the live dot is honest — only the picked channel wears one, lit only while that channel's feed is live (an inactive channel has no feed to claim); a thumb gets 44px chips, 36px channel pills with a 44px hit area (the battle picker's idiom) and a 44px door; nothing animates under reduced motion",
    /\{on && <i className=\{`mk-dot \$\{live \? 'mk-dot--open' : 'mk-dot--closed'\} deck__dot`\} aria-hidden \/>\}/.test(deck) &&
      /const live = report\.status === 'live'/.test(deck) &&
      /@media \(hover: none\) \{ \.deck__chip \{ min-height: 44px; \}/.test(cssRules) &&
      /\.deck__ch::after, \.deck__flick::after \{ content: ''; position: absolute; inset: -4px 0; \}/.test(cssRules) &&
      /\.deck__ch \{[^}]*height: 36px/.test(cssRules) &&
      /prefers-reduced-motion: reduce/.test(cssRules) &&
      /\.deck\[data-status="live"\] \.deck__dot \{ animation: none; \}/.test(cssRules),
  )
}

if (process.argv[1]?.endsWith('deck-pins.ts')) {
  let failed = 0
  deckPins((name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  })
  console.log(failed ? `\n${failed} failed` : '\nall green')
  process.exit(failed ? 1 : 0)
}
