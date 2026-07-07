// Public embed keys (`yfe_…`) + the embed-sites ledger. The key is a
// PUBLISHABLE identifier (lives in host page source), so unlike `yf_` API
// keys it is stored plaintext and grants no read/spend authority — it only
// binds embedded-chat traffic to the owning account so the HOST's plan pays
// for guest usage on their site and the dashboard can list every origin
// that mounted the chat.

import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'

export const EMBED_KEY_PREFIX = 'yfe_'
const KEY_BYTES = 12 // yfe_ + 24 hex chars — short enough to read, 2^96 space

export function generateEmbedKey(): string {
  return EMBED_KEY_PREFIX + randomBytes(KEY_BYTES).toString('hex')
}

export function looksLikeEmbedKey(v: unknown): v is string {
  return typeof v === 'string' && /^yfe_[0-9a-f]{24}$/.test(v)
}

/** Resolve a live (non-revoked) embed key to its owner. Null on anything
 * else. Fails soft — a store error reads as "no key". */
export async function resolveEmbedKey(key: string): Promise<{ id: string; ownerAddress: string } | null> {
  if (!looksLikeEmbedKey(key)) return null
  try {
    const row = await prisma.embedKey.findUnique({ where: { key } })
    if (!row || row.revoked) return null
    return { id: row.id, ownerAddress: row.ownerAddress }
  } catch {
    return null
  }
}

/** Record (or refresh) a sighting: this origin mounted the chat under this
 * key ('' = keyless). `bumpTurn` counts a chat message instead of a mount.
 * Fire-and-forget semantics — never throws. */
export async function recordEmbedSighting(opts: {
  embedKeyId: string
  ownerAddress: string | null
  origin: string
  pageUrl?: string | null
  bumpTurn?: boolean
}): Promise<void> {
  const origin = opts.origin.slice(0, 200)
  const pageUrl = opts.pageUrl ? opts.pageUrl.slice(0, 500) : undefined
  try {
    await prisma.embedSite.upsert({
      where: { embedKeyId_origin: { embedKeyId: opts.embedKeyId, origin } },
      update: {
        lastSeen: new Date(),
        ...(pageUrl ? { pageUrl } : {}),
        ...(opts.ownerAddress ? { ownerAddress: opts.ownerAddress } : {}),
        ...(opts.bumpTurn ? { turns: { increment: 1 } } : {}),
      },
      create: {
        embedKeyId: opts.embedKeyId,
        ownerAddress: opts.ownerAddress,
        origin,
        pageUrl: pageUrl ?? null,
        turns: opts.bumpTurn ? 1 : 0,
      },
    })
  } catch {
    // sighting is telemetry — never let it break a mount or a chat turn
  }
}

/** A best-effort origin for a sighting: prefer what the SDK reported, fall
 * back to the request's Referer header (the embedding page). */
export function sightingOrigin(reported: unknown, referer: string | null): string | null {
  for (const candidate of [reported, referer]) {
    if (typeof candidate !== 'string' || !candidate) continue
    try {
      return new URL(candidate).origin
    } catch {
      /* not a URL — try the next candidate */
    }
  }
  return null
}
