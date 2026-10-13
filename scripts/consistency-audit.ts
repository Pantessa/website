// THE consistency audit (squad polish, 2026-10-13 — CONSISTENCY lane).
//
// Walks components/** + app/** (.tsx · .ts · .css; never app/api route
// handlers, never build output) and finds every literal a surface sizes or
// paints itself with instead of a token from the ONE SCALE
// (app/x402-design.css — `--sp-*`, `--fs-*`, `--r-*`, `--sh-*`, `--dur-*`,
// `--z-*` and the palette):
//
//   color      a #hex / rgb() / rgba() / hsl() / oklch() literal
//   tw-color   a Tailwind palette class (text-white, bg-zinc-900, text-emerald-400 …)
//   font-px    a px font size (font-size: 13px · text-[13px] · fontSize: 13)
//   radius-px  a px radius (border-radius: 14px · rounded-[14px] · borderRadius: 14)
//   shadow     a literal box-shadow (box-shadow: 0 16px 40px … · shadow-[…] · shadow-lg)
//   z          a z-index (z-index: 70 · z-[70] · z-50 · zIndex: 70)
//   duration   a transition/animation duration (.15s · 200ms · duration-150)
//
// Every row carries the token it should become, or `keep:` + the reason it
// stays literal (satori OG art, a canvas paint, a brand mark, a ring, a token
// definition, local stacking, a decorative loop …). Rows are owned by the
// squad lane that owns the file (README contract table), so the lane file can
// hand each lane its own swap list.
//
//   npx tsx scripts/consistency-audit.ts                 # summary to stdout
//   npx tsx scripts/consistency-audit.ts --md <out.md>   # full per-lane markdown
//   npx tsx scripts/consistency-audit.ts --json <out>    # raw rows
//
// scripts/consistency-pins.ts imports `countFile` from here: the fence counts
// with the SAME scanner the audit prints, so a swap the audit asks for lowers
// the fenced count by construction.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export type Kind = 'color' | 'tw-color' | 'font-px' | 'radius-px' | 'shadow' | 'z' | 'duration'
export const KINDS: Kind[] = ['color', 'tw-color', 'font-px', 'radius-px', 'shadow', 'z', 'duration']
/** The kinds the pins FENCE (a new one fails). Shadows, z and durations are
 *  audited and swapped but not fenced: too many legitimate one-offs. */
export const FENCED: Kind[] = ['color', 'tw-color', 'font-px', 'radius-px']

export type Row = {
  file: string
  line: number
  kind: Kind
  literal: string
  /** The token this should become (`var(--fs-sm)` …), or null to keep. */
  token: string | null
  note: string
}

export type Lane = 'DEADENDS' | 'MARKETS-MOBILE' | 'FLOW-MOBILE' | 'CONSISTENCY' | 'QA' | 'UNOWNED'

const ROOT = join(__dirname, '..')

// ── Ownership (README contract table) ─────────────────────────────────────
const OWN: Array<[Lane, RegExp]> = [
  ['MARKETS-MOBILE', /^components\/(markets|home|live|guide)\//],
  ['MARKETS-MOBILE', /^components\/ChartOverlay\.tsx$/],
  ['MARKETS-MOBILE', /^app\/(page\.tsx|t\/|live\/|markets\/|lists\/)/],
  ['FLOW-MOBILE', /^components\/(AppSpine|ChatInterface|WalletPanel|WalletRebalance|SiteAccount|NavAccount|DashboardMobileNav|MobileCtaBar|AskDoor|ClarifyChips|SignOrderButton|JobDetailOverlay|SpineLink)\.tsx$/],
  ['FLOW-MOBILE', /^components\/(mobile|chat|arrival)\//],
  ['FLOW-MOBILE', /^components\/(Chat|CreateAccount|Dashboard|IntentRuntime|SendTx|JobCard|Links|MintLink|CreatorPage)[A-Za-z]*\.tsx$/],
  ['FLOW-MOBILE', /^components\/(wallet-phone|intent-runtime)\.css$/],
  ['FLOW-MOBILE', /^app\/native-shell\.css$/],
  ['FLOW-MOBILE', /^app\/(chat|wallet|i|l|p|links|dashboard|inbox|r|w|c|embed)\//],
  ['CONSISTENCY', /^app\/(globals|x402-design)\.css$/],
  ['CONSISTENCY', /^app\/layout\.tsx$/],
  ['CONSISTENCY', /^components\/(Navigation|Logo)\.tsx$/],
  ['CONSISTENCY', /^components\/Footer[A-Za-z]*\.tsx$/],
  ['CONSISTENCY', /^components\/ExplainerVideo/],
  ['CONSISTENCY', /^components\/(landing|docs)\//],
  ['CONSISTENCY', /^app\/(not-found\.tsx|story\/|docs\/|pricing\/|blog\/|servers\/|rebrand\/|compare\/|activity\/|agents\/|roster\/|mosaic\/|tools\/|incidents\/|sign\/|router\/|benchmarks\/)/],
]
export function ownerOf(file: string): Lane {
  for (const [lane, re] of OWN) if (re.test(file)) return lane
  return 'UNOWNED'
}

// ── The walk ───────────────────────────────────────────────────────────────
export function targets(root = ROOT): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      const rel = relative(root, p)
      if (rel === 'app/api') continue
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx|ts|css)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(rel)
    }
  }
  walk(join(root, 'components'))
  walk(join(root, 'app'))
  return out.sort()
}

// ── Comments out, line numbers kept ────────────────────────────────────────
function blank(s: string): string {
  return s.replace(/[^\n]/g, ' ')
}
export function stripComments(src: string, css: boolean): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, blank)
  if (!css) s = s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)))
  return s
}

// ── The token tables ───────────────────────────────────────────────────────
const HEX_TOKENS: Record<string, string> = {
  '#3ecf8e': '--accent', '#0a7350': '--accent (light)', '#0e8f62': '--accent (old light) / --gem-5 (light)',
  '#e5484d': '--sell', '#b0323a': '--sell (light) / --fail (light)',
  '#34d399': '--done', '#0b7a53': '--done (light)', '#f87171': '--fail',
  '#f0b454': '--gold', '#8a600a': '--gold (light)',
  '#000': '--bg (dark) / --ink on an accent fill', '#000000': '--bg (dark) / --ink on an accent fill',
  '#fff': '--fg (dark)', '#ffffff': '--fg (dark)', '#fdfdfc': '--bg (light)', '#101512': '--fg (light)',
  '#0b6b4a': '--gem-1', '#0f8156': '--gem-2', '#159b68': '--gem-3', '#27b67a': '--gem-4',
  '#5b9cff': '--chart-ma-50', '#f5c518': '--chart-ma-200',
  '#34e0a1': '--accent (the pre-2026 accent)', '#e8c468': '--gold (near)',
}
/** The palette a one-off hex is measured against (dark values). */
const PALETTE: Array<[string, string]> = [
  ['--accent', '#3ecf8e'], ['--sell', '#e5484d'], ['--done', '#34d399'], ['--fail', '#f87171'], ['--gold', '#f0b454'],
  ['--chart-ma-50', '#5b9cff'], ['--chart-ma-200', '#f5c518'], ['--bg', '#000000'], ['--fg', '#ffffff'],
  ['--surf-1', '#0c0c0c'], ['--surf-2', '#171717'], ['--line', '#333333'], ['--line-2', '#4a4a4a'], ['--muted', '#a3a3a3'],
]
function rgbOf(hex: string): [number, number, number] | null {
  let h = hex.slice(1).toLowerCase()
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (h.length !== 6) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function nearestToken(hex: string): string | null {
  const c = rgbOf(hex)
  if (!c) return null
  let best: [string, number] | null = null
  for (const [name, h] of PALETTE) {
    const p = rgbOf(h)!
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2])
    if (!best || d < best[1]) best = [name, d]
  }
  return best && best[1] <= 48 ? best[0] : null
}
const TW_COLOR_TOKEN: Array<[RegExp, string]> = [
  [/-(white)(\/\d+)?$/, 'var(--fg) (or --ink on an accent fill); /NN → a tint-* utility'],
  [/-(black)(\/\d+)?$/, 'var(--bg) / var(--scrim) for an overlay; /NN → a tint-* utility'],
  [/-(emerald|green|teal)-\d+/, 'var(--accent) (or --done for a finished state)'],
  [/-(red|rose)-\d+/, 'var(--sell) (or --fail for a failed state)'],
  [/-(amber|yellow|orange)-\d+/, 'var(--gold)'],
  [/-(zinc|gray|neutral|slate|stone)-(50|100|200)\b/, 'var(--fg)'],
  [/-(zinc|gray|neutral|slate|stone)-(300|400)\b/, 'var(--muted)'],
  [/-(zinc|gray|neutral|slate|stone)-(500|600)\b/, 'var(--muted-2) (text) / var(--line-2) (border)'],
  [/-(zinc|gray|neutral|slate|stone)-(700)\b/, 'var(--line) (border) / var(--surf-2) (fill)'],
  [/-(zinc|gray|neutral|slate|stone)-(800|900|950)\b/, 'var(--surf-1) / var(--surf-2)'],
  [/-(sky|blue|indigo|cyan)-\d+/, 'var(--chart-ma-50) if it is the blue series; else no token (keep, name it)'],
  [/-(violet|purple|fuchsia|pink)-\d+/, 'no token: a one-off hue (keep, or add a token)'],
  [/-(lime)-\d+/, 'var(--accent)'],
]
function fontToken(px: number, input: boolean): { token: string | null; note: string } {
  const exact: Record<number, string> = { 11: '--fs-xs', 12: '--fs-sm', 13: '--fs-md', 15: '--fs-base', 17: '--fs-lg', 20: '--fs-xl', 24: '--fs-2xl' }
  if (exact[px]) return { token: `var(${exact[px]})`, note: 'on the scale' }
  if (px === 16) return input ? { token: 'var(--fs-input)', note: 'an input: 16 is the iOS zoom floor' } : { token: 'var(--fs-base)', note: '16 is off-scale → 15 (or --fs-input on an input)' }
  if (px < 11) return { token: 'var(--fs-xs)', note: `${px}px is under the 11px floor` }
  if (px > 24) return { token: null, note: `keep: a display size (${px}px, Fraunces)` }
  const scale = [11, 12, 13, 15, 17, 20, 24]
  const names = ['--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--fs-xl', '--fs-2xl']
  let best = 0
  for (let i = 1; i < scale.length; i++) if (Math.abs(scale[i] - px) < Math.abs(scale[best] - px)) best = i
  return { token: `var(${names[best]})`, note: `${px}px is off-scale → ${scale[best]}` }
}
function radiusToken(px: number): { token: string | null; note: string } {
  if (px >= 99) return { token: 'var(--r-pill)', note: 'a pill' }
  if (px <= 4) return { token: null, note: `keep: a micro radius (${px}px on a bar/dot/tick)` }
  if (px <= 10) return { token: 'var(--r-sm)', note: px === 8 ? 'on the scale' : `${px}px → 8` }
  if (px <= 14) return { token: 'var(--r-md)', note: px === 12 ? 'on the scale (the card radius)' : `${px}px → 12 (the card radius)` }
  if (px <= 20) return { token: 'var(--r-lg)', note: px === 16 ? 'on the scale' : `${px}px → 16` }
  return { token: null, note: `keep: a ${px}px radius (a hero/illustration shape)` }
}
function zToken(n: number): { token: string | null; note: string } {
  if (n <= 30) return { token: null, note: 'keep: local stacking inside a component' }
  const map: Record<number, [string, string]> = {
    35: ['--z-pill', 'the ask pill'], 40: ['--z-nav', 'the brochure nav'], 45: ['--z-nav', '45 is an ad-hoc layer (popover over the nav) → --z-nav + 1 or a sheet'],
    50: ['--z-bar', 'the spine bar'], 60: ['--z-door', 'the ask door'], 61: ['--z-scrim', 'a sheet scrim'], 62: ['--z-sheet', 'a sheet'],
    65: ['--z-sheet', 'a sheet'], 70: ['--z-modal', 'a modal'], 80: ['--z-drawer', 'the dashboard drawer'], 90: ['--z-sheet', 'a sheet / banner'],
    100: ['--z-signin', 'the sign-in door'], 200: ['--z-signin', '200 = over everything'],
  }
  const hit = map[n]
  if (hit) return { token: `var(${hit[0]})`, note: hit[1] }
  return { token: null, note: `no token: ${n} (name the layer)` }
}
function durToken(ms: number): { token: string | null; note: string } {
  if (ms === 0) return { token: null, note: 'keep: 0' }
  if (ms < 100) return { token: null, note: `keep: ${ms}ms (an instant)` }
  if (ms <= 190) return { token: 'var(--dur-1)', note: `${ms}ms → 160` }
  if (ms <= 260) return { token: 'var(--dur-2)', note: `${ms}ms → 220` }
  return { token: null, note: `keep: ${ms}ms (a decorative/long animation)` }
}
function shadowToken(val: string): { token: string | null; note: string } {
  const v = val.trim()
  if (/^none\b/.test(v) || /^var\(/.test(v) || /^inherit|^initial|^unset/.test(v)) return { token: null, note: 'not a literal' }
  if (/\binset\b/.test(v)) return { token: null, note: 'keep: an inset edge/ring' }
  const nums = v.split(/,(?![^(]*\))/)[0].trim().split(/\s+/).filter((t) => /^-?[\d.]+(px)?$/.test(t)).map((t) => parseFloat(t))
  if (nums.length >= 4 && nums[0] === 0 && nums[1] === 0 && nums[2] === 0) return { token: null, note: 'keep: a ring (0 0 0 Npx), not elevation' }
  if (nums.length >= 3 && nums[0] === 0 && nums[1] === 0) return { token: null, note: 'keep: a glow (0 0 Npx), not elevation' }
  const blur = nums[2] ?? 0
  if (blur <= 4) return { token: 'var(--sh-1)', note: `blur ${blur}px → a resting lift` }
  if (blur <= 40) return { token: 'var(--sh-2)', note: `blur ${blur}px → a popover` }
  return { token: 'var(--sh-3)', note: `blur ${blur}px → a sheet/dialog` }
}
function msOf(t: string): number {
  return t.endsWith('ms') ? parseFloat(t) : Math.round(parseFloat(t) * 1000)
}

// ── File-level keep rules ──────────────────────────────────────────────────
const BRAND_MARK_FILE = /(protocol-marks|wallet-marks|chain-marks|BlogFigure|HouseLinkChip)\.tsx$|^components\/brand\//
const SATORI_FILE = /(opengraph-image|twitter-image|\/icon|apple-icon)\.tsx$/

// ── The scanner ────────────────────────────────────────────────────────────
const HEX = /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g
const FUNC_COLOR = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]+[^)]*\)/g
const TW_COLOR = /(?<![\w-])(?:text|bg|border(?:-[trblxy])?|ring|ring-offset|fill|stroke|from|to|via|outline|divide|placeholder|decoration|accent|caret|shadow)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?:\/\d+)?(?![\w-])/g

let remapped: Set<string> | null = null
function remappedClasses(root: string): Set<string> {
  if (remapped) return remapped
  const css = readFileSync(join(root, 'app/x402-design.css'), 'utf8')
  remapped = new Set<string>()
  for (const m of css.matchAll(/html\[data-theme='light'\]\s+\.([a-z0-9\\/.-]+)/g)) remapped.add(m[1].replace(/\\/g, ''))
  return remapped
}

export function scanSource(file: string, src: string, root = ROOT): Row[] {
  const css = file.endsWith('.css')
  const s = stripComments(src, css)
  const lines = s.split('\n')
  const rows: Row[] = []
  const satori = SATORI_FILE.test(file) || /\bImageResponse\b/.test(src)
  const brand = BRAND_MARK_FILE.test(file)
  const remap = remappedClasses(root)
  const push = (line: number, kind: Kind, literal: string, t: { token: string | null; note: string }) =>
    rows.push({ file, line, kind, literal, token: t.token, note: t.note })

  lines.forEach((text, i) => {
    const ln = i + 1
    const tokenDef = /^\s*--[\w-]+\s*:/.test(text) || (css && /(^|[;{]\s*)--[\w-]+\s*:/.test(text) && !/(^|[;{]\s*)(?!--)[a-z-]+\s*:/.test(text.replace(/--[\w-]+\s*:[^;]*;?/g, '')))
    const canvas = /fillStyle|strokeStyle|addColorStop|shadowColor|ctx\.|\.fillText|getContext/.test(text)
    const keepColor = satori
      ? 'keep: satori OG art renders without CSS vars'
      : brand
        ? 'keep: a third-party brand mark / illustration'
        : tokenDef
          ? 'keep: a token definition (custom property)'
          : canvas
            ? 'keep: a canvas paint (reads resolved colors; literal is the fallback)'
            : null

    // colors — #hex
    for (const m of text.matchAll(HEX)) {
      const lit = m[0]
      const before = text.slice(Math.max(0, m.index! - 6), m.index!)
      if (/url\($|href=["']?$|=["']?$/.test(before) && !/(fill|stroke|color|Color)=["']?$/.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue
      if (/^#\d+$/.test(lit)) {
        // all-digit "hex" only counts in a color position (": #000", "'#111'", "[#222]")
        const prev2 = text.slice(Math.max(0, m.index! - 2), m.index!)
        if (!/(^|[:,(]\s|['"`[(:=])$/.test(prev2) && !/[:,(]\s$/.test(prev2)) continue
      }
      const known = HEX_TOKENS[lit.toLowerCase()]
      const near = known ? null : nearestToken(lit)
      push(ln, 'color', lit, keepColor ? { token: null, note: keepColor } : known ? { token: `var(${known.split(' ')[0]})`, note: `= ${known}` } : near ? { token: `var(${near})`, note: `near ${near} (within 48 RGB)` } : { token: null, note: 'no token: a one-off hue (map to the palette or name it)' })
    }
    // colors — functional
    for (const m of text.matchAll(FUNC_COLOR)) {
      const lit = m[0]
      if (/var\(/.test(lit)) continue
      const black = /^rgba?\(\s*0[\s,]+0[\s,]+0\b/.test(lit)
      const white = /^rgba?\(\s*255[\s,]+255[\s,]+255\b/.test(lit)
      const inShadow = /shadow/i.test(text.slice(0, m.index!))
      const t = keepColor
        ? { token: null, note: keepColor }
        : black && inShadow
          ? { token: 'var(--sh-*)', note: 'a black shadow → the elevation token' }
          : black
            ? { token: 'var(--scrim)', note: 'a black overlay → --scrim (re-inks in light)' }
            : white
              ? { token: 'color-mix(in srgb, var(--fg) N%, transparent)', note: 'a white alpha → fg-relative (flips in light)' }
              : { token: null, note: 'no token: a one-off color (map to the palette or name it)' }
      push(ln, 'color', lit, t)
    }
    // Tailwind palette classes (tsx only)
    if (!css) {
      for (const m of text.matchAll(TW_COLOR)) {
        const lit = m[0]
        let hint = 'no token'
        for (const [re, h] of TW_COLOR_TOKEN) if (re.test(lit)) { hint = h; break }
        const re = remap.has(lit) ? ' (remapped for light in x402-design.css; swap when touched)' : ''
        push(ln, 'tw-color', lit, satori ? { token: null, note: 'keep: satori' } : { token: hint.startsWith('no token') ? null : hint.split(' ')[0], note: hint + re })
      }
    }
    // font sizes
    const input = /<input|<textarea|<select|input|textarea|select|field/i.test(text)
    const fontRes = css
      ? [/font-size:\s*([\d.]+)px/g, /\bfont:\s*(?:[a-z0-9 ]+\s)?([\d.]+)px/g]
      : [/(?<![\w-])text-\[([\d.]+)px\]/g, /fontSize:\s*['"]?([\d.]+)(?:px)?['"]?/g]
    for (const re of fontRes) for (const m of text.matchAll(re)) {
      const px = parseFloat(m[1])
      push(ln, 'font-px', m[0], satori ? { token: null, note: 'keep: satori' } : /fontSize=/.test(text) && brand ? { token: null, note: 'keep: svg art' } : fontToken(px, input))
    }
    if (!css) for (const m of text.matchAll(/fontSize=["{]?['"]?([\d.]+)/g)) {
      push(ln, 'font-px', m[0], { token: null, note: 'keep: an SVG text attribute (scales with the viewBox)' })
    }
    // radii
    const radRes = css
      ? [/border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;}]+)/g]
      : [/(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-\[([\d.]+)px\]/g, /borderRadius:\s*['"]?([\d.]+)(?:px)?['"]?/g]
    for (const re of radRes) for (const m of text.matchAll(re)) {
      const val = m[1]
      if (css) {
        const pxs = [...val.matchAll(/([\d.]+)px/g)].map((x) => parseFloat(x[1]))
        if (!pxs.length) continue
        const max = Math.max(...pxs)
        push(ln, 'radius-px', m[0].trim(), satori ? { token: null, note: 'keep: satori' } : radiusToken(max))
      } else {
        push(ln, 'radius-px', m[0], satori ? { token: null, note: 'keep: satori' } : radiusToken(parseFloat(val)))
      }
    }
    // shadows
    if (css) {
      for (const m of text.matchAll(/box-shadow:\s*([^;}]+)/g)) {
        const t = shadowToken(m[1])
        if (t.note === 'not a literal') continue
        push(ln, 'shadow', m[0].trim(), satori ? { token: null, note: 'keep: satori' } : t)
      }
    } else {
      for (const m of text.matchAll(/(?<![\w-])shadow-\[([^\]]+)\]/g)) {
        const t = shadowToken(m[1].replace(/_/g, ' '))
        if (t.note === 'not a literal') continue
        push(ln, 'shadow', m[0], satori ? { token: null, note: 'keep: satori' } : t)
      }
      for (const m of text.matchAll(/(?<![\w-])shadow(-sm|-md|-lg|-xl|-2xl)?(?![\w\-[])/g)) {
        if (!/className|class=|cn\(|['"`]/.test(text)) continue
        const sz = m[1] ?? ''
        const tok = sz === '-sm' || sz === '' ? 'var(--sh-1)' : sz === '-md' || sz === '-lg' ? 'var(--sh-2)' : 'var(--sh-3)'
        push(ln, 'shadow', m[0], { token: tok, note: 'a Tailwind black shadow → the elevation token (re-inks in light)' })
      }
      for (const m of text.matchAll(/boxShadow:\s*['"`]([^'"`]+)['"`]/g)) {
        const t = shadowToken(m[1])
        if (t.note === 'not a literal') continue
        push(ln, 'shadow', m[0], satori ? { token: null, note: 'keep: satori' } : t)
      }
    }
    // z-index
    const zRes = css ? [/z-index:\s*(-?\d+)/g] : [/(?<![\w-])z-\[(-?\d+)\]/g, /(?<![\w-])z-(\d+)(?![\w-])/g, /zIndex:\s*(-?\d+)/g]
    for (const re of zRes) for (const m of text.matchAll(re)) {
      if (!css && /^z-\d/.test(m[0]) && !/className|class=|cn\(|['"`]/.test(text)) continue
      push(ln, 'z', m[0], zToken(parseInt(m[1], 10)))
    }
    // durations
    if (css) {
      for (const m of text.matchAll(/(?:transition|animation)(?:-duration)?:\s*([^;}]+)/g)) {
        const loop = /infinite/.test(m[1])
        for (const d of m[1].matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
          const ms = msOf(d[1] + d[2])
          if (ms === 0) continue
          push(ln, 'duration', `${m[0].split(':')[0]}: ${d[0]}`, loop ? { token: null, note: 'keep: a looping animation' } : durToken(ms))
          break // the first time in a shorthand is the duration; the second is a delay
        }
      }
    } else {
      for (const m of text.matchAll(/(?<![\w-])duration-(\d+)(?![\w-])/g)) push(ln, 'duration', m[0], durToken(parseInt(m[1], 10)))
    }
  })
  return rows
}

export function scanFile(file: string, root = ROOT): Row[] {
  return scanSource(file, readFileSync(join(root, file), 'utf8'), root)
}

/** Fenced counts for one file: literals a swap would remove (token !== null
 *  rows only, for the fenced kinds). The pins hold these per file; they may
 *  only go DOWN. */
export function countFile(file: string, root = ROOT): Record<Kind, number> {
  const c = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>
  for (const r of scanFile(file, root)) if (r.token !== null || r.note.startsWith('no token')) c[r.kind]++
  return c
}

// ── CLI ────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2)
  const files = targets()
  const all: Row[] = []
  for (const f of files) all.push(...scanFile(f))
  const swap = all.filter((r) => r.token !== null || r.note.startsWith('no token'))
  const byLane = new Map<Lane, Row[]>()
  for (const r of swap) {
    const l = ownerOf(r.file)
    if (!byLane.has(l)) byLane.set(l, [])
    byLane.get(l)!.push(r)
  }
  const kindCount = (rows: Row[]) => KINDS.map((k) => rows.filter((r) => r.kind === k).length)
  const filesWith = (rows: Row[]) => new Set(rows.map((r) => r.file)).size
  const lines: string[] = []
  lines.push(`files scanned: ${files.length} · rows: ${all.length} · to swap: ${swap.length} · keep: ${all.length - swap.length}`)
  lines.push(`files with a literal color: ${filesWith(all.filter((r) => r.kind === 'color' || r.kind === 'tw-color'))}`)
  lines.push('')
  lines.push(`| lane | files | ${KINDS.join(' | ')} | total |`)
  lines.push(`|---|---|${KINDS.map(() => '---').join('|')}|---|`)
  for (const lane of ['CONSISTENCY', 'MARKETS-MOBILE', 'FLOW-MOBILE', 'DEADENDS', 'QA', 'UNOWNED'] as Lane[]) {
    const rows = byLane.get(lane) ?? []
    lines.push(`| ${lane} | ${filesWith(rows)} | ${kindCount(rows).join(' | ')} | ${rows.length} |`)
  }
  console.log(lines.join('\n'))

  const mdAt = args.indexOf('--md')
  if (mdAt >= 0) {
    const out: string[] = [lines.join('\n'), '']
    for (const lane of ['CONSISTENCY', 'MARKETS-MOBILE', 'FLOW-MOBILE', 'DEADENDS', 'QA', 'UNOWNED'] as Lane[]) {
      const rows = byLane.get(lane) ?? []
      if (!rows.length) continue
      out.push(`## ${lane === 'CONSISTENCY' ? 'CONSISTENCY (own files)' : `For ${lane}`}`, '')
      const byFile = new Map<string, Row[]>()
      for (const r of rows) {
        if (!byFile.has(r.file)) byFile.set(r.file, [])
        byFile.get(r.file)!.push(r)
      }
      const order = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
      out.push(`| file | ${KINDS.join(' | ')} | total |`, `|---|${KINDS.map(() => '---').join('|')}|---|`)
      for (const [f, rs] of order) out.push(`| \`${f}\` | ${kindCount(rs).join(' | ')} | ${rs.length} |`)
      out.push('')
      for (const [f, rs] of order) {
        out.push(`### \`${f}\` (${rs.length})`)
        for (const r of rs) out.push(`- L${r.line} \`${r.literal.replace(/`/g, "'")}\` → ${r.token ?? '—'} · ${r.note}`)
        out.push('')
      }
    }
    writeFileSync(args[mdAt + 1], out.join('\n'))
    console.log(`\nwrote ${args[mdAt + 1]}`)
  }
  const jsonAt = args.indexOf('--json')
  if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(all, null, 1))
}

if (process.argv[1] && /consistency-audit\.ts$/.test(process.argv[1])) main()
