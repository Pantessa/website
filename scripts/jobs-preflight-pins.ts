// Pins for squad lane1 (the jobs audit, 2026-11-17), lane preflight. Nate: "the
// one it suggested as a default for a new account broke ... I just don't want
// broken suggestions happening anymore." Pure: no server, no chain, no DB
// (every read the pre-flight makes is injected here).
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/jobs-preflight-pins.ts
// OWNED BY THE preflight LANE: only that lane edits this file.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileJobAsk, type CompiledJob } from '../lib/jobs'
import { JOB_EXPIRED_LINE, JOB_FIX_HL_MIN_DEPOSIT_USDC, jobDisplayStatus, jobDisplayTone, jobDisplayWord, jobExpired, jobFailedForReal, shortfallOfRefusal, stepFixFor } from '../lib/job-status'
import { buildableChips, fundingShortAnswer, jobGoalOf, jobLeadNeed, loneBuyOf, preflightJob, preflightLead, type JobPreflightDeps } from '../lib/job-preflight'
import { StepShortError, withheldHoldMs } from '../lib/jobs-runner'
import { HL_MIN_DEPOSIT_USDC } from '../lib/hyperliquid-exec'
import type { BalanceReader } from '../lib/affordability'
import type { FundingOrigin, FundingShortfall } from '../lib/lifi-bridge'
import { buildsNatively } from './ask-ladder'

type Check = (name: string, ok: boolean, extra?: string) => void

const WALLET = '0x00000000000000000000000000000000000000a1'
const FLAGSHIP = 'Fund Robinhood Chain with $12 from Base including gas, then buy $10 of AAPL'
const compiledOf = (ask: string): CompiledJob | null => {
  const c = compileJobAsk(ask)
  return c && !('problem' in c) && !('clarify' in c) ? c : null
}

/** A wallet's balances by `${chainId}:${symbol}` (native = ETH), in token units. */
function readerOf(balances: Record<string, number>, calls?: { n: number }): BalanceReader {
  const USDC: Record<number, string> = { 8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' }
  return {
    async native(chainId) {
      if (calls) calls.n += 1
      return BigInt(Math.round((balances[`${chainId}:ETH`] ?? 0) * 1e9)) * BigInt(1e9)
    },
    async erc20(chainId, token) {
      if (calls) calls.n += 1
      const isUsdc = USDC[chainId] === token.toLowerCase()
      return { balance: BigInt(Math.round((isUsdc ? balances[`${chainId}:USDC`] ?? 0 : 0) * 1e6)), decimals: 6, symbol: 'USDC' }
    },
  }
}

const origin = (chainId: number, word: string, token: string, usd: number, gasEth = 0.01): FundingOrigin => ({ chainId, word, token, usd, gasEth, ...(token === 'ETH' ? { spendable: true } : {}) })
const scanOf = (origins: FundingOrigin[]): FundingShortfall => ({ usdgAtoms: BigInt(0), hasGas: false, origins, gaslessOrigins: [], allScanned: origins, failedOrigins: [] })
const never = async (): Promise<never> => {
  throw new Error('must not be read')
}

export async function jobsPreflightPins(check: Check) {
  check('jobs preflight: the lane\'s pin file is wired into the harness', true)

  // ── 1. An expired job is `expired`, not a red failure ──
  const expiredRow = { status: 'failed', failReason: 'expired — the job sat untouched for 7 days; nothing was signed or spent. Ask again to rebuild it fresh.' }
  const realFail = { status: 'failed', failReason: '"Funds arrive on Robinhood Chain" timed out — unfilled swaps auto-refund to your wallet.' }
  check(
    'job status: a job that aged out unsigned reads `expired` in a muted tone and never counts as a real failure; a real failure keeps the fail tone',
    jobExpired(expiredRow) && jobDisplayStatus(expiredRow) === 'expired' && jobDisplayWord(expiredRow) === 'expired' && jobDisplayTone(expiredRow) === 'var(--muted-2)' && !jobFailedForReal(expiredRow) &&
      !jobExpired(realFail) && jobDisplayStatus(realFail) === 'failed' && jobDisplayWord(realFail) === 'failed' && jobDisplayTone(realFail) === 'var(--fail)' && jobFailedForReal(realFail) &&
      !jobExpired({ status: 'running', failReason: null }) && jobDisplayWord({ status: 'waiting_signature' }) === 'needs your signature' && !jobExpired({ status: 'canceled', failReason: 'expired' }),
  )
  const runnerSrc = readFileSync(join(process.cwd(), 'lib/jobs-runner.ts'), 'utf8')
  const agedReason = runnerSrc.match(/failReason: '(expired[^']*)'/)?.[1] ?? ''
  check(
    'job status: the reason the runner writes when it ages a job out is the one `jobExpired` reads (no schema change: the row stays failed, the reason starts with "expired")',
    agedReason.length > 0 && jobExpired({ status: 'failed', failReason: agedReason }) && !/—|–/.test(JOB_EXPIRED_LINE) && /Nothing was signed or spent/.test(JOB_EXPIRED_LINE),
    agedReason.slice(0, 80),
  )

  // ── 2. A shortfall the builder can name ──
  const PROD = {
    gasLeg: 'Insufficient USDC on Base: this leg needs $2 but the wallet holds 0.',
    valueLeg: 'Insufficient USDC on Base: this leg needs $52 but the wallet holds 31.25.',
    ethLeg: 'Insufficient ETH on Arbitrum: this leg needs $10 plus a gas keep-back but the wallet holds 0.0001.',
    hlNow: 'No free collateral on the Hyperliquid account — deposit first ("deposit 10 usdc to hyperliquid").',
    hlOld: 'No withdrawable collateral on the Hyperliquid account',
    hlDeposit: 'Wallet holds only 0 USDC on Arbitrum — bridge funds there first (cross-chain swap).',
    buy: 'The wallet holds only 1.20 USDG on the chain — not enough to buy $10 of AAPL.',
    gate: 'Nothing to sign yet: this would spend 1 USDC on Base and the wallet holds 0 USDC there. Send USDC to this wallet on Base',
  }
  const sf = (m: string) => shortfallOfRefusal(m)
  check(
    'shortfall words: every real prod failure of this class reads as a shortfall, with the token and chain it names',
    sf(PROD.gasLeg)?.kind === 'funds' && sf(PROD.gasLeg)?.symbol === 'USDC' && sf(PROD.gasLeg)?.chain === 'Base' &&
      sf(PROD.valueLeg)?.chain === 'Base' && sf(PROD.ethLeg)?.symbol === 'ETH' && sf(PROD.ethLeg)?.chain === 'Arbitrum' &&
      sf(PROD.hlNow)?.kind === 'hl-collateral' && sf(PROD.hlOld)?.kind === 'hl-collateral' &&
      sf(PROD.hlDeposit)?.kind === 'funds' && sf(PROD.hlDeposit)?.chain === 'Arbitrum' && sf(PROD.buy)?.symbol === 'USDG' && sf(PROD.gate)?.chain === 'Base',
    JSON.stringify(Object.fromEntries(Object.entries(PROD).map(([k, v]) => [k, sf(v)]))).slice(0, 300),
  )
  check(
    'shortfall words: a guard refusal, a venue miss, a timeout, a policy block and an expiry are NOT shortfalls (they still fail the job)',
    [
      'LiFi has no route for the gas leg from Base right now (no quote at $2, $2.5) — try again shortly.',
      'settlement timeout',
      'the swap was refunded/failed — funds return to your wallet',
      'This account is frozen. Unfreeze it to continue.',
      'SP500 isn\'t a Hyperliquid perp',
      '20 USDC ≥ the 5 USDC bridge minimum.',
      'expired — the job sat untouched for 7 days',
      '',
    ].every((m) => sf(m) === null) && shortfallOfRefusal(null) === null,
  )
  const catchIdx = runnerSrc.indexOf('if (e instanceof StepShortError) {')
  const failIdx = runnerSrc.indexOf('await failJob(fresh.id, `"${step.title}" refused:')
  check(
    'runner (root cause): a builder-named shortfall is WITHHELD, never a failed job — the catch handles StepShortError (back to pending, withheld, the job stays running) ABOVE the line that fails the job, and the funding leg throws it only when its balance check alone said no',
    catchIdx > 0 && failIdx > catchIdx &&
      /withheld: true, withheldKind: 'funds', shortTries: tries/.test(runnerSrc.slice(catchIdx, failIdx)) &&
      /failed\.every\(\(c\) => c\.id === 'balance'\) && !policyBlockOf\(built\.guardrails\)\) throw new StepShortError\(reasons\)/.test(runnerSrc) &&
      new StepShortError('x') instanceof Error && new StepShortError('x').name === 'StepShortError',
    JSON.stringify({ catchIdx, failIdx }),
  )
  check(
    'runner (hold-down): a step short of funds is re-checked every 90s for its first five tries, then every 15 minutes (each re-check is a venue quote); an RPC withhold keeps the short hold',
    withheldHoldMs({ withheld: true }) === 90_000 && withheldHoldMs({ withheld: true, shortTries: 5 }) === 90_000 && withheldHoldMs({ withheld: true, shortTries: 6 }) === 15 * 60_000 &&
      withheldHoldMs({ withheld: true, withheldKind: 'rpc', shortTries: 99 }) === 90_000 && withheldHoldMs(null) === 90_000,
  )

  // ── 3. The fix as a chip ──
  const flagshipSteps = [
    { seq: 0, kind: 'sign', status: 'failed', builder: 'native-lifi-fund', params: { leg: 'gas', usd: 2, origin: 8453, token: 'USDC' }, result: { error: PROD.gasLeg } },
    { seq: 1, kind: 'sign', status: 'pending', builder: 'native-lifi-fund', params: { leg: 'usdg', usd: 10, origin: 8453, token: 'USDC' } },
    { seq: 2, kind: 'wait', status: 'pending', builder: 'wait', params: {} },
    { seq: 3, kind: 'sign', status: 'pending', builder: 'native-lifi-swap', params: { buyUsd: 10, buyToken: 'AAPL' } },
  ]
  const fixFlag = stepFixFor({ status: 'failed', failReason: `"Bridge ~$2 of gas ETH → Robinhood Chain (from Base)" refused: ${PROD.gasLeg}`, steps: flagshipSteps })
  const fixHl = stepFixFor({ status: 'failed', failReason: 'x', steps: [{ seq: 0, kind: 'sign', status: 'failed', builder: 'native-hl-exec', params: { kind: 'open', coin: 'HYPE', isBuy: true, notionalUsd: 12, leverage: 2 }, result: { error: PROD.hlOld } }] })
  const fixDep = stepFixFor({ status: 'running', steps: [{ seq: 0, kind: 'sign', status: 'pending', builder: 'native-hl-exec', params: { kind: 'deposit', amountUsdc: 13 }, result: { error: PROD.hlDeposit, withheld: true, withheldKind: 'funds' } }] })
  const allFixChips = [...(fixFlag?.chips ?? []), ...(fixHl?.chips ?? []), ...(fixDep?.chips ?? [])]
  check(
    'fix chips: the prod screenshot\'s failed step offers "Buy $10 of AAPL" (asked alone, the chat plans it from where this wallet\'s money is) and a retry; a Hyperliquid open short of collateral offers the deposit sized to it ($6 for 2x $12); a withheld deposit offers the deposit and no retry (the job is still live)',
    fixFlag?.seq === 0 && fixFlag.retry === true && fixFlag.chips[0]?.resume === 'Buy $10 of AAPL' &&
      fixHl?.chips[0]?.resume === 'deposit 6 USDC to Hyperliquid' && fixHl.shortfall.kind === 'hl-collateral' &&
      fixDep?.chips[0]?.resume === 'deposit 13 USDC to Hyperliquid' && fixDep.retry === false,
    JSON.stringify({ fixFlag, fixHl, fixDep }).slice(0, 400),
  )
  check(
    'fix chips: every chip is an ask the ladder builds, none is the sentence that failed, and none is a recurring buy',
    allFixChips.length === 3 && allFixChips.every((c) => buildsNatively(c.resume) && !/\bevery\b|\bweekly\b|\bdaily\b/i.test(c.resume) && !/^fund /i.test(c.resume)),
    JSON.stringify(allFixChips.map((c) => [c.resume, buildsNatively(c.resume)])),
  )
  check(
    'fix chips: no fix on an expired job, a job that failed for another reason, an RPC withhold, or a healthy job; the Hyperliquid floor matches the layer\'s own',
    stepFixFor({ ...expiredRow, steps: flagshipSteps }) === null &&
      stepFixFor({ status: 'failed', failReason: 'x', steps: [{ seq: 0, kind: 'wait', status: 'failed', builder: 'wait', result: { error: 'settlement timeout' } }] }) === null &&
      stepFixFor({ status: 'running', steps: [{ seq: 0, kind: 'sign', status: 'pending', builder: 'native-lifi-fund', result: { error: 'rpc.example didn\'t answer', withheld: true, withheldKind: 'rpc' } }] }) === null &&
      stepFixFor({ status: 'waiting_signature', steps: [{ seq: 0, kind: 'sign', status: 'offered', builder: 'native-swap' }] }) === null &&
      JOB_FIX_HL_MIN_DEPOSIT_USDC === HL_MIN_DEPOSIT_USDC,
  )
  const cardSrc = readFileSync(join(process.cwd(), 'components/JobCard.tsx'), 'utf8')
  check(
    'card: an expired job wears the muted pill and the expired line, never the fail bar; a sign button renders only on a live job; a fix chip PREFILLS the composer (never sends) and the retry re-arms the step',
    /const expired = jobExpired\(job\)/.test(cardSrc) && /expired\s*\?\s*JOB_EXPIRED_LINE/.test(cardSrc) && /job\.status === 'failed' && !expired \? 'yprog--fail'/.test(cardSrc) &&
      /const signable = step\.status === 'offered' && live/.test(cardSrc) &&
      /const sendFix = \(resume: string\) => \(onFix \? onFix\(resume\) : setComposerPrefill\(resume\)\)/.test(cardSrc) && /data-job-fix=/.test(cardSrc) && /onClick=\{\(\) => void retry\(\)\}/.test(cardSrc) &&
      /onFix=\{prefill\}/.test(readFileSync(join(process.cwd(), 'components/JobDetailOverlay.tsx'), 'utf8')),
  )

  // ── 4. What the first step spends ──
  const flagship = compiledOf(FLAGSHIP)
  const needFlag = flagship ? jobLeadNeed(flagship) : null
  const needEth = jobLeadNeed(compiledOf('Fund robinhood chain with $12 from arbitrum using eth including gas, then buy $10 of AAPL') ?? { title: '', steps: [] })
  const needDep = jobLeadNeed(compiledOf('deposit 13 usdc to hyperliquid, then long $12 of HYPE on hyperliquid') ?? { title: '', steps: [] })
  const needOpen = jobLeadNeed(compiledOf('2x long $12 of HYPE on hyperliquid, then protect my HYPE long with a 5% stop') ?? { title: '', steps: [] })
  const needSwap = jobLeadNeed(compiledOf('swap 1 USDC for ETH on base, then swap 3 USDC for ETH on base') ?? { title: '', steps: [] })
  const needXc = jobLeadNeed(compiledOf('swap 5 USDC from base to USDC on arbitrum, then deposit 5 usdc to hyperliquid') ?? { title: '', steps: [] })
  check(
    'lead need: the flagship job needs $12 of USDC on Base for its first step (the $2 gas leg and the $10 value leg leave one balance), an ETH-funded one needs $12 of ETH on Arbitrum, a deposit needs its USDC on Arbitrum, an open needs Hyperliquid collateral, a swap and a bridge need what they sell where they sell it',
    !!flagship && needFlag?.kind === 'token' && needFlag.chainId === 8453 && needFlag.symbol === 'USDC' && needFlag.amount === 12 && needFlag.funding?.gasIncluded === true && needFlag.funding.destChainId === 4663 && needFlag.funding.usd === 12 &&
      needEth?.kind === 'eth-usd' && needEth.chainId === 42161 && needEth.usd === 12 &&
      needDep?.kind === 'token' && needDep.chainId === 42161 && needDep.symbol === 'USDC' && needDep.amount === 13 &&
      needOpen?.kind === 'hl-open' && needOpen.intent.coin === 'HYPE' &&
      needSwap?.kind === 'token' && needSwap.chainId === 8453 && needSwap.symbol.toUpperCase() === 'USDC' && needSwap.amount === 1 &&
      needXc?.kind === 'token' && needXc.chainId === 8453 && needXc.amount === 5,
    JSON.stringify({ needFlag, needEth, needDep, needOpen: needOpen?.kind, needSwap, needXc }).slice(0, 500),
  )
  check(
    'lead need: a job that opens on a step this file cannot size (a wait, a stake, a supply) is not checked here; the runner\'s own gate stands',
    jobLeadNeed({ title: 't', steps: [{ kind: 'wait', builder: 'wait', title: 'w', params: {} }] }) === null &&
      jobLeadNeed({ title: 't', steps: [{ kind: 'sign', builder: 'native-lido', title: 's', params: { amount: '0.05' } }] }) === null &&
      jobLeadNeed({ title: 't', steps: [{ kind: 'sign', builder: 'native-aave-supply', title: 's', params: { token: 'USDC', amount: '5' } }] }) === null &&
      jobLeadNeed({ title: 't', steps: [] }) === null,
  )
  check(
    'goal: the part after the funding legs is the job\'s goal ("buy $10 of AAPL"), in the house phrasing a chip can resume; a funding-only ask and a job that does not open on funding have none',
    jobGoalOf(FLAGSHIP) === 'buy $10 of AAPL' && loneBuyOf(jobGoalOf(FLAGSHIP))?.resume === 'Buy $10 of AAPL' &&
      jobGoalOf('Fund robinhood chain with $7 from ethereum including gas') === '' && jobGoalOf('swap 1 USDC for ETH on base, then swap 3 USDC for ETH on base') === '' &&
      loneBuyOf('buy $10 of AAPL, then stake it') === null && loneBuyOf('') === null,
    JSON.stringify({ goal: jobGoalOf(FLAGSHIP) }),
  )

  // ── 5. The pre-flight itself (every read injected) ──
  if (!flagship) {
    check('pre-flight: the flagship sentence compiles', false)
    return
  }
  const fakeCard: JobPreflightDeps['cardChip'] = (p) => ({ label: `Add $${Math.ceil(p.needUsd) + 8} with card or bank → ${p.actionLabel}`, resume: p.resume, fund: { presetFiatUsd: Math.ceil(p.needUsd) + 8, asset: 'ETH', network: 'ethereum' } })

  // (a) empty everywhere → no job, the shortfall named, the card door.
  const empty = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({}), scanFunding: async () => scanOf([]), cardChip: fakeCard } })
  check(
    'pre-flight (empty wallet): the prod screenshot\'s job is refused before it exists — "its first step spends 12 USDC on Base, and this wallet holds 0 USDC there" — and the answer carries the card door whose resume is the buy asked alone',
    empty.kind === 'short' && /No job was created/.test(empty.reply) && /spends 12 USDC on Base, and this wallet holds 0 USDC there/.test(empty.reply) && /Nothing was built or signed/.test(empty.reply) &&
      empty.short.chainId === 8453 && empty.short.symbol === 'USDC' && empty.short.needs === '12' && empty.short.held === '0' &&
      empty.clarify?.options[0]?.fund?.network === 'ethereum' && empty.clarify.options[0].resume === 'Buy $10 of AAPL' && /^Never mind/.test(empty.clarify.options[1]?.resume ?? ''),
    JSON.stringify(empty).slice(0, 500),
  )
  // (a2) empty, card door closed → still a named next step in words, no dead chip.
  const emptyNoCard = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({}), scanFunding: async () => scanOf([]), cardChip: () => null } })
  check(
    'pre-flight (empty wallet, card door closed): no job — the reply says what to send and where, and the only chip is the ask itself to press once the funds are there (the turn re-reads the wallet)',
    emptyNoCard.kind === 'short' && emptyNoCard.clarify?.options[0]?.label === 'I sent funds, check again' && emptyNoCard.clarify.options[0].resume === FLAGSHIP && !emptyNoCard.clarify.options[0].fund && /Send USDC to this wallet on Base \(or USDC or ETH on /.test(emptyNoCard.reply),
    JSON.stringify(emptyNoCard).slice(0, 300),
  )
  // (b) nothing on Base, $40 of USDC on Arbitrum → the same job from Arbitrum.
  const elsewhere = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({ '42161:USDC': 40 }), scanFunding: async () => scanOf([origin(42161, 'Arbitrum', 'USDC', 40)]), cardChip: never as unknown as JobPreflightDeps['cardChip'] } })
  const elseChip = elsewhere.kind === 'short' ? elsewhere.clarify?.options[0] : undefined
  const elseCompiled = elseChip ? compiledOf(elseChip.resume) : null
  const elseNeed = elseCompiled ? jobLeadNeed(elseCompiled) : null
  check(
    'pre-flight (funded on another chain): no job, and the chip is the SAME job from where the money is — "Fund robinhood chain with $12 from arbitrum including gas, then buy $10 of AAPL" — which compiles to a job whose first step spends on Arbitrum',
    elsewhere.kind === 'short' && /~\$40 of USDC on Arbitrum/.test(elsewhere.reply) && elseChip?.resume === 'Fund robinhood chain with $12 from arbitrum including gas, then buy $10 of AAPL' && !elseChip.fund &&
      elseNeed?.kind === 'token' && elseNeed.chainId === 42161 && elseNeed.amount === 12 && buildsNatively(elseChip.resume),
    JSON.stringify(elsewhere).slice(0, 500),
  )
  // …and that chip's job passes the same pre-flight for the same wallet.
  const elseAgain = elseCompiled ? await preflightJob({ wallet: WALLET, compiled: elseCompiled, ask: elseChip!.resume, deps: { reader: readerOf({ '42161:USDC': 40, '42161:ETH': 0.01 }), scanFunding: never } }) : null
  check('pre-flight (funded on another chain): the offered chip is not a second dead end — its job passes the pre-flight for that wallet with no scan', elseAgain?.kind === 'ok')

  // (c) funded where the job says → ok after exactly ONE balance read, no scan.
  const calls = { n: 0 }
  const funded = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({ '8453:USDC': 12, '8453:ETH': 0.01 }, calls), scanFunding: never, offerPlan: never as unknown as JobPreflightDeps['offerPlan'] } })
  const noGas = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({ '8453:USDC': 50 }), scanFunding: async () => ({ ...scanOf([]), gaslessOrigins: [origin(8453, 'Base', 'USDC', 50, 0)] }), cardChip: () => null } })
  const justShort = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({ '8453:USDC': 11.99 }), scanFunding: async () => scanOf([origin(8453, 'Base', 'USDC', 11)]), cardChip: () => null } })
  check(
    'pre-flight (funded wallet): a wallet holding the $12 on Base gets its job after one token read and one gas read (made together) and no wallet scan; $11.99 is short (the "$52 needed, holds 31.25" class); the token with NO gas on the chain is short too',
    funded.kind === 'ok' && calls.n === 2 && noGas.kind === 'short' && noGas.short.gas === true && /holds no ETH there to pay for gas/.test(noGas.reply) && justShort.kind === 'short' && justShort.short.held === '11.99',
    JSON.stringify({ funded, calls, justShort: justShort.kind }),
  )
  // (d) fail open: a read that throws or hangs creates the job as before.
  const thrown = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: { native: never, erc20: never }, scanFunding: never } })
  const hung = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: { native: () => new Promise(() => {}), erc20: () => new Promise(() => {}) }, timeoutMs: 30 } })
  const noPrice = await preflightJob({ wallet: WALLET, compiled: compiledOf('Fund robinhood chain with $12 from arbitrum using eth including gas, then buy $10 of AAPL')!, ask: 'x', deps: { reader: readerOf({}), ethUsd: async () => null } })
  check(
    'pre-flight (fail open): an unreadable balance, a balance read that hangs, or an unpriceable ETH leg is `unknown` — the job is created exactly as before and the runner\'s gate stands behind it',
    thrown.kind === 'unknown' && hung.kind === 'unknown' && /timed out/.test(hung.reason) && noPrice.kind === 'unknown',
    JSON.stringify({ thrown, hung, noPrice }),
  )
  // (e) the scan itself failing still refuses (the balance WAS read) with the buy as the chip.
  const scanDown = await preflightJob({ wallet: WALLET, compiled: flagship, ask: FLAGSHIP, deps: { reader: readerOf({}), scanFunding: never } })
  check(
    'pre-flight (scan down): the shortfall was read, so no job — and the chip is the buy asked alone, which re-reads the wallet on its own turn',
    scanDown.kind === 'short' && scanDown.clarify?.options[0]?.resume === 'Buy $10 of AAPL',
    JSON.stringify(scanDown).slice(0, 300),
  )
  // (f) Hyperliquid deposit lead short on Arbitrum → the funding layer's plan, verified.
  const depJob = compiledOf('deposit 13 usdc to hyperliquid, then long $12 of HYPE on hyperliquid')!
  const depAsk = 'deposit 13 usdc to hyperliquid, then long $12 of HYPE on hyperliquid'
  const depPlan = await preflightJob({
    wallet: WALLET,
    compiled: depJob,
    ask: depAsk,
    deps: {
      reader: readerOf({ '8453:USDC': 50 }),
      offerPlan: (async (p: { need: { followupResume: string; amountHuman: number; chainId: number } }) => ({
        reply: '🌉 **We can make this happen.** You hold ~$50 of USDC on Base.',
        clarify: { question: 'q', options: [{ label: 'Move from Base', resume: `Swap 14.5 USDC from Base to USDC on Arbitrum, then ${p.need.followupResume}` }, { label: 'A chip that does not build', resume: 'frobnicate the quux' }] },
        buildPath: 'native-funding-offer',
      })) as unknown as JobPreflightDeps['offerPlan'],
    },
  })
  const depNothing = await preflightJob({
    wallet: WALLET,
    compiled: depJob,
    ask: depAsk,
    deps: { reader: readerOf({}), offerPlan: (async () => ({ insufficient: 'I checked Base, Arbitrum, Optimism and Ethereum and found no ETH or USDC.', needUsd: 15.3, gasUsd: 1, chainsRead: 'Base, Arbitrum, Optimism and Ethereum', empty: true, strandedCovers: false })) as unknown as JobPreflightDeps['offerPlan'], cardChip: fakeCard },
  })
  check(
    'pre-flight (Hyperliquid deposit, prod: "holds only 0 USDC on Arbitrum"): no job; with money on Base the chip leads the same job with the move (a chip the ladder cannot build is dropped), and with nothing anywhere the card door carries the ask itself',
    depPlan.kind === 'short' && /spends 13 USDC on Arbitrum, and this wallet holds 0 USDC there/.test(depPlan.reply) && depPlan.clarify?.options.length === 2 &&
      depPlan.clarify.options[0].resume === `Swap 14.5 USDC from Base to USDC on Arbitrum, then ${depAsk}` && /^Never mind/.test(depPlan.clarify.options[1].resume) &&
      depNothing.kind === 'short' && depNothing.clarify?.options[0]?.fund?.asset === 'ETH' && depNothing.clarify.options[0].resume === depAsk,
    JSON.stringify({ depPlan, depNothing }).slice(0, 600),
  )
  // (g) Hyperliquid open lead with no collateral (prod: "No withdrawable collateral").
  const openAsk = '2x long $12 of HYPE on hyperliquid, then protect my HYPE long with a 5% stop'
  const openJob = compiledOf(openAsk)!
  const hlShort = { depositUsdc: 6, withdrawableUsd: 0, notionalUsd: 12 }
  const openArb = await preflightJob({ wallet: WALLET, compiled: openJob, ask: openAsk, deps: { hlShortfall: async () => hlShort, arbUsdc: async () => 20, offerPlan: never as unknown as JobPreflightDeps['offerPlan'] } })
  const openFunded = await preflightJob({ wallet: WALLET, compiled: openJob, ask: openAsk, deps: { hlShortfall: async () => null } })
  const openChecked = await preflightJob({ wallet: WALLET, compiled: openJob, ask: openAsk, hlOpenChecked: true, deps: { hlShortfall: never } })
  check(
    'pre-flight (Hyperliquid open, prod: "No withdrawable collateral"): an account with nothing behind the order gets no job; when Arbitrum covers the deposit the chip is the same ask led by the deposit; a funded account passes; the chat route (which compiles the funded job itself) is not checked twice',
    openArb.kind === 'short' && openArb.short.hlCollateral === true && /needs about \$6 of collateral on Hyperliquid, and the account has \$0\.00 free/.test(openArb.reply) &&
      openArb.clarify?.options[0]?.resume === `deposit 6 USDC to Hyperliquid, then ${openAsk}` && buildsNatively(openArb.clarify.options[0].resume) &&
      openFunded.kind === 'ok' && openChecked.kind === 'no-check',
    JSON.stringify({ openArb, openFunded, openChecked }).slice(0, 500),
  )

  // ── 6. Copy + wiring ──
  const gasStranded = fundingShortAnswer({
    facts: { chainId: 8453, chain: 'Base', symbol: 'USDC', needs: '12', held: '0' },
    funding: { destChainId: 4663, originChainId: 8453, token: 'USDC', usd: 12, gasIncluded: true },
    goal: 'buy $10 of AAPL',
    advice: { kind: 'gas-stranded', stranded: origin(42161, 'Arbitrum', 'USDC', 30, 0), donor: null, chips: null, copy: 'you\'re holding ~$30 of USDC on **Arbitrum** but the wallet has no ETH there.' },
    scan: scanOf([]),
    cardChip: null,
  })
  const newCopy = [empty, emptyNoCard, elsewhere, scanDown, depNothing, openArb].map((r) => (r.kind === 'short' ? r.reply : '')).join(' ') + preflightLead({ chainId: 1, chain: 'Ethereum', symbol: 'ETH', needs: '12', held: '0.001', needsAreUsd: true })
  check(
    'copy: money that exists but cannot move is named; the lane\'s own sentences carry no em dash; a dollars-of-ETH need prints as dollars',
    /holding ~\$30 of USDC on \*\*Arbitrum\*\*/.test(gasStranded.reply) && !/—|–/.test(newCopy) && /spends \$12 of ETH on Ethereum, and this wallet holds 0\.001 ETH there/.test(newCopy),
    newCopy.match(/.{0,30}[—–].{0,30}/)?.[0] ?? '',
  )
  check(
    'chips: a chip the ladder does not build is never offered; the decline chip always survives',
    buildableChips([{ label: 'a', resume: 'frobnicate the quux' }, { label: 'b', resume: 'Buy $10 of AAPL' }, { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }]).map((c) => c.label).join() === 'b,Not now',
  )
  const chatSrc = readFileSync(join(process.cwd(), 'app/api/chat/route.ts'), 'utf8')
  const apiSrc = readFileSync(join(process.cwd(), 'app/api/jobs/route.ts'), 'utf8')
  const chatPre = chatSrc.indexOf('const jobPre = await preflightJob({ wallet: walletAddress, compiled: jobAsk, ask: message, hlOpenChecked: true')
  const chatCreate = chatSrc.indexOf("const job = await createJob(walletAddress, stampSwapFeeTier(jobAsk, swapFeeBps")
  const apiPre = apiSrc.indexOf('const pre = await preflightJob({ wallet: addr, compiled, ask })')
  const apiCreate = apiSrc.indexOf('const job = await createJob(addr, compiled')
  check(
    'wiring: both doors run the pre-flight ABOVE their createJob and return before it on a short verdict (chat: the affordability-short path with chips; the jobs API: 400 with `created: false`, and its dry run reports the same verdict)',
    chatPre > 0 && chatCreate > chatPre && /if \(jobPre\.kind === 'short'\) \{\s*return NextResponse\.json\(\{/.test(chatSrc.slice(chatPre, chatCreate)) && /buildPath: AFFORDABILITY_SHORT_PATH/.test(chatSrc.slice(chatPre, chatCreate)) &&
      apiPre > 0 && apiCreate > apiPre && /created: false/.test(apiSrc.slice(apiPre, apiCreate)) && /status: 400/.test(apiSrc.slice(apiPre, apiCreate)) && /preflight: \{ short: short\.short/.test(apiSrc),
    JSON.stringify({ chatPre, chatCreate, apiPre, apiCreate }),
  )
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /jobs-preflight-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  void Promise.resolve(
    jobsPreflightPins((name, ok, extra) => {
      if (ok) pass += 1
      else fail += 1
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? `\n     ${extra}` : ''}`)
    }),
  ).then(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
}
