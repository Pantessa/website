// Blog helpers: the admin gate + slug derivation. Publishing is wallet-gated —
// a caller authenticates like everywhere else (SIWE session or Bearer yf_…
// key via getAuthAddress) and must ALSO be listed in the ADMIN_WALLETS env
// (comma-separated addresses). The Bearer path is how a headless agent
// (Claude) publishes posts.

import type { NextRequest } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'

/** Lowercased admin allowlist from the ADMIN_WALLETS env ('' = nobody). */
export function adminWallets(): Set<string> {
  return new Set(
    (process.env.ADMIN_WALLETS ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
  )
}

/** The caller's address when they're a blog admin; null otherwise. */
export async function getAdminAddress(req: NextRequest): Promise<string | null> {
  const addr = await getAuthAddress(req)
  if (!addr) return null
  return adminWallets().has(addr.toLowerCase()) ? addr.toLowerCase() : null
}

/** URL- and SEO-friendly slug: lowercase, hyphenated, trimmed. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
