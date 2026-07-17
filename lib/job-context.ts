// ─────────────────────────────────────────────────────────────────────────
//  Job context — "what does this job mean for ME right now?" Server-side
//  derivation of the position/PnL card shown when a job (or recurring buy)
//  is opened from the rail. Given the job's steps (their builders + params),
//  pull the live position the job touches: Hyperliquid positions with
//  unrealized PnL, the Lido stake, the Aave position + health factor, or the
//  wallet's holding of the token a swap/DCA has been buying.
//
//  Contract (the splash-tile lesson): every value is a PRE-FORMATTED STRING.
//  Providers are isolated + fail-soft — a dead RPC or MCP drops its rows,
//  never the card; the generic rows (money moved, status note) always land.
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { callMcpTool } from '@/lib/mcp-call'
import { alchemyEnabled, getMultichainPortfolio } from '@/lib/alchemy'
import { chainById } from '@/lib/chains'
import { cadenceLabel, periodPhrase, type DcaCadence } from '@/lib/dca'
import type { DcaScheduleView } from '@/lib/dca-exec'

export interface JobContextRow {
  label: string
  /** Pre-formatted display string ("$213.09", "+$4.20 PnL") — never a raw number. */
  value: string
  sub?: string
  tone?: 'pos' | 'neg'
}

export interface JobContext {
  headline?: { value: string; caption: string; tone?: 'pos' | 'neg' }
  rows: JobContextRow[]
  /** The one line the job needs the user to know right now. */
  note?: string
}

interface StepLike {
  builder: string
  params: unknown
}

interface JobLike {
  wallet: string
  status: string
  currentStep: number
  valueUsd: number | null
  failReason: string | null
  steps: StepLike[]
}

const usd = (n: number): string =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Per-provider ceiling — the card should paint fast even when one venue drags. */
const PROVIDER_TIMEOUT_MS = 8_000

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('context provider timed out')), PROVIDER_TIMEOUT_MS)),
  ])
}

/** Resolve a free MCP's base URL (…/mcp) from the DB by slug/name pattern —
 *  same convention as the splash route: the base lives on the server row or
 *  as the shared prefix of a child endpoint. */
async function mcpBaseFor(pattern: RegExp): Promise<string | null> {
  const rows = await prisma.mcpServer.findMany({
    where: { gated: false },
    select: { slug: true, name: true, endpoint: true, endpoints: { select: { url: true }, take: 1 } },
  })
  const row = rows.find((r) => pattern.test(`${r.slug} ${r.name}`))
  if (!row) return null
  for (const u of [row.endpoint, row.endpoints[0]?.url ?? null]) {
    if (!u) continue
    const m = u.match(/^(.+\/mcp)(?:[#/].*)?$/)
    if (m) return m[1]
  }
  return null
}

// ── Hyperliquid: the position(s) this job trades, with live PnL ─────────────

async function hlRows(wallet: string, coins: Set<string>): Promise<JobContextRow[]> {
  const { InfoClient, HttpTransport } = await import('@nktkas/hyperliquid')
  const info = new InfoClient({ transport: new HttpTransport({}) })
  const state = await info.clearinghouseState({ user: wallet as `0x${string}` })
  const rows: JobContextRow[] = []
  const positions = state.assetPositions
    .map((ap) => ap.position)
    .filter((p) => Number(p.szi) !== 0)
    // The job's coins first; if the job named none, show what's open.
    .sort((a, b) => Number(coins.has(b.coin)) - Number(coins.has(a.coin)))
    .slice(0, coins.size > 0 ? 4 : 3)
  for (const p of positions) {
    const size = Number(p.szi)
    const pnl = Number(p.unrealizedPnl ?? 0)
    const lev = p.leverage?.value
    rows.push({
      label: `${p.coin} ${size >= 0 ? 'long' : 'short'}${lev ? ` ${lev}x` : ''}`,
      value: `${pnl >= 0 ? '+' : '−'}${usd(pnl)} PnL`,
      sub: `entry $${p.entryPx ?? '—'} · size ${Math.abs(size)}${p.liquidationPx ? ` · liq $${p.liquidationPx}` : ''}`,
      tone: pnl >= 0 ? 'pos' : 'neg',
    })
  }
  const accountValue = Number(state.marginSummary?.accountValue ?? 0)
  if (accountValue > 0) {
    rows.push({ label: 'Hyperliquid account value', value: usd(accountValue) })
  }
  const named = [...coins].filter((c) => !positions.some((p) => p.coin === c))
  for (const c of named) {
    rows.push({ label: `${c} position`, value: 'flat', sub: 'no open position right now' })
  }
  return rows
}

// ── Lido: total staked + what it's earning ──────────────────────────────────

interface LidoPositionPayload {
  hasPosition?: boolean
  stEth?: { balance?: string; usd?: number | null }
  wstEth?: { balance?: string; usd?: number | null }
  totalStaked?: { stEth?: string; usd?: number | null }
  currentAprPct?: number | null
}

async function lidoRows(wallet: string): Promise<JobContextRow[]> {
  const base = await mcpBaseFor(/lido/i)
  if (!base) return []
  const pos = (await callMcpTool(base, 'position', { user: wallet }, { timeoutMs: PROVIDER_TIMEOUT_MS })) as LidoPositionPayload
  if (!pos?.hasPosition) return [{ label: 'Lido stake', value: 'none yet', sub: 'nothing staked from this wallet' }]
  const rows: JobContextRow[] = []
  const totalUsd = pos.totalStaked?.usd
  if (typeof totalUsd === 'number' && Number.isFinite(totalUsd)) {
    rows.push({
      label: 'Your Lido stake',
      value: usd(totalUsd),
      sub: `${pos.totalStaked?.stEth ?? '—'} stETH total${pos.currentAprPct != null ? ` · earning ~${pos.currentAprPct.toFixed(2)}% APR` : ''}`,
      tone: 'pos',
    })
  }
  if (Number(pos.stEth?.balance) > 0 && typeof pos.stEth?.usd === 'number') {
    rows.push({ label: 'stETH', value: usd(pos.stEth.usd), sub: `${pos.stEth.balance} stETH · rebasing daily` })
  }
  if (Number(pos.wstEth?.balance) > 0 && typeof pos.wstEth?.usd === 'number') {
    rows.push({ label: 'wstETH', value: usd(pos.wstEth.usd), sub: `${pos.wstEth.balance} wstETH` })
  }
  return rows
}

// ── Aave: net position, earned interest, health factor ──────────────────────

interface AavePortfolioPayload {
  positions?: { netBalanceUsd?: string | null; netApyPct?: number | null; healthFactor?: string | null }[]
  supplies?: { token?: { symbol?: string | null } | null; balanceUsd?: string | null; earnedInterestUsd?: string | null }[]
  borrows?: { token?: { symbol?: string | null } | null; debtUsd?: string | null; borrowApyPct?: number | null }[]
}

async function aaveRows(wallet: string): Promise<JobContextRow[]> {
  const base = await mcpBaseFor(/aave/i)
  if (!base) return []
  const data = (await callMcpTool(base, 'portfolio', { user: wallet }, { timeoutMs: PROVIDER_TIMEOUT_MS })) as AavePortfolioPayload
  const rows: JobContextRow[] = []
  const pos = Array.isArray(data.positions) ? data.positions[0] : undefined
  if (pos?.netBalanceUsd) {
    rows.push({
      label: 'Your Aave position',
      value: pos.netBalanceUsd,
      sub: pos.netApyPct != null ? `net ${pos.netApyPct}% APY` : undefined,
      tone: 'pos',
    })
  }
  for (const s of (data.supplies ?? []).slice(0, 2)) {
    if (!s?.token?.symbol) continue
    rows.push({
      label: `${s.token.symbol} supplied`,
      value: s.balanceUsd ?? '—',
      sub: s.earnedInterestUsd ? `${s.earnedInterestUsd} earned` : undefined,
      tone: 'pos',
    })
  }
  for (const b of (data.borrows ?? []).slice(0, 2)) {
    if (!b?.token?.symbol) continue
    rows.push({
      label: `${b.token.symbol} borrowed`,
      value: b.debtUsd ?? '—',
      sub: b.borrowApyPct != null ? `${b.borrowApyPct}% APY accruing` : undefined,
      tone: 'neg',
    })
  }
  const hf = pos?.healthFactor != null ? Number(pos.healthFactor) : NaN
  if (Number.isFinite(hf) && (data.borrows?.length ?? 0) > 0) {
    rows.push({
      label: 'Health factor',
      value: hf.toFixed(2),
      sub: hf < 1.5 ? 'getting close to liquidation' : 'comfortable',
      tone: hf < 1.5 ? 'neg' : 'pos',
    })
  }
  return rows
}

// ── Token holding: what the wallet holds of the token a swap/DCA buys ───────

async function holdingRows(wallet: string, symbols: Set<string>): Promise<JobContextRow[]> {
  if (symbols.size === 0 || !alchemyEnabled()) return []
  const portfolio = await getMultichainPortfolio(wallet)
  const rows: JobContextRow[] = []
  for (const sym of [...symbols].slice(0, 3)) {
    // Sum across chains — the same asset can sit on several.
    const matches = portfolio.holdings.filter((h) => h.symbol.toUpperCase() === sym.toUpperCase())
    if (matches.length === 0) continue
    const bal = matches.reduce((a, h) => a + Number(h.balance), 0)
    const value = matches.reduce((a, h) => a + (h.valueUsd ?? 0), 0)
    const price = matches.find((h) => h.priceUsd != null)?.priceUsd
    rows.push({
      label: `Your ${sym}`,
      value: value > 0 ? usd(value) : `${bal.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${sym}`,
      sub: [
        value > 0 ? `${bal.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${sym}` : null,
        price != null ? `at ${usd(price)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    })
  }
  return rows
}

// ── Assembly ────────────────────────────────────────────────────────────────

const HL_BUILDERS = new Set(['native-hl-exec', 'native-hl-guardian'])
const SWAP_BUILDERS = new Set(['native-swap', 'native-lifi-swap', 'native-cross-chain', 'native-lifi-fund'])

/** Pull a token symbol from a swap-ish step's compiled params (the fixed
 *  build inputs) — key names vary by builder, so probe the known ones. */
function buyTokenOf(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null
  const p = params as Record<string, unknown>
  for (const key of ['buyToken', 'toToken', 'tokenOut', 'buySymbol']) {
    const v = p[key]
    if (typeof v === 'string' && /^[A-Za-z0-9]{2,12}$/.test(v)) return v.toUpperCase()
  }
  return null
}

function jobStatusNote(job: JobLike): string | undefined {
  if (job.status === 'waiting_signature')
    return `Step ${job.currentStep + 1} is built and waiting on your signature — nothing moves until you sign.`
  if (job.status === 'waiting_settlement') return 'Settling — the runner is verifying the fill before the next step.'
  if (job.status === 'running') return 'Running — each step is built and guard-checked only when offered.'
  if (job.status === 'failed' && job.failReason) return job.failReason
  return undefined
}

/** The position/PnL context for a multi-step job, derived from what its steps
 *  actually touch. Fail-soft per provider. */
export async function jobContextFor(job: JobLike): Promise<JobContext> {
  const builders = new Set(job.steps.map((s) => s.builder))
  const hlCoins = new Set<string>()
  const buySymbols = new Set<string>()
  for (const s of job.steps) {
    if (HL_BUILDERS.has(s.builder)) {
      const coin = (s.params as { coin?: unknown } | null)?.coin
      if (typeof coin === 'string') hlCoins.add(coin.toUpperCase())
    }
    if (SWAP_BUILDERS.has(s.builder)) {
      const sym = buyTokenOf(s.params)
      if (sym) buySymbols.add(sym)
    }
  }

  const tasks: Promise<JobContextRow[]>[] = []
  if ([...builders].some((b) => HL_BUILDERS.has(b))) tasks.push(withTimeout(hlRows(job.wallet, hlCoins)))
  if (builders.has('native-lido')) tasks.push(withTimeout(lidoRows(job.wallet)))
  if (builders.has('native-aave-supply') || builders.has('native-aave-repay')) tasks.push(withTimeout(aaveRows(job.wallet)))
  if (buySymbols.size > 0) tasks.push(withTimeout(holdingRows(job.wallet, buySymbols)))

  const settled = await Promise.allSettled(tasks)
  const rows = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))

  if (job.valueUsd != null && job.valueUsd > 0) {
    rows.push({ label: 'Money moved by this job', value: usd(job.valueUsd), sub: 'every step receipted' })
  }
  const headline = rows.length > 0 && rows[0].tone !== undefined
    ? { value: rows[0].value, caption: rows[0].label.toLowerCase(), tone: rows[0].tone }
    : undefined
  return { headline, rows, note: jobStatusNote(job) }
}

/** The context for a recurring buy: what the schedule has invested so far and
 *  where the wallet's holding of that token stands now. Honest framing — the
 *  wallet's balance can predate the schedule, so "invested" and "you hold"
 *  are separate rows, never netted into a claimed PnL. */
export async function dcaContextFor(schedule: DcaScheduleView, wallet: string): Promise<JobContext> {
  const rows: JobContextRow[] = []

  // Invested to date: the DONE jobs linked to this schedule's runs.
  let invested = 0
  let buys = 0
  try {
    const runs = await prisma.dcaRun.findMany({ where: { scheduleId: schedule.id }, select: { jobId: true } })
    const jobIds = runs.map((r) => r.jobId).filter((j): j is string => !!j)
    if (jobIds.length > 0) {
      const jobs = await prisma.job.findMany({
        where: { id: { in: jobIds }, status: 'done' },
        select: { valueUsd: true },
      })
      buys = jobs.length
      invested = jobs.reduce((a, j) => a + (j.valueUsd ?? 0), 0)
    }
  } catch {
    /* fail-soft — the schedule rows below still paint */
  }
  rows.push({
    label: 'Bought via this schedule',
    value: buys > 0 ? usd(invested) : 'nothing yet',
    sub: buys > 0 ? `${buys} ${buys === 1 ? 'buy' : 'buys'} signed` : `first buy ${schedule.period === 'due' ? 'is due now' : 'not signed yet'}`,
    tone: buys > 0 ? 'pos' : undefined,
  })

  try {
    const holding = await withTimeout(holdingRows(wallet, new Set([schedule.buyToken])))
    rows.push(...holding)
  } catch {
    /* fail-soft */
  }

  rows.push({
    label: 'Schedule',
    value: `$${schedule.buyUsd} → ${schedule.buyToken} ${cadenceLabel(schedule.cadence as DcaCadence)}`,
    sub: `on ${schedule.chainName} · ${schedule.status}`,
  })

  // periodPhrase is already possessive ("today's" / "this week's").
  const phrase = periodPhrase(schedule.cadence as DcaCadence)
  const capPhrase = phrase.charAt(0).toUpperCase() + phrase.slice(1)
  const note =
    schedule.status === 'paused'
      ? 'Paused — no buys are offered until you resume.'
      : schedule.period === 'due'
        ? `${capPhrase} buy is due — nothing buys itself, sign when ready.`
        : schedule.period === 'live'
          ? `${capPhrase} buy is built and waiting on your signature.`
          : `${capPhrase} buy is done — the next period will offer a fresh one.`

  const headline = buys > 0 ? { value: usd(invested), caption: `invested across ${buys} signed ${buys === 1 ? 'buy' : 'buys'}`, tone: 'pos' as const } : undefined
  return { headline, rows, note }
}
