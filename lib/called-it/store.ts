// The post cache and the scan ledger (tables x_handles, x_posts, x_calls,
// x_scans; prisma/ddl/2026-11-11-called-it.sql).
//
// CONTRACT STUB (squad called-it, 2026-11-11): the signatures are the
// contract; lane SOURCE writes the bodies. Lane JUDGE codes against these
// names today. A lane that needs one more function ADDS it here (append
// only) and says so on the blackboard; nobody changes a signature alone.
import type { Requester, ScanRow, StoredLabel, XPost, XProfile } from './spec'

const NOT_BUILT = 'lib/called-it/store: not built yet (lane SOURCE)'

export interface StoredHandle extends XProfile {
  isProtected: boolean
  /** Set when the account itself signed in with X (lane AUTH writes it through claimHandle). */
  claimedXUserId: string | null
  claimedAt: number | null
  readAt: number | null
}

export interface PlottedRow {
  handle: string
  symbol: string
  name: string | null
  avatarUrl: string | null
  verified: boolean
  /** Posts labeled bull or bear for this symbol (gone posts excluded). */
  calls: number
  scannedAt: number
}

export async function getHandle(_handle: string): Promise<StoredHandle | null> {
  throw new Error(NOT_BUILT)
}
/** Insert or refresh what X says about an account. Never touches the claim. */
export async function saveProfile(_profile: XProfile & { isProtected?: boolean }): Promise<void> {
  throw new Error(NOT_BUILT)
}
/** The account itself signed in with X. Overwrites an older claim by a different user id (a handle can change hands). */
export async function claimHandle(_handle: string, _xUserId: string, _profile?: Partial<XProfile>): Promise<void> {
  throw new Error(NOT_BUILT)
}
/** Upsert by post id. Refreshes the counts; never clears goneAt. */
export async function savePosts(_posts: readonly XPost[]): Promise<void> {
  throw new Error(NOT_BUILT)
}
/** A handle's cached posts from `fromMs` on, date ascending. Gone posts are never returned. */
export async function postsFor(_handle: string, _fromMs: number): Promise<XPost[]> {
  throw new Error(NOT_BUILT)
}
export async function newestPostId(_handle: string): Promise<string | null> {
  throw new Error(NOT_BUILT)
}
/** X no longer serves these. They are never shown again. */
export async function markGone(_postIds: readonly string[]): Promise<void> {
  throw new Error(NOT_BUILT)
}
/** Every label (`none` included, so a post is never labeled twice) for a handle's posts on one symbol. */
export async function labelsFor(_handle: string, _symbol: string): Promise<StoredLabel[]> {
  throw new Error(NOT_BUILT)
}
export async function saveLabels(_labels: readonly StoredLabel[]): Promise<void> {
  throw new Error(NOT_BUILT)
}
export async function latestScan(_handle: string, _symbol: string): Promise<ScanRow | null> {
  throw new Error(NOT_BUILT)
}
export async function getScan(_id: string): Promise<ScanRow | null> {
  throw new Error(NOT_BUILT)
}
/** Opens a `running` row, or returns the one already running for this handle and symbol (two people asking share one scan). */
export async function startScan(_row: { handle: string; symbol: string; provider: string; requestedBy: Requester; isInternal: boolean; windowFrom: number; windowTo: number }): Promise<{ scan: ScanRow; joined: boolean }> {
  throw new Error(NOT_BUILT)
}
export async function updateScan(_id: string, _patch: Partial<Pick<ScanRow, 'status' | 'postsRead' | 'callsFound' | 'costUsd' | 'note'>> & { finished?: boolean }): Promise<void> {
  throw new Error(NOT_BUILT)
}
/** Dollars spent on X reads since 00:00 UTC, every requester together. */
export async function spentTodayUsd(_nowMs?: number): Promise<number> {
  throw new Error(NOT_BUILT)
}
/** Scans this requester started since 00:00 UTC (joined scans do not count). */
export async function scansToday(_requester: Requester, _nowMs?: number): Promise<number> {
  throw new Error(NOT_BUILT)
}
/** The public list: finished scans with at least one call, newest first. Internal runs never list. */
export async function listPlotted(_opts: { limit: number; handle?: string }): Promise<PlottedRow[]> {
  throw new Error(NOT_BUILT)
}
