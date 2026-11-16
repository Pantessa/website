// Who asked, and whether they may make the house pay X for a scan (squad
// called-it, lane SOURCE).
//
// A requester is `x:<X user id>` (proved with Verify with X), `w:<wallet>`
// (a SIWE session) or `ip:<hash>` (anyone else; the address is never stored,
// only a salted sha256 prefix, lib/turn-limits hashIp). The first two are
// PROVEN and get FREE_SCANS_PER_DAY free; a guest gets GUEST_SCANS_PER_DAY.
// Over all of them the house spends at most DAILY_USD_CAP on FREE scans in
// a UTC day, and a free scan is refused while what is left could not pay for
// a whole scan at its cap (so the cap is a ceiling, never a target).
//
// PAID WITH ANSWERS (2026-11-16): past the free one, a new scan costs
// SCAN_ANSWER_PRICE house answers (lib/billing: the plan's month first, then
// the bank) from the WALLET SESSION's own balance. It is never spent unless
// the request says `pay: true`: without it the refusal carries the offer.
// Paid scans do not draw on the free pool; they have their own daily fuse.
//
// Every refusal names what is over and offers somewhere to go.
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun as houseInternalRun } from '@/lib/internal-run'
import { clientIpFrom, hashIp } from '@/lib/turn-limits'
import { fakeModeOn, ADDS_PER_MINUTE, DAILY_USD_CAP, ENV, GUEST_ADDS_PER_DAY, GUEST_LOOKUPS_PER_DAY, FREE_SCANS_PER_DAY, GUEST_SCANS_PER_DAY, PAID_DAILY_USD_CAP, PAID_SCANS_PER_DAY, PROVEN_ADDS_PER_DAY, PROVEN_LOOKUPS_PER_DAY, SCAN_ANSWER_PRICE, SCAN_POST_CAP, X_POST_COST_USD, X_USER_COST_USD, chartHref, type Requester } from './spec'
import { lookupsToday, paidScansToday, paidSpentTodayUsd, scansToday, spentTodayUsd } from './store'
import { getXIdentity } from './x-auth'
import { answersLeft } from '@/lib/billing'

type HeadersOf = { headers: Headers }

/** The house's ceiling on FREE scans' X spend per UTC day (env XCALLS_DAILY_USD_CAP). */
export function dailyUsdCap(): number {
  const v = Number(process.env[ENV.dailyUsdCap])
  return Number.isFinite(v) && v >= 0 ? v : DAILY_USD_CAP
}

/** The fuse on X spend PAID WITH ANSWERS per UTC day (env XCALLS_PAID_DAILY_USD_CAP). */
export function paidDailyUsdCap(): number {
  const v = Number(process.env[ENV.paidDailyUsdCap])
  return Number.isFinite(v) && v >= 0 ? v : PAID_DAILY_USD_CAP
}

/** Answers one paid scan costs (env XCALLS_SCAN_ANSWERS, a whole number from 1 to 10,000). */
export function scanAnswerPrice(env: Record<string, string | undefined> = process.env): number {
  const raw = env[ENV.scanAnswers]
  if (raw !== undefined && /^\d{1,5}$/.test(raw.trim()) && Number(raw.trim()) >= 1 && Number(raw.trim()) <= 10_000) return Number(raw.trim())
  return SCAN_ANSWER_PRICE
}

/**
 * Free new scans a signed-in requester may start in a UTC day (env XCALLS_FREE_SCANS). Fake mode (the harness, never a
 * Vercel deployment) keeps the ten it always had, so its drives still run.
 */
export function freeScansPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env[ENV.freeScans]
  if (raw !== undefined && /^\d{1,3}$/.test(raw.trim())) return Number(raw.trim())
  return fakeModeOn(env) ? 10 : FREE_SCANS_PER_DAY
}

/** Posts one scan may read (env XCALLS_SCAN_POST_CAP, at least 10, at most 3,000). */
export function scanPostCap(): number {
  const v = Math.floor(Number(process.env[ENV.scanPostCap]))
  return Number.isFinite(v) && v >= 10 ? Math.min(v, 3000) : SCAN_POST_CAP
}

/** The most one scan can cost: its profile read and every post its cap allows. */
export function maxScanCostUsd(postCap = scanPostCap()): number {
  return Math.round((postCap * X_POST_COST_USD + X_USER_COST_USD) * 1e6) / 1e6
}

export function isProven(requester: Requester): boolean {
  return /^(x|w):./.test(requester)
}

/** `x:<id>` when the browser proved an X account, else `w:<wallet>` from the SIWE session, else `ip:<hash>`. Never throws. */
export async function requesterOf(req: HeadersOf): Promise<Requester> {
  try {
    const x = await getXIdentity()
    if (x?.xUserId && /^\d{1,20}$/.test(x.xUserId)) return `x:${x.xUserId}`
  } catch {
    // no identity
  }
  try {
    const w = await getSessionAddress()
    if (w && /^0x[0-9a-f]{40}$/.test(w)) return `w:${w}`
  } catch {
    // no session
  }
  return `ip:${hashIp(clientIpFrom(req.headers) ?? 'local')}`
}

/** The house's "this is our own run" header (x-yf-internal-run: 1). */
export function isInternalRun(req: HeadersOf): boolean {
  return houseInternalRun(req.headers)
}

export type Allowance =
  /** `charge`: the answers this scan costs its wallet (0 or absent = a free one). */
  | { ok: true; scansLeft: number; postCap: number; usdLeft: number; charge?: number }
  /** `pay`: the scan can run for that many answers and the wallet has them; nothing is spent until the request says so. */
  | { ok: false; reason: string; next: { label: string; href: string }[]; over: 'requester' | 'house' | 'pay'; pay?: { answers: number; have: number } }

export interface AllowanceInput {
  requester: Requester
  /** This requester's FREE scans today. */
  scansToday: number
  /** The free pool's spend today (scans nobody paid answers for). */
  spentTodayUsd: number
  capUsd: number
  postCap: number
  /** Profile reads this requester caused today, misses included (review R4c). Absent = not counted. */
  lookupsToday?: number
  /** The wallet session that could pay with answers (never an X-only or guest requester). */
  owner?: string | null
  /** That wallet's answers: the plan's month left plus the bank. */
  answers?: number
  /** The request said to spend answers. */
  pay?: boolean
  /** Paid scans' spend today and its fuse. Absent: the paid lane is closed. */
  paidSpentTodayUsd?: number
  paidCapUsd?: number
  /** This wallet's paid scans today. */
  paidScansToday?: number
  /** Answers one scan costs. Absent: scanAnswerPrice(). */
  price?: number
  /** For the refusal's links. */
  handle?: string
  symbol?: string
}

const GET_ANSWERS = { label: 'Get answers', href: '/pricing' }

function nextFor(ctx: { handle?: string; symbol?: string }): { label: string; href: string }[] {
  const next = [{ label: 'Open a handle that is already plotted', href: '/x' }]
  if (ctx.handle && ctx.symbol) next.push({ label: 'Paste one of their posts instead', href: chartHref(ctx.handle, ctx.symbol) })
  return next
}

/**
 * New scans a guest may start in a UTC day: 0 unless XCALLS_GUEST_SCANS says otherwise. Fake mode (the harness, never a
 * Vercel deployment) keeps the two it always had, so its guest drives still run.
 */
export function guestScansPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env[ENV.guestScans]
  if (raw !== undefined && /^\d{1,3}$/.test(raw.trim())) return Number(raw.trim())
  return fakeModeOn(env) ? 2 : GUEST_SCANS_PER_DAY
}

/** The allowance arithmetic, pure. A free scan when one is left and the free pool can pay for it; otherwise the paid lane. */
export function allowanceFor(i: AllowanceInput): Allowance {
  const proven = isProven(i.requester)
  const perDay = proven ? freeScansPerDay() : guestScansPerDay()
  const worst = maxScanCostUsd(i.postCap)
  const usdLeft = Math.max(0, Math.round((i.capUsd - i.spentTodayUsd) * 1e6) / 1e6)
  const lookups = proven ? PROVEN_LOOKUPS_PER_DAY : GUEST_LOOKUPS_PER_DAY
  if ((i.lookupsToday ?? 0) >= lookups) {
    return {
      ok: false,
      over: 'requester',
      reason: `You have looked up ${lookups} handles on X today, misses included. Lookups come back at 00:00 UTC; handles already plotted still open.`,
      next: nextFor(i),
    }
  }
  const freeLeft = i.scansToday < perDay
  const poolOk = usdLeft >= worst
  if (freeLeft && poolOk) return { ok: true, scansLeft: perDay - i.scansToday, postCap: i.postCap, usdLeft, charge: 0 }

  // THE PAID LANE: a wallet session with enough answers, under the paid fuse.
  const price = i.price ?? scanAnswerPrice()
  const have = Math.max(0, Math.floor(i.answers ?? 0))
  const paidLeft = i.paidCapUsd === undefined ? 0 : Math.max(0, Math.round((i.paidCapUsd - (i.paidSpentTodayUsd ?? 0)) * 1e6) / 1e6)
  const paidOpen = paidLeft >= worst
  const why = !freeLeft
    ? perDay === 0
      ? proven
        ? 'Free scans are off here.'
        : 'A free scan needs a sign-in.'
      : `You have used today's free ${perDay === 1 ? 'scan' : `${perDay} scans`}.`
    : `Free scans are resting for today: the house has spent its $${i.capUsd.toFixed(2)} on them.`
  if (i.owner && have >= price && paidOpen) {
    if ((i.paidScansToday ?? 0) >= PAID_SCANS_PER_DAY) {
      return { ok: false, over: 'requester', reason: `You have run today's ${PAID_SCANS_PER_DAY} paid scans. They come back at 00:00 UTC.`, next: nextFor(i) }
    }
    if (i.pay) return { ok: true, scansLeft: 0, postCap: i.postCap, usdLeft: paidLeft, charge: price }
    return {
      ok: false,
      over: 'pay',
      reason: `${why} This scan costs ${price} answers, and you have ${have.toLocaleString('en-US')}. Nothing is spent until you say so.`,
      next: nextFor(i),
      pay: { answers: price, have },
    }
  }

  // Nothing covers it. Say which door is closed, and how to open it.
  const back = 'at 00:00 UTC'
  const paidWords = !paidOpen
    ? ''
    : i.owner
      ? ` A scan can also be paid for: ${price} answers each, and you have ${have.toLocaleString('en-US')}.`
      : ` A scan can also be paid for with ${price} answers, from a wallet sign-in.`
  if (!freeLeft) {
    return {
      ok: false,
      over: 'requester',
      reason: proven
        ? `${why} The next free one comes back ${back}.${paidWords}`
        : perDay === 0
          ? `Starting a new scan needs a sign-in: verify with X or sign in with a wallet (${freeScansPerDay()} free scan${freeScansPerDay() === 1 ? '' : 's'} a day, more for ${price} answers each). Every record already scanned opens for everyone, and one post can be pasted by its link.`
          : `You have used today's ${perDay} free scans. Verify with X or sign in with a wallet for more, or open a handle that is already plotted.`,
      next: proven && paidOpen ? [GET_ANSWERS, ...nextFor(i)] : nextFor(i),
    }
  }
  return {
    ok: false,
    over: 'house',
    reason: `${why} They come back ${back}.${paidWords} Handles already plotted still open, and a pasted post still reads.`,
    next: proven && paidOpen ? [GET_ANSWERS, ...nextFor(i)] : nextFor(i),
  }
}

/** The wallet session that could pay for a scan, lower-cased; null for anyone else. Never throws. */
export async function payerOf(): Promise<string | null> {
  try {
    const w = await getSessionAddress()
    return w && /^0x[0-9a-fA-F]{40}$/.test(w) ? w.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * May this requester start a scan now? Reads today's scans, both pools' spend and the session wallet's answers. It never
 * says `pay`: a look (the record's "can it scan") is told the price, and only the scan route spends.
 */
export async function scanAllowance(requester: Requester, nowMs: number = Date.now(), ctx: { handle?: string; symbol?: string } = {}): Promise<Allowance> {
  const owner = await payerOf()
  const [count, spent, lookups, paidSpent, paidCount, answers] = await Promise.all([
    scansToday(requester, nowMs),
    spentTodayUsd(nowMs),
    lookupsToday(requester, nowMs),
    paidSpentTodayUsd(nowMs),
    owner ? paidScansToday(owner, nowMs) : 0,
    owner ? answersLeft(owner).then((a) => a.planLeft + a.bank) : 0,
  ])
  return allowanceFor({ requester, scansToday: count, spentTodayUsd: spent, lookupsToday: lookups, capUsd: dailyUsdCap(), postCap: scanPostCap(), owner, answers, paidSpentTodayUsd: paidSpent, paidCapUsd: paidDailyUsdCap(), paidScansToday: paidCount, ...ctx })
}

// ── Pasted posts (review R2b): each one is a house-paid model call ──────────

export type AddAllowance = { ok: true; leftToday: number } | { ok: false; reason: string; next: { label: string; href: string }[]; over: 'day' | 'minute' }

/** May this requester paste one more post? Pure over the counts of their rows in x_calls (added_by). */
export function addAllowanceFor(i: { requester: Requester; today: number; lastMinute: number; handle?: string; symbol?: string }): AddAllowance {
  const proven = isProven(i.requester)
  const perDay = proven ? PROVEN_ADDS_PER_DAY : GUEST_ADDS_PER_DAY
  const next = nextFor(i)
  if (i.lastMinute >= ADDS_PER_MINUTE) return { ok: false, over: 'minute', reason: `That is ${ADDS_PER_MINUTE} posts added in the last minute. Wait a minute and paste the next one.`, next }
  if (i.today >= perDay) {
    return {
      ok: false,
      over: 'day',
      reason: proven
        ? `You have added today's ${perDay} posts. More can be added after 00:00 UTC.`
        : `You have added today's ${perDay} posts. Verify with X or sign in with a wallet for ${PROVEN_ADDS_PER_DAY} a day.`,
      next,
    }
  }
  return { ok: true, leftToday: perDay - i.today }
}
