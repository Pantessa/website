// ─────────────────────────────────────────────────────────────────────────
//  DCA — the I/O half: schedule store + the chat turn. Guardian/jobs
//  discipline throughout: originEnv fence on every query (shared Neon DB),
//  atomic per-period claims (the @@unique row, then an atomic jobId attach),
//  and NOTHING pre-built — each due period compiles a one-step job whose
//  native-swap artifact is built fresh at offer time by lib/swap-exec.ts,
//  deadline watch and refresh recipe included. Confirm-mode only: the user
//  signs every buy; missed periods lapse (no catch-up spends).
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { advanceJob, cancelJob, createJob, jobsEnv } from '@/lib/jobs-runner'
import { signJobToken } from '@/lib/job-token'
import { APP_CHAINS, chainById, DEFAULT_CHAIN_ID, primaryStable } from '@/lib/chains'
import { ensureTokenList } from '@/lib/token-list'
import { resolveToken } from '@/lib/cow'
import { pairStockToken, stockChipLabel } from '@/lib/stock-pairing'
import { ROBINHOOD_CHAIN_ID } from '@/lib/lifi-bridge'
import type { ClarifyRequest } from '@/lib/clarify'
import {
  cadenceLabel,
  compileDcaBuy,
  dcaRunChip,
  parseDcaCreate,
  parseDcaManage,
  parseDcaRun,
  periodKeyFor,
  periodPhrase,
  type DcaCadence,
} from '@/lib/dca'

type Trace = (event: unknown) => void

/** Job statuses that mean "this period's buy is prepared / in flight". */
const LIVE_JOB = ['running', 'waiting_signature', 'waiting_settlement', 'paused']

export interface DcaScheduleView {
  id: string
  status: string
  cadence: DcaCadence
  buyUsd: number
  buyToken: string
  sellToken: string
  chainId: number
  chainName: string
  /** Current UTC period: 'due' | 'live' (offered, unsigned) | 'bought'. */
  period: 'due' | 'live' | 'bought'
  liveJobId: string | null
  /** 'confirm' (you sign every buy) | 'auto' (armed — autopilot executes). */
  mode: string
  /** Last sweep failure on an armed schedule — the ONLY needs-you signal. */
  autoError: string | null
  /** The armed schedule's latest auto-run receipt line, if any. */
  lastAutoRun: { periodKey: string; status: string; detail: string | null } | null
}

/** A schedule's derived current-period state, env-fenced. */
export async function listDcaSchedules(wallet: string): Promise<DcaScheduleView[]> {
  const schedules = await prisma.dcaSchedule.findMany({
    where: { wallet: wallet.toLowerCase(), originEnv: jobsEnv(), status: { in: ['active', 'paused'] } },
    orderBy: { createdAt: 'asc' },
  })
  if (schedules.length === 0) return []
  const keys = schedules.map((s) => ({ scheduleId: s.id, periodKey: periodKeyFor(s.cadence as DcaCadence) }))
  const runs = await prisma.dcaRun.findMany({
    where: { OR: keys.map((k) => ({ scheduleId: k.scheduleId, periodKey: k.periodKey })) },
  })
  const jobIds = runs.map((r) => r.jobId).filter((j): j is string => !!j)
  const jobs = jobIds.length
    ? await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, status: true } })
    : []
  const jobStatus = new Map(jobs.map((j) => [j.id, j.status]))
  // Armed schedules' latest receipts (one query, newest per schedule in JS —
  // the sets are tiny). An auto-BOUGHT current period counts as 'bought'.
  const armedIds = schedules.filter((s) => s.mode === 'auto').map((s) => s.id)
  const autoRuns = armedIds.length
    ? await prisma.dcaAutoRun.findMany({
        where: { scheduleId: { in: armedIds } },
        orderBy: { createdAt: 'desc' },
        select: { scheduleId: true, periodKey: true, status: true, detail: true },
      })
    : []
  return schedules.map((s) => {
    const run = runs.find((r) => r.scheduleId === s.id)
    const st = run?.jobId ? jobStatus.get(run.jobId) : undefined
    const latestAuto = autoRuns.find((r) => r.scheduleId === s.id) ?? null
    const autoBoughtNow = latestAuto?.status === 'bought' && latestAuto.periodKey === periodKeyFor(s.cadence as DcaCadence)
    const period: DcaScheduleView['period'] = st === 'done' || autoBoughtNow ? 'bought' : st && LIVE_JOB.includes(st) ? 'live' : 'due'
    return {
      id: s.id,
      status: s.status,
      cadence: s.cadence as DcaCadence,
      buyUsd: s.buyUsd,
      buyToken: s.buyToken,
      sellToken: s.sellToken,
      chainId: s.chainId,
      chainName: chainById(s.chainId)?.name ?? `chain ${s.chainId}`,
      period,
      liveJobId: st && LIVE_JOB.includes(st) ? run!.jobId : null,
      mode: s.mode,
      autoError: s.autoError,
      lastAutoRun: latestAuto ? { periodKey: latestAuto.periodKey, status: latestAuto.status, detail: latestAuto.detail } : null,
    }
  })
}

type ClaimResult =
  | { state: 'bought' }
  | { state: 'live'; jobId: string }
  | { state: 'offered'; jobId: string }

/** Claim the current period and produce its one-step job. The unique
 *  (scheduleId, periodKey) row is the idempotency claim; the jobId attach is
 *  atomic (updateMany with the expected prior value), so overlapping taps
 *  converge on ONE job — the loser cancels its own. A period whose job
 *  failed or was canceled is reclaimable (an unsigned failure must not eat
 *  the period). */
async function claimDcaRun(
  schedule: { id: string; wallet: string; buyUsd: number; buyToken: string; sellToken: string; chainId: number; cadence: DcaCadence },
  periodKey: string,
): Promise<ClaimResult> {
  const where = { scheduleId_periodKey: { scheduleId: schedule.id, periodKey } }
  let existing = await prisma.dcaRun.findUnique({ where })
  if (existing?.jobId) {
    const job = await prisma.job.findUnique({ where: { id: existing.jobId }, select: { status: true } })
    if (job?.status === 'done') return { state: 'bought' }
    if (job && LIVE_JOB.includes(job.status)) return { state: 'live', jobId: existing.jobId }
    // failed / canceled / vanished → fall through and re-claim the period
  }
  if (!existing) {
    try {
      existing = await prisma.dcaRun.create({
        data: { scheduleId: schedule.id, wallet: schedule.wallet, periodKey, jobId: null },
      })
    } catch {
      // Unique-constraint loss: another turn claimed first — defer to it.
      existing = await prisma.dcaRun.findUnique({ where })
      if (existing?.jobId) {
        const job = await prisma.job.findUnique({ where: { id: existing.jobId }, select: { status: true } })
        if (job?.status === 'done') return { state: 'bought' }
        if (job && LIVE_JOB.includes(job.status)) return { state: 'live', jobId: existing.jobId }
      }
      if (!existing) throw new Error('period claim failed')
    }
  }
  const job = await createJob(schedule.wallet, compileDcaBuy(schedule), `dca:${schedule.id}`)
  const attach = await prisma.dcaRun.updateMany({
    where: { scheduleId: schedule.id, periodKey, jobId: existing.jobId ?? null },
    data: { jobId: job.id },
  })
  if (attach.count !== 1) {
    // Lost the attach race — another turn's job owns the period; cancel ours.
    await prisma.job.update({ where: { id: job.id }, data: { status: 'canceled' } }).catch(() => {})
    const theirs = await prisma.dcaRun.findUnique({ where })
    if (theirs?.jobId) return { state: 'live', jobId: theirs.jobId }
    throw new Error('period claim failed')
  }
  await advanceJob(job).catch(() => {}) // kick the first (only) build inline
  return { state: 'offered', jobId: job.id }
}

/** Resolve the schedule's chain: message chain word > the session picker
 *  (when the token resolves there) > the first first-class chain whose
 *  official token list carries the symbol (Base first). Deterministic, and a
 *  schedule must never guess: unresolvable → null (honest refusal). */
async function resolveDcaChain(buyToken: string, namedChainId: number | null, selectedChainId?: number | null): Promise<number | null> {
  if (namedChainId) return namedChainId
  const resolvesOn = async (chainId: number) => {
    await ensureTokenList(chainId).catch(() => {})
    return !!resolveToken(buyToken, chainId)
  }
  if (selectedChainId && (await resolvesOn(selectedChainId))) return selectedChainId
  const ordered = [DEFAULT_CHAIN_ID, ...APP_CHAINS.map((c) => c.id).filter((id) => id !== DEFAULT_CHAIN_ID)]
  for (const id of ordered) {
    if (id === selectedChainId) continue
    if (await resolvesOn(id)) return id
  }
  return null
}

export interface DcaTurn {
  reply: string
  jobId?: string
  jobToken?: string
  clarify?: ClarifyRequest
  buildPath?: string
  dcaScheduleId?: string
  /** The autopilot arm offer (one signTypedData card) — lib/dca-auto-exec. */
  dcaArm?: import('@/lib/dca-auto-exec').DcaArmOffer
}

const nextPeriodWord: Record<DcaCadence, string> = { day: 'tomorrow', week: 'next week', month: 'next month' }

/**
 * The DCA layer's whole chat turn: create ("buy $10 of AAPL every week"),
 * run (the due-period chip's resume string), and manage (pause/resume/
 * cancel/list). Returns null when the message isn't DCA-shaped — the rest
 * of the route proceeds untouched.
 */
export async function runDcaTurn(
  message: string,
  wallet: string | undefined,
  selectedChainId: number | null | undefined,
  trace: Trace,
): Promise<DcaTurn | null> {
  // ── Autopilot toggles FIRST — "turn off my dca autopilot" must never read
  //    as the manage grammar's cancel. Lazy import keeps the module graph
  //    acyclic at runtime (dca-auto-exec type-imports DcaTurn from here). ──
  const { runDcaAutoToggleTurn } = await import('@/lib/dca-auto-exec')
  const auto = await runDcaAutoToggleTurn(message, wallet, trace)
  if (auto) return auto

  // ── The due-period chip's resume — one tap → this period's guarded buy ──
  const run = parseDcaRun(message)
  if (run) {
    trace({ type: 'status', label: `dca layer claimed the turn: run schedule ${run.scheduleId.slice(0, 8)} — planner bypassed` })
    if (!wallet) return { reply: '📆 Connect your wallet first — a recurring buy signs from YOUR wallet.' }
    const s = await prisma.dcaSchedule.findUnique({ where: { id: run.scheduleId } })
    if (!s || s.wallet !== wallet.toLowerCase() || s.originEnv !== jobsEnv()) {
      return { reply: "📆 I can't find that recurring buy on this wallet — say “list my dcas” to see what's active." }
    }
    if (s.status === 'canceled') return { reply: `📆 That ${s.buyToken} recurring buy was canceled — say “buy $${s.buyUsd} of ${s.buyToken} ${cadenceLabel(s.cadence as DcaCadence)}” to start a new one.` }
    if (s.status === 'paused') return { reply: `📆 Your ${s.buyToken} recurring buy is paused — say “resume my ${s.buyToken} dca” first.` }
    const cadence = s.cadence as DcaCadence
    const periodKey = periodKeyFor(cadence)
    const claim = await claimDcaRun({ ...s, cadence }, periodKey)
    if (claim.state === 'bought') {
      return { reply: `📆 ${periodPhrase(cadence)[0].toUpperCase()}${periodPhrase(cadence).slice(1)} $${s.buyUsd} of ${s.buyToken} is already bought — the next one unlocks ${nextPeriodWord[cadence]}. No double buys, ever.`, buildPath: 'native-dca' }
    }
    const reply =
      claim.state === 'live'
        ? `📆 ${periodPhrase(cadence)[0].toUpperCase()}${periodPhrase(cadence).slice(1)} buy is already prepared — sign it below.`
        : `📆 **${periodPhrase(cadence)[0].toUpperCase()}${periodPhrase(cadence).slice(1)} buy:** $${s.buyUsd} of ${s.buyToken}. Built fresh just now — live quote, guard-checked — sign it below.`
    trace({ type: 'status', label: `dca layer: period ${periodKey} ${claim.state} (job ${claim.jobId.slice(0, 8)})` })
    return { reply, jobId: claim.jobId, jobToken: signJobToken(claim.jobId), buildPath: 'native-dca', dcaScheduleId: s.id }
  }

  // ── Create: "buy $10 of AAPL every week" ────────────────────────────────
  const create = parseDcaCreate(message)
  if (create && 'problem' in create) {
    trace({ type: 'status', label: 'dca layer: recurring ask under-specified — asking for a dollar amount' })
    return { reply: `📆 ${create.problem}` }
  }
  if (create) {
    trace({ type: 'status', label: `dca layer claimed the turn: $${create.buyUsd} of ${create.buyToken} ${cadenceLabel(create.cadence)} — planner bypassed` })
    if (!wallet) return { reply: `📆 That's a recurring buy — connect your wallet first and I'll set up $${create.buyUsd} of ${create.buyToken} ${cadenceLabel(create.cadence)}, one signature per buy.` }
    let chainId = await resolveDcaChain(create.buyToken, create.chainId, selectedChainId)
    // ── Stock pairing ── a schedule is the WORST place for a typo'd ticker:
    // it would fail every period's build. An explicitly-Robinhood ask (the
    // named-chain shortcut above skips resolution checks!) or a token that
    // resolves nowhere pairs against 4663's stock list — obvious names
    // rewrite ("google weekly" → GOOGL), suspected misspellings ASK before
    // any schedule exists, nothing close refuses honestly.
    if (chainId === ROBINHOOD_CHAIN_ID || chainId === null) {
      await ensureTokenList(ROBINHOOD_CHAIN_ID).catch(() => {})
      const paired = pairStockToken(create.buyToken, ROBINHOOD_CHAIN_ID)
      if (paired.kind === 'paired') {
        trace({ type: 'status', label: `dca layer: stock pairing “${create.buyToken}” → ${paired.symbol} (${paired.name}) on Robinhood Chain` })
        create.buyToken = paired.symbol
        chainId = chainId ?? ROBINHOOD_CHAIN_ID
      } else if (paired.kind === 'suggest') {
        const wordRe = new RegExp(`\\b${create.buyToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
        const options = paired.candidates.map((c) => ({ label: stockChipLabel(c), resume: message.replace(wordRe, c.symbol) }))
        if (options.length < 2) options.push({ label: 'None of these — cancel', resume: 'Never mind — don’t set anything up.' })
        trace({ type: 'status', label: `dca layer: “${create.buyToken}” looks misspelled — asking before creating a schedule (${paired.candidates.map((c) => c.symbol).join('/')})` })
        return {
          reply: `📆 Before I set up a recurring buy — I don't see "${create.buyToken}" on Robinhood Chain's stock list, and a schedule with a guessed ticker would fail every single period.`,
          clarify: {
            question: paired.candidates.length === 1 ? `Did you mean ${stockChipLabel(paired.candidates[0])}?` : 'Which did you mean?',
            options: options.slice(0, 4),
          },
          buildPath: 'native-dca',
        }
      } else if (chainId === ROBINHOOD_CHAIN_ID && paired.kind === 'unknown') {
        return { reply: `📆 Robinhood Chain doesn't list "${create.buyToken}" — it carries 100 tokenized stocks (AAPL, NVDA, TSLA, …). No schedule was created.` }
      }
    }
    if (!chainId) {
      return { reply: `📆 I can't find ${create.buyToken} on a first-class chain's official token list (Base, Ethereum, Arbitrum, Robinhood Chain) — name the chain, e.g. "buy $${create.buyUsd} of ${create.buyToken} ${cadenceLabel(create.cadence)} on robinhood".` }
    }
    const stable = primaryStable(chainId)
    if (!stable) return { reply: `📆 No spend stable is configured for that chain — I can't size the recurring buy.` }
    const chainName = chainById(chainId)?.name ?? `chain ${chainId}`
    // One live schedule per (token, cadence, chain) — a duplicate ask offers
    // the existing schedule's actions instead of quietly doubling the spend.
    const dup = await prisma.dcaSchedule.findFirst({
      where: { wallet: wallet.toLowerCase(), originEnv: jobsEnv(), buyToken: create.buyToken, cadence: create.cadence, chainId, status: { in: ['active', 'paused'] } },
    })
    if (dup) {
      const chip = dcaRunChip({ id: dup.id, buyUsd: dup.buyUsd, buyToken: dup.buyToken, cadence: dup.cadence as DcaCadence })
      // Say where this period actually stands — "already have" alone read as
      // "something bought itself"; arming a schedule never signs anything.
      const dupCadence = dup.cadence as DcaCadence
      const run = await prisma.dcaRun.findUnique({
        where: { scheduleId_periodKey: { scheduleId: dup.id, periodKey: periodKeyFor(dupCadence) } },
      })
      const runJob = run?.jobId ? await prisma.job.findUnique({ where: { id: run.jobId }, select: { status: true } }) : null
      const periodNote =
        runJob?.status === 'done'
          ? ` ${periodPhrase(dupCadence)[0].toUpperCase()}${periodPhrase(dupCadence).slice(1)}'s buy is signed and settled.`
          : ` Nothing has been bought ${periodPhrase(dupCadence)} — a buy only ever happens when you sign it.`
      return {
        reply: `📆 You already have a ${cadenceLabel(dupCadence)} $${dup.buyUsd} ${dup.buyToken} buy on ${chainName}${dup.status === 'paused' ? ' (paused)' : ''} — one schedule per token+cadence, so nothing doubles silently.${periodNote} “List my dcas” shows every schedule.`,
        clarify: {
          question: 'Want this period’s buy, or should I change the schedule?',
          options: [
            { label: chip.label, resume: chip.prompt },
            { label: `Cancel the ${dup.buyToken} schedule`, resume: `cancel my ${dup.buyToken} dca` },
          ],
        },
        buildPath: 'native-dca',
      }
    }
    const schedule = await prisma.dcaSchedule.create({
      data: {
        wallet: wallet.toLowerCase(),
        originEnv: jobsEnv(),
        status: 'active',
        cadence: create.cadence,
        buyUsd: create.buyUsd,
        buyToken: create.buyToken,
        sellToken: stable.symbol,
        chainId,
      },
    })
    // The first period is due NOW — offer the first guarded buy immediately,
    // so "set it up" and "see it work" are the same moment.
    const claim = await claimDcaRun({ ...schedule, cadence: create.cadence }, periodKeyFor(create.cadence))
    trace({ type: 'status', label: `dca layer: schedule ${schedule.id.slice(0, 8)} created (${cadenceLabel(create.cadence)} $${create.buyUsd} ${create.buyToken} on ${chainName}) — first buy ${claim.state}` })
    const turn: DcaTurn = {
      reply:
        `📆 **Recurring buy armed:** $${create.buyUsd} of ${create.buyToken} ${cadenceLabel(create.cadence)} on ${chainName}, spending ${stable.symbol}. ` +
        `Each period the buy is built fresh — live quote, guardrails, receipt — and NOTHING buys without your signature; skip a period and it simply lapses. ` +
        `Say “pause my ${create.buyToken} dca” or “cancel my ${create.buyToken} dca” anytime.` +
        (chainId === 8453 ? ` Want it fully hands-free? Say “make my ${create.buyToken} dca autonomous” — one signature caps the spend on-chain and each buy executes itself.` : '') +
        ` Here's ${periodPhrase(create.cadence)}:`,
      buildPath: 'native-dca',
      dcaScheduleId: schedule.id,
    }
    if (claim.state !== 'bought') {
      turn.jobId = claim.jobId
      turn.jobToken = signJobToken(claim.jobId)
    }
    return turn
  }

  // ── Manage: pause / resume / cancel / list ──────────────────────────────
  const manage = parseDcaManage(message)
  if (!manage) return null
  trace({ type: 'status', label: `dca layer claimed the turn: ${manage.op}${manage.token ? ` ${manage.token}` : ''} — planner bypassed` })
  if (!wallet) return { reply: '📆 Connect your wallet first — recurring buys belong to a wallet.' }
  const all = await listDcaSchedules(wallet)

  if (manage.op === 'list') {
    if (all.length === 0) return { reply: `📆 No recurring buys yet — say something like “buy $10 of AAPL every week” and I'll set one up (you sign each buy).` }
    const lines = all.map((s) => {
      const state =
        s.status === 'paused'
          ? 'paused'
          : s.mode === 'auto'
            ? s.autoError
              ? `🤖 autopilot — needs you: ${s.autoError}`
              : s.period === 'bought'
                ? `🤖 autopilot — bought ${periodPhrase(s.cadence)}`
                : '🤖 autopilot — buys itself when due'
            : s.period === 'bought'
              ? `bought ${periodPhrase(s.cadence)}`
              : s.period === 'live'
                ? 'buy prepared — awaiting your signature'
                : 'due now'
      return `• **$${s.buyUsd} of ${s.buyToken}** ${cadenceLabel(s.cadence)} on ${s.chainName} — ${state}`
    })
    // Armed schedules buy themselves — the one-tap chip is only for
    // confirm-mode periods that genuinely wait on a signature.
    const due = all.filter((s) => s.status === 'active' && s.period === 'due' && s.mode !== 'auto')
    const options = due.map((s) => {
      const chip = dcaRunChip(s)
      return { label: chip.label, resume: chip.prompt }
    })
    if (options.length === 1) options.push({ label: `Pause the ${due[0].buyToken} schedule`, resume: `pause my ${due[0].buyToken} dca` })
    const turn: DcaTurn = { reply: `📆 Your recurring buys:\n${lines.join('\n')}`, buildPath: 'native-dca' }
    if (options.length >= 2) turn.clarify = { question: 'Due now:', options: options.slice(0, 4) }
    return turn
  }

  const matches = all.filter((s) => (manage.token ? s.buyToken === manage.token : true))
  if (matches.length === 0) {
    return { reply: manage.token ? `📆 No ${manage.token} recurring buy on this wallet — “list my dcas” shows what's active.` : '📆 No recurring buys on this wallet yet.' }
  }
  if (!manage.token && matches.length > 1) {
    return {
      reply: '📆 You have more than one recurring buy — which one?',
      clarify: {
        question: `Which schedule should I ${manage.op}?`,
        options: matches.slice(0, 4).map((s) => ({ label: `${s.buyToken} (${cadenceLabel(s.cadence)} $${s.buyUsd})`, resume: `${manage.op} my ${s.buyToken} dca` })),
      },
      buildPath: 'native-dca',
    }
  }
  const nextStatus = manage.op === 'pause' ? 'paused' : manage.op === 'resume' ? 'active' : 'canceled'
  await prisma.dcaSchedule.updateMany({
    where: { id: { in: matches.map((s) => s.id) }, wallet: wallet.toLowerCase() },
    data: { status: nextStatus },
  })
  if (manage.op === 'cancel') {
    // Don't strand this period's live offer: an orphaned waiting_signature
    // job would keep rebuilding stale artifacts with no card left to show.
    for (const s of matches) if (s.liveJobId) await cancelJob(s.liveJobId, wallet).catch(() => {})
  }
  const what = matches.map((s) => `$${s.buyUsd} of ${s.buyToken} ${cadenceLabel(s.cadence)}`).join(', ')
  const verbPast = manage.op === 'pause' ? 'Paused' : manage.op === 'resume' ? 'Resumed' : 'Canceled'
  trace({ type: 'status', label: `dca layer: ${verbPast.toLowerCase()} ${matches.length} schedule(s)` })
  return {
    reply: `📆 **${verbPast}:** ${what}.${manage.op === 'pause' ? ` Resume anytime with “resume my ${matches[0].buyToken} dca”.` : ''}${manage.op === 'cancel' ? ' Nothing was signed or spent.' : ''}`,
    buildPath: 'native-dca',
  }
}
