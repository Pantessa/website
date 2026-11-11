// Pins for squad landing, lane SIDES-B (2026-11-10): the Autopilots, Community, Wallet and Build panels.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-sides-b-pins.ts            (npm run pins:landing-sides-b)
//   BASE=http://localhost:PORT npx tsx scripts/landing-sides-b-pins.ts --served
//
// What these hold (each would go red if the behaviour broke):
//   • every sentence a panel can RUN is accepted by the product's own parser
//     and gate, and the one that only some wallets can run is not a chip;
//   • a recurring buy is never OFFERED from these panels (retired as a
//     suggestion 2026-09-16; scripts/test-api.ts fences the landing) and its
//     words are nowhere in the lane's files outside comments;
//   • the numbers the Autopilots panel prints (the stop's level, the alert's
//     band) agree with the rule that acts on them (lib/hl-guardian
//     evaluatePolicy, lib/watchlists alertFires), over tables of cases;
//   • the Build panel's code equals the page it was copied from;
//   • the Community specimen's lines are the real card's own functions' and
//     never say "bought" under the verified mark; it wears the EXAMPLE tag;
//   • each panel holds against EMPTY_TOUR (no hole, no brace);
//   • the lane's files say nothing the landing may not say and follow the
//     landing's CSS and door rules.

import fs from 'node:fs'
import path from 'node:path'
import { compileJobAsk } from '@/lib/jobs'
import { parseCadence, parseDcaCreate } from '@/lib/dca'
import { evaluatePolicy, parseGuardianArm } from '@/lib/hl-guardian'
import { parseSpotGuardArm } from '@/lib/spot-guard'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { STOPS, composeAsk } from '@/lib/trade-asks'
import { alertFires, alertLabel } from '@/lib/watchlists'
import { FUNDING_SCAN_CHAINS } from '@/lib/funding-plan'
import { FUNDING_ORIGIN_CHAINS } from '@/lib/funding-origins'
import { APP_CHAINS, chainById } from '@/lib/chains'
import { getChainMark } from '@/components/chain-marks'
import { proofFactLine, proofTagLine } from '@/lib/community/proof-words'
import { EMPTY_TOUR, tourBody, tourFacts, type TourSideMeta, type TourSnapshot } from '@/lib/home-tour'
import { meta as autopilots } from '@/lib/home-tour/autopilots'
import { meta as community } from '@/lib/home-tour/community'
import { meta as wallet } from '@/lib/home-tour/wallet'
import { meta as build } from '@/lib/home-tour/build'
import { FUND_FROM_CHAIN_IDS, alertBand, fmtAge, levelChart, stopLevel } from '@/components/home/tour/sides/b/rules'
import { ALERT_PCT, JOB_STEPS, alertSentence, stopSentence } from '@/components/home/tour/sides/b/standing'
import { BUILD_TABS, DESK_MCP_SNIPPET, DESK_TOOLS, EMBED_SNIPPET, SDK_INSTALL_SNIPPET, SDK_SNIPPET } from '@/components/home/tour/sides/b/snippets'
import { ANATOMY, PROOF_LIMIT, SPECIMEN, specimenLines } from '@/components/home/tour/sides/b/specimen'
import { FUNDING_STEPS, fmtUnits, fmtUsd, listNames, shortAddress, topHoldings, totalUsd } from '@/components/home/tour/sides/b/funding'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const SIDES: readonly TourSideMeta[] = [autopilots, community, wallet, build]
const LANE_TSX = ['Autopilots', 'Community', 'Wallet', 'Build'].map((n) => `components/home/tour/sides/${n}.tsx`)
const LANE_CSS = ['autopilots', 'community', 'wallet', 'build'].map((n) => `components/home/tour/sides/${n}.css`).concat('components/home/tour/sides/b/shared.css')
const LANE_TS = ['rules', 'standing', 'snippets', 'specimen', 'funding'].map((n) => `components/home/tour/sides/b/${n}.ts`)
const LANE_WORDS = ['autopilots', 'community', 'wallet', 'build'].map((n) => `lib/home-tour/${n}.ts`)

/** A source with its comments removed: what a rule about PRINTED words reads. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

export function landingSidesBPins(check: Check): void {
  // ── The sentences a panel can run ─────────────────────────────────────────
  const [job] = autopilots.asks
  const audit = read('scripts/audit-asks.ts')
  const inCorpus = (ask: string) => audit.split('\n').some((l) => l.includes(`'${ask}'`) && /expect: 'action'/.test(l))
  const compiled = job ? compileJobAsk(job.ask) : null
  const steps = compiled && 'steps' in compiled ? compiled.steps : []
  const panel = read('components/home/tour/sides/Autopilots.tsx')
  check(
    'sides-b (autopilots): the one sentence the panel runs compiles to exactly the steps it draws — your wallet signs the long, the runner arms the stop — the venue gate lets it through and the ask corpus expects an action from it',
    autopilots.asks.length === 1 &&
      steps.length === JOB_STEPS.length &&
      steps.every((s, i) => s.kind === JOB_STEPS[i].kind) &&
      steps[0]?.builder === 'native-hl-exec' &&
      steps[1]?.builder === 'native-hl-guardian' &&
      canTradeAsk(job.ask, null) &&
      inCorpus(job.ask) &&
      /JOB_STEPS\.map\(/.test(panel),
    steps.map((s) => `${s.kind}:${s.builder}`).join(' → '),
  )
  check(
    'sides-b (asks): no side of this lane offers a sentence only some wallets can run — nothing the spot guardian or the perp guardian would read as an arm is a chip (a stop needs a position: it is words on the panel)',
    SIDES.flatMap((s) => s.asks).every((a) => !parseSpotGuardArm(a.ask) && (a.ask === job.ask || !parseGuardianArm(a.ask))) && [community, wallet, build].every((s) => s.asks.length === 0),
  )
  check(
    'sides-b (autopilots): the job row goes through act() behind canAct, never fill(); the stop and the alert have no act() of their own',
    /canAct\(job\.ask\) &&/.test(panel) && /onClick=\{\(\) => act\(job\.ask\)\}/.test(panel) && !/\bfill\(/.test(code(panel)) && (code(panel).match(/\bact\(/g) ?? []).length === 1,
  )
  // Retired as a suggestion (2026-09-16, Nate): in confirm mode a recurring
  // buy only reminds the wallet to sign each period, so no surface OFFERS
  // one, the landing included. Typing one still works.
  const RECURRING = /\bdca\b|every (day|week|month)|\b(daily|weekly|monthly)\b/i
  const recurringIn = [...LANE_TSX, ...LANE_TS, ...LANE_WORDS].map((f) => [f, code(read(f))] as const).concat(LANE_CSS.map((f) => [f, read(f).replace(/\/\*[\s\S]*?\*\//g, '')] as const)).filter(([, src]) => RECURRING.test(src)).map(([f]) => f)
  check(
    'sides-b (no recurring buy): no sentence of this lane is one lib/dca reads as a recurring buy, no cadence word is printed by any of the lane\'s files outside comments, and Autopilots is three orders (stop, alert, job)',
    SIDES.flatMap((s) => s.asks).every((a) => !parseDcaCreate(a.ask) && !parseCadence(a.ask)) &&
      recurringIn.length === 0 &&
      SIDES.every((s) => !RECURRING.test([s.label, s.claim, s.line, s.body, ...s.facts, ...s.doors.map((d) => d.label), ...s.asks.flatMap((a) => [a.ask, a.label, a.via])].join(' '))) &&
      (panel.match(/data-ap-row="/g) ?? []).join('') === 'data-ap-row="'.repeat(3) &&
      ['stop', 'alert', 'job'].every((r) => panel.includes(`data-ap-row="${r}"`)) &&
      !/Set it up/.test(panel),
    recurringIn.join(', '),
  )

  // ── The stop: the sentence and the level ──────────────────────────────────
  const hlPair = { symbol: 'ETH', source: 'hyperliquid' } as Parameters<typeof composeAsk>[0]
  check(
    'sides-b (autopilots): the stop sentence is the product\'s own for every preset (lib/trade-asks composeAsk, protect on a perp) and the guardian reads it as a percent stop of that size',
    STOPS.every((p) => {
      const s = stopSentence('ETH', p)
      const arm = parseGuardianArm(s)
      return s === composeAsk(hlPair, 'protect', { pct: p }) && arm?.coin === 'ETH' && arm.kind === 'stop_loss' && arm.triggerMode === 'price_move_pct' && arm.triggerValue === p
    }),
  )
  const stopCases: [number, number][] = [
    [2057.54, 5],
    [2057.54, 10],
    [2057.54, 15],
    [98765.4, 5],
    [0.0421, 10],
    [3412.2, 1],
  ]
  const stopOk = stopCases.every(([entry, pct]) =>
    (['long', 'short'] as const).every((side) => {
      const level = stopLevel(entry, pct, side)
      if (level == null) return false
      const p = { coin: 'ETH', side, kind: 'stop_loss' as const, triggerMode: 'price_move_pct' as const, triggerValue: pct }
      const pos = { coin: 'ETH', szi: side === 'long' ? 1 : -1, entryPx: entry }
      const eps = entry * 1e-6
      const inside = side === 'long' ? level + eps : level - eps
      const beyond = side === 'long' ? level - eps : level + eps
      return evaluatePolicy(p, pos, level).fired && evaluatePolicy(p, pos, beyond).fired && !evaluatePolicy(p, pos, inside).fired && !evaluatePolicy(p, pos, entry).fired
    }),
  )
  check(
    'sides-b (autopilots): the stop level the panel draws is the price the guardian fires at — a percent from ENTRY, under it for a long and over it for a short; holding one tick inside it, firing at it and beyond — and a number the guardian would refuse draws nothing',
    stopOk && stopLevel(0, 5) === null && stopLevel(100, 0) === null && stopLevel(100, 100) === null && stopLevel(NaN, 5) === null && Math.abs((stopLevel(2000, 5) ?? 0) - 1900) < 1e-9 && Math.abs((stopLevel(2000, 5, 'short') ?? 0) - 2100) < 1e-9,
  )

  // ── The alert: the sentence and the band ──────────────────────────────────
  const bandOk = [2057.54, 98765.4, 0.0421].every((base) => {
    const band = alertBand(base, ALERT_PCT)
    if (!band) return false
    const rule = { symbol: 'ETH', condition: 'pct_move' as const, value: ALERT_PCT, basePrice: base }
    const eps = base * 1e-6
    return alertFires(rule, band.up + eps) && alertFires(rule, band.down - eps) && !alertFires(rule, band.up - eps) && !alertFires(rule, band.down + eps) && !alertFires(rule, base)
  })
  check(
    'sides-b (autopilots): the alert reads as the bell lists it (lib/watchlists alertLabel) and its two prices are where alertFires trips, either way from the price it was armed at',
    bandOk && alertSentence('ETH', ALERT_PCT, '$2,057.54') === alertLabel({ symbol: 'ETH', condition: 'pct_move', value: ALERT_PCT, basePrice: 2057.54 }) && alertSentence('ETH', ALERT_PCT, null) === alertLabel({ symbol: 'ETH', condition: 'pct_move', value: ALERT_PCT, basePrice: null }) && alertBand(0, 5) === null,
  )

  check(
    'sides-b (community): a post\'s age never prints a negative or an empty figure',
    fmtAge(-1) === 'just now' && fmtAge(59_000) === 'just now' && fmtAge(12 * 60_000) === '12m ago' && fmtAge(3 * 3_600_000) === '3h ago' && fmtAge(49 * 3_600_000) === '2d ago',
  )
  const chart = levelChart(
    [
      [1, 2100],
      [2, 2080],
      [3, 2057.54],
    ],
    [2057.54, 1954.66],
  )
  check(
    'sides-b (autopilots): the small chart keeps the stop inside its box (the level sits under the day\'s range) and draws nothing from fewer than two points',
    !!chart && chart.y(1954.66) <= 96 && chart.y(1954.66) > chart.y(2057.54) && chart.y(2100) >= 0 && /^M0\.0 /.test(chart.d) && levelChart([[1, 5]], [4]) === null && levelChart([], []) === null,
  )
  check(
    'sides-b (autopilots): the panel reads no clock and sets no timer (a static page prints no date of its own); Community reads its clock only after mount; no panel opens a stream',
    !/Date\.now\(|new Date\(|setInterval|setTimeout/.test(code(panel)) && /useEffect\(\(\) => setNow\(Date\.now\(\)\), \[\]\)/.test(read('components/home/tour/sides/Community.tsx')) && LANE_TSX.every((f) => !/WebSocket|EventSource|lightweight-charts|from 'three'|\/api\/chat/.test(code(read(f)))),
  )

  // ── Build: the code is the docs' ──────────────────────────────────────────
  const assemble = read('components/EmbedAssemble.tsx')
  const embedDocs = read('app/docs/embed/page.tsx')
  const deskDocs = read('app/docs/desk/page.tsx')
  const deskDocsCode = deskDocs.replace(/\\`/g, '`').replace(/\\\$\{/g, '${')
  const embedLines = EMBED_SNIPPET.split('\n').filter((l) => l.trim())
  let cursor = -1
  const embedInOrder = embedLines.every((l) => {
    const at = assemble.indexOf(l, cursor + 1)
    const ok = at > cursor
    cursor = at
    return ok
  })
  check(
    'sides-b (build): the embed snippet is the install components/EmbedAssemble types, line for line and in order, and every option in it is on the embed docs page',
    embedInOrder && ["mountPantessaChat", "'pantessa/embed'", "mode: 'bubble'", "wallet: 'auto'", 'mcps:'].every((w) => EMBED_SNIPPET.includes(w) && embedDocs.includes(w)),
  )
  check(
    'sides-b (build): the desk line is the docs page\'s own command, the three tools named under it are on that page and in the desk\'s MCP route, and the tab says nothing about a tool that is not',
    deskDocs.includes(DESK_MCP_SNIPPET) && DESK_TOOLS.every((t) => deskDocs.includes(t) && read('app/api/broker/[transport]/route.ts').includes(t)) && (BUILD_TABS.find((t) => t.id === 'desk')?.points ?? []).every((p) => DESK_TOOLS.some((t) => p.startsWith(`${t}: `))),
  )
  const sdkReadme = ['../sdk/README.md', '../../sdk/README.md'].map((p) => path.join(ROOT, p)).find((p) => fs.existsSync(p))
  const readme = sdkReadme ? fs.readFileSync(sdkReadme, 'utf8') : null
  check(
    'sides-b (build): the SDK block is the desk docs page\'s agent-signed snippet, character for character; the install line is the quickstart\'s (and the SDK README\'s, where the README is on this machine)',
    deskDocsCode.includes(SDK_SNIPPET) && read('app/docs/_quickstart/page.tsx').includes(SDK_INSTALL_SNIPPET) && (readme == null || (readme.includes(SDK_INSTALL_SNIPPET) && readme.includes("import { openAndExecute, driveJob } from 'pantessa/desk'"))),
    readme == null ? 'sdk README not on this machine: checked against the repo only' : 'README read',
  )
  const pinned = new Set([EMBED_SNIPPET, DESK_MCP_SNIPPET, SDK_INSTALL_SNIPPET, SDK_SNIPPET])
  const buildPanel = read('components/home/tour/sides/Build.tsx')
  check(
    'sides-b (build): three tabs in order (Embed, Agent desk, SDK), every block one of the pinned snippets, each with a copy button that writes the block\'s own text; the tabs are a real tablist whose handled keys stop there (the tour\'s own tablist never moves under them); the venue line is counted from the snapshot and dropped without it',
    BUILD_TABS.map((t) => t.id).join(',') === 'embed,desk,sdk' &&
      BUILD_TABS.every((t) => t.blocks.length > 0 && t.blocks.every((b) => pinned.has(b.code))) &&
      /navigator\.clipboard\.writeText\(block\.code\)/.test(buildPanel) &&
      /role="tablist"/.test(buildPanel) &&
      /role="tabpanel"/.test(buildPanel) &&
      /ArrowRight/.test(buildPanel) &&
      /e\.preventDefault\(\)\s+e\.stopPropagation\(\)/.test(buildPanel) &&
      /tabIndex=\{t\.id === on \? 0 : -1\}/.test(buildPanel) &&
      /venues != null && pinnedAddresses != null &&/.test(buildPanel) &&
      /href="\/docs\/venues"/.test(buildPanel) &&
      !/\{venues\}|\{pinnedAddresses\}/.test(build.body + build.facts.join(' ')),
  )

  // ── Community: the specimen speaks the real card's words ─────────────────
  const lines = specimenLines()
  const communityPanel = read('components/home/tour/sides/Community.tsx')
  check(
    'sides-b (community): the specimen\'s proof line is lib/community/proof-words\' own ("this wallet moved", never bought or sold), the market and side are printed as the author\'s tag, the title as the author\'s words',
    lines.fact === proofFactLine({ sizeUsd: SPECIMEN.sizeUsd, chain: SPECIMEN.chain }) &&
      lines.fact === 'Verified on-chain: this wallet moved $75.00 on Base' &&
      !/bought|sold|long|short|profit/i.test(lines.fact) &&
      lines.tag === proofTagLine({ symbols: SPECIMEN.symbols, side: SPECIMEN.side }) &&
      lines.tag === 'Tagged by the author: bought ETH' &&
      lines.said === `The author says: "${SPECIMEN.title}"`,
    `${lines.fact} · ${lines.tag} · ${lines.said}`,
  )
  check(
    'sides-b (community): the anatomy wears the EXAMPLE tag, has three callouts (the proof, the call, the room), shows only when the snapshot has no public post, and a real post prints dollars only when it carries proof',
    /data-example/.test(communityPanel) &&
      />\s*Example\s*</.test(communityPanel) &&
      ANATOMY.map((a) => a.id).join(',') === 'proof,call,room' &&
      /posts\.length \? \(/.test(communityPanel) &&
      /<Anatomy \/>/.test(communityPanel) &&
      /p\.movedUsd != null && p\.movedUsd > 0 &&/.test(communityPanel) &&
      /Perp fills and cross-chain swaps cannot/.test(PROOF_LIMIT) &&
      /Hyperliquid fills cannot be posted as proof yet/.test(read('app/docs/community/page.tsx')),
  )

  // ── Wallet: the chains and the funding steps ─────────────────────────────
  const walletPanel = read('components/home/tour/sides/Wallet.tsx')
  const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
  check(
    'sides-b (wallet): the chains a short buy is funded from are the funding layer\'s own (lib/funding-plan and lib/funding-origins agree), each is a registry chain with a mark, and the words say "another chain", never "any chain"',
    sameIds(FUND_FROM_CHAIN_IDS, FUNDING_SCAN_CHAINS) && sameIds(FUND_FROM_CHAIN_IDS, FUNDING_ORIGIN_CHAINS) && FUND_FROM_CHAIN_IDS.every((id) => !!chainById(id) && !!getChainMark(chainById(id)!.key)) && !/any chain/i.test(wallet.line + wallet.body + FUNDING_STEPS.map((s) => s.what).join(' ')),
  )
  check(
    'sides-b (wallet): every chain in the registry has a face for the strip; with an empty snapshot the strip falls back to the registry; a wallet\'s three states (reading, nothing held, held) each have words; the panel has no connect button of its own and prints no count of signatures',
    APP_CHAINS.every((c) => !!getChainMark(c.key)) &&
      /data\.chains\.length \? data\.chains : APP_CHAINS/.test(walletPanel) &&
      /held == null \?/.test(walletPanel) &&
      /held\.length === 0 \?/.test(walletPanel) &&
      !/<button/.test(walletPanel) &&
      !/openConnectModal|useConnect\b/.test(walletPanel) &&
      FUNDING_STEPS.length === 3 &&
      FUNDING_STEPS.every((s) => !/\d/.test(s.what + s.title) && !/signature[s]? /.test(s.title)),
  )
  const held = [
    { symbol: 'A', valueUsd: 5 },
    { symbol: 'B', valueUsd: null },
    { symbol: 'C', valueUsd: 50 },
    { symbol: 'D', valueUsd: 0 },
  ]
  check(
    'sides-b (wallet): holdings rank by priced value with the unpriced after; the total counts only what was priced and is null when nothing was; an address, a size and a dollar figure print one way',
    topHoldings(held, 3).map((h) => h.symbol).join('') === 'CAB' && totalUsd(held) === 55 && totalUsd([{ valueUsd: null }]) === null && totalUsd([]) === null && shortAddress('0x1234567890abcdef1234567890abcdef12345678') === '0x1234…5678' && fmtUsd(1234.5) === '$1,234.50' && fmtUnits(0.123456) === '0.1235' && fmtUnits(1234.567) === '1,234.57' && listNames(['Base', 'Arbitrum', 'Optimism', 'Ethereum']) === 'Base, Arbitrum, Optimism and Ethereum' && listNames(['Base']) === 'Base',
  )

  // ── Against an empty snapshot ─────────────────────────────────────────────
  const full: TourSnapshot = { ...EMPTY_TOUR, counts: { stocks: 100, crypto: 40, macro: 9, apps: 12, chains: 6, venues: 13, pinnedAddresses: 49, earnWays: 8 } }
  check(
    'sides-b (empty snapshot): every side\'s body and facts read whole against EMPTY_TOUR — no brace, no doubled space, no fact with a hole — and fill from a full one; a line is 64 characters at most, facts three at most, one primary door first',
    SIDES.every((s) => {
      const body = tourBody(s, EMPTY_TOUR)
      const facts = tourFacts(s, EMPTY_TOUR)
      return !/[{}]/.test(body) && !/ {2}/.test(body) && facts.every((f) => !/[{}]/.test(f)) && !/[{}]/.test(tourBody(s, full)) && s.line.length <= 64 && s.facts.length <= 3 && s.doors[0]?.kind === 'primary' && s.doors.filter((d) => d.kind === 'primary').length === 1
    }) && tourBody(wallet, full).includes('6 chains'),
    SIDES.map((s) => `${s.id}:${s.line.length}`).join(' '),
  )
  check(
    'sides-b (empty snapshot): a panel that needs a live value draws without it — the stop and the alert fall back to words when there is no ether quote, the community to the anatomy, the build foot is dropped',
    /entry != null && stop != null \? \(/.test(panel) && /\{chart && entry != null && stop != null && \(/.test(panel) && /band \? \(/.test(panel) && /alertSentence\('ETH', ALERT_PCT, null\)/.test(panel),
  )

  // ── What the lane's files may not say or do ───────────────────────────────
  const printed = [...LANE_TSX, ...LANE_TS, ...LANE_WORDS].map((f) => [f, code(read(f))] as const)
  const banned = /telegram|discord|\bdune\b|yeetful|guarantee|fully automatic|risk[- ]free|financial advice/i
  const saysBanned = printed.filter(([, src]) => banned.test(src)).map(([f]) => f)
  check('sides-b (honesty): nothing this lane prints names Telegram, Discord, a partner or the old brand, or promises what confirm mode does not do', saysBanned.length === 0, saysBanned.join(', '))
  const doorsBad = LANE_TSX.filter((f) => {
    const src = code(read(f))
    return /from 'next\/link'|redirectTo|\/chat\?prompt=|window\.scrollTo|router\.(push|replace)/.test(src)
  })
  check('sides-b (doors): every link in the four panels is a LandingLink with a journey label; none imports next/link, passes redirectTo or writes a prompt link', doorsBad.length === 0 && LANE_TSX.every((f) => (code(read(f)).match(/<LandingLink\b[^>]*>/g) ?? []).every((tag) => /data-journey=\{tourJourney\(meta\.id,/.test(tag))), doorsBad.join(', '))
  const cssBad = LANE_CSS.filter((f) => {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '')
    const motion = /transition|animation/.test(src)
    return /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(src) || /font-size:\s*[\d.]+px/.test(src) || /border-radius:\s*[\d.]+px/.test(src) || /position:\s*(sticky|fixed)/.test(src) || /@media[^{]*(max|min)-width/.test(src) || (motion && !/prefers-reduced-motion/.test(src))
  })
  check('sides-b (css): tokens only in the lane\'s five sheets — no literal colour, no px font size, no px radius, nothing sticky or fixed, sized by container never by viewport, and a sheet that moves has a reduced-motion rule', cssBad.length === 0, cssBad.join(', '))
}

export async function landingSidesBPinsServed(check: Check, base: string): Promise<void> {
  const headers = { 'x-yf-internal-run': '1' }
  // The doors the four panels add beyond their tables' (the coordinator's pin walks the tables').
  const extra = ['/t/ETH', '/docs/venues']
  const dead: string[] = []
  for (const href of [...new Set([...extra, ...[autopilots, community, wallet, build].flatMap((s) => s.doors.map((d) => d.href)).filter((h) => h.startsWith('/'))])]) {
    const res = await fetch(`${base}${href}`, { headers, redirect: 'manual' }).catch(() => null)
    if (!res || res.status >= 400) dead.push(`${href} → ${res?.status ?? 'no answer'}`)
  }
  check('sides-b (served): every door the four panels open answers (the tables\' doors, ether\'s chart for an alert, the venue manifest)', dead.length === 0, dead.join(' · '))

  const readRes = await fetch(`${base}/api/markets/read`, { headers }).catch(() => null)
  const snap = readRes && readRes.ok ? ((await readRes.json().catch(() => null)) as { quotes?: { eth?: { last?: number; points?: unknown[] } } } | null) : null
  const eth = snap?.quotes?.eth
  check(
    'sides-b (served): the read the stop and the alert are drawn from answers with an ether quote and a series (without one the panel says the rule in words)',
    !!readRes && readRes.ok && (eth == null || (typeof eth.last === 'number' && eth.last > 0 && Array.isArray(eth.points))),
    eth ? `ether ${eth.last} · ${eth.points?.length ?? 0} points` : 'no ether quote in this snapshot',
  )

  const home = await fetch(`${base}/`, { headers }).catch(() => null)
  const html = home ? await home.text() : ''
  check(
    'sides-b (served): the home names this lane\'s four sides, with each side\'s line, in the server HTML',
    !!home && home.ok && [autopilots, community, wallet, build].every((s) => html.includes(s.label) && html.includes(s.line.replace(/&/g, '&amp;'))),
  )
}

if (process.argv[1]?.endsWith('landing-sides-b-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingSidesBPins(check))
    .then(() => (served ? landingSidesBPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
