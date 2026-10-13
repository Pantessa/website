// Pins for ONE SCALE (squad polish, 2026-10-13 — CONSISTENCY lane).
//
//   1. The scale tokens exist in app/x402-design.css with the right value in
//      BOTH themes (the light value = the light block's re-ink, else the base).
//   2. Reduced motion collapses the durations.
//   3. The browser chrome matches the page: theme-color = --bg both ways
//      (lib/phone-shell THEME_COLORS vs the CSS), the manifest is standalone
//      with real 192 + 512 icons on disk.
//   4. THE FENCE: per file under components/** + app/** (never app/api), the
//      count of literal colors · Tailwind palette classes · px font sizes · px
//      radii that a token should replace (scripts/consistency-audit.ts's own
//      scanner) may only go DOWN from scripts/consistency-baseline.json. A new
//      file starts at 0. A swap lowers the count; a new literal fails here.
//      `--lower` ratchets every cell to min(baseline, today) — a cell that
//      went UP keeps its baseline and stays red.
//   5. With BASE set (a running server): the served manifest + the two
//      media-keyed theme-color metas on `/`.
//
//   npm run pins:consistency                 # pure
//   BASE=http://localhost:4075 npm run pins:consistency
//   npm run pins:consistency -- --lower      # ratchet after a swap
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countFile, FENCED, targets, type Kind } from './consistency-audit'
import { THEME_COLORS } from '../lib/phone-shell'
import manifest from '../app/manifest'

const ROOT = join(__dirname, '..')
const BASELINE = join(ROOT, 'scripts/consistency-baseline.json')
let pass = 0
let fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
}

// ── 1. Tokens ──────────────────────────────────────────────────────────────
const css = readFileSync(join(ROOT, 'app/x402-design.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function block(startRe: RegExp): string {
  const m = startRe.exec(css)
  if (!m) return ''
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(m.index, i + 1)
    }
  }
  return ''
}
const decls = (b: string) => {
  const out: Record<string, string> = {}
  for (const m of b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().replace(/\s+/g, ' ')
  return out
}
const base = decls(block(/(^|\n)\s*:root\s*\{/))
const light = decls(block(/:root\[data-theme='light'\]\s*\{/))

const SCALE: Record<string, string | [string, string]> = {
  '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px', '--sp-4': '16px', '--sp-5': '24px', '--sp-6': '32px',
  '--gutter-phone': '16px',
  '--fs-xs': '11px', '--fs-sm': '12px', '--fs-md': '13px', '--fs-base': '15px', '--fs-lg': '17px', '--fs-xl': '20px', '--fs-2xl': '24px',
  '--fs-input': '16px',
  '--r-sm': '8px', '--r-md': '12px', '--r-lg': '16px', '--r-pill': '999px', '--r-card': 'var(--r-md)', '--r-sheet': 'var(--r-lg)',
  '--sh-1': ['0 1px 2px rgb(0 0 0 / 0.4)', '0 1px 2px rgb(16 21 18 / 0.08)'],
  '--sh-2': ['0 16px 40px rgb(0 0 0 / 0.35)', '0 12px 32px rgb(16 21 18 / 0.12)'],
  '--sh-3': ['0 24px 64px rgb(0 0 0 / 0.45)', '0 24px 64px rgb(16 21 18 / 0.18)'],
  '--scrim': ['rgb(0 0 0 / 0.5)', 'rgb(16 21 18 / 0.4)'],
  '--dur-1': '160ms', '--dur-2': '220ms',
  '--ease-out': 'cubic-bezier(0.32, 0.72, 0, 1)', '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  '--tap': '44px', '--bar-h': '49px',
  '--safe-t': 'env(safe-area-inset-top, 0px)', '--safe-b': 'env(safe-area-inset-bottom, 0px)',
  '--z-pill': '35', '--z-nav': '40', '--z-bar': '50', '--z-door': '60', '--z-modal': '70', '--z-drawer': '80',
  '--z-scrim': '89', '--z-sheet': '90', '--z-toast': '95', '--z-signin': '100',
}
for (const [name, want] of Object.entries(SCALE)) {
  const [d, l] = Array.isArray(want) ? want : [want, want]
  const gotD = base[name]
  const gotL = light[name] ?? base[name]
  check(`token ${name} (dark)`, gotD === d, `got ${gotD ?? 'MISSING'}, want ${d}`)
  check(`token ${name} (light)`, gotL === l, `got ${gotL ?? 'MISSING'}, want ${l}`)
}
// The z order is an order: each layer strictly above the one before it.
const zOrder = ['--z-pill', '--z-nav', '--z-bar', '--z-door', '--z-modal', '--z-drawer', '--z-scrim', '--z-sheet', '--z-toast', '--z-signin']
check('z layers strictly ascend', zOrder.every((n, i) => i === 0 || Number(base[n]) > Number(base[zOrder[i - 1]])), zOrder.map((n) => base[n]).join(' < '))
// The bar token matches the bar: AppSpine's phone seats are min-h-[48px] under a 1px border-t.
const spine = readFileSync(join(ROOT, 'components/AppSpine.tsx'), 'utf8')
check('--bar-h = AppSpine phone seat 48 + 1px border', /PHONE_SEAT\s*=[\s\S]{0,200}min-h-\[48px\]/.test(spine) && /data-spine-bar[\s\S]{0,200}border-t\b/.test(spine) && base['--bar-h'] === '49px')
// The sheet primitive's z equals the token (FLOW-MOBILE owns the file; the pin reads it).
const sheetCss = readFileSync(join(ROOT, 'components/mobile/mobile.css'), 'utf8')
check('--z-sheet = .sheet z-index (mobile.css)', new RegExp(`\\.sheet\\s*\\{[^}]*z-index:\\s*(${base['--z-sheet']}|var\\(--z-sheet\\))`).test(sheetCss))

// ── 2. Reduced motion ──────────────────────────────────────────────────────
check('reduced motion collapses --dur-1/--dur-2', /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--dur-1:\s*0\.01ms;\s*--dur-2:\s*0\.01ms;\s*\}/.test(css))

// ── 3. Chrome = page ───────────────────────────────────────────────────────
check('theme-color dark = --bg (dark)', THEME_COLORS.dark.toLowerCase() === (base['--bg'] ?? '').toLowerCase(), `${THEME_COLORS.dark} vs ${base['--bg']}`)
check('theme-color light = --bg (light)', THEME_COLORS.light.toLowerCase() === (light['--bg'] ?? '').toLowerCase(), `${THEME_COLORS.light} vs ${light['--bg']}`)
const man = manifest()
check('manifest display standalone', man.display === 'standalone')
check('manifest theme/background = dark --bg', man.theme_color === THEME_COLORS.dark && man.background_color === THEME_COLORS.dark)
for (const size of ['192x192', '512x512']) {
  const icon = (man.icons ?? []).find((i) => i.sizes === size && (i.purpose ?? 'any') === 'any')
  check(`manifest icon ${size} on disk`, !!icon && existsSync(join(ROOT, 'public', icon.src)), icon?.src ?? 'missing')
}

// ── 4. The fence ───────────────────────────────────────────────────────────
type Counts = Record<string, Partial<Record<Kind, number>>>
const now: Counts = {}
for (const f of targets()) {
  const c = countFile(f)
  const fenced: Partial<Record<Kind, number>> = {}
  for (const k of FENCED) if (c[k]) fenced[k] = c[k]
  if (Object.keys(fenced).length) now[f] = fenced
}
const lower = process.argv.includes('--lower')
const seed = process.argv.includes('--seed')
if (seed || !existsSync(BASELINE)) {
  if (!seed) check('baseline exists', false, `${BASELINE} missing — run with --seed once`)
  else {
    writeFileSync(BASELINE, JSON.stringify(now, null, 1) + '\n')
    console.log(`seeded ${BASELINE} (${Object.keys(now).length} files)`)
  }
} else {
  const was: Counts = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const ups: string[] = []
  const downs: string[] = []
  for (const f of new Set([...Object.keys(now), ...Object.keys(was)])) {
    for (const k of FENCED) {
      const a = was[f]?.[k] ?? 0
      const b = now[f]?.[k] ?? 0
      if (b > a) ups.push(`${f} ${k} ${a} → ${b}`)
      else if (b < a) downs.push(`${f} ${k} ${a} → ${b}`)
    }
  }
  const total = (c: Counts) => Object.values(c).reduce((s, v) => s + Object.values(v).reduce((x, y) => x + (y ?? 0), 0), 0)
  check('fence: no file gained a literal color / palette class / px font / px radius', ups.length === 0, ups.length ? `\n   ${ups.join('\n   ')}\n   → use a token (scripts/consistency-audit.ts prints which)` : `${total(now)} fenced literals today (baseline ${total(was)}; ${downs.length} file·kind cells went down)`)
  if (lower) {
    // Ratchet: every cell becomes min(baseline, today). A cell that went UP
    // keeps its baseline (and keeps this pin red) — lowering never accepts a gain.
    const next: Counts = {}
    for (const f of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const cell: Partial<Record<Kind, number>> = {}
      for (const k of FENCED) {
        const v = Math.min(was[f]?.[k] ?? 0, now[f]?.[k] ?? 0)
        if (v) cell[k] = v
      }
      if (Object.keys(cell).length) next[f] = cell
    }
    writeFileSync(BASELINE, JSON.stringify(next, null, 1) + '\n')
    console.log(`baseline lowered: ${total(was)} → ${total(next)}${ups.length ? ` (${ups.length} cells that went UP keep their baseline)` : ''}`)
  } else if (downs.length) console.log(`   (${downs.length} cells are below the baseline — run with --lower to ratchet)`)
}

// ── 5. Served (BASE) ───────────────────────────────────────────────────────
async function served() {
  const BASE = process.env.BASE
  if (!BASE) return
  const res = await fetch(`${BASE}/manifest.webmanifest`)
  const m = res.ok ? await res.json() : null
  check('served manifest is standalone', m?.display === 'standalone', `${res.status}`)
  for (const icon of (m?.icons ?? []).filter((i: { purpose?: string }) => (i.purpose ?? 'any') === 'any')) {
    const r = await fetch(`${BASE}${icon.src}`)
    check(`served icon ${icon.sizes} 200`, r.status === 200 && /image\/png/.test(r.headers.get('content-type') ?? ''), `${r.status}`)
  }
  const html = await (await fetch(`${BASE}/story`)).text()
  const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0])
  const metaFor = (scheme: string) => metas.find((m) => m.includes(`media="(prefers-color-scheme: ${scheme})"`)) ?? ''
  check('served theme-color (dark) = --bg', metaFor('dark').includes(`content="${THEME_COLORS.dark}"`), metaFor('dark') || 'missing')
  check('served theme-color (light) = --bg', metaFor('light').includes(`content="${THEME_COLORS.light}"`), metaFor('light') || 'missing')
}

served()
  .catch((e) => check('served checks ran', false, String(e)))
  .finally(() => {
    console.log(`\npins:consistency ${pass} passed / ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
