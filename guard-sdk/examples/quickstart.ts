// @pantessa/guard — compile-checked quickstart. This file is swept by the
// repo's tsc, so every example the README shows stays honest: if an API
// drifts, the build breaks. Imports are relative here; consumers use
// `from '@pantessa/guard'`.
import { grantViolation, type GrantPolicy } from '../src/spend-grant'
import { policyCheck, recipientCheck, validityCheck, buildReport } from '../src/tx-guardrails'
import { assertTokenIdentity, type ContractReader } from '../src/token-identity'
import { buildGuardianClose, guardGuardianClose, type GuardianPolicyParams, type GuardianPosition } from '../src/hl-guardian'

// ── 1. The spend gate ──────────────────────────────────────────────────────
// You pass the policy row and today's spend; the package never opens a
// database — and a gate that cannot evaluate REFUSES (POLICY_ERROR).
export function exampleSpendGate(): void {
  const policy: GrantPolicy = {
    id: 'grant-1',
    allow: ['api.example.com'],
    perCallUsd: 5,
    perDayUsd: 20,
    expiresAt: new Date(Date.now() + 86_400_000),
    status: 'active',
    spendPolicyEnabled: true,
  }
  const violation = grantViolation(policy, 'api.example.com', 3.5, /* spentTodayUsd */ 12)
  if (violation) throw new Error(`refused: ${violation}`)
}

// ── 2. Artifact guardrails ────────────────────────────────────────────────
// Venue-neutral checks every signable artifact passes before it is offered:
// proceeds return to the signer, the validity window is sane, the spend
// policy gates at the point of signing.
export function exampleArtifactReport(from: string, receiver: string, validToSec: number, policy: GrantPolicy | null) {
  const policyResult = policyCheck(/* valueUsd */ 42.5, policy, /* spentTodayUsd */ 0, 'swap.example.com')
  return buildReport(42.5, [recipientCheck(receiver, from), validityCheck(validToSec), policyResult.check])
}

// ── 3. Token identity binding (the consistent-liar defense) ───────────────
// The reader is injected — viem, ethers, or a test fake all fit. Throws
// unless the address's on-chain symbol()/decimals() match the claim, and
// throws when it cannot read at all: unverifiable is refused, not trusted.
export async function exampleTokenIdentity(reader: ContractReader): Promise<void> {
  await assertTokenIdentity(reader, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 6)
}

// ── 4. The delegated-execution gate ───────────────────────────────────────
// A delegated close is DERIVED from live state (side, size, price all
// computed, none chosen), then re-verified by a ten-check, all-block gate.
export function exampleGuardianClose() {
  const policy: GuardianPolicyParams = { coin: 'ETH', side: 'long', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 10 }
  const position: GuardianPosition = { coin: 'ETH', szi: 0.5, entryPx: 3000 }
  const markPx = 2690 // below the 10% stop → the trigger is live
  const close = buildGuardianClose(policy, position, /* assetIndex */ 4, markPx, /* szDecimals */ 4)
  return guardGuardianClose(policy, position, close, {
    delegationStatus: 'active',
    delegationExpiresAt: new Date(Date.now() + 3600_000),
    killSwitchPaused: false,
    policyFlipWon: true,
    markPx,
    assetIndex: 4,
    szDecimals: 4,
  })
}
