// Pins for squad landing, lane MOBILE (2026-11-10): the landing on a phone — the rules its CSS must keep (the drive is scripts/landing-mobile-drive.mjs).
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-mobile-pins.ts            (npm run pins:landing-mobile)
//   BASE=http://localhost:PORT npx tsx scripts/landing-mobile-pins.ts --served

import fs from 'node:fs'
import path from 'node:path'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => {
  try {
    return fs.readFileSync(path.join(ROOT, f), 'utf8')
  } catch {
    return ''
  }
}
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// The landing's sheets: the shell lanes' and the panels' (sides/** read live, so a new side sheet is covered).
const SHELL_SHEETS = ['components/home/hero.css', 'components/home/tour/tour.css', 'components/home/tour/panel.css', 'components/home/how.css', 'components/home/closing.css', 'components/story/story-tour.css']
function sideSheets(): string[] {
  const dir = path.join(ROOT, 'components/home/tour/sides')
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.name.endsWith('.css')) out.push(path.relative(ROOT, f))
    }
  }
  walk(dir)
  return out
}

/** Every `@media (pointer: coarse) { … }` block's body in a sheet (brace-matched). */
export function coarseBlocks(css: string): string[] {
  const out: string[] = []
  const re = /@media\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }
    out.push(css.slice(start, i - 1))
  }
  return out
}

/** Declarations that pin a box wider than a 343px phone column (`width: 400px`, `min-width: 360px`, `flex-basis`), outside a query's own condition. */
export function fixedWideWidths(css: string): string[] {
  const hits: string[] = []
  for (const m of strip(css).matchAll(/(^|[;{\s])((?:min-)?width|flex-basis)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    if (Number(m[3]) > 343) hits.push(`${m[2]}: ${m[3]}px`)
  }
  return hits
}

export function landingMobilePins(check: Check): void {
  // 1. A thumb gets 44px: every shell sheet with something tappable carries a coarse block that sets ≥ 44px.
  const tappable: Record<string, string[]> = {
    'components/home/hero.css': ['.mk-claim__go', '.mk-claim__try'],
    'components/home/tour/tour.css': ['.tour__door', '.tour__show', '.tour__hide', '.tour__next'],
    'components/home/tour/panel.css': ['.tpn__chip', '.tpn__door'],
    'components/home/how.css': ['.how__door'],
    'components/home/closing.css': ['.closing__quietlink'],
    'components/story/story-tour.css': ['.stour__indexlink'],
  }
  for (const [f, sels] of Object.entries(tappable)) {
    const blocks = coarseBlocks(strip(read(f))).join('\n')
    const sizes = [...blocks.matchAll(/min-height\s*:\s*(\d+)px/g)].map((m) => Number(m[1]))
    check(`mobile: ${f} has a (pointer: coarse) block`, blocks.length > 0)
    check(`mobile: ${f} coarse targets ≥ 44px`, sizes.length > 0 && sizes.every((n) => n >= 44), sizes.join(', '))
    for (const sel of sels) check(`mobile: ${f} coarse block names ${sel}`, blocks.includes(sel))
  }
  // 2. The phone's tour rows are 56px+ rows (STAGE's contract) and the closing cells 56px+.
  const tour = strip(read('components/home/tour/tour.css'))
  const phoneTour = tour.match(/@container tour \(max-width: 559\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const rowH = Number(phoneTour.match(/\.tour__tab\s*\{[^}]*min-height:\s*(\d+)px/)?.[1] ?? 0)
  check('mobile: a phone tour row is ≥ 56px', rowH >= 56, `${rowH}px`)
  const closingH = Number(strip(read('components/home/closing.css')).match(/\.closing__door\s*\{[^}]*min-height:\s*(\d+)px/)?.[1] ?? 0)
  check('mobile: a closing door is ≥ 56px', closingH >= 56, `${closingH}px`)
  // 3. The quiet row on a phone is a 3 + 2 grid, links starting on their edge (no centred 44px gaps).
  const closing = strip(read('components/home/closing.css'))
  check('mobile: the closing quiet row is a three-column grid on a phone', /@container closing \(max-width: 420px\)\s*\{[^@]*\.closing__quiet\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(closing))
  // 4. Inputs never zoom on iOS: any input/textarea/select rule in a landing sheet sets var(--fs-input) or 1rem+.
  const all = [...SHELL_SHEETS, ...sideSheets()]
  for (const f of all) {
    const css = strip(read(f))
    for (const m of css.matchAll(/([^{}]*\b(?:input|textarea|select)\b[^{}]*)\{([^}]*)\}/g)) {
      const sel = m[1].trim()
      if (/::?placeholder|:disabled|\[type=["']?(range|checkbox|radio)/.test(sel)) continue
      const fsDecl = m[2].match(/font-size\s*:\s*([^;]+)/)?.[1]?.trim()
      if (!fsDecl) continue
      const ok = /var\(--fs-input\)/.test(fsDecl) || /^(1(\.\d+)?|[2-9](\.\d+)?)rem$/.test(fsDecl) || /^(1[6-9]|[2-9]\d)px$/.test(fsDecl)
      check(`mobile: ${f} ${sel.slice(0, 40)} font-size keeps 16px`, ok, fsDecl)
    }
  }
  // 5. No box wider than a phone's column, in any landing sheet.
  for (const f of all) {
    const wide = fixedWideWidths(read(f))
    check(`mobile: ${f} sets no width over the phone column`, wide.length === 0, wide.join(', '))
  }
  // 6. The pin's own rules hold on fixtures.
  check('mobile: fixedWideWidths sees width: 400px', fixedWideWidths('.a { width: 400px }').length === 1)
  check('mobile: fixedWideWidths skips max-width and small widths', fixedWideWidths('.a { max-width: 900px; width: 32px }').length === 0)
  check('mobile: coarseBlocks reads a nested block', coarseBlocks('@media (pointer: coarse) { .a { min-height: 44px } @container x (min-width: 1px) { .b { min-height: 44px } } }')[0]?.includes('.b') === true)
}

export async function landingMobilePinsServed(check: Check, base: string): Promise<void> {
  // The served home carries the phone rules in its CSS (a sheet that never loads protects nobody).
  const html = await (await fetch(`${base}/`, { headers: { 'x-yf-internal-run': '1' } })).text()
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1])
  let css = ''
  for (const h of hrefs) css += await (await fetch(new URL(h, base), { headers: { 'x-yf-internal-run': '1' } })).text()
  const coarse = coarseBlocks(css).join('\n')
  for (const sel of ['.mk-claim__go', '.tour__door', '.tpn__chip', '.how__door', '.closing__quietlink']) check(`mobile (served /): ${sel} gets 44px under pointer: coarse`, coarse.includes(sel), `${hrefs.length} sheets`)
  check('mobile (served /): the viewport meta lets the page fit the phone', /<meta name="viewport" content="[^"]*width=device-width/.test(html))
}

if (process.argv[1]?.endsWith('landing-mobile-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingMobilePins(check))
    .then(() => (served ? landingMobilePinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
