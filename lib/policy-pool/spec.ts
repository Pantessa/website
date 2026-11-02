// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — shared spec (coordinator-owned; lanes import, never edit)
//
//  A Uniswap v4 pool whose hook (contracts/policy-pool/src/PolicyPoolHook.sol)
//  refuses every swap that does not carry an ATTESTATION signed by the desk's
//  policy signer, and emits `DeskFill` with the intent's provenance after a
//  fill. This file is the executable form of the contract in
//  /Users/nate/pantessa/squad-policy-pool-2026-11-02/README.md: the EIP-712
//  domain and types, the hookData encoding, and the hook's event/error ABI.
//  Solidity and TypeScript MUST agree byte for byte — the SIGNER lane's test
//  vectors (contracts/policy-pool/test/vectors/attestation.json) prove it.
// ─────────────────────────────────────────────────────────────────────────

import { decodeAbiParameters, encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from 'viem'

/** One signed permission to swap once, on one pool, one side, up to a size, before an expiry. */
export interface Attestation {
  /** keccak256(utf8(desk intent id)) — single use on-chain. */
  intentId: Hex
  /** v4 PoolId = keccak256(abi.encode(PoolKey)). */
  poolId: Hex
  /** EOA expected as tx.origin; zero address = bearer (smart-account custody). */
  swapper: Address
  zeroForOne: boolean
  /** Atoms of the input currency; the swap must be exact-in and within this. */
  maxAmountIn: bigint
  /** Unix seconds. */
  expiry: bigint
  /** Provenance, emitted verbatim: `dune:<queryId>`, `desk:<intentId>`, `demo:<label>`. */
  origin: string
}

export const ZERO_SWAPPER: Address = '0x0000000000000000000000000000000000000000'
export const ATTESTATION_TTL_SEC = 600

export const POLICY_POOL_EIP712_NAME = 'PantessaPolicyPool'
export const POLICY_POOL_EIP712_VERSION = '1'

export function policyPoolDomain(chainId: number, hook: Address) {
  return { name: POLICY_POOL_EIP712_NAME, version: POLICY_POOL_EIP712_VERSION, chainId, verifyingContract: hook } as const
}

/** EIP-712 types; the primary type is `Attestation`. */
export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'intentId', type: 'bytes32' },
    { name: 'poolId', type: 'bytes32' },
    { name: 'swapper', type: 'address' },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'maxAmountIn', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'origin', type: 'string' },
  ],
} as const

/** `Attestation(bytes32 intentId,bytes32 poolId,address swapper,bool zeroForOne,uint256 maxAmountIn,uint256 expiry,string origin)` */
export const ATTESTATION_TYPE_STRING =
  'Attestation(bytes32 intentId,bytes32 poolId,address swapper,bool zeroForOne,uint256 maxAmountIn,uint256 expiry,string origin)'
export const ATTESTATION_TYPEHASH: Hex = keccak256(stringToHex(ATTESTATION_TYPE_STRING))

/** The desk intent id → on-chain intentId. */
export function intentIdFor(deskIntentId: string): Hex {
  return keccak256(stringToHex(deskIntentId))
}

/** v4 PoolKey → PoolId, exactly as PoolIdLibrary.toId. */
export interface PoolKeyLike {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}
export function poolIdFor(key: PoolKeyLike): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  )
}

/** hookData = abi.encode(Attestation att, bytes sig). */
export const HOOK_DATA_PARAMS = [
  {
    name: 'att',
    type: 'tuple',
    components: [
      { name: 'intentId', type: 'bytes32' },
      { name: 'poolId', type: 'bytes32' },
      { name: 'swapper', type: 'address' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'maxAmountIn', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'origin', type: 'string' },
    ],
  },
  { name: 'sig', type: 'bytes' },
] as const

export function encodeHookData(att: Attestation, sig: Hex): Hex {
  return encodeAbiParameters(HOOK_DATA_PARAMS, [att, sig])
}

export function decodeHookData(data: Hex): { att: Attestation; sig: Hex } {
  const [att, sig] = decodeAbiParameters(HOOK_DATA_PARAMS, data)
  return {
    att: {
      intentId: att.intentId,
      poolId: att.poolId,
      swapper: att.swapper,
      zeroForOne: att.zeroForOne,
      maxAmountIn: att.maxAmountIn,
      expiry: att.expiry,
      origin: att.origin,
    },
    sig,
  }
}

/** keccak256(bytes(origin)) — the indexed topic beside the verbatim string. */
export function originHashFor(origin: string): Hex {
  return keccak256(stringToHex(origin))
}

/** The hook's public ABI surface every lane needs (events, errors, admin reads). */
export const POLICY_POOL_HOOK_ABI = [
  {
    type: 'event',
    name: 'DeskFill',
    inputs: [
      { name: 'intentId', type: 'bytes32', indexed: true },
      { name: 'originHash', type: 'bytes32', indexed: true },
      { name: 'swapper', type: 'address', indexed: true },
      { name: 'poolId', type: 'bytes32', indexed: false },
      { name: 'zeroForOne', type: 'bool', indexed: false },
      { name: 'amount0', type: 'int128', indexed: false },
      { name: 'amount1', type: 'int128', indexed: false },
      { name: 'origin', type: 'string', indexed: false },
    ],
  },
  { type: 'event', name: 'PolicySignerSet', inputs: [{ name: 'signer', type: 'address', indexed: true }] },
  { type: 'event', name: 'PausedSet', inputs: [{ name: 'paused', type: 'bool', indexed: false }] },
  { type: 'error', name: 'NotAttested', inputs: [] },
  { type: 'error', name: 'WrongPool', inputs: [] },
  { type: 'error', name: 'WrongSide', inputs: [] },
  { type: 'error', name: 'ExactOutRefused', inputs: [] },
  { type: 'error', name: 'OverSize', inputs: [] },
  { type: 'error', name: 'Expired', inputs: [] },
  { type: 'error', name: 'WrongSwapper', inputs: [] },
  { type: 'error', name: 'IntentUsed', inputs: [] },
  { type: 'error', name: 'BadSigner', inputs: [] },
  { type: 'error', name: 'Paused', inputs: [] },
  { type: 'error', name: 'OnlyOwnerLiquidity', inputs: [] },
  { type: 'function', name: 'policySigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'usedIntent', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const

/** Ledger row kinds, in the order a happy intent walks them. */
export const POLICY_POOL_EVENT_KINDS = [
  'guard_allowed',
  'guard_refused',
  'attested',
  'handed_off',
  'signed',
  'mined',
  'fill',
  'onchain_revert',
  'dune_seen',
] as const
export type PolicyPoolEventKind = (typeof POLICY_POOL_EVENT_KINDS)[number]
