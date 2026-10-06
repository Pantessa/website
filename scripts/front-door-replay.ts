#!/usr/bin/env tsx
/**
 * Front-door replay (QA lane, squad front-door 2026-10-06).
 *
 * test:api cannot run on a machine with no database, and the front-door flip
 * (`/` = the markets splash, /markets → 308 → `/`, the brochure → /story)
 * changes what ~two dozen of its checks read. This runner replays THOSE checks
 * against a live local server, without a DB:
 *
 *   1. it parses scripts/test-api.ts with the TypeScript compiler API and finds
 *      every `check(...)` call inside main();
 *   2. it selects the checks the flip touches (two tiers, below) and, for each,
 *      the statement that holds it plus every earlier statement it depends on
 *      (the declarations of the names it reads, and the statements that write to
 *      them), through the nesting of bare `{ }` blocks;
 *   3. it writes those statements, under the harness's own preamble (its
 *      imports, `flat()`, the `x-yf-internal-run` fetch belt — `check()` swapped
 *      for a recorder), to scripts/.front-door-replay.gen.ts, runs it with tsx,
 *      deletes it, and prints PASS / FAIL / ERROR / SKIP per check.
 *
 * Because the code comes out of test-api.ts at run time, an in-place re-pin
 * (`RE-PINNED 2026-10-06 (front-door)`) is replayed as re-pinned — no copy here
 * goes stale. Each statement runs in its own try/catch, so one dead read (a
 * deleted file, a 404) names itself instead of ending the run the way it would
 * end test:api.
 *
 * Tiers:
 *   LISTED — the README's harness re-pin list, matched by check NAME (a re-pin
 *            that keeps the prefix still matches; a spec that matches nothing
 *            prints MISSING).
 *   SWEEP  — every other check whose statement (with its dependencies) reads
 *            `/` or `/markets` over HTTP, the sitemap, a source file the flip
 *            changed, or a rule the flip changed (isMarketsPath, SIGN_IN_LANDING,
 *            ARRIVAL_SOURCES, HERO_LINE, …).
 * A statement whose slice signs in (SIWE needs the DB), writes (POST/PUT/PATCH/
 * DELETE) or touches prisma is SKIPPED and named — never counted as a pass.
 * Checks issued through a helper defined in main() (`agree(…)`) are not seen.
 *
 *   BASE=http://localhost:3984 npx tsx scripts/front-door-replay.ts [--json out.json] [--list] [-v]
 *
 * Exit 1 when any replayed check FAILs or ERRORs (SKIP and MISSING are printed,
 * not failed — the coordinator reads them).
 */
import ts from 'typescript'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HARNESS = join(HERE, 'test-api.ts')
const GEN = join(HERE, '.front-door-replay.gen.ts')
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : ''
const LIST_ONLY = argv.includes('--list')
const VERBOSE = argv.includes('-v')
const BASE = (process.env.BASE ?? 'http://localhost:3984').replace(/\/$/, '')

// ── the selection ───────────────────────────────────────────────────────────
type Spec = { id: string; why: string; name?: RegExp; text?: RegExp }
/** The README "harness re-pin list" (squad front-door), by check name or by the
 *  text of the statement + its dependencies. */
const LISTED: Spec[] = [
  { id: 'roster-home', why: '`/` carries HERO_LINE and no roster marker', name: /^roster homepage:/ },
  // re-pinned names read "the brochure (/story)" — the spec keys on both shapes
  { id: 'msg-landing', why: 'markets/msg reads the landing (brochure → /story)', name: /^markets\/msg: the (landing|brochure)/ },
  { id: 'msg-sitemap', why: 'the sitemap lists /markets', name: /^markets\/msg: sitemap lists/ },
  { id: 'is-markets-path', why: "isMarketsPath('/') is true now", name: /isMarketsPath is exactly/ },
  { id: 'sign-in-landing', why: 'SIGN_IN_LANDING is `/`; signInLandingFor', name: /^(app entry: signed out|sign-in lands)/ },
  { id: 'mk2-landing', why: 'the mk2 landing block reads `/` (now /story)', name: /^mk2\/landing:/ },
  { id: 'mobile-cta', why: 'MobileCtaBar lives on /story; its CTA → `/`', text: /MobileCtaBar|\bmctaS(rc)?\b/ },
  // by NAME: the re-pin changed the alt's shape (the board card), so a text key on the old alt went MISSING
  { id: 'og-alt', why: 'the root card alt `Pantessa — ${HERO_LINE}`', name: /^onboarding: the root social card/ },
  { id: 'arrival-sources', why: 'ARRIVAL_SOURCES gains `/`', text: /\bARRIVAL_SOURCES\b|arrivalSourceAllowed\(/ },
  { id: 'nav-markets', why: "the nav's Markets tab href", text: /components\/Navigation\.tsx[\s\S]*\/markets|href="\\?\/markets"[\s\S]*nav__tab|nav__tab[\s\S]*href="\\?\/markets"/ },
  // by NAME: the re-pin reads app/page.tsx now, so a text key on the deleted path went MISSING
  { id: 'venue-first-paint', why: 'read app/markets/page.tsx (deleted by the flip); now the index page', name: /^venue gate \(first paint\)/ },
]
const SWEEP: { id: string; re: RegExp }[] = [
  // /story: the brochure moved there, and the re-pins read it
  { id: 'reads /, /markets or /story', re: /\$\{BASE\}\/(?:markets|story)?(?:[`?#])/ },
  { id: 'reads the sitemap', re: /sitemap\.xml/ },
  { id: 'reads a flip-changed file', re: /app\/page\.tsx|app\/story\/|app\/markets\/page|AppSpine\.tsx|MarketsIndex\.tsx|arrival-fence|phone-nav|next\.config|components\/home\/|components\/guide\/|lib\/guide\b/ },
  { id: 'uses a flip-changed rule', re: /\bisMarketsPath\(|\bisPublicAppPath\(|\bSIGN_IN_LANDING\b|\bsignInLandingFor\b|\bARRIVAL_SOURCES\b|arrivalSourceAllowed\(|\bphoneTap\(|\bHERO_LINE\b|\bMARKETS_HREF\b/ },
]
const NEEDS_SESSION = /\bsignIn\(|\bmallorySession\b/
const WRITES = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]|\bprisma\.|\$queryRaw|\$executeRaw/

// ── parse the harness ───────────────────────────────────────────────────────
const src = readFileSync(HARNESS, 'utf8')
const sf = ts.createSourceFile(HARNESS, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const mainDecl = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'main')
if (!mainDecl?.body) throw new Error('scripts/test-api.ts: no main() found')
const mainBody = mainDecl.body
const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
const isMainCall = (s: ts.Statement) => ts.isExpressionStatement(s) && /^main\(\)/.test(s.getText(sf))
const preamble = sf.statements.filter((s) => s !== mainDecl && !isMainCall(s))

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)))
}
const moduleNames = new Set<string>()
for (const s of preamble) {
  if (ts.isImportDeclaration(s) && s.importClause) {
    const c = s.importClause
    if (c.name) moduleNames.add(c.name.text)
    const nb = c.namedBindings
    if (nb && ts.isNamespaceImport(nb)) moduleNames.add(nb.name.text)
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) moduleNames.add(e.name.text)
  } else if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) for (const n of bindingNames(d.name)) moduleNames.add(n)
  } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) {
    moduleNames.add(s.name.text)
  }
}
const isGlobal = (n: string) => n in globalThis || n === 'undefined' || n === 'arguments'

const MUTATORS = new Set(['push', 'add', 'set', 'unshift', 'splice', 'delete', 'clear', 'pop', 'shift', 'sort', 'reverse', 'fill'])
const isAssign = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment
type Scan = { refs: Set<string>; decl: Set<string>; writes: Set<string> }
const scanCache = new Map<ts.Node, Scan>()
/** Names a statement reads, declares (anywhere inside it) and writes. */
function scan(node: ts.Node): Scan {
  const hit = scanCache.get(node)
  if (hit) return hit
  const refs = new Set<string>(), decl = new Set<string>(), writes = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) for (const x of bindingNames(n.name)) decl.add(x)
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n)) && n.name) decl.add(n.name.text)
    if (ts.isIdentifier(n)) {
      const p = n.parent
      const notRef =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isPropertySignature(p)) && p.name === n) ||
        (ts.isBindingElement(p) && (p.propertyName === n || p.name === n)) ||
        ((ts.isVariableDeclaration(p) || ts.isParameter(p)) && p.name === n) ||
        ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)) && p.name === n) ||
        ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p) ||
        ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isQualifiedName(p)
      if (!notRef) {
        refs.add(n.text)
        if (ts.isBinaryExpression(p) && p.left === n && isAssign(p.operatorToken.kind)) writes.add(n.text)
        if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) writes.add(n.text)
        if (ts.isPropertyAccessExpression(p) && p.expression === n && ts.isCallExpression(p.parent) && p.parent.expression === p && MUTATORS.has(p.name.text)) writes.add(n.text)
        if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n && ts.isBinaryExpression(p.parent) && p.parent.left === p && isAssign(p.parent.operatorToken.kind)) writes.add(n.text)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  for (const d of decl) writes.delete(d) // a write to a name the statement declares itself is its own business
  const out = { refs, decl, writes }
  scanCache.set(node, out)
  return out
}
/** Names a statement declares at ITS block's level (what later siblings can see). */
function levelDecls(st: ts.Statement): string[] {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => bindingNames(d.name))
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text]
  return []
}
const free = (s: Scan) => [...s.refs].filter((x) => !s.decl.has(x) && !moduleNames.has(x) && !isGlobal(x))

// ── every check() in main(), grouped by the statement that holds it ─────────
type Unit = { stmt: ts.Statement; chain: ts.Block[]; checks: { name: string; line: number }[]; line: number }
const units = new Map<ts.Statement, Unit>()
function checkName(call: ts.CallExpression): string {
  const a = call.arguments[0]
  if (!a) return '(unnamed)'
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text
  return a.getText(sf).replace(/^`|`$/g, '')
}
function unitOf(call: ts.Node): { stmt: ts.Statement; chain: ts.Block[] } | null {
  const path: ts.Node[] = []
  for (let n: ts.Node | undefined = call; n; n = n.parent) {
    path.unshift(n)
    if (n === mainBody) break
  }
  if (path[0] !== mainBody) return null
  const chain: ts.Block[] = [mainBody]
  let i = 1
  while (i < path.length && ts.isBlock(path[i])) chain.push(path[i++] as ts.Block)
  if (i >= path.length) return null
  return { stmt: path[i] as ts.Statement, chain }
}
const insideFunction = (n: ts.Node, stop: ts.Node) => {
  for (let p = n.parent; p && p !== stop; p = p.parent) if (ts.isFunctionLike(p)) return true
  return false
}
;(function walk(n: ts.Node) {
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'check') {
    const u = unitOf(n)
    // a check() inside a helper's body runs where the helper is CALLED — not here
    if (u && !insideFunction(n, u.stmt)) {
      const unit = units.get(u.stmt) ?? { stmt: u.stmt, chain: u.chain, checks: [], line: lineOf(u.stmt) }
      unit.checks.push({ name: checkName(n), line: lineOf(n) })
      units.set(u.stmt, unit)
    }
  }
  ts.forEachChild(n, walk)
})(mainBody)

/** The statement + every earlier statement it depends on, innermost block outward. */
function sliceOf(u: Unit): ts.Statement[] {
  const deps: ts.Statement[] = []
  const needed = new Set(free(scan(u.stmt)))
  let child: ts.Node = u.stmt
  for (let ci = u.chain.length - 1; ci >= 0 && needed.size; ci--) {
    const block = u.chain[ci]
    const idx = block.statements.indexOf(child as ts.Statement)
    for (let k = idx - 1; k >= 0 && needed.size; k--) {
      const st = block.statements[k]
      const here = levelDecls(st)
      const s = scan(st)
      const declares = here.some((x) => needed.has(x))
      const mutates = [...s.writes].some((x) => needed.has(x))
      if (!declares && !mutates) continue
      deps.push(st)
      for (const x of free(s)) needed.add(x)
      for (const x of here) needed.delete(x)
    }
    // hoisted function declarations anywhere in the block
    for (const st of block.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && needed.has(st.name.text)) {
        deps.push(st)
        needed.delete(st.name.text)
        for (const x of free(scan(st))) needed.add(x)
      }
    }
    child = block
  }
  return deps
}

type Sel = { unit: Unit; tier: 'LISTED' | 'SWEEP'; specs: string[]; why: string[]; skip?: string; deps: ts.Statement[] }
const selected: Sel[] = []
for (const u of units.values()) {
  const deps = sliceOf(u)
  const text = [u.stmt, ...deps].map((s) => s.getText(sf)).join('\n')
  const specs = LISTED.filter((sp) => (sp.name && u.checks.some((c) => sp.name!.test(c.name))) || (sp.text && sp.text.test(text)))
  const sweeps = SWEEP.filter((sw) => sw.re.test(text))
  if (!specs.length && !sweeps.length) continue
  const skip = NEEDS_SESSION.test(text)
    ? 'needs a signed-in session (SIWE writes the DB)'
    : WRITES.test(text)
      ? 'writes, or reads the database'
      : undefined
  selected.push({ unit: u, tier: specs.length ? 'LISTED' : 'SWEEP', specs: specs.map((s) => s.id), why: sweeps.map((s) => s.id), skip, deps })
}
selected.sort((a, b) => a.unit.line - b.unit.line)

if (LIST_ONLY) {
  for (const s of selected) {
    console.log(`${s.tier.padEnd(6)} L${s.unit.line} ${s.skip ? `[SKIP: ${s.skip}] ` : ''}[${[...s.specs, ...s.why].join(', ')}] deps=${s.deps.length}`)
    for (const c of s.unit.checks) console.log(`         · ${c.name.slice(0, 150)}`)
  }
  const missing = LISTED.filter((sp) => !selected.some((s) => s.specs.includes(sp.id)))
  for (const m of missing) console.log(`MISSING ${m.id} — ${m.why}`)
  console.log(`\n${selected.length} statements, ${selected.reduce((n, s) => n + s.unit.checks.length, 0)} checks`)
  process.exit(0)
}

// ── emit the replay program ─────────────────────────────────────────────────
const run = selected.filter((s) => !s.skip)
const included = new Map<ts.Statement, number>() // statement → id
const unitIds = new Map<ts.Statement, number>()
let nextId = 0
for (const s of run) {
  for (const d of s.deps) if (!included.has(d)) included.set(d, nextId++)
  if (!included.has(s.unit.stmt)) included.set(s.unit.stmt, nextId++)
  unitIds.set(s.unit.stmt, included.get(s.unit.stmt)!)
}
// the blocks on the way down to anything included
const openBlocks = new Set<ts.Node>()
for (const st of included.keys()) for (let p = st.parent; p && p !== mainBody.parent; p = p.parent) if (ts.isBlock(p)) openBlocks.add(p)

function emitStatement(st: ts.Statement, id: number): string {
  const L = lineOf(st)
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) return st.getText(sf) // hoisting must survive
  if (ts.isVariableStatement(st)) {
    const names = st.declarationList.declarations.flatMap((d) => bindingNames(d.name))
    const assigns = st.declarationList.declarations
      .filter((d) => d.initializer)
      .map((d) => `(${d.name.getText(sf)} = ${d.initializer!.getText(sf)});`)
      .join('\n')
    return `let ${names.join(', ')};\n__at(${id}, ${L}); try {\n${assigns}\n} catch (__e) { __fail(${id}, ${L}, __e) }`
  }
  return `__at(${id}, ${L}); try {\n${st.getText(sf)}\n} catch (__e) { __fail(${id}, ${L}, __e) }`
}
function emitBlock(block: ts.Block): string {
  const out: string[] = []
  for (const st of block.statements) {
    const id = included.get(st)
    if (id !== undefined) out.push(emitStatement(st, id))
    else if (ts.isBlock(st) && openBlocks.has(st)) out.push(`{\n${emitBlock(st)}\n}`)
  }
  return out.join('\n')
}
const preambleText = preamble
  .map((s) =>
    ts.isFunctionDeclaration(s) && s.name?.text === 'check'
      ? `function check(name: string, ok: boolean, extra = '') {\n  __RESULTS.push({ name, ok: !!ok, extra: String(extra ?? ''), stmt: __CUR })\n  ok ? pass++ : fail++\n}`
      : s.getText(sf),
  )
  .join('\n')
const program = `// GENERATED by scripts/front-door-replay.ts from scripts/test-api.ts — deleted after the run.
${preambleText}
const __RESULTS: { name: string; ok: boolean; extra: string; stmt: number }[] = []
const __ERRORS: { stmt: number; line: number; error: string }[] = []
let __CUR = -1
function __at(id: number, _line: number) { __CUR = id }
function __fail(id: number, line: number, e: unknown) {
  __ERRORS.push({ stmt: id, line, error: String((e as Error)?.message ?? e).split('\\n')[0].slice(0, 240) })
}
async function __replay() {
${emitBlock(mainBody)}
}
__replay()
  .catch((e) => __ERRORS.push({ stmt: -1, line: 0, error: 'top: ' + String(e?.message ?? e).slice(0, 240) }))
  .finally(() => {
    console.log('\\n__REPLAY_RESULT__' + JSON.stringify({ results: __RESULTS, errors: __ERRORS }))
    process.exit(0)
  })
`

// ── run it ──────────────────────────────────────────────────────────────────
if (existsSync(GEN)) unlinkSync(GEN)
writeFileSync(GEN, program)
let stdout = ''
let stderr = ''
try {
  const r = spawnSync(process.execPath, [...process.execArgv, GEN], {
    cwd: ROOT,
    env: { ...process.env, BASE },
    encoding: 'utf8',
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  stdout = r.stdout ?? ''
  stderr = r.stderr ?? ''
  if (r.error) stderr += `\n${r.error.message}`
} finally {
  if (existsSync(GEN) && !process.env.KEEP_GEN) unlinkSync(GEN)
}
const marker = stdout.lastIndexOf('__REPLAY_RESULT__')
if (marker < 0) {
  console.error('replay: the generated program did not report (it failed to compile or crashed):')
  console.error(stderr.split('\n').filter((l) => !/DeprecationWarning|trace-deprecation/.test(l)).slice(0, 30).join('\n'))
  console.log('replay: CRASHED — see stderr')
  process.exit(2)
}
const got = JSON.parse(stdout.slice(marker + '__REPLAY_RESULT__'.length).trim().split('\n')[0]) as {
  results: { name: string; ok: boolean; extra: string; stmt: number }[]
  errors: { stmt: number; line: number; error: string }[]
}

// ── report ──────────────────────────────────────────────────────────────────
type Row = { tier: string; spec: string; status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP' | 'MISSING'; name: string; detail: string; line: number }
const rows: Row[] = []
const stmtLine = new Map<number, number>()
for (const [st, id] of included) stmtLine.set(id, lineOf(st))
for (const s of selected) {
  const spec = s.tier === 'LISTED' ? s.specs.join('+') : s.why.join('+')
  if (s.skip) {
    for (const c of s.unit.checks) rows.push({ tier: s.tier, spec, status: 'SKIP', name: c.name, detail: s.skip, line: c.line })
    continue
  }
  const id = unitIds.get(s.unit.stmt)!
  const depIds = s.deps.map((d) => included.get(d)!)
  const depErrs = got.errors.filter((e) => depIds.includes(e.stmt)).map((e) => `L${e.line}: ${e.error}`)
  const ownErr = got.errors.find((e) => e.stmt === id)
  const res = got.results.filter((r) => r.stmt === id)
  for (const c of s.unit.checks) {
    const r = res.find((x) => x.name === c.name) ?? res.find((x) => x.name.startsWith(c.name.split('${')[0]))
    if (r) {
      const detail = [r.extra, !r.ok && depErrs.length ? `dependency failed — ${depErrs.join(' | ')}` : ''].filter(Boolean).join(' · ')
      rows.push({ tier: s.tier, spec, status: r.ok ? 'PASS' : 'FAIL', name: r.name, detail, line: c.line })
    } else {
      const why =
        [ownErr ? `L${ownErr.line}: ${ownErr.error}` : '', depErrs.length ? `dependency failed — ${depErrs.join(' | ')}` : ''].filter(Boolean).join(' · ') ||
        'did not run (the statement exited before this check)'
      rows.push({ tier: s.tier, spec, status: 'ERROR', name: c.name, detail: why, line: c.line })
    }
  }
  // template-named checks run once per loop pass: report the extra passes too
  for (const r of res) if (!s.unit.checks.some((c) => c.name === r.name) && !rows.some((x) => x.name === r.name)) {
    rows.push({ tier: s.tier, spec, status: r.ok ? 'PASS' : 'FAIL', name: r.name, detail: r.extra, line: s.unit.line })
  }
}
for (const sp of LISTED) if (!selected.some((s) => s.specs.includes(sp.id))) rows.push({ tier: 'LISTED', spec: sp.id, status: 'MISSING', name: sp.why, detail: 'no check in test-api.ts matched (re-pinned away, renamed, or deleted)', line: 0 })

const harnessSha = (() => {
  const r = spawnSync('git', ['log', '-1', '--format=%h', '--', 'scripts/test-api.ts'], { cwd: ROOT, encoding: 'utf8' })
  const h = spawnSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return `HEAD ${h.stdout.trim()} (test-api.ts last touched ${r.stdout.trim()})`
})()
console.log(`front-door replay — BASE=${BASE} — ${harnessSha}`)
for (const tier of ['LISTED', 'SWEEP'] as const) {
  const tr = rows.filter((r) => r.tier === tier)
  console.log(`\n${tier === 'LISTED' ? 'LISTED — the README harness re-pin list' : 'SWEEP — every other check that reads `/`, `/markets`, the sitemap, or a flip-changed file or rule'}`)
  for (const r of tr) {
    if (r.status === 'PASS' && tier === 'SWEEP' && !VERBOSE) continue
    console.log(`  ${r.status.padEnd(7)} [${r.spec}] ${r.name.slice(0, 170)}${r.line ? ` (test-api.ts:${r.line})` : ''}${r.detail ? `\n          ↳ ${r.detail.slice(0, 300)}` : ''}`)
  }
  if (tier === 'SWEEP' && !VERBOSE) console.log(`  (${tr.filter((r) => r.status === 'PASS').length} SWEEP passes not printed; -v prints them)`)
}
const count = (tier: string, st: string) => rows.filter((r) => r.tier === tier && r.status === st).length
const line = (tier: string) =>
  `${tier} ${count(tier, 'PASS')} pass / ${count(tier, 'FAIL')} fail / ${count(tier, 'ERROR')} error / ${count(tier, 'SKIP')} skip${tier === 'LISTED' ? ` / ${count(tier, 'MISSING')} missing` : ''}`
console.log(`\nreplay: ${line('LISTED')} · ${line('SWEEP')}`)
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), harness: harnessSha, rows, errors: got.errors }, null, 2))
process.exit(rows.some((r) => r.status === 'FAIL' || r.status === 'ERROR') ? 1 : 0)
