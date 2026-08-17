// ─────────────────────────────────────────────────────────────────────────
//  Wallet refusals — the client half of the ask-failure log.
//
//  ask_failures (lib/ask-failure.ts) records every money ask the SERVER
//  walled. It could not see the class of failure that bit the flagship
//  "Close SYRUP" chip on 2026-08-17: the ladder built and guarded a perfect
//  artifact, the beacon said tx-built, and then the WALLET said no
//  (MetaMask: `Provided chainId "1337" must match the active chainId
//  "4663"`) — a failure that lived only in one browser's red text. This
//  module makes that a row: every sign button reports a non-rejection
//  wallet error here, and it lands in the same admin queue
//  (/dashboard/failures, kind `wallet-refused`, had_funds TRUE — the money
//  was there; the wallet was the wall). A human "no" is not a failure and is
//  never reported.
// ─────────────────────────────────────────────────────────────────────────

export const WALLET_REFUSAL_KIND = 'wallet-refused'

export type WalletArtifact = 'hl-order' | 'hl-leverage' | 'hl-agent' | 'cow-order' | 'tx' | 'tx-chain' | 'vote' | 'opensea-listing'

export interface WalletRefusalReport {
  wallet: string | null | undefined
  artifact: WalletArtifact
  /** What the user was signing, in our words (the card's summary line). */
  ask: string
  /** The wallet/RPC error text, verbatim (capped server-side). */
  detail: string
  buildPath?: string
  valueUsd?: number | null
  /** The connector the wallet arrived through (wagmi connector id/name) —
   *  the axis a wild-user matrix is built on. */
  connector?: string
  chainId?: number
}

/** Pure: is this wallet error worth a row? Human rejections are not. */
export function isReportableWalletError(message: string): boolean {
  const m = message.trim()
  if (!m) return false
  return !/user rejected|user denied|rejected the request|denied|declined|cancell?ed by user|action_rejected/i.test(m)
}

/** Fire-and-forget beacon; never throws, never blocks the sign flow. */
export function reportWalletRefusal(report: WalletRefusalReport): void {
  if (typeof window === 'undefined') return
  if (!isReportableWalletError(report.detail)) return
  void fetch('/api/ask-failures/wallet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {})
}
