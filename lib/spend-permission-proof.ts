// Who may arm an autopilot (a DCA schedule, a spot protection).
//
// The arm routes are connect-to-act: with no session they take the wallet
// from the body, on the reasoning that only the schedule's owner can produce
// a permission signature the chain accepts. That holds for a NEW permission:
// the signature is simulated against the manager. It does not hold for a
// permission ALREADY approved on-chain - there the simulation was skipped, so
// the signature was never checked and anyone who knew the schedule id could
// turn a switched-off autopilot back on (2026-11-17 review). The permission
// struct is public the moment it is approved.
//
// The rule: a signature the chain just accepted is proof. Without one (the
// permission is already approved), the caller must be the owner by session
// or API key.

export type ArmProof = 'signature' | 'owner' | 'refused'

/** Pure. `approvedOnChain`: the manager already holds this permission, so no
 *  signature will be checked. `provenOwner`: the caller authenticated as the
 *  schedule's wallet (session or key), not merely named it in the body. */
export function armProof(approvedOnChain: boolean, provenOwner: boolean): ArmProof {
  if (!approvedOnChain) return 'signature'
  return provenOwner ? 'owner' : 'refused'
}

export const ARM_NEEDS_OWNER = 'This permission is already approved on-chain, so there is no new signature to check. Sign in with this wallet to turn it back on.'
