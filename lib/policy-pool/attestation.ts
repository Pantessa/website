// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — the policy signer (SIGNER lane)
//
//  The desk's policy signer issues one EIP-712 Attestation per approved
//  intent; the hook (PolicyPoolHook.sol) recovers it in beforeSwap and refuses
//  the swap unless the signer is `policySigner`. Domain, types and encoding
//  come from ./spec — this file only signs, verifies and hashes.
//
//  Key: POLICY_SIGNER_PRIVATE_KEY (server env only). Its address is
//  POLICY_SIGNER_ADDRESS, which the hook's owner sets as `policySigner`.
// ─────────────────────────────────────────────────────────────────────────

import { hashTypedData, isAddress, isHex, verifyTypedData, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  ATTESTATION_TTL_SEC,
  ATTESTATION_TYPES,
  ZERO_SWAPPER,
  intentIdFor,
  policyPoolDomain,
  type Attestation,
} from './spec'

export interface AttestationDomainOpts {
  chainId: number
  hook: Address
}

/** The policy signer's key, or a clear refusal when the env is missing or malformed. */
function signerKey(override?: Hex): Hex {
  const raw = override ?? process.env.POLICY_SIGNER_PRIVATE_KEY?.trim()
  if (!raw) {
    throw new Error(
      'POLICY_SIGNER_PRIVATE_KEY is not set: the policy signer cannot attest. Set it in the server env (its address goes in POLICY_SIGNER_ADDRESS and on the hook as policySigner).',
    )
  }
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
  if (!isHex(key) || key.length !== 66) {
    throw new Error('POLICY_SIGNER_PRIVATE_KEY is malformed: expected 32 bytes of hex (0x + 64 hex chars).')
  }
  return key
}

/** The policy signer's address from its key (never the key itself). */
export function policySignerAddress(opts: { privateKey?: Hex } = {}): Address {
  return privateKeyToAccount(signerKey(opts.privateKey)).address
}

/** Sign an attestation as the policy signer. Returns the 65-byte r‖s‖v signature. */
export async function signAttestation(
  att: Attestation,
  opts: AttestationDomainOpts & { privateKey?: Hex },
): Promise<Hex> {
  const account = privateKeyToAccount(signerKey(opts.privateKey))
  return account.signTypedData({
    domain: policyPoolDomain(opts.chainId, opts.hook),
    types: ATTESTATION_TYPES,
    primaryType: 'Attestation',
    message: att,
  })
}

/** True only when `sig` is `signer`'s signature over exactly this attestation and domain. Never throws. */
export async function verifyAttestation(
  att: Attestation,
  sig: Hex,
  opts: AttestationDomainOpts & { signer: Address },
): Promise<boolean> {
  try {
    if (!isAddress(opts.signer) || !isAddress(opts.hook)) return false
    return await verifyTypedData({
      address: opts.signer,
      domain: policyPoolDomain(opts.chainId, opts.hook),
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message: att,
      signature: sig,
    })
  } catch {
    return false
  }
}

/** The EIP-712 digest the hook recovers against: keccak256(0x1901 ‖ domainSeparator ‖ structHash). */
export function attestationDigest(att: Attestation, opts: AttestationDomainOpts): Hex {
  return hashTypedData({
    domain: policyPoolDomain(opts.chainId, opts.hook),
    types: ATTESTATION_TYPES,
    primaryType: 'Attestation',
    message: att,
  })
}

/** Build the attestation for one desk intent: hashed intent id, bearer when no swapper, expiry = now + ttl. */
export function attestationFor(input: {
  intentId: string
  poolId: Hex
  swapper: Address | null
  zeroForOne: boolean
  maxAmountIn: bigint
  origin: string
  ttlSec?: number
}): Attestation {
  const ttl = input.ttlSec ?? ATTESTATION_TTL_SEC
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error(`attestationFor: ttlSec must be a positive number of seconds (got ${input.ttlSec}).`)
  if (input.maxAmountIn <= BigInt(0)) throw new Error('attestationFor: maxAmountIn must be greater than zero.')
  const now = Math.floor(Date.now() / 1000)
  return {
    intentId: intentIdFor(input.intentId),
    poolId: input.poolId,
    swapper: input.swapper ?? ZERO_SWAPPER,
    zeroForOne: input.zeroForOne,
    maxAmountIn: input.maxAmountIn,
    expiry: BigInt(now + Math.floor(ttl)),
    origin: input.origin,
  }
}
