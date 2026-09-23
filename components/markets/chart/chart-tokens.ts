// The chart engine's theme probe — shared by MarketChart (candles) and
// Fundamentals (the DefiLlama panel) so every canvas on /t reads the SAME
// tokens the same way. Extracted from MarketChart 2026-09-23, unchanged.
//
// Client-only: reads getComputedStyle and paints a 1×1 canvas.

export interface Tokens {
  accent: string
  sell: string
  /** Candle inks: --mk-up / --mk-down (look.css), falling back to accent / sell. */
  up: string
  down: string
  /** Translucent tints used as-is: the grid and the crosshair. */
  grid: string
  crosshair: string
  /** The compare line's ink: series slot 2 (orange), never a candle ink. */
  compare: string
  /** The eight series inks (fill glyphs wear their venue's). */
  series: string[]
  fg: string
  bg: string
  line: string
  muted: string
  muted2: string
  surf: string
  /** The slow averages keep the colors traders read them in: 50 blue, 200 yellow. */
  ma50: string
  ma200: string
  /** The extended-hours tint behind a stock's quiet bars (translucent, used as-is). */
  session: string
}

/** Token → canvas colors. The engine paints on a 2D canvas whose alpha
 *  variants we compose by hand (`alpha(hex, a)`), so an opaque token has to
 *  come out as a plain #rrggbb. The theme's neutrals (--line, --surf-1,
 *  --muted, --muted-2) are oklch(), and a canvas's fillStyle getter hands
 *  oklch() back as oklch(), not hex: the old getter-only check fell back to
 *  the hardcoded DARK hexes on every theme, so the light chart drew a dark
 *  grid, dark borders and a dark crosshair label. Now the browser resolves the
 *  value (a span's computed color, so var() and color-mix() work too), the
 *  getter's hex is taken when it gives one, and anything else is painted onto
 *  a 1×1 canvas and read back. */
function colorProbe() {
  const span = document.createElement('span')
  span.style.display = 'none'
  document.body.appendChild(span)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const computed = (value: string): string | null => {
    if (!value) return null
    span.style.color = ''
    span.style.color = value
    return span.style.color ? getComputedStyle(span).color : null
  }
  const SENTINEL = '#010203'
  return {
    /** An opaque token as #rrggbb; a translucent one has no single hex. */
    hex(value: string, fallback: string): string {
      try {
        const color = computed(value)
        if (!color || !ctx) return fallback
        ctx.fillStyle = SENTINEL
        ctx.fillStyle = color
        const got = String(ctx.fillStyle)
        if (got === SENTINEL) return fallback // the canvas refused the syntax
        if (/^#[0-9a-f]{6}$/i.test(got)) return got
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return a < 250 ? fallback : `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
      } catch {
        return fallback
      }
    },
    /** Any token as a color string the canvas takes as-is (the translucent tints). */
    css(value: string, fallback: string): string {
      try {
        return computed(value) ?? fallback
      } catch {
        return fallback
      }
    },
    dispose() {
      span.remove()
    },
  }
}

export function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const probe = colorProbe()
  const get = (name: string, fb: string) => probe.hex(cs.getPropertyValue(name).trim(), fb)
  try {
    return {
      accent: get('--accent', '#3ecf8e'),
      sell: get('--sell', '#e5484d'),
      up: get('--mk-up', get('--accent', '#3ecf8e')),
      down: get('--mk-down', get('--sell', '#e5484d')),
      grid: probe.css(cs.getPropertyValue('--mk-grid').trim(), 'rgba(255, 255, 255, 0.07)'),
      crosshair: probe.css(cs.getPropertyValue('--mk-crosshair').trim(), 'rgba(255, 255, 255, 0.35)'),
      compare: get('--mk-series-2', '#e0642c'),
      series: Array.from({ length: 8 }, (_, i) => get(`--mk-series-${i + 1}`, '#9a9a9a')),
      fg: get('--fg', '#ffffff'),
      bg: get('--bg', '#000000'),
      line: get('--line', '#3a3a3a'),
      muted: get('--muted', '#9a9a9a'),
      muted2: get('--muted-2', '#7a7a7a'),
      surf: get('--surf-1', '#161616'),
      ma50: get('--chart-ma-50', '#5b9cff'),
      ma200: get('--chart-ma-200', '#f5c518'),
      session: probe.css(cs.getPropertyValue('--chart-session').trim(), 'rgba(255, 255, 255, 0.045)'),
    }
  } finally {
    probe.dispose()
  }
}
