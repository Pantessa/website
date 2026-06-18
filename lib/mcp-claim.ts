// MCP ownership claim (x402-launch M5, payTo-anchored). The operator of an MCP
// claims it by signing in with the wallet the MCP is PAID TO — its x402 `payTo`
// receiver, read straight from the MCP's own 402 challenge. That's the whole
// proof: the receiver address comes from the live service (never from the
// claimant), and whoever controls it is the one collecting the MCP's revenue —
// the real operator. SIWE already proves the wallet, so a claim is just "sign in
// with the payee wallet." No DNS, no files, no deploy.
//
// MCPs whose endpoint can't be read (no x402 402, or a shared gateway whose payee
// the operator doesn't control) fall back to admin verification.

import { getReceiver } from '@/lib/x402'

/** The endpoint host an MCP is claimed against (display), or null. */
export function endpointHost(endpoint: string | null): string | null {
  if (!endpoint) return null
  try {
    return new URL(endpoint).host.toLowerCase()
  } catch {
    return null
  }
}

export type ClaimVerification = { ok: boolean; reason?: string; receiver?: string }

/**
 * Read the MCP's x402 receiver (`payTo`) from its endpoint and check it matches
 * the claiming wallet. `endpoint` comes from the MCP record, not the request.
 */
export async function verifyReceiverClaim(
  endpoint: string | null,
  address: string,
): Promise<ClaimVerification> {
  if (!endpoint) {
    return { ok: false, reason: 'This MCP has no callable endpoint — it needs admin verification.' }
  }

  const receiver = await getReceiver(endpoint)
  if (!receiver) {
    return {
      ok: false,
      reason: "Couldn't read this MCP's payment receiver from its endpoint — it may need admin verification.",
    }
  }

  if (receiver.toLowerCase() !== address.toLowerCase()) {
    return {
      ok: false,
      receiver,
      reason: `Sign in with the wallet this MCP is paid to (${receiver}) to claim it.`,
    }
  }
  return { ok: true, receiver }
}

/** The receiver an operator must sign in with to claim, for display. */
export async function claimReceiver(endpoint: string | null): Promise<string | null> {
  if (!endpoint) return null
  return getReceiver(endpoint)
}
