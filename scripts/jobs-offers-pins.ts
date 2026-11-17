// Pins for squad lane1 (the jobs audit, 2026-11-17), lane offers. Nate: "the
// one it suggested as a default for a new account broke ... I just don't want
// broken suggestions happening anymore." Pure: no server, no chain, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/jobs-offers-pins.ts
// OWNED BY THE offers LANE: only that lane edits this file.

import { readFileSync } from 'node:fs'
import { formatEther } from 'viem'
import { compileJobAsk } from '../lib/jobs'
import { FUNDING_MARGIN_BPS, fundingNeedUsd, GAS_LEG_USD, MIN_VALUE_LEG_USD, RH_GAS_FLOOR_WEI } from '../lib/lifi-bridge'
import { FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD } from '../lib/funding-origins'
import { FIRST_RUN_ASKS, JOBS_DOOR } from '../lib/first-run'
import {
  fundBuySentence,
  isExpiredJob,
  JOB_OFFER_BUY,
  JOB_OFFER_EXAMPLE,
  JOB_OFFER_ORIGINS,
  JOB_OFFER_SENTENCES,
  jobOfferFor,
  jobOfferView,
  OFFER_DEST_GAS_FLOOR_ETH,
  OFFER_FUNDING_MARGIN_BPS,
  OFFER_GAS_LEG_USD,
  OFFER_MIN_VALUE_LEG_USD,
  OFFER_ORIGIN_MIN_GAS_ETH,
  offerFundUsd,
  type JobOfferChain,
  type JobOfferFacts,
} from '../lib/job-offers'

type Check = (name: string, ok: boolean, extra?: string) => void

const WALLET = '0x00000000000000000000000000000000000000aa'
/** A chain row: `usdc` dollars of USDC, `eth` native ETH. */
const row = (chainId: number, usdc: number, eth: number, ok = true): JobOfferChain =>
  ok ? { chainId, ok: true, stable: { symbol: chainId === 4663 ? 'USDG' : 'USDC', balance: usdc }, nativeEth: eth } : { chainId, ok: false }
/** Every origin read and empty, Robinhood Chain read and empty, then the overrides. */
const facts = (...over: JobOfferChain[]): JobOfferFacts => {
  const base = [8453, 42161, 10, 1, 4663].map((id) => row(id, 0, 0))
  return { chains: base.map((b) => over.find((o) => o.chainId === b.chainId) ?? b) }
}
const src = (p: string) => readFileSync(p, 'utf8')
/** Source with comments removed, so a header that NAMES a thing never counts as using it. */
const code = (p: string) =>
  src(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

export function jobsOffersPins(check: Check) {
  // ── The floors are lib/lifi-bridge's, to the cent ─────────────────────────
  check(
    'jobs offers: the client-safe floors equal lib/lifi-bridge (gas leg, smallest value leg, margin, Robinhood Chain gas floor)',
    OFFER_GAS_LEG_USD === GAS_LEG_USD &&
      OFFER_MIN_VALUE_LEG_USD === MIN_VALUE_LEG_USD &&
      OFFER_FUNDING_MARGIN_BPS === FUNDING_MARGIN_BPS &&
      OFFER_DEST_GAS_FLOOR_ETH === Number(formatEther(RH_GAS_FLOOR_WEI)),
    JSON.stringify({ OFFER_GAS_LEG_USD, GAS_LEG_USD, OFFER_MIN_VALUE_LEG_USD, MIN_VALUE_LEG_USD, OFFER_FUNDING_MARGIN_BPS, FUNDING_MARGIN_BPS, OFFER_DEST_GAS_FLOOR_ETH }),
  )
  check(
    'jobs offers: offerFundUsd is lib/lifi-bridge fundingNeedUsd for every size and gas state it could meet',
    [3, 5, 10, 12, 25, 40, 100].every((b) => [true, false].every((g) => offerFundUsd(b, g) === fundingNeedUsd(b, g))),
  )
  {
    // ORIGIN_MIN_GAS_ETH is not exported: read the literal.
    const m = src('lib/lifi-bridge.ts').match(/const ORIGIN_MIN_GAS_ETH: Record<number, number> = \{([^}]+)\}/)
    const theirs = Object.fromEntries([...(m?.[1] ?? '').matchAll(/(\d+):\s*([\d.]+)/g)].map((x) => [Number(x[1]), Number(x[2])]))
    check(
      'jobs offers: the origin signing floors equal lib/lifi-bridge ORIGIN_MIN_GAS_ETH for each chain an offer can leave',
      !!m && JOB_OFFER_ORIGINS.every((id) => theirs[id] === OFFER_ORIGIN_MIN_GAS_ETH[id]) && Object.keys(OFFER_ORIGIN_MIN_GAS_ETH).length === JOB_OFFER_ORIGINS.length,
      JSON.stringify({ theirs, ours: OFFER_ORIGIN_MIN_GAS_ETH }),
    )
  }
  check(
    'jobs offers: the offer draws only from funding origins the bridge can leave, and never from mainnet (L1 gas: only a rich wallet built one in the audit drive)',
    JOB_OFFER_ORIGINS.every((id) => (FUNDING_ORIGIN_CHAINS as readonly number[]).includes(id)) && !JOB_OFFER_ORIGINS.includes(1) && [...JOB_OFFER_ORIGINS].sort().join() === [10, 42161, 8453].sort().join(),
  )

  // ── Every sentence the function can emit compiles ─────────────────────────
  const compiled = JOB_OFFER_SENTENCES.map((ask) => [ask, compileJobAsk(ask)] as const)
  check(
    'jobs offers: every catalog sentence (3 origins x with / without the gas leg) compiles as a job',
    JOB_OFFER_SENTENCES.length === 6 && compiled.every(([, c]) => !!c && 'steps' in c),
    compiled.map(([a, c]) => `${c && 'steps' in c ? 'ok' : JSON.stringify(c)} <- ${a}`).join(' | '),
  )
  check(
    'jobs offers: with the gas leg the job is gas leg, value leg, wait, buy (4 steps); without it value leg, wait, buy (3), and the legs leave the named origin in USDC',
    compiled.every(([ask, c]) => {
      if (!c || !('steps' in c)) return false
      const gas = /including gas/.test(ask)
      const funds = c.steps.filter((s) => s.builder === 'native-lifi-fund')
      const origin = JOB_OFFER_ORIGINS.find((id) => ask.includes(`from ${FUNDING_ORIGIN_WORD[id]}`))
      return (
        c.steps.length === (gas ? 4 : 3) &&
        funds.length === (gas ? 2 : 1) &&
        funds.every((s) => (s.params as { origin?: number; token?: string }).origin === origin && (s.params as { token?: string }).token === 'USDC') &&
        c.steps[c.steps.length - 2].kind === 'wait' &&
        c.steps[c.steps.length - 1].kind === 'sign'
      )
    }),
    compiled.map(([a, c]) => `${c && 'steps' in c ? c.steps.map((s) => s.builder).join('>') : '-'} <- ${a}`).join(' | '),
  )
  check(
    'jobs offers: the value leg a sentence moves covers the buy with the bridge headroom, and never drops under the smallest leg that fills',
    [true, false].every((g) => {
      const value = offerFundUsd(JOB_OFFER_BUY.usd, g) - (g ? GAS_LEG_USD : 0)
      return value >= JOB_OFFER_BUY.usd * (1 + FUNDING_MARGIN_BPS / 10_000) && value >= MIN_VALUE_LEG_USD
    }),
  )
  check('jobs offers: no catalog sentence is a recurring buy (retired as a suggestion 2026-09-16)', JOB_OFFER_SENTENCES.every((a) => !/\b(every|weekly|daily|monthly|each)\b/i.test(a)))

  // ── The decision table ────────────────────────────────────────────────────
  const withGas = offerFundUsd(JOB_OFFER_BUY.usd, true)
  const noGas = offerFundUsd(JOB_OFFER_BUY.usd, false)
  check('jobs offers: an empty wallet gets no job (the prod 2026-11-17 case: 0 USDC on Base)', jobOfferFor(facts()) === null)
  check('jobs offers: no facts, no job', jobOfferFor(null) === null && jobOfferFor(undefined) === null)
  {
    const o = jobOfferFor(facts(row(42161, 40, 0.001)))
    check(
      'jobs offers: funded on Arbitrum only -> an Arbitrum-origin sentence, with the gas leg (no ETH on Robinhood Chain), and it compiles',
      !!o && o.originChainId === 42161 && o.ask === fundBuySentence(42161, true) && /from Arbitrum including gas, then buy \$10 of AAPL$/.test(o.ask) && o.steps === 4 && o.fundUsd === withGas && !/Base/.test(o.ask) && !!compileJobAsk(o.ask),
      JSON.stringify(o),
    )
  }
  {
    const o = jobOfferFor(facts(row(8453, 20, 0.001)))
    check('jobs offers: funded on Base -> the Base sentence', !!o && o.originChainId === 8453 && o.ask === fundBuySentence(8453, true) && /Base/.test(o.why), JSON.stringify(o))
  }
  {
    const o = jobOfferFor(facts(row(10, 15, 0.001), row(4663, 0, 0.001)))
    check(
      'jobs offers: ETH already on Robinhood Chain -> no gas leg, a 3-step job, the smaller size',
      !!o && o.originChainId === 10 && !o.gasIncluded && o.steps === 3 && o.fundUsd === noGas && !/including gas/.test(o.ask) && /3-step/.test(o.label),
      JSON.stringify(o),
    )
  }
  check(
    'jobs offers: Robinhood Chain unread -> the gas leg rides (a spare gas leg is harmless, a buy with no gas stalls)',
    jobOfferFor(facts(row(8453, 20, 0.001), row(4663, 0, 0, false)))?.gasIncluded === true,
  )
  check(
    'jobs offers: below the size -> no job (a cent short with the gas leg; and the no-gas size does not rescue a wallet that needs gas)',
    jobOfferFor(facts(row(8453, withGas - 0.01, 0.001))) === null && jobOfferFor(facts(row(8453, noGas, 0.001))) === null && jobOfferFor(facts(row(8453, withGas, 0.001))) !== null,
  )
  check(
    'jobs offers: USDC with no ETH to sign on that chain is not an offer; at the floor it is',
    jobOfferFor(facts(row(8453, 500, 0))) === null && jobOfferFor(facts(row(8453, 500, 0.00002))) === null && jobOfferFor(facts(row(8453, 500, 0.00003)))?.originChainId === 8453,
  )
  check(
    'jobs offers: the richest chain that qualifies wins; USDC on mainnet alone, however much, is never an offer',
    jobOfferFor(facts(row(8453, 14, 0.001), row(42161, 90, 0.001), row(1, 5000, 0.01)))?.originChainId === 42161 && jobOfferFor(facts(row(8453, 5, 0.001), row(1, 5000, 1))) === null,
  )
  check(
    'jobs offers: a chain that did not read, or whose stable is not USDC, never funds an offer',
    jobOfferFor(facts(row(8453, 0, 0, false))) === null && jobOfferFor({ chains: [{ chainId: 8453, ok: true, stable: { symbol: 'USDT', balance: 500 }, nativeEth: 0.01 }] }) === null,
  )
  check(
    'jobs offers: every offer the table can produce is a catalog sentence',
    [facts(row(8453, 20, 0.001)), facts(row(42161, 20, 0.001)), facts(row(10, 20, 0.001)), facts(row(10, 20, 0.01), row(4663, 0, 1))].every((f) => {
      const o = jobOfferFor(f)
      return !!o && JOB_OFFER_SENTENCES.includes(o.ask)
    }),
  )

  // ── What a surface shows ──────────────────────────────────────────────────
  check('jobs offers (view): no wallet -> connect, the example as text', (() => { const v = jobOfferView(null, null); return v.state === 'connect' && v.example === JOB_OFFER_EXAMPLE })())
  check('jobs offers (view): a wallet whose balances are not read yet -> loading (never a sentence)', jobOfferView(WALLET, null).state === 'loading')
  check('jobs offers (view): an empty wallet -> fund, naming the dollars a first job needs', (() => { const v = jobOfferView(WALLET, facts()); return v.state === 'fund' && v.needUsd === withGas && v.note.includes(`$${withGas.toFixed(2)}`) })())
  check('jobs offers (view): a funded wallet -> offer', jobOfferView(WALLET, facts(row(42161, 40, 0.001))).state === 'offer')
  check(
    'jobs offers (view): an origin that did not read and nothing else qualifies -> unread (unknown is never "empty"); a qualifying chain still wins',
    jobOfferView(WALLET, facts(row(8453, 0, 0, false))).state === 'unread' && jobOfferView(WALLET, facts(row(8453, 0, 0, false), row(10, 30, 0.001))).state === 'offer',
  )
  check(
    'jobs offers (view): USDC that cannot sign is named, not called nothing',
    (() => { const v = jobOfferView(WALLET, facts(row(42161, 80, 0))); return v.state === 'fund' && /USDC on Arbitrum but no ETH/.test(v.note) })(),
  )

  // ── Expired is not failed ─────────────────────────────────────────────────
  check(
    'jobs offers: a job that lapsed unsigned reads as expired; a real failure, a done job and a live one do not',
    isExpiredJob({ status: 'failed', failReason: 'expired — sat untouched for 7 days' }) &&
      isExpiredJob({ status: 'failed', failReason: 'Expired: never signed' }) &&
      !isExpiredJob({ status: 'failed', failReason: 'Insufficient USDC on Base: this leg needs $2 but the wallet holds 0.' }) &&
      !isExpiredJob({ status: 'failed', failReason: null }) &&
      !isExpiredJob({ status: 'done', failReason: 'expired' }) &&
      !isExpiredJob({ status: 'waiting_signature', failReason: null }),
  )

  // ── The surfaces use the rule ─────────────────────────────────────────────
  check('jobs offers: the JOBS door\'s example IS the catalog example, and it is still the first-run ask the ladder pins', JOBS_DOOR.ask === JOB_OFFER_EXAMPLE && FIRST_RUN_ASKS[0] === JOB_OFFER_EXAMPLE)
  {
    const rail = code('components/JobsRailTab.tsx')
    check(
      'jobs offers: the JOBS rail offers no fixed sentence: both empty states are JobsEmptyDoor, and JOBS_DOOR.ask is not read there',
      (rail.match(/<JobsEmptyDoor\b/g) ?? []).length === 2 && !/JOBS_DOOR\.ask/.test(rail) && !/<EmptyDoor\b/.test(rail),
    )
    check(
      'jobs offers: the rail shows an expired job in a neutral colour (no red dot, no red bar, no red reason line)',
      /jobDot\(j\.status, expired\)/.test(rail) && /j\.status === 'failed' && !expired && 'yprog--fail'/.test(rail) && /j\.status === 'failed' && !expired && j\.failReason/.test(rail),
    )
  }
  {
    const door = code('components/JobOfferDoor.tsx')
    check(
      'jobs offers: the door\'s ask button exists only in the offer state and sends the offer\'s own sentence; fund is the wallet door; connect is the connect-only door with no redirect',
      (door.match(/kind: 'ask'/g) ?? []).length === 1 &&
        /case 'offer':[\s\S]*?kind: 'ask', label: `\$\{view\.offer\.label\} →`, ask: view\.offer\.ask[\s\S]*?break/.test(door) &&
        /case 'fund':[\s\S]*?kind: 'spine', label: JOBS_DOOR\.fundLabel, href: WALLET_PAGE_HREF/.test(door) &&
        /<CreateAccountButton walletConnectOnly className="door__cta" label=\{JOBS_DOOR\.connectLabel\} \/>/.test(door) &&
        !/JOBS_DOOR\.ask/.test(door),
    )
    check('jobs offers: while loading, or when a chain did not read, the door has no primary action', /case 'unread':[\s\S]*?break/.test(door) && !/case 'unread':[^]*?primary =[^]*?case 'loading'/.test(door) && !/case 'loading':[^]*?primary =[^]*?case 'connect'/.test(door))
  }
  {
    const night = src('components/NightShift.tsx')
    const lit = night.match(/ask: '(Fund Robinhood Chain[^']+)'/)?.[1]
    check('jobs offers: NightShift\'s JOBS tile shows the catalog example, and is a link only through JobTile (the wallet\'s own offer)', lit === JOB_OFFER_EXAMPLE && /x\.job \? \(\s*<JobTile/.test(night) && /view\.state === 'offer'/.test(night), String(lit))
    check('jobs offers: the first-five-minutes page links no fixed job sentence (the example is JobOfferLine text)', !/SpineLink href=\{ask\('[^']*, then /.test(src('app/docs/first-five-minutes/page.tsx')) && /<JobOfferLine example=/.test(src('app/docs/first-five-minutes/page.tsx')))
    check('jobs offers: the dashboard\'s empty jobs panel shows its example through JobOfferLine', /<JobOfferLine example=\{JOBS_DOOR\.ask\} \/>/.test(src('components/JobsPanel.tsx')))
    // AUDIT's two sentences that never built for anyone are gone, and what replaced them compiles.
    const band = /compound: '([^']+)'/.exec(src('lib/markets-copy.ts'))?.[1] ?? ''
    const sdk = /ask: '([^']+)',\n  signer,/.exec(src('components/home/tour/sides/b/snippets.ts'))?.[1] ?? ''
    const all = ['lib/markets-copy.ts', 'components/home/tour/sides/b/snippets.ts', 'app/docs/desk/page.tsx'].map(code).join('\n')
    const okJob = (a: string) => { const c = compileJobAsk(a); return !!c && 'steps' in c && c.steps.length >= 2 }
    check(
      'jobs offers: the landing band\'s compound and the desk SDK example compile as jobs; "Fund Hyperliquid with ..." and the chainless "Buy $50 of ETH, then stake ..." are offered nowhere',
      okJob(band) && okJob(sdk) && src('app/docs/desk/page.tsx').includes(`ask: '${sdk}'`) && !/Fund Hyperliquid with/.test(all) && !/Buy \$50 of ETH, then stake/.test(all),
      JSON.stringify({ band, sdk }),
    )
    const hl = src('lib/splash/sources.ts').match(/hyperliquid: \{\s*message: 'No Hyperliquid account[\s\S]*?\n  \},/)?.[0] ?? ''
    check('jobs offers: the splash\'s no-account Hyperliquid card carries no job chip (a static list cannot know the wallet)', hl.length > 0 && [...hl.matchAll(/prompt: '([^']+)'/g)].every((m) => !/\bthen\b/i.test(m[1])), hl.slice(0, 200))
  }
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /jobs-offers-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  jobsOffersPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

