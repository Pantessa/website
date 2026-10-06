// THE LIVE PULSE (squad front-door, 2026-10-06): the pure half of the band
// at the top of `/`.
//
// Nate: "our new live page feels more alive … we don't need to show the
// epileptic every trade splat … combine the live feed with the markets page
// … showing value others do not have right away like the scanning streaming
// data". So the splash opens on the venue's own fills, aggregated in the
// browser (lib/tape + lib/tape-feed, keyless) into a calm band: dollars per
// second over the last ninety seconds, the hot market, the largest print,
// the taker split — and the chip on the two numbers is the sentence that does
// the same thing ("every print is a button"). No tape rows: that is /live's
// job, and the band is the door to it.
//
// This module holds every rule the band runs on and nothing that touches a
// browser: the market pick, the buffer window, the per-second bars, the
// tiles, the chips, the hidden-tab policy, the words, the heights the SSR
// frame is drawn at. Pinned by scripts/pulse-pins.ts; drawn by
// components/home/PulseSlot.tsx.
//
// Rules carried over (HANDOFF-battlefield, lib/tape): every pixel is a
// number; a number the band has not measured is "waiting for the first
// fill", never a placeholder; a chip sends, a link prefills, a URL never
// fires a turn; the signature is the gate; nothing on the band fires on its
// own.

import {
  FALLBACK_MARKETS,
  FLOW_CLASSES,
  flowBuckets,
  flowTone,
  followAsk,
  mergeFillsWithin,
  tapeMarket,
  tapeStats,
  type FollowAsk,
  type MarketPick,
  type TapeFill,
  type TapeMarket,
  type TapeSide,
  type UniverseRow,
} from '@/lib/tape'
import type { FeedStatus } from '@/lib/tape-feed'

// ── The pick ─────────────────────────────────────────────────────────────────

/** Smaller than /live's {14, 8}: enough books to never be quiet (the
 *  busiest eight main-book perps alone printed ~35 fills/s on 2026-10-06),
 *  few enough to read as one number. */
export const PULSE_PICK: MarketPick = { main: 8, xyz: 4 }

/**
 * Which markets the band subscribes to: the busiest main-book perps by the
 * venue's own 24h volume, and among the xyz (HIP-3) dex the stocks the house
 * lists on Robinhood Chain FIRST — those rows carry a button; crude, gold,
 * FX and an index cannot follow — then the busiest of the rest so a quiet
 * stock day still shows a live xyz book. Delisted rows, zero-volume rows and
 * the dex's own index product never make the list. (/live's pickTapeMarkets
 * leads with the two hottest xyz books instead; the splash leads with what a
 * wallet can act on.)
 */
export function pickPulseMarkets(main: readonly UniverseRow[], xyz: readonly UniverseRow[], pick: MarketPick = PULSE_PICK): string[] {
  const live = (rows: readonly UniverseRow[]) =>
    [...rows.filter((r) => !r.delisted && Number.isFinite(r.volumeUsd) && r.volumeUsd > 0 && !/:XYZ100$/.test(r.name))].sort((a, b) => b.volumeUsd - a.volumeUsd)
  const mainPick = live(main)
    .slice(0, pick.main)
    .map((r) => r.name)
  const xyzLive = live(xyz)
  const listed = xyzLive.filter((r) => tapeMarket(r.name).kind === 'stock').map((r) => r.name)
  const xyzPick: string[] = []
  for (const name of [...listed, ...xyzLive.map((r) => r.name)]) {
    if (xyzPick.length >= pick.xyz) break
    if (!xyzPick.includes(name)) xyzPick.push(name)
  }
  return [...mainPick, ...xyzPick]
}

/** What the band runs on when the universe read fails: /live's fallback,
 *  cut to the pulse's own sizes (its xyz entries are all house-listed). */
export const PULSE_FALLBACK_MARKETS: readonly string[] = [
  ...FALLBACK_MARKETS.filter((m) => !m.includes(':')).slice(0, PULSE_PICK.main),
  ...FALLBACK_MARKETS.filter((m) => m.includes(':')).slice(0, PULSE_PICK.xyz),
]

/**
 * The markets the stream is aimed at once the universe answers. The band
 * opens on PULSE_FALLBACK_MARKETS the moment it mounts (the read measured
 * 2.6–3.6s in the browser, half the time to the first fill) and re-aims the
 * same socket here. A half the venue failed to answer keeps the fallback's
 * half: one failed read must never leave four quiet stock books as the whole
 * pulse (measured twice on 2026-10-06: `live · 4 markets`, first fill at 13s).
 */
export function pulseMarketsFrom(main: readonly UniverseRow[], xyz: readonly UniverseRow[], pick: MarketPick = PULSE_PICK): string[] {
  const picked = pickPulseMarkets(main, xyz, pick)
  const mainPick = picked.filter((m) => !m.includes(':'))
  const xyzPick = picked.filter((m) => m.includes(':'))
  return [
    ...(mainPick.length ? mainPick : PULSE_FALLBACK_MARKETS.filter((m) => !m.includes(':'))),
    ...(xyzPick.length ? xyzPick : PULSE_FALLBACK_MARKETS.filter((m) => m.includes(':'))),
  ]
}

/** How long the universe read may take before the band stops waiting for it
 *  and keeps the fallback aim (measured 1.8s from node, 2.6–3.6s in the
 *  browser beside the splash's other reads, 2026-10-06). */
export const PULSE_UNIVERSE_TIMEOUT_MS = 6_000

// ── The buffer and the window ────────────────────────────────────────────────

/** The chart's window, in seconds. Ninety reads as "right now" and still
 *  shows a shape; /live's two minutes is a page, this is a band. */
export const PULSE_WINDOW_SEC = 90

/** The tiles' window — tapeStats' own minute, named here for the copy. */
export const PULSE_TILE_WINDOW_SEC = 60

/** The buffer keeps the chart's window plus a whole edge bucket plus the
 *  ingest latency a batch can carry, so the oldest bar is never thinned. */
export const PULSE_KEEP_MS = (PULSE_WINDOW_SEC + 6) * 1_000

/** Deep enough for 120 fills/s across the keep window (the 12-market pick
 *  measured 47/s; a venue-wide spike still fits). A cap that bites under the
 *  window would quietly lower the oldest bars — a lie in the chart. */
export const PULSE_MAX_FILLS = 120 * (PULSE_KEEP_MS / 1_000)

/** The band repaints at most this often: a batch lands every frame on a busy
 *  second, and a calm band does not need sixty renders a second. The first
 *  fill after an empty buffer paints at once. */
export const PULSE_FLUSH_MS = 250

export function mergePulseFills(buffer: readonly TapeFill[], incoming: readonly TapeFill[], nowMs: number): TapeFill[] {
  return mergeFillsWithin(buffer, incoming, nowMs, PULSE_KEEP_MS, PULSE_MAX_FILLS)
}

// ── The bars ─────────────────────────────────────────────────────────────────

export interface PulseBar {
  /** Unix seconds. */
  sec: number
  /** Dollars the takers BOUGHT this second (up-ink): a buy, or with a
   *  position-aware feed a long open / short cover. */
  up: number
  /** Dollars the takers SOLD this second (down-ink). */
  down: number
  total: number
  count: number
}

/** The chart's bars: the last `windowSec` seconds ending on the current
 *  second, every second present (a quiet one is a zero bar), the six flow
 *  classes folded to the two inks the band draws. */
export function pulseBars(fills: readonly TapeFill[], nowMs: number, windowSec = PULSE_WINDOW_SEC): PulseBar[] {
  return flowBuckets(fills, nowMs, windowSec).map((b) => {
    let up = 0
    let down = 0
    for (const c of FLOW_CLASSES) {
      if (flowTone(c).dir === 'up') up += b.usd[c]
      else down += b.usd[c]
    }
    return { sec: b.sec, up, down, total: b.total, count: b.count }
  })
}

// ── The tiles ────────────────────────────────────────────────────────────────

export type PulseTileChip = FollowAsk

export interface PulseTiles {
  /** The market with the most dollars in the last minute, which side carried
   *  them, and that side's share of its dollars. */
  hot: { market: TapeMarket; usd: number; side: TapeSide; buyPct: number; chip: PulseTileChip | null } | null
  largest: { fill: TapeFill; market: TapeMarket; chip: PulseTileChip | null } | null
  /** Fills per second over the last ten seconds (tapeStats' rule). */
  tradesPerSec: number
  /** Dollars over the last minute. */
  notionalPerMin: number
  split: { buyUsd: number; sellUsd: number; buyPct: number | null }
}

/**
 * The band's numbers from the buffer, every one measured: the hot market,
 * the largest print, trades per second, notional per minute, the taker
 * split. Each chip is lib/tape's followAsk — the sentence the symbol pages
 * compose — and `chipOk` is the caller's gate (lib/trade-venue-gate
 * canTradeAsk with the measured verdicts): a sentence the gate refuses is
 * no chip, never a dead button. An empty buffer answers nulls; the band
 * prints "waiting for the first fill", not a dash it invented.
 */
export function pulseTiles(fills: readonly TapeFill[], nowMs: number, chipOk: (ask: string) => boolean = () => true): PulseTiles {
  const st = tapeStats(fills, nowMs)
  const gate = (f: FollowAsk | null): PulseTileChip | null => (f && chipOk(f.ask) ? f : null)
  let hot: PulseTiles['hot'] = null
  if (st.hotMarket) {
    const minAgo = nowMs - PULSE_TILE_WINDOW_SEC * 1_000
    let buy = 0
    let all = 0
    for (const f of fills) {
      if (f.at < minAgo || f.market !== st.hotMarket.market) continue
      all += f.usd
      if (f.side === 'buy') buy += f.usd
    }
    hot = {
      market: tapeMarket(st.hotMarket.market),
      usd: st.hotMarket.usd,
      side: st.hotMarket.side,
      buyPct: all > 0 ? Math.round((buy / all) * 100) : 0,
      chip: gate(followAsk({ market: st.hotMarket.market, side: st.hotMarket.side })),
    }
  }
  const largest: PulseTiles['largest'] = st.largestPrint ? { fill: st.largestPrint, market: tapeMarket(st.largestPrint.market), chip: gate(followAsk(st.largestPrint)) } : null
  return { hot, largest, tradesPerSec: st.tradesPerSec, notionalPerMin: st.notionalPerMin, split: st.takerFlow }
}

/** Why a tile has no chip, in /live's words — said in place of the button. */
export function pulseNoChipWords(m: TapeMarket, side: TapeSide): string {
  return m.kind === 'stock' && side === 'sell' ? 'needs a position' : 'no route here'
}

// ── The hidden-tab policy ────────────────────────────────────────────────────

/**
 * A hidden tab keeps the stream for this long, then closes it. Fifteen
 * seconds covers a glance at another tab (no reconnect, no empty chart on
 * return); anything longer is a tab nobody is reading, and the venue is
 * owed no socket for it. The band reopens the moment the tab is visible
 * again, and the chart's window refills from the venue's snapshot and the
 * live fills — it never claims "live" while the socket is closed.
 */
export const PULSE_HIDDEN_CLOSE_MS = 15_000

export interface PulseVisibility {
  visible: boolean
  /** When the tab hid, or null: visible, or hidden since before the band
   *  mounted (a tab opened in the background never opens the stream until
   *  it is looked at). */
  hiddenAt: number | null
}

/** Should the socket be open right now? */
export function pulseStreamWanted(v: PulseVisibility, nowMs: number, holdMs = PULSE_HIDDEN_CLOSE_MS): boolean {
  if (v.visible) return true
  if (v.hiddenAt === null) return false
  return nowMs - v.hiddenAt < holdMs
}

/** The next visibility record after the document's state changed. */
export function pulseVisibilityStep(prev: PulseVisibility | null, hidden: boolean, nowMs: number): PulseVisibility {
  if (!hidden) return { visible: true, hiddenAt: null }
  // Born hidden: no clock starts. Hid after being seen: the hold starts now
  // (and a repeat `hidden` event never restarts it).
  if (prev === null || !prev.visible) return { visible: false, hiddenAt: prev?.hiddenAt ?? null }
  return { visible: false, hiddenAt: nowMs }
}

// ── The words ────────────────────────────────────────────────────────────────

/** The status after the dot. `hidden` names the policy's own close. */
export function pulseStatusWords(status: FeedStatus, detail?: string, opts: { markets?: number; hidden?: boolean } = {}): string {
  switch (status) {
    case 'live':
      return opts.markets ? `live · ${opts.markets} markets` : 'live'
    case 'connecting':
      return 'connecting'
    case 'reconnecting':
      return `reconnecting${detail ? ` ${detail}` : ''}`
    case 'unconfigured':
      return `not configured${detail ? ` · ${detail}` : ''}`
    case 'closed':
    case 'idle':
      return opts.hidden ? 'paused · tab in the background' : status === 'closed' ? `closed${detail ? ` · ${detail}` : ''}` : 'connecting'
  }
}

/** What it is and why it is different — one mono line under the panel. The
 *  phone keeps one sentence (≤ 54 characters: one line of 9.5px mono in the
 *  321px a 375 phone leaves the band). */
export const PULSE_WHY = {
  what: "Hyperliquid's own fills, live and keyless, read by your browser.",
  why: 'Every number is a sentence your wallet can sign — nothing fires on its own.',
  phone: 'Hyperliquid fills · every number is a button you sign.',
} as const

export const PULSE_WAITING = 'waiting for the first fill'

/** The door: the whole tape, and the three battle views on the same stream
 *  (lib/battle LIVE_VIEWS — the pin keeps these in step). */
export const PULSE_LIVE_HREF = '/live'
export const PULSE_VIEW_LINKS: readonly { id: 'front' | 'siege' | 'map'; label: string; href: string }[] = [
  { id: 'front', label: 'The Front', href: '/live?view=front' },
  { id: 'siege', label: 'The Siege', href: '/live?view=siege' },
  { id: 'map', label: 'The Map', href: '/live?view=map' },
]

// ── The frame ────────────────────────────────────────────────────────────────

/** The chart's plot height in CSS px: the SVG is drawn in a stretched
 *  viewBox (one unit per second across, px down) so the server renders the
 *  frame at its final size with no measurement, and nothing shifts when the
 *  first fill lands. */
export const PULSE_CHART_H = 96
export const PULSE_CHART_H_PHONE = 52

/** The band's minimum heights, pinned equal to components/home/pulse.css:
 *  the SSR frame IS the final frame. The phone fits under 180px (THE DESIGN
 *  §4: "the chart + two numbers + one chip" at 375). */
export const PULSE_BAND_MIN_H = { desktop: 224, phone: 174 } as const
