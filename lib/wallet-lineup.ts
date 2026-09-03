// lib/wallet-lineup.ts — the ONE decision about which wallet lanes exist
// (doors run, 2026-09-01). Pure + dependency-free so the harness pins the
// exact lineup for both env states without importing RainbowKit:
//
//   · NEXT_PUBLIC_WC_PROJECT_ID absent  → EXACTLY today's connectors
//     (injected, MetaMask, Coinbase-EOA) — byte-identical behavior, pinned.
//   · present → the WalletConnect v2 lanes join (WalletConnect QR + Rainbow),
//     with the site's own metadata on the pairing screen.
//
// Why gated: WC wallets init the WC SignClient, which touches browser-only
// indexedDB during SSR (fatal under Next 16) and needs a real project id.
// The Coinbase gotchas (CLAUDE.md) are untouched: eoaOnly stays pinned in
// lib/wagmi.ts (popup-after-await breaks Smart-Wallet second signatures).

export type WalletLaneId = 'injected' | 'metaMask' | 'coinbase' | 'rainbow' | 'walletConnect'

/** A real WC Cloud project id — set AND not the placeholder. */
export function wcConfigured(projectId: string | null | undefined): boolean {
  return !!projectId && projectId !== 'YOUR_WALLETCONNECT_PROJECT_ID'
}

/** The wallet lineup for the RainbowKit modal, in display order. */
export function walletLineup(projectId: string | null | undefined): WalletLaneId[] {
  const base: WalletLaneId[] = ['injected', 'metaMask', 'coinbase']
  return wcConfigured(projectId) ? [...base, 'rainbow', 'walletConnect'] : base
}

/** The unified sign-in modal's wallet-lane subtitle (rule 6 — the lane lives
 *  INSIDE CreateAccountButton; this line is the only thing that changes when
 *  WC arrives, so env-absent stays byte-identical). */
export function walletLaneHint(projectId: string | null | undefined): string {
  return wcConfigured(projectId)
    ? 'MetaMask, Coinbase, Rainbow — or scan the QR with any mobile wallet (WalletConnect).'
    : 'MetaMask, Coinbase, or any installed browser wallet.'
}

/** Human names for the lanes. The sign-in door shows each lane as its brand
 *  LOGO (components/wallet-marks) — a logo is read at a glance where a name
 *  has to be parsed — so these carry the accessible name behind the mark. */
export const WALLET_LANE_NAMES: Record<WalletLaneId, string> = {
  metaMask: 'MetaMask',
  coinbase: 'Coinbase Wallet',
  rainbow: 'Rainbow',
  walletConnect: 'WalletConnect',
  injected: 'Any browser wallet',
}

/** The lanes the sign-in door draws as a logo strip, in display order.
 *  Derived from walletLineup() so the lineup keeps ONE source: adding a lane
 *  adds its logo for free. */
export function walletLaneChips(
  projectId: string | null | undefined,
): { id: WalletLaneId; name: string }[] {
  const lanes = walletLineup(projectId)
  const branded = lanes.filter((id) => id !== 'injected')
  // WalletConnect already means "any wallet", so the injected catch-all beside
  // it is redundant. Without WC the catch-all is load-bearing — it is how
  // someone on a non-MetaMask extension knows their wallet works here.
  const withCatchAll = lanes.includes('injected') && !lanes.includes('walletConnect')
  const ids: WalletLaneId[] = withCatchAll ? [...branded, 'injected'] : branded
  return ids.map((id) => ({ id, name: WALLET_LANE_NAMES[id] }))
}

/** WC pairing-screen metadata — the site's own identity, single source. */
export const WC_APP_METADATA = {
  appName: 'Pantessa',
  appDescription:
    'Say what should happen; sign what it builds. Guarded transactions — your wallet is the only signer.',
  appUrl: 'https://www.pantessa.com',
  appIcon: 'https://www.pantessa.com/icon.png',
} as const
