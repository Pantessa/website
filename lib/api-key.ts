// API keys for headless agents — mint, verify, and the Bearer-or-SIWE auth
// resolver used by /api/grants*. Secrets are `yf_` + 64 hex chars; only the
// sha256 of the plaintext is stored (lib/auth.ts stays the SIWE side).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const KEY_PREFIX = 'yf_'
const SECRET_BYTES = 32

export function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** Generate a fresh secret. Returned plaintext is shown to the user exactly once. */
export function generateKey(): { secret: string; hash: string; prefix: string } {
  const secret = KEY_PREFIX + randomBytes(SECRET_BYTES).toString('hex')
  return { secret, hash: hashKey(secret), prefix: secret.slice(0, KEY_PREFIX.length + 8) }
}

/** The authenticated key itself — a key IS a connected agent. */
export interface BearerKey {
  id: string
  ownerAddress: string
  label: string
  perDayUsd: number | null
  /** Set when this is an org key: the agent spends under the org's grant
   *  and rolls up to the org's daily cap. Null = a personal key. */
  orgId: string | null
}

/**
 * Resolve `Authorization: Bearer yf_…` to the key row, or null. Touches
 * lastUsedAt on success.
 */
export async function getBearerKey(req: NextRequest): Promise<BearerKey | null> {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(yf_[0-9a-f]{64})$/i.exec(header.trim())
  if (!match) return null

  const presented = hashKey(match[1])
  const key = await prisma.apiKey.findUnique({ where: { hash: presented } })
  if (!key) return null
  // findUnique already compared the digest; this re-check is constant-time belt
  // and braces against any future lookup change.
  if (!timingSafeEqual(Buffer.from(presented), Buffer.from(key.hash))) return null

  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {}) // telemetry only — never fail the request over it

  return {
    id: key.id,
    ownerAddress: key.ownerAddress.toLowerCase(),
    label: key.label,
    perDayUsd: key.perDayUsd,
    orgId: key.orgId,
  }
}

/**
 * Resolve `Authorization: Bearer yf_…` to the key's owner address (lowercased),
 * or null. Touches lastUsedAt on success.
 */
export async function getBearerAddress(req: NextRequest): Promise<string | null> {
  return (await getBearerKey(req))?.ownerAddress ?? null
}

/**
 * The caller's wallet address via either auth scheme: SIWE session cookie
 * (browser) or Bearer API key (headless agent). Null if neither verifies.
 */
export async function getAuthAddress(req: NextRequest): Promise<string | null> {
  return (await getSessionAddress()) ?? getBearerAddress(req)
}
