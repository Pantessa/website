// Writes the policy pool's cross-implementation test vectors:
//   contracts/policy-pool/test/vectors/attestation.json
// The HOOK lane's Foundry test loads that file and must reproduce every
// digest and recover every signer — it is the proof that TypeScript
// (lib/policy-pool/spec.ts + attestation.ts) and Solidity agree byte for byte.
//
// Signed by ANVIL ACCOUNT 0, a publicly documented throwaway key — never a
// real key. ECDSA here is RFC 6979 deterministic, so the file is reproducible.
//   npx tsx scripts/policy-pool-attestation-vectors.ts          # write
//   npx tsx scripts/policy-pool-attestation-vectors.ts --check  # fail if the file drifts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  concat,
  encodeAbiParameters,
  getAddress,
  domainSeparator as viemDomainSeparator,
  hashStruct,
  keccak256,
  parseSignature,
  recoverTypedDataAddress,
  stringToHex,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { attestationDigest, signAttestation, verifyAttestation } from '../lib/policy-pool/attestation'
import {
  ATTESTATION_TYPEHASH,
  ATTESTATION_TYPES,
  ATTESTATION_TYPE_STRING,
  POLICY_POOL_EIP712_NAME,
  POLICY_POOL_EIP712_VERSION,
  ZERO_SWAPPER,
  decodeHookData,
  encodeHookData,
  intentIdFor,
  originHashFor,
  poolIdFor,
  policyPoolDomain,
  type Attestation,
} from '../lib/policy-pool/spec'

export const VECTORS_PATH = join(__dirname, '..', 'contracts', 'policy-pool', 'test', 'vectors', 'attestation.json')

/** Anvil / Hardhat default account 0. PUBLIC test key — anyone can sign with it. Never fund it on a real chain. */
export const ANVIL_ACCOUNT_0_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const ANVIL_ACCOUNT_0_ADDRESS: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

/**
 * Example hook address. Its low 14 bits are 0x08C0 = BEFORE_ADD_LIQUIDITY (1<<11)
 * | BEFORE_SWAP (1<<7) | AFTER_SWAP (1<<6) — exactly the flags PolicyPoolHook
 * declares — so a test that checks Hooks.validateHookPermissions accepts it.
 * Nothing is deployed there; it is only the EIP-712 verifyingContract.
 */
export const EXAMPLE_HOOK: Address = getAddress('0x4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a08c0')
const HOOK_FLAG_MASK = 0x3fff
const EXPECTED_HOOK_FLAGS = (1 << 11) | (1 << 7) | (1 << 6)

const BASE_SEPOLIA = 84532
const BASE = 8453
const NATIVE: Address = '0x0000000000000000000000000000000000000000'
const USDC_BASE_SEPOLIA: Address = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const USDC_BASE: Address = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)
/** A fixed expiry (2030-01-01T00:00:00Z) so the vectors never change; a fork test at today's block is inside it. */
const FIXED_EXPIRY = BigInt(1893456000)

const SWAPPER: Address = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8') // Anvil account 1, public

/** Long, multi-script origin: Latin, CJK, emoji with ZWJ + skin tone, combining marks, RTL, astral plane. */
const UNICODE_ORIGIN =
  'dune:9055910 · Ünïcödé ✓ 政策池 ポリシー 🏦🧾👩🏽‍💻🏳️‍🌈 é ñ̃ العربية עברית 𝔓𝔞𝔫𝔱𝔢𝔰𝔰𝔞 ' +
  '—'.repeat(8) +
  ' '.repeat(1) +
  '∑∫√∞≠≤≥ '.repeat(6) +
  'end'

interface VectorInput {
  name: string
  description: string
  chainId: number
  pool: { currency0: Address; currency1: Address; fee: number; tickSpacing: number }
  deskIntentId: string
  swapper: Address
  zeroForOne: boolean
  maxAmountIn: bigint
  origin: string
}

const INPUTS: VectorInput[] = [
  {
    name: 'normal',
    description: 'A desk attestation bound to one swapper EOA: sell 0.01 ETH for USDC on the Base Sepolia demo pool.',
    chainId: BASE_SEPOLIA,
    pool: { currency0: NATIVE, currency1: USDC_BASE_SEPOLIA, fee: 500, tickSpacing: 10 },
    deskIntentId: 'cmhpolicypool0000000001',
    swapper: SWAPPER,
    zeroForOne: true,
    maxAmountIn: BigInt('10000000000000000'),
    origin: 'desk:cmhpolicypool0000000001',
  },
  {
    name: 'bearer',
    description: 'swapper = address(0): any tx.origin may use it (smart-account custody). Buy ETH with 25 USDC on Base mainnet shape.',
    chainId: BASE,
    pool: { currency0: NATIVE, currency1: USDC_BASE, fee: 500, tickSpacing: 10 },
    deskIntentId: 'job_bearer_25usdc',
    swapper: ZERO_SWAPPER,
    zeroForOne: false,
    maxAmountIn: BigInt(25_000_000),
    origin: 'dune:9055910',
  },
  {
    name: 'unicode-origin',
    description: 'A long origin string mixing multi-byte UTF-8 (CJK, emoji with ZWJ, combining marks, RTL, astral-plane letters). The struct hash uses keccak256(bytes(origin)) of the UTF-8 bytes.',
    chainId: BASE_SEPOLIA,
    pool: { currency0: NATIVE, currency1: USDC_BASE_SEPOLIA, fee: 500, tickSpacing: 10 },
    deskIntentId: 'intent-ünïcödé-政策',
    swapper: SWAPPER,
    zeroForOne: true,
    maxAmountIn: BigInt(1),
    origin: UNICODE_ORIGIN,
  },
  {
    name: 'max-amount',
    description: 'maxAmountIn = type(uint256).max (2^256 - 1): the size check never bites, every other check still does.',
    chainId: BASE_SEPOLIA,
    pool: { currency0: NATIVE, currency1: USDC_BASE_SEPOLIA, fee: 500, tickSpacing: 10 },
    deskIntentId: 'demo:max-amount',
    swapper: SWAPPER,
    zeroForOne: false,
    maxAmountIn: MAX_UINT256,
    origin: 'demo:max-amount',
  },
  {
    name: 'empty-origin',
    description: 'origin = "" (empty string): the struct hash carries keccak256("") = 0xc5d2…a470.',
    chainId: BASE_SEPOLIA,
    pool: { currency0: NATIVE, currency1: USDC_BASE_SEPOLIA, fee: 500, tickSpacing: 10 },
    deskIntentId: 'demo:empty-origin',
    swapper: ZERO_SWAPPER,
    zeroForOne: true,
    maxAmountIn: BigInt('500000000000000000'),
    origin: '',
  },
]

/** The struct encoding by hand (EIP-712 §encodeData), independent of viem's hashStruct. */
export function manualEncodedStruct(att: Attestation): Hex {
  return encodeAbiParameters(
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
    [ATTESTATION_TYPEHASH, att.intentId, att.poolId, att.swapper, att.zeroForOne, att.maxAmountIn, att.expiry, keccak256(stringToHex(att.origin))],
  )
}

/** The domain separator by hand: keccak256(abi.encode(EIP712Domain typehash, name hash, version hash, chainId, verifyingContract)). */
export function manualDomainSeparator(chainId: number, hook: Address): Hex {
  const domainTypehash = keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'))
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [domainTypehash, keccak256(stringToHex(POLICY_POOL_EIP712_NAME)), keccak256(stringToHex(POLICY_POOL_EIP712_VERSION)), BigInt(chainId), hook],
    ),
  )
}

function assert(ok: boolean, what: string): void {
  if (!ok) throw new Error(`vector self-check failed: ${what}`)
}

export async function buildVectors(): Promise<Record<string, unknown>> {
  assert((parseInt(EXAMPLE_HOOK.slice(-4), 16) & HOOK_FLAG_MASK) === EXPECTED_HOOK_FLAGS, 'example hook flag bits')
  assert(privateKeyToAccount(ANVIL_ACCOUNT_0_KEY).address === ANVIL_ACCOUNT_0_ADDRESS, 'anvil account 0 address')

  const vectors = []
  for (const v of INPUTS) {
    const poolKey = { ...v.pool, hooks: EXAMPLE_HOOK }
    const att: Attestation = {
      intentId: intentIdFor(v.deskIntentId),
      poolId: poolIdFor(poolKey),
      swapper: v.swapper,
      zeroForOne: v.zeroForOne,
      maxAmountIn: v.maxAmountIn,
      expiry: FIXED_EXPIRY,
      origin: v.origin,
    }
    const domain = policyPoolDomain(v.chainId, EXAMPLE_HOOK)
    const domainSeparator = viemDomainSeparator({ domain })
    const encodedStruct = manualEncodedStruct(att)
    const structHash = hashStruct({ data: att, primaryType: 'Attestation', types: ATTESTATION_TYPES })
    const digest = attestationDigest(att, { chainId: v.chainId, hook: EXAMPLE_HOOK })
    const signature = await signAttestation(att, { chainId: v.chainId, hook: EXAMPLE_HOOK, privateKey: ANVIL_ACCOUNT_0_KEY })
    const { r, s, v: vv, yParity } = parseSignature(signature)
    const hookData = encodeHookData(att, signature)

    // Every number computed two ways must agree before it is written.
    assert(domainSeparator === manualDomainSeparator(v.chainId, EXAMPLE_HOOK), `${v.name}: domain separator`)
    assert(structHash === keccak256(encodedStruct), `${v.name}: struct hash`)
    assert(digest === keccak256(concat(['0x1901', domainSeparator, structHash])), `${v.name}: digest`)
    assert(
      (await recoverTypedDataAddress({ domain, types: ATTESTATION_TYPES, primaryType: 'Attestation', message: att, signature })) ===
        ANVIL_ACCOUNT_0_ADDRESS,
      `${v.name}: recover`,
    )
    assert(await verifyAttestation(att, signature, { chainId: v.chainId, hook: EXAMPLE_HOOK, signer: ANVIL_ACCOUNT_0_ADDRESS }), `${v.name}: verify`)
    const back = decodeHookData(hookData)
    assert(JSON.stringify(back, big) === JSON.stringify({ att, sig: signature }, big), `${v.name}: hookData round trip`)
    assert(signature.length === 132, `${v.name}: 65-byte signature`)

    vectors.push({
      name: v.name,
      description: v.description,
      domain: { name: domain.name, version: domain.version, chainId: v.chainId, verifyingContract: EXAMPLE_HOOK },
      domainSeparator,
      poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks: poolKey.hooks },
      deskIntentId: v.deskIntentId,
      attestation: {
        intentId: att.intentId,
        poolId: att.poolId,
        swapper: att.swapper,
        zeroForOne: att.zeroForOne,
        maxAmountIn: att.maxAmountIn.toString(),
        expiry: att.expiry.toString(),
        origin: att.origin,
      },
      originUtf8Hex: stringToHex(att.origin),
      originHash: originHashFor(att.origin),
      typeHash: ATTESTATION_TYPEHASH,
      encodedStruct,
      structHash,
      digest,
      signer: ANVIL_ACCOUNT_0_ADDRESS,
      signature,
      r,
      s,
      v: Number(vv ?? BigInt(27 + (yParity ?? 0))),
      hookData,
    })
  }

  return {
    _readme: {
      what: 'EIP-712 Attestation test vectors for PolicyPoolHook. Generated by scripts/policy-pool-attestation-vectors.ts from lib/policy-pool/spec.ts; regenerate, never hand-edit. Every value below was computed twice (viem and a hand encoding) and checked before writing.',
      signerKey: `${ANVIL_ACCOUNT_0_KEY} = Anvil/Hardhat default account 0. PUBLIC THROWAWAY KEY, never a real key; the hook's policySigner in a test is ${ANVIL_ACCOUNT_0_ADDRESS}.`,
      typeString: 'The EIP-712 type string of the primary type; typeHash = keccak256(typeString).',
      exampleHook: `${EXAMPLE_HOOK}: low 14 bits 0x08C0 = BEFORE_ADD_LIQUIDITY|BEFORE_SWAP|AFTER_SWAP (PolicyPoolHook's permissions). Nothing deployed there; it is only the domain's verifyingContract and the pool key's hooks.`,
      fields: {
        name: 'Short label for the case.',
        description: 'What the case exercises.',
        domain: 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract). verifyingContract = the hook.',
        domainSeparator: 'keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract)).',
        poolKey: 'The v4 PoolKey the poolId was computed from (fee in pips, tickSpacing signed).',
        deskIntentId: 'The desk-side intent id (UTF-8); attestation.intentId = keccak256(bytes(deskIntentId)).',
        attestation: 'The struct as signed. uint256 fields (maxAmountIn, expiry) are DECIMAL STRINGS (vm.parseJsonUint accepts them). expiry is fixed at 1893456000 (2030-01-01T00:00:00Z); a test at a later timestamp must vm.warp below it.',
        originUtf8Hex: 'bytes(origin) as hex — the exact UTF-8 bytes, for languages whose string literals are not UTF-8.',
        originHash: 'keccak256(bytes(origin)); also the DeskFill originHash topic.',
        typeHash: 'keccak256(typeString).',
        encodedStruct: 'abi.encode(typeHash, intentId, poolId, swapper, zeroForOne, maxAmountIn, expiry, keccak256(bytes(origin))) — the bytes under structHash.',
        structHash: 'keccak256(encodedStruct) = EIP-712 hashStruct(attestation).',
        digest: 'keccak256(0x1901 ‖ domainSeparator ‖ structHash) — what ECDSA.recover(digest, signature) must map to signer. Equals OZ EIP712._hashTypedDataV4(structHash) when the hook is deployed at verifyingContract on chainId.',
        signer: 'The address that signed (Anvil account 0).',
        signature: '65 bytes r ‖ s ‖ v, v ∈ {27, 28} — the bytes the hook receives in hookData.',
        r: 'signature[0:32].',
        s: 'signature[32:64] (low-s).',
        v: 'signature[64] as a number.',
        hookData: 'abi.encode((bytes32,bytes32,address,bool,uint256,uint256,string) att, bytes sig) — the exact bytes the swap carries; abi.decode it in the hook.',
      },
    },
    typeString: ATTESTATION_TYPE_STRING,
    typeHash: ATTESTATION_TYPEHASH,
    exampleHook: EXAMPLE_HOOK,
    signer: ANVIL_ACCOUNT_0_ADDRESS,
    vectors,
  }
}

function big(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v
}

async function main() {
  const out = JSON.stringify(await buildVectors(), null, 2) + '\n'
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(VECTORS_PATH, 'utf8')
    } catch {
      console.error(`❌ ${VECTORS_PATH} is missing — run without --check to write it.`)
      process.exit(1)
    }
    if (current !== out) {
      console.error(`❌ ${VECTORS_PATH} differs from what spec.ts produces — regenerate it.`)
      process.exit(1)
    }
    console.log(`✅ attestation vectors match spec.ts (${INPUTS.length} vectors)`)
    return
  }
  mkdirSync(dirname(VECTORS_PATH), { recursive: true })
  writeFileSync(VECTORS_PATH, out)
  console.log(`✅ wrote ${INPUTS.length} vectors → ${VECTORS_PATH}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
