// ─────────────────────────────────────────────────────────────────────────
//  MCP admission gate — the ONE rulebook for "is this directory row live?"
//
//  Before 2026-09-08 any signed-in wallet could POST /api/servers and the row
//  landed in the SHARED directory, planner-callable for every user, wearing a
//  FREE badge whose tooltip read "free MCP by Pantessa". Combined with the
//  generic signable passthrough that was a stranger-authored sign button
//  (SECURITY-AUDIT-2026-09-08 §A). Now:
//
//   · a user-requested row is born `pending` — visible ONLY to the wallet
//     that requested it, never callable by anyone, never in the Auto-Router
//     catalog, never a splash/approvals/sitemap/detail-page row;
//   · a reviewer wallet (MCP_REVIEWER_WALLETS ∪ admins — the "trusted
//     partners") approves or rejects it from /dashboard/mcp-requests;
//   · only `approved` rows are live. Every seeded/ingested row is born
//     approved (the column default), so the first-party fleet + the paid
//     catalog are unchanged.
//
//  Every directory reader goes through `visibleServerWhere` / `isLiveServer`
//  so the status can't be forgotten one query at a time (the third-instance
//  lesson from the internal-fence class, 2026-09-03).
// ─────────────────────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { adminWallets } from '@/lib/admin'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['pending', 'approved', 'rejected'] as const

/** A wallet may hold at most this many undecided requests — a spam fence. */
export const MAX_PENDING_PER_WALLET = 5

/** Lowercased reviewer set: admins ∪ the MCP_REVIEWER_WALLETS env (comma-separated). */
export function reviewerWallets(): Set<string> {
  const env = (process.env.MCP_REVIEWER_WALLETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return new Set<string>([...adminWallets(), ...env])
}

export function isReviewerAddress(addr: string | null | undefined): boolean {
  if (!addr) return false
  return reviewerWallets().has(addr.toLowerCase())
}

/** True when the row may route, list, and render for everyone. */
export function isLiveServer(row: { reviewStatus?: string | null }): boolean {
  return !row.reviewStatus || row.reviewStatus === 'approved'
}

/**
 * Prisma `where` for "rows this viewer may see": approved rows for everyone,
 * plus the viewer's OWN requests in any state (so they can watch the status).
 * Reviewers see everything through the queue, not through the directory.
 */
export function visibleServerWhere(viewer?: string | null): Prisma.McpServerWhereInput {
  const v = viewer?.toLowerCase()
  return v ? { OR: [{ reviewStatus: 'approved' }, { ownerAddress: v }] } : { reviewStatus: 'approved' }
}

/** Only the requesting wallet or a reviewer may update/delete a custom row. */
export function canManageServer(row: { source: string | null; ownerAddress: string | null }, addr: string): boolean {
  if (row.source !== 'custom') return false
  const a = addr.toLowerCase()
  return row.ownerAddress === a || isReviewerAddress(a)
}

export async function pendingCountFor(owner: string): Promise<number> {
  return prisma.mcpServer.count({ where: { ownerAddress: owner.toLowerCase(), reviewStatus: 'pending' } })
}

export interface ReviewQueueRow {
  id: string
  slug: string
  name: string
  description: string
  endpoint: string | null
  websiteUrl: string | null
  logoUrl: string | null
  ownerAddress: string | null
  reviewStatus: string
  requestNote: string | null
  reviewNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  requestedAt: string | null
  createdAt: string
  tools: string[]
}

/** Pending requests first (oldest first — FIFO), then the latest decisions. */
export async function listReviewQueue(): Promise<{ pending: ReviewQueueRow[]; decided: ReviewQueueRow[] }> {
  const select = {
    id: true, slug: true, name: true, description: true, endpoint: true, websiteUrl: true, logoUrl: true,
    ownerAddress: true, reviewStatus: true, requestNote: true, reviewNote: true, reviewedBy: true,
    reviewedAt: true, requestedAt: true, createdAt: true,
    endpoints: { select: { url: true }, orderBy: { position: 'asc' as const } },
  }
  const [pending, decided] = await Promise.all([
    prisma.mcpServer.findMany({ where: { source: 'custom', reviewStatus: 'pending' }, orderBy: { createdAt: 'asc' }, select }),
    prisma.mcpServer.findMany({
      where: { source: 'custom', reviewStatus: { in: ['approved', 'rejected'] } },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select,
    }),
  ])
  const shape = ({ endpoints, ...r }: (typeof pending)[number]): ReviewQueueRow => ({
    ...r,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    requestedAt: r.requestedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    // `<base>/<tool>` is the stored endpoint shape — the tool is the last segment.
    tools: endpoints.map((e) => e.url.split('/').pop() ?? '').filter(Boolean),
  })
  return { pending: pending.map(shape), decided: decided.map(shape) }
}

export type ReviewDecision = 'approve' | 'reject'

/**
 * Record a decision. Approving a row makes it live everywhere at once (the
 * visibility predicate is the only switch); rejecting keeps the row so the
 * requester sees WHY, and frees their pending slot.
 */
export async function decideReview(opts: { id: string; decision: ReviewDecision; reviewer: string; note?: string | null }) {
  const row = await prisma.mcpServer.findUnique({ where: { id: opts.id }, select: { id: true, source: true, reviewStatus: true } })
  if (!row) return { ok: false as const, status: 404, error: 'Request not found.' }
  if (row.source !== 'custom') return { ok: false as const, status: 403, error: 'Only user-requested MCPs go through review.' }
  const next: ReviewStatus = opts.decision === 'approve' ? 'approved' : 'rejected'
  const updated = await prisma.mcpServer.update({
    where: { id: row.id },
    data: {
      reviewStatus: next,
      reviewedBy: opts.reviewer.toLowerCase(),
      reviewedAt: new Date(),
      reviewNote: opts.note?.trim().slice(0, 500) || null,
    },
    select: { id: true, slug: true, name: true, reviewStatus: true, reviewedAt: true, reviewNote: true },
  })
  return { ok: true as const, server: updated, previous: row.reviewStatus }
}
