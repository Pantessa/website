// Pins for the print alerts (lib/print-alerts): the body reader, the stored
// shapes, the words, the evaluation over consumed fills (scope, dedupe,
// cooldown, the per-pass cap, the backlog walk), the notification, the
// cursor policy, the fixture reader, the held arm, and the wiring (the
// cron's literal maxDuration, vercel.json, the rail's mount, ONE
// notification path, the cursor stored after the evaluation). Pure: no
// server, no socket, no DB. Called from scripts/test-api.ts, and alone:
//   npx tsx scripts/print-alert-pins.ts
import { readFileSync } from 'node:fs'
import {
  BIG_PRINT_CHOICES,
  CURSOR_REJECT_WINDOW_MS,
  FEED_LEASE_MS,
  FIXTURE_MAX_FILLS,
  HELD_PRINT_ARM_KEY,
  HELD_PRINT_ARM_TTL_MS,
  PRINT_ALERT_COOLDOWN_MS,
  PRINT_ALERT_MAX_PER_PASS,
  PRINT_ALERT_MAX_PER_WINDOW,
  PRINT_CRON_BUDGET_MS,
  PRINT_CRON_MAX_BUDGET_MS,
  PRINT_CRON_MAX_DURATION_S,
  PRINT_RULES,
  ageWords,
  evaluatePrintAlert,
  feedStatusWords,
  fixtureFills,
  gapNote,
  heldPrintArmRecord,
  parseRecent,
  parseThresholds,
  parseVenues,
  printAlertLabel,
  printNotification,
  printVenueWords,
  pullOutcome,
  readHeldPrintArm,
  readPrintAlertBody,
  type PrintAlertShape,
} from '../lib/print-alerts'
import { DEFAULT_THRESHOLDS, type TapeFill, type TapeSide, type TapeVenue } from '../lib/tape'
import { PERP_VENUES } from '../lib/dune'

type Check = (name: string, ok: boolean, extra?: string) => void

const PRICE: Record<string, number> = { HYPE: 42.1, BTC: 112000, ETH: 3900, SOL: 180, WETH: 3900, DOGE: 0.2, UNI: 7.1, LINK: 20 }
let n = 0
function fill(market: string, side: TapeSide, usd: number, at: number, over: Partial<TapeFill> = {}): TapeFill {
  const price = over.price ?? PRICE[market] ?? 10
  n++
  return { id: `dune:${n}`, market, side, size: usd / price, price, usd, at, taker: null, maker: null, hash: null, effect: null, block: null, source: 'dune', venue: 'hyperliquid' as TapeVenue, chainId: null, ...over }
}

const T = 1_760_000_000_000
const rule = (over: Partial<PrintAlertShape>): Pick<PrintAlertShape, 'rule' | 'market' | 'venues' | 'thresholds'> => ({ rule: 'big-print', market: null, venues: ['hypercore'], thresholds: { ...DEFAULT_THRESHOLDS }, ...over })

export function printAlertPins(check: Check): void {
  // ── The body reader ───────────────────────────────────────────────────────
  const ok = readPrintAlertBody({ rule: 'big-print' })
  const nvda = readPrintAlertBody({ rule: 'whale-repeat', market: ' xyz:NVDA ', venues: ['hypercore', 'nope', 'HYPERCORE'] })
  const bar = readPrintAlertBody({ rule: 'big-print', bigPrintUsd: '10000' })
  check('print alerts: the body reader — a bare rule defaults to every perp venue, any market and the $50K bar; a market keeps the venue spelling (xyz:NVDA); venues are the known ids, deduped; a bar is one of the rail\'s choices',
    'input' in ok && ok.input.rule === 'big-print' && ok.input.market === null && ok.input.venues.join() === PERP_VENUES.join() && ok.input.thresholds.bigPrintUsd === 50_000 &&
      'input' in nvda && nvda.input.market === 'xyz:NVDA' && nvda.input.venues.join() === 'hypercore' && 'input' in bar && bar.input.thresholds.bigPrintUsd === 10_000 && bar.input.thresholds.whaleUsd === DEFAULT_THRESHOLDS.whaleUsd,
    JSON.stringify({ ok, nvda, bar }))
  const bads = [readPrintAlertBody({ rule: 'sideways' }), readPrintAlertBody({ rule: 'big-print', market: 'HY PE' }), readPrintAlertBody({ rule: 'big-print', venues: ['mars'] }), readPrintAlertBody({ rule: 'big-print', bigPrintUsd: 12345 }), readPrintAlertBody(null)]
  check('print alerts: every refusal is by name — rule, market shape, venues, the bar; nothing is guessed',
    bads.every((b) => 'problem' in b) && /rule must be/.test((bads[0] as { problem: string }).problem) && /market must be/.test((bads[1] as { problem: string }).problem) && /venues must name/.test((bads[2] as { problem: string }).problem) && /bigPrintUsd must be one of/.test((bads[3] as { problem: string }).problem) && /rule must be/.test((bads[4] as { problem: string }).problem),
    JSON.stringify(bads))
  check('print alerts: PRINT_RULES are the rail\'s three; the bar choices are the rail\'s four', PRINT_RULES.join() === 'big-print,whale-repeat,flow-skew' && BIG_PRINT_CHOICES.join() === '10000,50000,250000,1000000')
  check('print alerts: a stored recent jsonb keeps its sent stamps (numbers only)', parseRecent({ sent: [1, 'x', 2] }).sent.join() === '1,2' && parseRecent(null).sent.length === 0)
  check('print alerts: a stored venues / thresholds / recent jsonb reads back with the defaults under garbage',
    parseVenues('x')?.join() === PERP_VENUES.join() && parseVenues(['dex-base', 'hypercore'])?.join() === 'hypercore,dex-base' && parseVenues([], null) === null &&
      parseThresholds({ bigPrintUsd: 10_000, skewPct: 'x', whaleFills: -1 }).bigPrintUsd === 10_000 && parseThresholds({ bigPrintUsd: 10_000, skewPct: 'x' }).skewPct === DEFAULT_THRESHOLDS.skewPct && parseThresholds(null).whaleFills === DEFAULT_THRESHOLDS.whaleFills &&
      parseRecent({ events: ['a', 1, 'b'], fires: { HYPE: 5, 'bad market!': 1, BTC: 'x' } }).events.join() === 'a,b' && Object.keys(parseRecent({ events: ['a', 1, 'b'], fires: { HYPE: 5, 'bad market!': 1, BTC: 'x' } }).fires).join() === 'HYPE')
  check('print alerts: the words — "Big print ≥ $50.00K on HYPE", "One taker, repeatedly on any market", "every perp venue" / "every venue" / the labels joined',
    printAlertLabel({ rule: 'big-print', market: 'HYPE', thresholds: DEFAULT_THRESHOLDS }) === 'Big print ≥ $50.00K on HYPE' && printAlertLabel({ rule: 'whale-repeat', market: null, thresholds: DEFAULT_THRESHOLDS }) === 'One taker, repeatedly on any market' &&
      printVenueWords([...PERP_VENUES]) === 'every perp venue' && printVenueWords(['hypercore', 'lighter', 'lighter-robinhood', 'dex-ethereum', 'dex-base', 'dex-arbitrum']) === 'every venue' && printVenueWords(['hypercore', 'dex-base']) === 'Hyperliquid perps + DEX swaps · Base')

  // ── Evaluation over consumed fills ────────────────────────────────────────
  const fills: TapeFill[] = [
    fill('HYPE', 'buy', 60_000, T - 30_000),
    fill('HYPE', 'sell', 9_000, T - 25_000),
    fill('BTC', 'buy', 4_000, T - 8_000, { taker: '0xabc' }),
    fill('BTC', 'buy', 4_000, T - 6_000, { taker: '0xabc' }),
    fill('BTC', 'buy', 4_000, T - 4_000, { taker: '0xabc' }),
    fill('SOL', 'buy', 80_000, T - 20_000, { venue: 'lighter' }),
    ...Array.from({ length: 22 }, (_, i) => fill('ETH', 'buy', 1_000, T - 50_000 + i * 1_800)),
    fill('ETH', 'sell', 1_000, T - 12_000),
    fill('ETH', 'sell', 1_000, T - 11_000),
  ]
  const empty = parseRecent(null)
  const big = evaluatePrintAlert(rule({}), fills, empty, { now: T })
  check('print alerts: a big-print rule on hypercore fires ONCE on the $60K HYPE print — not on the $9K sell, not on the $80K Lighter print (another venue) — with the fill\'s price, the past-tense measured sentence and the Hyperliquid long chip',
    big.fires.length === 1 && big.fires[0].event.market === 'HYPE' && big.fires[0].price === 42.1 && big.fires[0].event.text === '$60.00K bought on HYPE in one fill at 42.1.' && big.fires[0].event.follow?.ask === 'Long $25 of HYPE on Hyperliquid' && big.more === 0 && big.cooled === 0,
    JSON.stringify(big.fires.map((f) => f.event.text)))
  const both = evaluatePrintAlert(rule({ venues: ['hypercore', 'lighter'] }), fills, empty, { now: T })
  check('print alerts: the venues scope — a rule on hypercore + lighter fires on both the HYPE and the SOL print, newest first; a market scope keeps only its market (BTC → nothing ≥ $50K)',
    both.fires.length === 2 && both.fires[0].event.market === 'SOL' && both.fires[0].venue === 'lighter' && both.fires[1].event.market === 'HYPE' && evaluatePrintAlert(rule({ market: 'BTC' }), fills, empty, { now: T }).fires.length === 0,
    JSON.stringify(both.fires.map((f) => f.event.market)))
  const whale = evaluatePrintAlert(rule({ rule: 'whale-repeat' }), fills, empty, { now: T })
  const skew = evaluatePrintAlert(rule({ rule: 'flow-skew' }), fills, empty, { now: T })
  check('print alerts: one taker, repeatedly — 0xabc\'s three $4K BTC buys in 10s fire once, $12.00K measured, the long chip; the one-sided minute — 22 of 24 ETH fills buying fires once with the measured share',
    whale.fires.length === 1 && whale.fires[0].event.market === 'BTC' && whale.fires[0].event.usd === 12_000 && /bought \$12\.00K of BTC across 3 fills in 10s\./.test(whale.fires[0].event.text) && whale.fires[0].event.follow?.ask === 'Long $25 of BTC on Hyperliquid' &&
      skew.fires.length === 1 && skew.fires[0].event.market === 'ETH' && skew.fires[0].event.text === '92% of $24.00K on ETH in the last minute was buying, over 24 fills.' && skew.fires[0].price === 3900,
    `${whale.fires[0]?.event.text} | ${skew.fires[0]?.event.text}`)
  check('print alerts: a rule never fires another rule\'s event — the big-print rule sees no whale or skew event over the same fills, and vice versa', big.fires.every((f) => f.event.rule === 'big-print') && whale.fires.every((f) => f.event.rule === 'whale-repeat') && skew.fires.every((f) => f.event.rule === 'flow-skew'))
  const again = evaluatePrintAlert(rule({}), fills, big.recent, { now: T })
  check('print alerts: dedupe across passes — the same fills judged again with the rule\'s remembered events fire nothing (an UPDATE frame re-delivering a block is one event, not two); the event id is remembered', again.fires.length === 0 && big.recent.events.includes(`big:${fills[0].id}`), JSON.stringify(big.recent.events))
  const later2 = [fill('HYPE', 'buy', 61_000, T + 120_000)]
  const cool = evaluatePrintAlert(rule({}), later2, big.recent, { now: T + 120_000 })
  const later11 = [fill('HYPE', 'buy', 61_000, T + 11 * 60_000)]
  const warm = evaluatePrintAlert(rule({}), later11, big.recent, { now: T + 11 * 60_000 })
  check(`print alerts: the cooldown — a second $61K HYPE print two minutes after a firing is held (cooled 1, nothing written); eleven minutes later it fires (PRINT_ALERT_COOLDOWN_MS = ${PRINT_ALERT_COOLDOWN_MS / 60_000} min)`,
    cool.fires.length === 0 && cool.cooled === 1 && warm.fires.length === 1 && PRINT_ALERT_COOLDOWN_MS === 10 * 60_000, JSON.stringify({ cool: cool.cooled, warm: warm.fires.length }))
  const five = ['HYPE', 'BTC', 'ETH', 'SOL', 'DOGE'].map((m, i) => fill(m, 'buy', 70_000, T - 50_000 + i * 5_000))
  const capped = evaluatePrintAlert(rule({}), five, empty, { now: T })
  check(`print alerts: the per-pass cap — five markets each with a $70K print fire the newest ${PRINT_ALERT_MAX_PER_PASS} (DOGE · SOL · ETH) and count the other two`,
    capped.fires.length === PRINT_ALERT_MAX_PER_PASS && capped.fires.map((f) => f.event.market).join() === 'DOGE,SOL,ETH' && capped.more === 2 && PRINT_ALERT_MAX_PER_PASS === 3, JSON.stringify(capped.fires.map((f) => f.event.market)))
  const sixMarkets = ['HYPE', 'BTC', 'ETH', 'SOL', 'DOGE', 'UNI'].map((m, i) => fill(m, 'buy', 70_000, T - 50_000 + i * 5_000))
  const pass1 = evaluatePrintAlert(rule({}), sixMarkets, empty, { now: T })
  const pass2 = evaluatePrintAlert(rule({}), [fill('LINK', 'buy', 70_000, T + 30_000), fill('WETH', 'buy', 70_000, T + 31_000, { price: 3900 })], pass1.recent, { now: T + 60_000 })
  const pass3 = evaluatePrintAlert(rule({}), [fill('LINK', 'buy', 70_000, T + 30_000 + 10 * 60_000, { id: 'dune:late' })], pass2.recent, { now: T + 11 * 60_000 })
  check(`print alerts: the per-window budget — a rule writes at most ${PRINT_ALERT_MAX_PER_WINDOW} notifications inside one cooldown window across passes: 3 of six markets in pass one, 2 more in pass two (two new markets), then the budget holds the next until the window turns (${PRINT_ALERT_MAX_PER_WINDOW} > ${PRINT_ALERT_MAX_PER_PASS})`,
    pass1.fires.length === 3 && pass1.recent.sent.length === 3 && pass2.fires.length === 2 && pass2.recent.sent.length === 5 &&
      evaluatePrintAlert(rule({}), [fill('AAVE', 'buy', 70_000, T + 90_000, { price: 300 }), fill('ARB', 'buy', 70_000, T + 91_000, { price: 0.4 })], pass2.recent, { now: T + 120_000 }).fires.length === 1 &&
      evaluatePrintAlert(rule({}), [fill('AAVE', 'buy', 70_000, T + 90_000, { price: 300 }), fill('ARB', 'buy', 70_000, T + 91_000, { price: 0.4 })], pass2.recent, { now: T + 120_000 }).more === 1 &&
      pass3.fires.length === 1 && PRINT_ALERT_MAX_PER_WINDOW > PRINT_ALERT_MAX_PER_PASS,
    JSON.stringify({ p1: pass1.fires.length, p2: pass2.fires.length, sent: pass2.recent.sent.length, p3: pass3.fires.length }))
  const old = fills.map((f) => ({ ...f, id: `${f.id}:old`, at: f.at - 5 * 60_000 }))
  const backlog = evaluatePrintAlert(rule({ rule: 'flow-skew' }), old, empty, { now: T })
  check('print alerts: a replayed backlog is judged in its own minute — the one-sided ETH minute from five minutes ago still fires when the pass runs now (the step walk), where a single "last minute from now" read would see nothing',
    backlog.fires.length === 1 && backlog.fires[0].event.market === 'ETH', JSON.stringify(backlog.fires.map((f) => f.event.text)))
  check('print alerts: no fills in scope → no fires, the remembered state trimmed, nothing else', evaluatePrintAlert(rule({ venues: ['dex-base'] }), fills, empty, { now: T }).fires.length === 0)

  // ── The notification ──────────────────────────────────────────────────────
  const note = printNotification({ rule: 'big-print' }, big.fires[0], big.fires[0].event.follow, 2)
  const quiet = printNotification({ rule: 'big-print' }, big.fires[0], null, 0)
  const dexFire = evaluatePrintAlert(rule({ venues: ['dex-base'] }), [fill('WETH', 'buy', 55_000, T - 5_000, { venue: 'dex', chainId: 8453 })], empty, { now: T }).fires[0]
  const dexNote = printNotification({ rule: 'big-print' }, dexFire, dexFire.event.follow, 0)
  const stock = evaluatePrintAlert(rule({}), [fill('xyz:NVDA', 'buy', 55_000, T - 5_000, { price: 180 })], empty, { now: T }).fires[0]
  const stockNote = printNotification({ rule: 'big-print' }, stock, stock.event.follow, 0)
  check('print alerts: the notification — title "Big print on HYPE", the bell\'s symbol HYPE, the body = the measured sentence + the venue through Dune\'s feed + "2 more in the same pass." + the chip line only with a chip; no chip → no chip line and actionAsk null; the mail points at the tape filtered to the market',
    note.title === 'Big print on HYPE' && note.symbol === 'HYPE' && note.body === "$60.00K bought on HYPE in one fill at 42.1. Hyperliquid, through Dune's feed. 2 more in the same pass. The chip is ready to send — it moves nothing until you sign." && note.actionAsk === 'Long $25 of HYPE on Hyperliquid' && note.price === 42.1 && note.href === '/live?m=HYPE' &&
      quiet.actionAsk === null && !/chip is ready/.test(quiet.body) && !/more in the same pass/.test(quiet.body),
    JSON.stringify({ note, quiet }))
  check('print alerts: a DEX print names its chain (DEX · Base) and the bell\'s symbol is the ask ticker (WETH → ETH, chip "Buy $25 of ETH on Base"); a stock perp (xyz:NVDA) is NVDA on the bell with the spot buy chip',
    dexNote.symbol === 'ETH' && /DEX · Base, through Dune's feed\./.test(dexNote.body) && dexNote.actionAsk === 'Buy $25 of ETH on Base' && stockNote.symbol === 'NVDA' && stockNote.title === 'Big print on xyz:NVDA' && stockNote.actionAsk === 'Buy $25 of NVDA' && stockNote.href === '/live?m=xyz%3ANVDA',
    JSON.stringify({ dexNote, stockNote }))

  // ── The cursor policy (measured 2026-10-13) ───────────────────────────────
  const facts = { resumed: true, opened: false, frames: 0, closeCode: 1006, livedMs: 418, caughtUp: false, budgetHit: false, idle: false }
  check('print alerts: the cursor policy — a resumed socket that dies within 2s with no open and no frame is `rejected` (the venue refused the cursor: 1006 at ~0.4s measured for one outside the retained range and for one from the future); the same death on a COLD open is `error`, never a rejection; a 1008 is `fell-behind`; the tip, the budget, an idle venue and a plain close are themselves',
    pullOutcome(facts) === 'rejected' && pullOutcome({ ...facts, resumed: false }) === 'error' && pullOutcome({ ...facts, closeCode: 1008 }) === 'fell-behind' && pullOutcome({ ...facts, opened: true, frames: 3 }) === 'closed' &&
      pullOutcome({ resumed: true, opened: true, frames: 100, closeCode: null, livedMs: 4_000, caughtUp: true, budgetHit: false, idle: false }) === 'tip' && pullOutcome({ resumed: true, opened: true, frames: 100, closeCode: null, livedMs: 40_000, caughtUp: false, budgetHit: true, idle: false }) === 'budget' &&
      pullOutcome({ resumed: true, opened: true, frames: 0, closeCode: null, livedMs: 12_500, caughtUp: false, budgetHit: false, idle: true }) === 'idle' && pullOutcome({ ...facts, unconfigured: true }) === 'unconfigured' && CURSOR_REJECT_WINDOW_MS === 2_000)
  check('print alerts: a refused cursor is recorded in words — the venue, the cursor\'s age, that the prints since were not watched, and that the pass rejoined at the tip (the runbook: never silently restart)',
    gapNote('Hyperliquid perps', '76467932', 26 * 60 * 60_000) === 'Hyperliquid perps refused the stored cursor from 26h ago (76467932); the prints since then were not watched. Rejoined at the tip.' && gapNote('Lighter perps', '5', null) === 'Lighter perps refused the stored cursor (5); the prints since then were not watched. Rejoined at the tip.' &&
      ageWords(45_000) === '45s' && ageWords(7 * 60_000) === '7m' && ageWords(26 * 3_600_000) === '26h' && ageWords(3 * 86_400_000) === '3d')
  const fs = feedStatusWords({ venue: 'hypercore', cursor: '7', tipAt: new Date(T - 2_000).toISOString(), lastOutcome: 'tip', lastPassAt: new Date(T - 40_000).toISOString(), gapAt: new Date(T - 600_000).toISOString(), gapNote: 'Hyperliquid perps refused the stored cursor from 26h ago (1); the prints since then were not watched. Rejoined at the tip.' }, T)
  check('print alerts: the rail\'s status line — no pass yet says so; a pass names its age, how far it read, the outcome, and a gap inside a day',
    feedStatusWords({ venue: 'lighter', cursor: null, tipAt: null, lastOutcome: null, lastPassAt: null, gapAt: null, gapNote: null }, T) === 'Lighter perps: no pass yet — the first opens the feed at the tip.' && fs === 'Hyperliquid perps: last pass 40s ago, read up to 2s ago (tip). Gap 10m ago: Hyperliquid perps refused the stored cursor from 26h ago (1); the prints since then were not watched. Rejoined at the tip.', fs)
  check(`print alerts: the budget fits the route — the default consumption ${PRINT_CRON_BUDGET_MS / 1000}s, the cap ${PRINT_CRON_MAX_BUDGET_MS / 1000}s, under the ${PRINT_CRON_MAX_DURATION_S}s function with room for the DB and the mail; the venue lease outlives a pass and never a minute`,
    PRINT_CRON_BUDGET_MS <= PRINT_CRON_MAX_BUDGET_MS && PRINT_CRON_MAX_BUDGET_MS + 10_000 <= PRINT_CRON_MAX_DURATION_S * 1000 && FEED_LEASE_MS > PRINT_CRON_MAX_BUDGET_MS && FEED_LEASE_MS < 60_000)

  // ── The fixture reader ────────────────────────────────────────────────────
  const fx = fixtureFills([{ id: 'a', market: 'HYPE', side: 'buy', size: 10, price: 42, at: T, taker: '0xABC' }, { id: 'b', market: 'WETH', side: 'sell', size: 1, price: 3900, usd: 3950, at: T, venue: 'dex', chainId: 8453 }, { id: 'c', market: 'HY PE', side: 'buy', size: 1, price: 1, at: T }, { id: 'd', market: 'BTC', side: 'hold', size: 1, price: 1, at: T }, { id: 'e', market: 'BTC', side: 'buy', size: 0, price: 1, at: T }, 'junk', { id: 'f', market: 'BTC', side: 'buy', size: 1, price: 1, at: 'x' }])
  check('print alerts: the cron\'s fixture — a fill is kept only in shape (id · market · side · size · price · at), usd defaults to size × price, the taker is lowercased, a DEX fill keeps its chain, a perp drops it; five bad rows are dropped by shape; the list is capped',
    fx.length === 2 && fx[0].usd === 420 && fx[0].taker === '0xabc' && fx[0].venue === 'hyperliquid' && fx[0].chainId === null && fx[0].source === 'dune' && fx[1].usd === 3950 && fx[1].venue === 'dex' && fx[1].chainId === 8453 &&
      fixtureFills(Array.from({ length: FIXTURE_MAX_FILLS + 5 }, (_, i) => ({ id: `x${i}`, market: 'BTC', side: 'buy', size: 1, price: 1, at: T }))).length === FIXTURE_MAX_FILLS && fixtureFills('nope').length === 0,
    JSON.stringify(fx))

  // ── The held arm ──────────────────────────────────────────────────────────
  const rec = heldPrintArmRecord({ rule: 'big-print', market: 'HYPE', bigPrintUsd: 10_000 }, '/live', T)
  check(`print alerts: a guest's tap survives the door — the record reads back on the same path inside ${HELD_PRINT_ARM_TTL_MS / 60_000} min with the rule, the market and the bar; another path, an expired record, a future stamp, a bad rule or garbage read as nothing (the key is ${HELD_PRINT_ARM_KEY})`,
    JSON.stringify(readHeldPrintArm(rec, '/live', T + 60_000)) === JSON.stringify({ rule: 'big-print', market: 'HYPE', bigPrintUsd: 10_000 }) && readHeldPrintArm(rec, '/live?view=front', T) === null && readHeldPrintArm(rec, '/live', T + HELD_PRINT_ARM_TTL_MS + 1) === null && readHeldPrintArm(rec, '/live', T - 120_000) === null &&
      readHeldPrintArm(heldPrintArmRecord({ rule: 'nope' as never, market: null, bigPrintUsd: 10_000 }, '/live', T), '/live', T) === null && readHeldPrintArm('{', '/live', T) === null && readHeldPrintArm(null, '/live', T) === null && HELD_PRINT_ARM_KEY === 'pantessa.prints.heldArm.v1')

  // ── The wiring (source) ───────────────────────────────────────────────────
  const route = readFileSync('app/api/cron/prints/route.ts', 'utf8')
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[]; functions: Record<string, { maxDuration: number }> }
  check(`print alerts: the cron route — CRON_SECRET fail-closed (no secret = 401, the guardian doctrine), a LITERAL \`export const maxDuration = ${PRINT_CRON_MAX_DURATION_S}\` (an import there fails the build), vercel.json runs it every minute and gives the function the same ${PRINT_CRON_MAX_DURATION_S}s; the fixture is read only on an internal run`,
    /if \(!secret\) return false/.test(route) && new RegExp(`^export const maxDuration = ${PRINT_CRON_MAX_DURATION_S}$`, 'm').test(route) && !/import[^\n]*maxDuration/.test(route) &&
      vercel.crons.some((c) => c.path === '/api/cron/prints' && c.schedule === '* * * * *') && vercel.functions['app/api/cron/prints/route.ts']?.maxDuration === PRINT_CRON_MAX_DURATION_S && /isInternalRun\(req\.headers, body\) && body\.fixture/.test(route))
  const exec = readFileSync('lib/print-alerts-exec.ts', 'utf8')
  const priceExec = readFileSync('lib/alerts-exec.ts', 'utf8')
  check('print alerts: ONE notification path — the print sweep and the price sweep both write through lib/alerts-exec notifyAlertFired (the bell + the mail), the print sweep never touches alert_notifications itself; the mail never goes to an internal row',
    /notify\(\{ owner: a\.row\.owner, alertId: a\.row\.id/.test(exec) && /const notify = opts\.notify \?\? notifyAlertFired/.test(exec) && !/alertNotification\./.test(exec) && /await notifyAlertFired\(\{ owner: a\.owner, alertId: a\.id/.test(priceExec) && /if \(n\.email && !n\.isInternal\)/.test(priceExec))
  const evalAt = exec.indexOf('evaluatePrintAlert(a.shape')
  const cursorAt = exec.indexOf('prisma.feedCursor.update(')
  check('print alerts: the cursor is stored AFTER the rules judged the frames (the runbook: persist the checkpoint only after the message was handled) and the lease is released in a finally; a refused cursor records gap_from / gap_at / gap_note before the pass rejoins at the tip; a 1008 reconnects from the last durable cursor',
    evalAt > 0 && cursorAt > evalAt && /} finally \{[\s\S]*prisma\.feedCursor\.update\(/.test(exec) && /gapFrom: r\.gap\.from, gapAt: now, gapNote: r\.gap\.note/.test(exec) && /r\.outcome === 'rejected' && cursor/.test(exec) && exec.indexOf('gap = { from: cursor') < exec.indexOf('const again = await pull(venue, null') &&
      /r\.outcome === 'fell-behind'/.test(exec) && /pull\(venue, r\.cursorOut \?\? cursor/.test(exec) && /fixture && r\.isInternal/.test(exec) && /canTradeAsk\(follow\.ask, tradable\)/.test(exec))
  const feed = readFileSync('components/live/LiveFeed.tsx', 'utf8')
  // Comments stripped before the body regex: the seat's own header names the rule it keeps.
  const seat = readFileSync('components/live/ServerTriggers.tsx', 'utf8').replace(/^\s*\/\/.*$/gm, '')
  check('print alerts: the rail mounts the seat under the rules with the tape\'s market filter and venues; the seat arms through the session only (no owner, wallet or recipient in its body), a guest gets the UNIFIED door with no redirectTo and the tap is held, the armed state is read from the server; the rail\'s bar choices are the one list',
    /<ServerTriggers market=\{market\} venues=\{venues\} thresholds=\{thresholds\} \/>/.test(feed) && /market=\{filter\} venues=\{venues\}/.test(feed) && /import \{ BIG_PRINT_CHOICES \} from '@\/lib\/print-alerts'/.test(feed) &&
      !/walletAddress|owner:|email:|recipient/.test(seat) && /<CreateAccountButton className="live__sarm"/.test(seat) && !/redirectTo/.test(seat) && /onOpenChange=\{\(open\) => open && hold\(rule\)\}/.test(seat) && /readHeldPrintArm\(sessionStorage\.getItem\(HELD_PRINT_ARM_KEY\)/.test(seat) && /status === 'authed' && !!address/.test(seat))
  const ddl = readFileSync('prisma/ddl/2026-10-13-print-alerts.sql', 'utf8')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const cols = (table: string) => (ddl.slice(ddl.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`)).split(');')[0].match(/^\s{2}[a-z_]+\s/gm) ?? []).length
  check('print alerts: the DDL file is additive (CREATE TABLE/INDEX IF NOT EXISTS only) and carries both tables with the model\'s column counts (print_alerts 14, feed_cursors 12)',
    !/DROP|ALTER TABLE .* DROP/.test(ddl) && cols('print_alerts') === 14 && cols('feed_cursors') === 12 && /model PrintAlert \{[\s\S]*@@map\("print_alerts"\)/.test(schema) && /model FeedCursor \{[\s\S]*@@map\("feed_cursors"\)/.test(schema))
}

if (process.argv[1]?.endsWith('print-alert-pins.ts')) {
  let failed = 0
  printAlertPins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall print-alert pins green')
  process.exit(failed ? 1 : 0)
}
