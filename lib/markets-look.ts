// MARKETS LOOK — the token NAMES and pure formatters every markets surface
// shares (VIZ lane, squad-mk2-2026-09-15). The values live in
// components/markets/look.css: dark on `:root` (the site default), light
// under `:root[data-theme='light']` (memory light-dark-theme-system). Never
// a color whose ONLY definition sits inside a theme block.
//
// Client-safe, no I/O. Import the names, never retype the strings.

export { fmtPrice } from '@/components/CandleChart'

/** Direction of a signed change (price, %): the up/down/flat ink. */
export type DeltaTone = 'up' | 'down' | 'flat'

/** CSS custom-property names — `var(${MK.up})` in JSX, `var(--mk-up)` in CSS. */
export const MK = {
  up: '--mk-up',
  down: '--mk-down',
  flat: '--mk-flat',
  /** Translucent fills behind an up/down number block. */
  upSoft: '--mk-up-soft',
  downSoft: '--mk-down-soft',
  /** The categorical series palette — 8 fixed slots, assigned by ENTITY
   *  (pool, venue, chain), never cycled. `seriesVar(i)` picks one. */
  series: ['--mk-series-1', '--mk-series-2', '--mk-series-3', '--mk-series-4', '--mk-series-5', '--mk-series-6', '--mk-series-7', '--mk-series-8'] as const,
  /** Surfaces. `surface` = a panel on the page ground; `glass` = a translucent
   *  panel for data drawn OVER data (a hover card on a map); `glow` = the
   *  accent halo behind a live number. */
  surface: '--mk-surface',
  surface2: '--mk-surface-2',
  glass: '--mk-glass',
  glassLine: '--mk-glass-line',
  glow: '--mk-glow',
  /** The "receipt rule" — the thin line under every number block. */
  rule: '--mk-rule',
  /** The grid/crosshair ink the chart engine and SVGs share. */
  grid: '--mk-grid',
  crosshair: '--mk-crosshair',
  /** Sequential ramp for magnitude (one hue, 5 steps light→dark). */
  seq: ['--mk-seq-1', '--mk-seq-2', '--mk-seq-3', '--mk-seq-4', '--mk-seq-5'] as const,
  /** Type scale. */
  fontDisplay: '--mk-font-display',
  fontUi: '--mk-font-ui',
  fontMono: '--mk-font-mono',
  textHero: '--mk-text-hero',
  textStat: '--mk-text-stat',
  textBody: '--mk-text-body',
  textLabel: '--mk-text-label',
  /** Motion. */
  durFast: '--mk-dur-fast',
  durBase: '--mk-dur-base',
  durSlow: '--mk-dur-slow',
  ease: '--mk-ease',
  /** The facet-cut corner (a clip-path polygon) panels wear. */
  facet: '--mk-facet',
} as const

/** Every token name, flat — the harness pins each one exists in BOTH themes. */
export const MK_TOKEN_NAMES: readonly string[] = Object.values(MK).flatMap((v) => (typeof v === 'string' ? [v] : [...v]))

/** Entities that get a STABLE series slot everywhere (color follows the
 *  entity, never its rank). Anything unlisted hashes into a slot. */
export const SERIES_SLOT: Readonly<Record<string, number>> = {
  uniswap: 0,
  cow: 1,
  aave: 2,
  lido: 3,
  hyperliquid: 4,
  robinhood: 5,
  morpho: 6,
  wallet: 7,
  base: 0,
  ethereum: 1,
  arbitrum: 2,
  optimism: 3,
  'robinhood-chain': 5,
}

/** `var(--mk-series-N)` for an entity id (stable) or a numeric slot. */
export function seriesVar(entity: string | number): string {
  const i = typeof entity === 'number' ? entity : (SERIES_SLOT[entity.toLowerCase()] ?? hashSlot(entity))
  return `var(${MK.series[((i % 8) + 8) % 8]})`
}

function hashSlot(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 8
}

/** Which ink a signed number wears. `flat` for 0, NaN, null. */
export function deltaTone(n: number | null | undefined): DeltaTone {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

/** `var(--mk-up)` / `var(--mk-down)` / `var(--mk-flat)` for a number. */
export function deltaVar(n: number | null | undefined): string {
  const t = deltaTone(n)
  return `var(${t === 'up' ? MK.up : t === 'down' ? MK.down : MK.flat})`
}

/** 1234 → "1.23K", 1.2e6 → "1.2M", 3.4e9 → "3.4B"; null → "—".
 *  Optional `$` prefix. Sub-1 values keep 2–3 significant digits. */
export function fmtCompact(n: number | null | undefined, opts: { usd?: boolean; digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const usd = opts.usd ? '$' : ''
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  const d = opts.digits ?? 2
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [v, u] of units) {
    if (a >= v) {
      const x = a / v
      return `${sign}${usd}${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(d)}${u}`
    }
  }
  if (a >= 1) return `${sign}${usd}${a.toFixed(a >= 100 ? 0 : d)}`
  if (a === 0) return `${usd}0`
  return `${sign}${usd}${a.toPrecision(3).replace(/\.?0+$/, '')}`
}

/** +1.23% / -0.40% / 0.00%; null → "—". `signed` false drops the "+". */
export function fmtPct(n: number | null | undefined, opts: { digits?: number; signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const d = opts.digits ?? 2
  const plus = opts.signed === false ? '' : n > 0 ? '+' : ''
  return `${plus}${n.toFixed(d)}%`
}

/** The honest footnote every live-number block carries. */
export const TAPE_FOOTNOTE = 'Live feeds, no license to resell: Coinbase spot, Hyperliquid, Robinhood 24/7 tape. Numbers are what the feed said, when it said it.'
