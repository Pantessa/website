// ─────────────────────────────────────────────────────────────────────────
//  MARKETS — the words. ONE source for every Markets surface (landing hero,
//  the Markets band, /markets, /t/<symbol>, /compare, /docs/markets, the
//  watchlist rail, the technicals + news + community tabs). Lanes import
//  these instead of inventing a second phrasing; a string that lives here
//  is the phrasing the site says everywhere.
//
//  Pure + client-safe (no env, no fetch). Numbers that are FEES come from
//  lib/fees so the killer line can never drift from what the builders stamp.
// ─────────────────────────────────────────────────────────────────────────

import { SWAP_FEE_BPS, SWAP_FEE_PCT } from '@/lib/fees'

/** The nav word — landing nav, app spine, footer. */
export const MARKETS_NAV_WORD = 'Markets'

/** The hero (README default, 2026-09-11). Nate picks the final line from
 *  the PR's three options; whichever wins lands HERE and every surface
 *  follows. */
export const HERO_LINE = 'The chart that executes.'
export const HERO_SUB =
  'A window to digital equities. Stocks 24/7, perps, spot and yield in one wallet. You keep the pen.'

/** <title> for the homepage — the hero line, no suffix (pinned in test-api). */
export const HOME_TITLE = `Pantessa — ${HERO_LINE}`
export const HOME_DESCRIPTION =
  'Live charts for tokenized stocks (24/7 on Robinhood Chain), crypto spot and Hyperliquid perps — and every chart is the order form. Buy, sell, DCA or protect from a chip; Pantessa builds the guarded transaction, your own wallet signs. Unlimited watchlists and alerts, free.'

/** The value line against a metered charting subscription. Never add a cap. */
export const UNLIMITED_LINE = 'Unlimited watchlists · unlimited tickers · unlimited alerts · free'

/** The chip contract, said once. In the app a chip SENDS on click; from a
 *  page or a link the ask PREFILLS and you send it. A URL never fires a turn. */
export const CHIP_CONTRACT = 'A chip sends. A link prefills. The signature is the gate.'

/** Every number the Markets surfaces compute — gauges, movers, pivots,
 *  performance tiles — wears this footnote. */
export const TAPE_FOOTNOTE = 'Computed from our own tape · not advice'

/** Where the candles come from, said honestly on every chart. */
export const FEED_NOTE =
  'Stocks: Robinhood’s 24/7 market-data tape (the print the on-chain token tracks; Yahoo Finance when it’s down, and the chart says so). Crypto: Coinbase spot. Perps: Hyperliquid.'

// ── Session lines ─────────────────────────────────────────────────────────
// Robinhood-Chain stocks trade 24/7 on-chain while the underlying tape
// closes — every stock header shows BOTH, never just one.

export type SessionKind = 'stock' | 'spot' | 'perp'

/** NYSE regular session in ET, weekdays — good enough for a header line;
 *  the venue's own `session` from /api/quotes wins when present. */
export function nyseOpen(now: Date = new Date()): boolean {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return false
  const mins = et.getHours() * 60 + et.getMinutes()
  return mins >= 9 * 60 + 30 && mins < 16 * 60
}

/** The header's session line. Stocks: "Token trades 24/7 · NYSE closed". */
export function sessionLine(kind: SessionKind, opts: { exchangeOpen?: boolean; now?: Date } = {}): string {
  if (kind === 'stock') {
    const open = opts.exchangeOpen ?? nyseOpen(opts.now)
    return `Token trades 24/7 · NYSE ${open ? 'open' : 'closed'}`
  }
  if (kind === 'perp') return '24/7 · Hyperliquid perps'
  return '24/7 · Coinbase spot'
}

/** Which session kind a chart source implies. */
export function sessionKindFor(source: 'coinbase' | 'hyperliquid' | 'robinhood' | null | undefined): SessionKind {
  if (source === 'robinhood') return 'stock'
  if (source === 'hyperliquid') return 'perp'
  return 'spot'
}

// ── Empty states ──────────────────────────────────────────────────────────
export const EMPTY = {
  watchlist: 'Nothing watched yet. Add a ticker — there is no limit, and there never will be.',
  watchlistGuest: 'Your watchlist lives in this browser until you sign in; signing in keeps it.',
  news: (symbol: string) => `No headlines pinned to the ${symbol} tape yet.`,
  community: (symbol: string) => `No charts posted on ${symbol} yet. Draw a level, post it — a reader can sign it.`,
  technicals: 'Not enough bars to compute a verdict yet.',
  chart: (symbol: string) => `No live chart for ${symbol} yet.`,
  alerts: 'No alerts armed. An alert here can notify you — or act.',
  movers: 'Movers appear once the tape has a full day behind it.',
} as const

// ── Alerts ────────────────────────────────────────────────────────────────
/** The two things an alert can do — the second is the one a charting
 *  subscription cannot sell. */
export const ALERT_MODES = {
  notify: 'Notify me',
  act: 'Act on it',
} as const

// ── TradingView import ────────────────────────────────────────────────────
// The competitor is NAMED here because the import target is their export
// format — plain text, no marks (rule 7).
export const TV_IMPORT = {
  cta: 'Import your TradingView watchlist',
  sub: 'Paste the export. Every symbol we can chart lights up; the rest are listed as not tradable here yet.',
  placeholder: 'NASDAQ:AAPL, NASDAQ:TSLA, COINBASE:ETHUSD\n###Perps\nHYPERLIQUID:HYPE',
  notTradable: 'Not tradable here yet',
} as const

// ── Attribution ───────────────────────────────────────────────────────────
/** The chart engine's license requires a visible notice with a link
 *  (lightweight-charts, Apache-2.0 + attribution). Text + link only — never
 *  a logo lockup (rule 7). CHART renders it under the canvas; docs cite it. */
export const CHART_ATTRIBUTION = {
  text: 'Charting by TradingView Lightweight Charts™',
  href: 'https://www.tradingview.com/',
  license: 'Apache-2.0',
} as const

// ── /compare: their meters, verbatim, dated ───────────────────────────────
/** TradingView’s pricing page (annual billing, EUR) as read on this date.
 *  Quoted numbers — update the date when you update a cell. */
export const TV_PRICING_AS_OF = '2026-09-11'
export const TV_PRICING_AS_OF_LABEL = 'September 11, 2026'

export interface PricingRow {
  tier: string
  eurPerMonth: number
  chartsPerTab: string
  indicators: string
  bars: string
  priceAlerts: string
  watchlistAlerts: string
}

export const TV_PRICING_TABLE: PricingRow[] = [
  { tier: 'Free', eurPerMonth: 0, chartsPerTab: '1', indicators: '2', bars: '~5K', priceAlerts: '1', watchlistAlerts: '0' },
  { tier: 'Essential', eurPerMonth: 12.95, chartsPerTab: '2', indicators: '5', bars: '10K', priceAlerts: '20', watchlistAlerts: '0' },
  { tier: 'Plus', eurPerMonth: 29.95, chartsPerTab: '4', indicators: '10', bars: '10K', priceAlerts: '100', watchlistAlerts: '0' },
  { tier: 'Premium', eurPerMonth: 59.95, chartsPerTab: '8', indicators: '25', bars: '20K', priceAlerts: '400', watchlistAlerts: '2' },
  { tier: 'Ultimate', eurPerMonth: 199.95, chartsPerTab: '16', indicators: '50', bars: '40K', priceAlerts: '1,000', watchlistAlerts: '15' },
]

/** Our column, every tier: the same six meters, un-metered. */
export const PANTESSA_PRICING_ROW: PricingRow = {
  tier: 'Pantessa',
  eurPerMonth: 0,
  chartsPerTab: '∞',
  indicators: '∞',
  bars: '∞',
  priceAlerts: '∞',
  watchlistAlerts: '∞',
}

/** The six things a charting subscription cannot sell at any price
 *  (BUSINESS-MODEL-chart-first §1). Title + one sentence each. */
export const SIX_LINES: { title: string; body: string }[] = [
  {
    title: 'The alert executes.',
    body: 'Their alert pings your phone. Ours closes the position, buys the dip, takes the profit — signed once, runs while you sleep, non-custodial.',
  },
  {
    title: 'The idea executes.',
    body: 'A posted chart is a link the reader signs in one tap, and the author is paid on every trade it produces, for life.',
  },
  {
    title: '24/7 stocks next to perps, spot and yield, one wallet.',
    body: 'AAPL at 3am on a Sunday. HYPE 2x with a stop. USDC earning on Aave. One chart surface, one signature model, no broker linking.',
  },
  {
    title: 'The line is the order.',
    body: 'Draw a level and it becomes a limit order or a stop. Draw a ladder and it becomes a schedule.',
  },
  {
    title: 'Say it.',
    body: '“Show me the AAPL chart, buy ten dollars.” The mic is in the composer.',
  },
  {
    title: 'You keep the pen.',
    body: 'No custody, no broker account, no sign-up to look. Only your wallet can sign.',
  },
]

// ── The killer line — derived from the fee source, never typed ────────────
const ULTIMATE_EUR_PER_YEAR = 199.95 * 12 // 2,399.40
const fmtEurRound = (n: number) => `€${Math.round(n).toLocaleString('en-US')}`
const fmtEurCompact = (n: number) =>
  n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1_000 ? `€${Math.round(n / 1000)}K` : fmtEurRound(n)

/** Volume through Pantessa whose organic fee equals a year of their top tier. */
export const VOLUME_TO_MATCH_ULTIMATE_EUR = ULTIMATE_EUR_PER_YEAR / (SWAP_FEE_BPS / 10_000)

export const KILLER_LINE = {
  ultimatePerYear: fmtEurRound(ULTIMATE_EUR_PER_YEAR),
  volume: fmtEurCompact(VOLUME_TO_MATCH_ULTIMATE_EUR),
  feePct: SWAP_FEE_PCT,
  /** "Ultimate is €2,399 a year. You would have to trade €1.2M through Pantessa to pay us that." */
  sentence: `Ultimate is ${fmtEurRound(ULTIMATE_EUR_PER_YEAR)} a year. You would have to trade ${fmtEurCompact(VOLUME_TO_MATCH_ULTIMATE_EUR)} through Pantessa to pay us that.`,
  /** The small trader’s number: a year of Ultimate’s price, traded once, costs €4.80. */
  smallTraderFee: `€${(ULTIMATE_EUR_PER_YEAR * (SWAP_FEE_BPS / 10_000)).toFixed(2)}`,
}

// ── The honest column: what they have that we don’t ───────────────────────
export const THEY_HAVE: { title: string; body: string }[] = [
  { title: 'Pine Script.', body: 'A whole language for custom indicators and strategies, with a library of thousands. We have none.' },
  { title: 'Screeners.', body: 'Stock, crypto and forex screeners across every listed market. We chart what we can trade.' },
  { title: 'Drawing depth.', body: 'A hundred-plus drawing tools, templates, replay. Ours are the lines that become orders.' },
  { title: 'Broker links.', body: 'Trade through your existing brokerage from their chart. We are the venue-side: one wallet, on-chain.' },
  { title: 'Coverage.', body: 'Forex, futures, indices, most global equities. We cover the tokenized stocks on Robinhood Chain, crypto majors and Hyperliquid perps.' },
  { title: 'Fifteen years.', body: 'A community of tens of millions and native apps on every platform. We opened this month.' },
]

// ── Risks, said out loud (BUSINESS-MODEL §6) ──────────────────────────────
export const HONEST_RISKS: { title: string; body: string }[] = [
  {
    title: 'A brokerage app charges $0 commission on stocks. We charge a fee.',
    body: `Organic trades pay ${SWAP_FEE_PCT} to Pantessa, on-chain and visible. What you get for it is 24/7, non-custodial, one wallet across venues — not a lower price.`,
  },
  {
    title: 'On-chain stock liquidity is thin.',
    body: 'The chart is the tape; the sign card quotes the pool. If the two disagree, the card is the truth and you can decline it.',
  },
  {
    title: 'Tokenized stocks are regional.',
    body: 'Robinhood Chain stock tokens are issued under regional rules; the pools are permissionless but your access to the tokens depends on where you are. Check before you buy.',
  },
  {
    title: 'Not advice.',
    body: `Every gauge, mover and pivot is ${TAPE_FOOTNOTE.toLowerCase()}. Nothing here is a recommendation.`,
  },
]

/** The regional note, alone, for surfaces that show stocks to a stranger. */
export const REGIONAL_NOTE =
  'Tokenized stock access is regionally gated by the issuer; the on-chain pools are permissionless. Check your eligibility before buying.'
