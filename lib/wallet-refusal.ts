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

/**
 * Pure: the wallet's ACTUAL words out of a wrapped error. viem wraps RPC
 * failures (InternalRpcError etc.) so `e.message` leads with the generic
 * "An internal error was received." and the diagnosable text — MetaMask's
 * `Provided chainId "1337" must match the active chainId "4663"`, the node's
 * "insufficient funds for gas" — sits in `.details` / `.data.message` /
 * `.cause.…` / `.shortMessage`. Walk that chain, first non-empty specific
 * line wins; the generic viem line is a last resort. Never throws.
 */
export function walletErrorWords(e: unknown): string {
  const GENERIC = /^an internal error was received\.?$|^an unknown rpc error occurred\.?$|^request failed\.?$/i
  const seen = new Set<unknown>()
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const first = v.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
    if (first) out.push(first)
  }
  const walk = (x: unknown, depth: number) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 6) return
    seen.add(x)
    const o = x as Record<string, unknown>
    push((o.data as Record<string, unknown> | undefined)?.message)
    push(o.details)
    push(o.shortMessage)
    push(o.message)
    walk(o.cause, depth + 1)
    walk(o.data, depth + 1)
  }
  if (typeof e === 'string') push(e)
  else walk(e, 0)
  const specific = out.find((l) => !GENERIC.test(l) && !/^Details:\s*$/i.test(l))
  return (specific ?? out[0] ?? 'Wallet error (no message)').replace(/^Details:\s*/i, '').slice(0, 400)
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
