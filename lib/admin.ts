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

/** Hardcoded internal testing wallets (lowercased). These are Pantessa's own
 *  test wallets — not real external adopters. The admin dashboard flags them so
 *  a "TEST" badge (and the External-only filter) can separate our own dogfooding
 *  noise from genuine external usage. Includes the two OWNER_WALLETS above. */
export const TEST_WALLETS = [
  '0x66268791b55e1f5fa585d990326519f101407257',
  '0xc6d528748da994e1601267141a77f639ac0d4ace',
  '0x6f93fa8b383e51d59ddfc87988afc964d6ffb5da',
  '0x2e7c96201fc8d162aa53ded5a5f4c8d4399049d7',
  '0xfb6b3f49e3d831f162540f13e66dce81f7fa7ad0',
  '0x5eaabd731d2bc0490c2d47e41858e9b0629455a0',
  '0x7a7a4036d946d902bee16742b885514b2801b9e4',
  '0x2055fa9e99565181a8509b81cbd0aa3d73be8d56',
  '0xe630826c26760f46339cda35621e3aac63736c4a',
  '0xc917800fa6c9019d4d007302f09abfc16a657c26',
  '0xc7b4fde9b363514b5e84e2af8a63681aa495ec8c',
  // Nate's list, 2026-07-20 — includes the treasury itself (it signs test flows).
  '0x9cc0b7a0ddb091e17647d689206e730131e9892a',
  '0x9ab3c2631018e89d6be7416dac85b3a42ad81051',
  '0xd980fb8cda9bdab910147ee9e36ccc7c4c31f9b7',
  '0xfdcc56eef544a63b8301f5e9e7c4e17a37f32821',
] as const

const TEST_WALLET_SET = new Set<string>(TEST_WALLETS)

/** True for Pantessa's own testing wallets (owner + hardcoded test list). Used
 *  by the admin dashboard to flag internal dogfooding vs external adopters. */
export function isTestWallet(addr: string | null | undefined): boolean {
  if (!addr) return false
  return TEST_WALLET_SET.has(addr.toLowerCase())
}

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
