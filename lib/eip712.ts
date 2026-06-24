// ─────────────────────────────────────────────────────────────────────────
//  General EIP-712 signing tool — the engine's "sign typed data" capability.
//
//  NOT hard-coded to Snapshot. Any MCP that needs an EIP-712 signature (a
//  governance vote, a gasless order, a permit, a delegation) returns — or has a
//  registered builder that produces — a canonical `Eip712TypedData`, and this
//  tool signs it. Two signer modes (per the product decision):
//    • agent  — the engine signs server-side with the configured agent key
//               (PRIVATE_KEY). This is "let my agent vote": headless, no popup.
//    • wallet — the engine hands the typed data back for the human's wallet to
//               sign (the existing SignVoteButton path). Voting power / funds
//               stay bound to the human's address.
//
//  The signer is schema-agnostic: it coerces integer fields to BigInt by reading
//  the type list, so it works for Vote, Order, Permit, … without special cases.
// ─────────────────────────────────────────────────────────────────────────

import type { PrivateKeyAccount } from 'viem/accounts'
import { getAgentAccount } from './agent-wallet'

/** A canonical EIP-712 payload, exactly the shape viem/wagmi `signTypedData`
 *  takes (minus the BigInt coercion this module applies). */
export interface Eip712TypedData {
  domain: Record<string, unknown>
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: Record<string, unknown>
}

/**
 * Coerce integer (uint / int) fields of the PRIMARY type to BigInt — what viem
 * hashes. Schema-agnostic: it walks the primaryType's field list, so any EIP-712
 * type works, not just Snapshot's Vote. Bytes/address/string pass through.
 * Pure + exported for tests.
 */
export function coerceForSigning(td: Eip712TypedData): Eip712TypedData {
  const fields = td.types[td.primaryType] ?? []
  const message: Record<string, unknown> = { ...td.message }
  for (const f of fields) {
    const isInt = f.type.startsWith('uint') || f.type.startsWith('int')
    if (!isInt) continue
    const v = message[f.name]
    if (f.type.endsWith('[]')) {
      if (Array.isArray(v)) message[f.name] = v.map((x) => BigInt(x as number | string))
    } else if (typeof v === 'number' || typeof v === 'string') {
      message[f.name] = BigInt(v)
    }
  }
  return { ...td, message }
}

/** Short human label for what's being signed — used in the engine terminal. */
export function describeTypedData(td: Eip712TypedData): string {
  const domain = typeof td.domain.name === 'string' ? td.domain.name : 'EIP-712'
  return `${domain} · ${td.primaryType}`
}

/**
 * Sign a typed-data payload server-side with the agent key (default) or a
 * provided account. Returns the 0x signature. This is the monetizable "in the
 * path" action: the engine produced the artifact AND can settle it.
 */
export async function signEip712(td: Eip712TypedData, account?: PrivateKeyAccount): Promise<string> {
  const signer = account ?? getAgentAccount()
  const c = coerceForSigning(td)
  return signer.signTypedData({
    domain: c.domain,
    types: c.types,
    primaryType: c.primaryType,
    message: c.message,
    // viem's types are stricter than our generic record; the shape is correct.
  } as Parameters<PrivateKeyAccount['signTypedData']>[0])
}

/** The agent signer's address — the `from` baked into agent-signed artifacts. */
export function agentSignerAddress(): string {
  return getAgentAccount().address
}
