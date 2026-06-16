// Admin allowlist — the owner wallets that may see the company-wide adoption
// dashboard (/dashboard/admin). Server routes ENFORCE this via getAuthAddress;
// the client reuses isAdminAddress() only to show/hide the nav item. The API
// is the real gate — never trust the client check.
//
// This module is pure (no server-only imports) so it's safe to import from
// client components. Note: process.env.ADMIN_WALLETS is undefined on the
// client, so the browser sees only OWNER_WALLETS — env-added admins still get
// full server access and the page renders, they just don't get the nav chip.

/** Hardcoded owner wallets (lowercased). Baked in so the admin view works even
 *  when ADMIN_WALLETS is unset on Vercel. */
export const OWNER_WALLETS = [
  '0x5eaabd731d2bc0490c2d47e41858e9b0629455a0',
  '0x66268791b55e1f5fa585d990326519f101407257',
] as const

/** Lowercased union of OWNER_WALLETS ∪ the ADMIN_WALLETS env (comma-separated). */
export function adminWallets(): Set<string> {
  const env = (process.env.ADMIN_WALLETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return new Set<string>([...OWNER_WALLETS, ...env])
}

export function isAdminAddress(addr: string | null | undefined): boolean {
  if (!addr) return false
  return adminWallets().has(addr.toLowerCase())
}
