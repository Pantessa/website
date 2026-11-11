// Who asked, and whether they may make the house pay X for a scan (squad
// called-it, lane SOURCE).
//
// A requester is `x:<X user id>` (proved with Verify with X), `w:<wallet>`
// (a SIWE session) or `ip:<hash>` (anyone else; the address is never stored,
// only a salted sha256 prefix, lib/turn-limits hashIp). The first two are
// PROVEN and get PROVEN_SCANS_PER_DAY; a guest gets GUEST_SCANS_PER_DAY.
// Over all of them the house spends at most DAILY_USD_CAP on X reads in a
// UTC day, and a scan is refused while what is left could not pay for a
// whole scan at its cap (so the cap is a ceiling, never a target).
//
// Every refusal names what is over and offers somewhere to go.
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun as houseInternalRun } from '@/lib/internal-run'
import { clientIpFrom, hashIp } from '@/lib/turn-limits'
import { ADDS_PER_MINUTE, DAILY_USD_CAP, ENV, GUEST_ADDS_PER_DAY, GUEST_SCANS_PER_DAY, PROVEN_ADDS_PER_DAY, PROVEN_SCANS_PER_DAY, SCAN_POST_CAP, X_POST_COST_USD, X_USER_COST_USD, chartHref, type Requester } from './spec'
import { scansToday, spentTodayUsd } from './store'
import { getXIdentity } from './x-auth'

type HeadersOf = { headers: Headers }

/** The house's ceiling on X spend per UTC day (env XCALLS_DAILY_USD_CAP). */
export function dailyUsdCap(): number {
  const v = Number(process.env[ENV.dailyUsdCap])
  return Number.isFinite(v) && v >= 0 ? v : DAILY_USD_CAP
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
  | { ok: true; scansLeft: number; postCap: number; usdLeft: number }
  | { ok: false; reason: string; next: { label: string; href: string }[]; over: 'requester' | 'house' }

export interface AllowanceInput {
  requester: Requester
  scansToday: number
  spentTodayUsd: number
  capUsd: number
  postCap: number
  /** For the refusal's links. */
  handle?: string
  symbol?: string
}

function nextFor(ctx: { handle?: string; symbol?: string }): { label: string; href: string }[] {
  const next = [{ label: 'Open a handle that is already plotted', href: '/x' }]
  if (ctx.handle && ctx.symbol) next.push({ label: 'Paste one of their posts instead', href: chartHref(ctx.handle, ctx.symbol) })
  return next
}

/** The allowance arithmetic, pure. */
export function allowanceFor(i: AllowanceInput): Allowance {
  const proven = isProven(i.requester)
  const perDay = proven ? PROVEN_SCANS_PER_DAY : GUEST_SCANS_PER_DAY
  const usdLeft = Math.max(0, Math.round((i.capUsd - i.spentTodayUsd) * 1e6) / 1e6)
  if (usdLeft < maxScanCostUsd(i.postCap)) {
    return {
      ok: false,
      over: 'house',
      reason: `Scans are resting for today: the house has spent its $${i.capUsd.toFixed(2)} on X reads. They come back at 00:00 UTC. Handles already plotted still open, and a pasted post still reads.`,
      next: nextFor(i),
    }
  }
  if (i.scansToday >= perDay) {
    return {
      ok: false,
      over: 'requester',
      reason: proven
        ? `You have used today's ${perDay} scans. They come back at 00:00 UTC.`
        : `You have used today's ${perDay} free scans. Verify with X or sign in with a wallet for ${PROVEN_SCANS_PER_DAY} a day, or open a handle that is already plotted.`,
      next: nextFor(i),
    }
  }
  return { ok: true, scansLeft: perDay - i.scansToday, postCap: i.postCap, usdLeft }
}

/** May this requester start a scan now? Reads today's scans and the house's spend. */
export async function scanAllowance(requester: Requester, nowMs: number = Date.now(), ctx: { handle?: string; symbol?: string } = {}): Promise<Allowance> {
  const [count, spent] = await Promise.all([scansToday(requester, nowMs), spentTodayUsd(nowMs)])
  return allowanceFor({ requester, scansToday: count, spentTodayUsd: spent, capUsd: dailyUsdCap(), postCap: scanPostCap(), ...ctx })
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
