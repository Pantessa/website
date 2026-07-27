// Blog helpers: the admin gate + slug derivation. Publishing is wallet-gated —
// a caller authenticates like everywhere else (SIWE session or Bearer yf_…
// key via getAuthAddress) and must ALSO be listed in the ADMIN_WALLETS env
// (comma-separated addresses). The Bearer path is how a headless agent
// (Claude) publishes posts.

import type { NextRequest } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { getSessionAddress } from '@/lib/auth'
import { OWNER_WALLETS } from '@/lib/admin'

/** Lowercased admin allowlist: OWNER_WALLETS ∪ the ADMIN_WALLETS env.
 *
 *  The owners are baked in for the same reason lib/admin.ts bakes them in —
 *  ADMIN_WALLETS is unset locally and unverified on Vercel, and a publish gate
 *  that reads an env nobody set locks the owner out of their own blog. This
 *  is the ONLY widening: env-added admins still work exactly as before, and
 *  every caller is still SIWE- or key-authenticated before we look here. */
export function adminWallets(): Set<string> {
  const env = (process.env.ADMIN_WALLETS ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
  return new Set<string>([...OWNER_WALLETS, ...env])
}

/** The caller's address when they're a blog admin; null otherwise. */
export async function getAdminAddress(req: NextRequest): Promise<string | null> {
  const addr = await getAuthAddress(req)
  if (!addr) return null
  return adminWallets().has(addr.toLowerCase()) ? addr.toLowerCase() : null
}

/** Server-COMPONENT admin check (pages have no NextRequest, and a page load
 *  never carries a Bearer key — session cookie only). Cosmetic by design: it
 *  decides what chrome to render, while /api/blog/* stays the real gate on
 *  every mutation. */
export async function isBlogAdminSession(): Promise<boolean> {
  const addr = await getSessionAddress()
  return !!addr && adminWallets().has(addr)
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
