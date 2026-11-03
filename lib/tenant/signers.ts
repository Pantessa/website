// lib/tenant/signers.ts — registering a tenant signer, FAIL CLOSED (TENANT lane).
//
// A custody address joins `tenant.signers` only with its own signature over a
// live challenge (lib/tenant/store mintSignerChallenge): personal_sign for an
// EOA, EIP-1271 for a smart account. The challenge is single-use, and that
// rule is enforced by BURNING its nonce in the blotter BEFORE the signer is
// added: `recordBlotterOnce` writes the `tenant_updated` row under the
// tenant's lock, keyed `signer-nonce:<nonce>`, and answers the row (written),
// the existing row (already used → 409), or null (the write failed). On null
// the registration is REFUSED with a 503 in words — a burn that did not land
// would leave a valid signature re-usable inside its window (QA round 3).
//
// The I/O is injected (`deps`) so the pins can make the burn fail and prove
// nothing is added; the route passes the real blotter + Prisma.

import { recoverMessageAddress, type PublicClient } from 'viem'
import prisma from '@/lib/db'
import { recordBlotterOnce, type BlotterWrite } from '@/lib/tenant/blotter'
import { liveSignerNonces, lowerList, signerChallengeText, signerNonceOk } from '@/lib/tenant/store'
import type { BlotterEvent } from '@/lib/tenant/spec'

export interface SignerRegistrationInput {
  tenant: { id: string; slug: string; signers: unknown }
  by: string
  address: string
  signature: `0x${string}`
  chainId: number | null
  /** The nonce the caller names, or undefined to try every live challenge (the console's shape). */
  nonce?: unknown
  /** The public client for `chainId` (EIP-1271), when one was asked for. */
  client?: PublicClient | null
}

export interface SignerRegistrationDeps {
  /** Has this nonce already registered a signer? (fast path; the burn is the atomic check) */
  isBurned: (tenantId: string, nonce: string) => Promise<boolean>
  /** Burn the nonce: write the registration row exactly once. null = the write failed. */
  burn: (once: string, e: BlotterEvent) => Promise<BlotterWrite | null>
  /** Add the signer (after a burn that landed). */
  addSigner: (tenantId: string, signers: string[]) => Promise<unknown>
}

export const SIGNER_DEPS: SignerRegistrationDeps = {
  isBurned: async (tenantId, nonce) => !!(await prisma.blotterRow.findFirst({ where: { tenantId, kind: 'tenant_updated', payload: { path: ['nonce'], equals: nonce } }, select: { id: true } })),
  burn: recordBlotterOnce,
  addSigner: (tenantId, signers) => prisma.tenant.update({ where: { id: tenantId }, data: { signers } }),
}

export type SignerRegistration =
  | { ok: true; status: 200; address: string; proof: 'personal_sign' | 'eip1271'; signers: string[]; tenant?: unknown }
  | { ok: false; status: 400 | 403 | 409 | 503; error: string; field?: string; reason: 'SIGNER_DENIED' | 'BLOTTER_UNAVAILABLE' }

/** Verify the proof, burn the nonce, then (and only then) add the signer. */
export async function registerSigner(input: SignerRegistrationInput, deps: SignerRegistrationDeps = SIGNER_DEPS): Promise<SignerRegistration> {
  const { tenant, address } = input
  let nonces: string[]
  if (input.nonce !== undefined && input.nonce !== null) {
    const ok = signerNonceOk(tenant, address, input.nonce)
    if (!ok.ok) return { ok: false, status: 400, error: ok.why, field: 'nonce', reason: 'SIGNER_DENIED' }
    nonces = [input.nonce as string]
  } else {
    nonces = liveSignerNonces(tenant, address)
  }

  const client = input.client ?? null
  const hasCode = client ? await client.getCode({ address: address as `0x${string}` }).then((c) => !!c && c !== '0x').catch(() => false) : false
  let proof: 'personal_sign' | 'eip1271' | null = null
  let nonce = ''
  for (const n of nonces) {
    const message = signerChallengeText(tenant.slug, address, n)
    try {
      if ((await recoverMessageAddress({ message, signature: input.signature })).toLowerCase() === address) proof = 'personal_sign'
    } catch {
      /* not a plain EOA signature — try the account's own validator */
    }
    if (!proof && client && hasCode) {
      try {
        if (await client.verifyMessage({ address: address as `0x${string}`, message, signature: input.signature })) proof = 'eip1271'
      } catch {
        proof = null
      }
    }
    if (proof) {
      nonce = n
      break
    }
  }
  if (!proof) {
    return {
      ok: false,
      status: 403,
      error: `the signature does not prove control of ${address}: it must be that address's own personal_sign over a live challenge (GET …/signers/challenge, 15 minutes), or an EIP-1271 signature its contract accepts on chainId.`,
      reason: 'SIGNER_DENIED',
    }
  }
  if (await deps.isBurned(tenant.id, nonce).catch(() => false)) {
    return { ok: false, status: 409, error: 'this challenge was already used — GET a fresh one.', field: 'nonce', reason: 'SIGNER_DENIED' }
  }

  const before = lowerList(tenant.signers)
  const after = before.includes(address) ? before : [...before, address]
  // THE BURN, FIRST. Single-use is only as strong as this write: no row, no signer.
  const burned = await deps
    .burn(`signer-nonce:${nonce}`, {
      tenantId: tenant.id,
      kind: 'tenant_updated',
      payload: { by: input.by, event: 'signer_registered', changes: { signers: { from: before, to: after } }, address, proof, nonce, ...(input.chainId != null ? { chainId: input.chainId } : {}) },
    })
    .catch(() => null)
  if (!burned) {
    return {
      ok: false,
      status: 503,
      error: 'The desk could not write this registration to the tenant blotter, so nothing was registered — a challenge whose use is not on the record could be replayed. Try again in a moment with a fresh challenge.',
      reason: 'BLOTTER_UNAVAILABLE',
    }
  }
  if (!burned.written) {
    return { ok: false, status: 409, error: 'this challenge was already used — GET a fresh one.', field: 'nonce', reason: 'SIGNER_DENIED' }
  }
  const tenantRow = before.includes(address) ? undefined : await deps.addSigner(tenant.id, after)
  return { ok: true, status: 200, address, proof, signers: after, tenant: tenantRow }
}
