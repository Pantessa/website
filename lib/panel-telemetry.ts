'use client'

// App Mode panel telemetry: the panels' twin of ChatInterface's first-party
// beacon. Same wire contract (/api/embed/telemetry, firstParty lane = value-
// bearing outcomes ONLY, no prompt ever leaves the client), same money-moved
// semantics — valueUsd is the guardrail-priced notional, buildPath is the
// app-mode-* origin so /dashboard/embeds splits chat vs workspace conversion.
//
// Funnel semantics differ from chat on PURPOSE: a debounced live quote is
// browsing, not intent — the panel fires `tx-built` when the user opens
// Review & sign (the artifact is in front of them), and `signed` when the
// final step confirms. One beacon per moment, never per re-quote.

const sessionId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

export function postPanelTelemetry(payload: {
  outcome: 'tx-built' | 'signed'
  artifact: string
  chain?: string
  txUrl?: string
  valueUsd?: number
  buildPath: 'app-mode-swap' | 'app-mode-vote'
}) {
  void fetch('/api/embed/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      firstParty: true,
      sessionId,
      page: typeof window !== 'undefined' ? window.location.href : undefined,
      ...payload,
    }),
  }).catch(() => {})
}

export function chainLabelOf(chainId: number): string {
  return { 1: 'ethereum', 100: 'gnosis', 8453: 'base', 42161: 'arbitrum' }[chainId] ?? String(chainId)
}
