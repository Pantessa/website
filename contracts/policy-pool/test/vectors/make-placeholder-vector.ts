// Placeholder cross-implementation vector for test/PolicyPoolHook.t.sol (`test_vector_matchesTypeScript`).
// The SIGNER lane's scripts/policy-pool-attestation-vectors.ts REPLACES test/vectors/attestation.json with the
// same shape; until then this writes one signed by a DOCUMENTED THROWAWAY key (Anvil account 0 — public, never
// holds funds). Run from the website root: `npx tsx contracts/policy-pool/test/vectors/make-placeholder-vector.ts`.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, hashTypedData, keccak256, stringToHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  ATTESTATION_TYPEHASH,
  ATTESTATION_TYPES,
  encodeHookData,
  intentIdFor,
  originHashFor,
  policyPoolDomain,
  poolIdFor,
  type Attestation,
} from '../../../../lib/policy-pool/spec'

// Anvil / Hardhat account 0 — a published key, used ONLY so the vector is reproducible. Never fund it.
const THROWAWAY_PK: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(THROWAWAY_PK)

const chainId = 84532
// A hook address with the mined flag bits set (BEFORE_SWAP | AFTER_SWAP | BEFORE_ADD_LIQUIDITY = 0x8c0), arbitrary otherwise.
const hook = '0x00000000000000000000000000000000dead08c0' as const
const key = {
  currency0: '0x0000000000000000000000000000000000000000' as const,
  currency1: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const, // Base Sepolia USDC
  fee: 500,
  tickSpacing: 10,
  hooks: hook,
}
const att: Attestation = {
  intentId: intentIdFor('vector-intent-0001'),
  poolId: poolIdFor(key),
  swapper: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Anvil account 1 as tx.origin
  zeroForOne: true,
  maxAmountIn: BigInt('1000000000000000'), // 0.001 ETH (no bigint literals: the website's TS target is ES2017)
  expiry: BigInt('1800000000'),
  origin: 'demo:vector',
}
const domain = policyPoolDomain(chainId, hook)
const structHash = keccak256(
  encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'bool' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bytes32' },
    ],
    [ATTESTATION_TYPEHASH, att.intentId, att.poolId, att.swapper, att.zeroForOne, att.maxAmountIn, att.expiry, originHashFor(att.origin)],
  ),
)
const domainSep = keccak256(
  encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [
      keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
      keccak256(stringToHex(domain.name)),
      keccak256(stringToHex(domain.version)),
      BigInt(chainId),
      hook,
    ],
  ),
)
const digest = hashTypedData({ domain, types: ATTESTATION_TYPES, primaryType: 'Attestation', message: att })
const expectDigest = keccak256(`0x1901${domainSep.slice(2)}${structHash.slice(2)}`)
if (digest !== expectDigest) throw new Error(`digest mismatch: viem ${digest} vs manual ${expectDigest}`)

async function main() {
  const signature = await account.signTypedData({ domain, types: ATTESTATION_TYPES, primaryType: 'Attestation', message: att })
  const vector = {
    description:
      'PLACEHOLDER written by contracts/policy-pool/test/vectors/make-placeholder-vector.ts (HOOK lane). The SIGNER lane replaces this file with the same shape. Signed by Anvil account 0, a published throwaway key.',
    chainId,
    hook,
    signer: account.address,
    attestation: {
      intentId: att.intentId,
      poolId: att.poolId,
      swapper: att.swapper,
      zeroForOne: att.zeroForOne,
      maxAmountIn: att.maxAmountIn.toString(),
      expiry: att.expiry.toString(),
      origin: att.origin,
    },
    typeHash: ATTESTATION_TYPEHASH,
    structHash,
    domainSeparator: domainSep,
    digest,
    signature,
    hookData: encodeHookData(att, signature),
  }
  const out = join(dirname(fileURLToPath(import.meta.url)), 'attestation.json')
  writeFileSync(out, JSON.stringify(vector, null, 2) + '\n')
  console.log(`wrote ${out}\nsigner ${account.address}\ndigest ${digest}`)
}
main()
