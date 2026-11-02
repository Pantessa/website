// THE VENUE MANIFEST (2026-11-02): what Pantessa can build, exactly, per venue —
// the pinned contracts per chain, the selectors a build may emit, the signing
// domains, the guard that fences each venue, and the bounds it enforces.
//
// This file is PROOF, not prose. Every address, selector, domain and bound
// below is IMPORTED from the same `lib/` constant the builder encodes with and
// the guard re-decodes against. Nothing is retyped: scripts/venue-manifest-pins.ts
// reads each contract's `source` file and asserts the address literal is there.
// A pin a venue keeps only inside the free-mcps repo is named (`pinnedIn`),
// never copied. Selectors are derived from the builders' own ABIs with viem.
//
// Served as JSON at GET /api/venues/manifest (`?venue=<slug>` for one) and as
// the printable page /docs/venues. `integrity` is sha256 over the canonical
// JSON of { chains, fees, invariants, signing, venues } — generatedAt, commit
// and integrity itself are outside the hash, so two builds of the same code
// and env agree. Pure: no network, no DB, no browser.

import { sha256, stringToBytes, toFunctionSelector, toFunctionSignature, erc20Abi, type AbiFunction } from 'viem'
import { APP_CHAINS, chainById } from '@/lib/chains'
import { FREE_FLEET_SLUGS } from '@/lib/free-fleet'
import { MAX_VALID_SEC } from '@/lib/tx-guardrails'
import { PERMIT2_ADDRESS } from '@/lib/planner-artifact-guard'
import {
  CREATOR_FEE_SPLIT,
  CROSS_CHAIN_FEE_BPS,
  HL_BUILDER_FEE_TENTH_BPS,
  LINK_SWAP_FEE_BPS,
  ONECLICK_FEE_SPLIT,
  SWAP_FEE_BPS,
  TREASURY_ADDRESS,
} from '@/lib/fees'
import {
  FEE_TIERS,
  QUOTER_V2_ABI,
  SWAP_ROUTER_02_ABI,
  UNI_DEADLINE_SEC,
  UNI_DEFAULT_SLIPPAGE_BPS,
  UNI_QUOTER_V2,
  UNI_SWAP_ROUTER_02,
  UNISWAP_POLICY_HOST,
} from '@/lib/uniswap-venue'
import { PERMIT2_ABI, UNIVERSAL_ROUTER_ABI, V4_QUOTER_ABI } from '@/lib/uniswap-v4'
import { WETH_DEPOSIT_SELECTOR } from '@/lib/weth-wrap'
import { COW_API_BASE, COW_EIP712_DOMAIN, COW_ORDER_TYPES, GPV2_SETTLEMENT } from '@/lib/cow'
import { COW_POLICY_HOST, COW_VAULT_RELAYER, MAX_SLIPPAGE_BPS as COW_MAX_SLIPPAGE_BPS } from '@/lib/cow-guardrails'
import { AAVE_OP_SELECTORS } from '@/lib/aave-supply'
import { MORPHO_CHAIN_IDS, MORPHO_OP_SELECTORS, MORPHO_SINGLETON } from '@/lib/morpho-supply'
import { LIDO_GAS_BUFFER_ETH, LIDO_MCP, LIDO_STETH_MAINNET, LIDO_WSTETH_MAINNET, STETH_SUBMIT_ABI } from '@/lib/lido-stake'
import {
  ARBITRUM_CHAIN_ID,
  ARBITRUM_USDC,
  HL_BRIDGE2_ARBITRUM,
  HL_BUILDER_MIN_ACCOUNT_USD,
  HL_EXEC_POLICY_HOST,
  HL_EXEC_SLIPPAGE_BPS,
  HL_MIN_DEPOSIT_USDC,
  HL_MIN_ORDER_USD,
} from '@/lib/hyperliquid-exec'
import { HL_BATCH_MAX_MEMBERS } from '@/lib/hl-batch'
import { HL_DOMAIN_CHAIN_ID } from '@/lib/desk-wire'
import { CONFIDENTIAL_LEVEL, ORIGIN_CHAIN_IDS, VENUE_SHARE_MAX_BPS } from '@/lib/cross-chain-swap'
import { LIFI_MAX_QUOTE_SHORTFALL_BPS, LIFI_POLICY_HOST, LIFI_QUOTE_TTL_SEC, lifiRoutersFor } from '@/lib/lifi-venue'
import { LIFI_LEG_FLAT_USD, lifiBridgeRoutersFor } from '@/lib/lifi-bridge'
import { OPENSEA_CHAINS, OPENSEA_CONDUIT, OPENSEA_CONDUIT_KEY, OPENSEA_FEE_RECIPIENT, SEAPORT_1_6, SEAPORT_EIP712_TYPES } from '@/lib/opensea'
import { SNAPSHOT_VOTE_DOMAIN } from '@/lib/snapshot-vote'
import { ARB_SYS, ARB_SYS_ABI, INBOX_ABI, RH_L1_INBOX, ROBINHOOD_CHAIN_ID } from '@/lib/robinhood-bridge'
import { AAVE_MCP } from '@/lib/aave-exec'
import { MORPHO_MCP } from '@/lib/morpho-exec'

// ── Shapes ───────────────────────────────────────────────────────────────────

/** What a venue operation hands the wallet. `read` never produces anything signable. */
export type VenueShape = 'read' | 'tx' | 'txChain' | 'typedData' | 'order' | 'hlAction'

export interface ManifestContract {
  /** What the address is to the builder (router, settlement, token …). */
  role: string
  address: `0x${string}`
  /** `lib/<file>.ts#<CONST>` — the constant this value was read from. */
  source: string
  /** Set when an env var may REPLACE the pinned list at runtime (the pins skip the literal check then). */
  env?: string
}

export interface ManifestChain {
  chainId: number
  name: string
  explorerTx: string
  contracts: ManifestContract[]
}

export interface ManifestSelector {
  /** The function signature the selector was derived from. */
  signature: string
  selector: `0x${string}`
  /** The ABI constant it was derived from. */
  source: string
}

export interface ManifestOperation {
  name: string
  shape: VenueShape
  description: string
}

export interface ManifestGuard {
  module: string
  function: string
  refuses: string[]
}

export interface ManifestTypedData {
  domain: Record<string, string | number>
  primaryType: string
  fields: string[]
  source: string
}

export interface ManifestVenue {
  slug: string
  name: string
  /** `native` = a builder + guard pair in this repo; `free-mcp` = a build-don't-execute MCP in Pantessa/free-mcps; both = the MCP reads, the native layer builds. */
  kind: 'native' | 'free-mcp' | 'native+free-mcp'
  repo: string[]
  /** Which of the venue's operations can produce something a wallet signs. */
  produces: 'read-only' | 'tx-shaped'
  mcp?: {
    fleetSlug?: string
    host?: string
    /** `free-mcps/<service>/<file>` — where a pin lives when it is NOT in this repo. */
    pinnedIn?: string
  }
  chains: ManifestChain[]
  selectors: ManifestSelector[]
  typedData?: ManifestTypedData
  operations: ManifestOperation[]
  guards: ManifestGuard[]
  bounds: Record<string, number | string | readonly number[]>
  policy: {
    /** A venue the retail product allows by default. A tenant policy (default deny) would narrow this. */
    defaultAllowed: boolean
    notes: string[]
  }
  /** Honest status words a compliance reader needs before a prospect finds them. */
  custody: string
}

export interface VenueManifest {
  generatedAt: string
  /** The deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA); null outside a Vercel build. */
  commit: string | null
  /** sha256 over canonicalJson({ chains, fees, invariants, signing, venues }). */
  integrity: `0x${string}`
  chains: { chainId: number; name: string; key: string; nativeSymbol: string; explorerTx: string }[]
  fees: {
    treasury: `0x${string}`
    swapFeeBps: number
    linkSwapFeeBps: number
    creatorSplit: number
    hlBuilderFeeTenthBps: number
    crossChainFeeBps: number
    oneClickFeeSplit: number
    source: string
  }
  invariants: { name: string; detail: string; source: string }[]
  signing: { signer: string; lanesProven: string[]; custody: string }
  venues: ManifestVenue[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** JSON with every object's keys sorted, recursively — the hashed form. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** The hashed slice of a manifest — everything that describes the code, nothing that describes the moment. */
export function integrityBody(m: Pick<VenueManifest, 'chains' | 'fees' | 'invariants' | 'signing' | 'venues'>) {
  return { chains: m.chains, fees: m.fees, invariants: m.invariants, signing: m.signing, venues: m.venues }
}

export function manifestIntegrity(m: Pick<VenueManifest, 'chains' | 'fees' | 'invariants' | 'signing' | 'venues'>): `0x${string}` {
  return sha256(stringToBytes(canonicalJson(integrityBody(m))))
}

/** Every function in an ABI → its selector, derived (never retyped). */
function selectorsOf(abi: readonly unknown[], source: string, only?: readonly string[]): ManifestSelector[] {
  const fns = abi.filter((x): x is AbiFunction => !!x && typeof x === 'object' && (x as { type?: string }).type === 'function')
  return fns
    .filter((f) => !only || only.includes(f.name))
    .map((f) => ({ signature: toFunctionSignature(f), selector: toFunctionSelector(f), source }))
}

/** A selector a builder pins as a bare 8-hex string (Aave, Morpho) → the manifest's 0x form. */
function pinnedSelector(signature: string, hex8: string, source: string): ManifestSelector {
  const clean = hex8.replace(/^0x/, '').toLowerCase()
  return { signature, selector: `0x${clean}` as `0x${string}`, source }
}

function chainRow(chainId: number, contracts: ManifestContract[]): ManifestChain {
  const c = chainById(chainId)
  return { chainId, name: c?.name ?? `chain ${chainId}`, explorerTx: c?.explorerTx ?? '', contracts }
}

/** Explorer link for an address: the chain's tx explorer, re-pointed at /address/. */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const c = chainById(chainId)
  return c ? c.explorerTx.replace(/\/tx\/$/, '/address/') + address : null
}

const addr = (a: string) => a as `0x${string}`

// ── Shared guard rows ────────────────────────────────────────────────────────

const RECIPIENT_AND_VALIDITY: ManifestGuard = {
  module: 'lib/tx-guardrails.ts',
  function: 'recipientCheck · validityCheck · buildReport',
  refuses: [
    'proceeds to any wallet but the requesting one',
    `anything signable for more than ${MAX_VALID_SEC / 86400} days (MAX_VALID_SEC)`,
    'any block-level check failing → blocked: true → no consumer offers the artifact',
  ],
}

const KILL_SWITCH: ManifestGuard = {
  module: 'lib/tx-guardrails.ts',
  function: 'policyCheck (the kill switch)',
  refuses: ['every outflow while the account is frozen or revoked (ACCOUNT_FROZEN / REVOKED)', 'the build when the gate itself cannot run (POLICY_ERROR, fail-closed)'],
}

const PLANNER_GUARD: ManifestGuard = {
  module: 'lib/planner-artifact-guard.ts',
  function: 'guardPlannerArtifact',
  refuses: [
    'any transaction on a chain outside the app registry',
    `any call to Permit2 (${PERMIT2_ADDRESS}) from an external tool`,
    'bare native sends to a third party built by an external tool',
    'UNLIMITED token approvals',
    'transferFrom-family calldata and setApprovalForAll from external tools',
    'any generic EIP-712 order that is not a CoW order verifying against the pinned GPv2 settlement and paying the signer',
    'a Snapshot vote whose primaryType is not Vote, that carries an on-chain domain, or whose voter is not the requesting wallet',
  ],
}

// ── The venues ───────────────────────────────────────────────────────────────

function uniswapVenue(): ManifestVenue {
  const chains: ManifestChain[] = []
  for (const c of APP_CHAINS) {
    const contracts: ManifestContract[] = []
    if (c.uniswap) {
      contracts.push(
        { role: 'SwapRouter02', address: c.uniswap.swapRouter02, source: `lib/chains.ts#APP_CHAINS[${c.key}].uniswap.swapRouter02` },
        { role: 'QuoterV2', address: c.uniswap.quoterV2, source: `lib/chains.ts#APP_CHAINS[${c.key}].uniswap.quoterV2` },
      )
    }
    if (c.uniswapV4) {
      contracts.push(
        { role: 'Universal Router (v4)', address: c.uniswapV4.universalRouter, source: `lib/chains.ts#APP_CHAINS[${c.key}].uniswapV4.universalRouter` },
        { role: 'V4 Quoter', address: c.uniswapV4.quoter, source: `lib/chains.ts#APP_CHAINS[${c.key}].uniswapV4.quoter` },
        { role: 'Permit2', address: c.uniswapV4.permit2, source: `lib/chains.ts#APP_CHAINS[${c.key}].uniswapV4.permit2` },
      )
    }
    if (contracts.length) {
      contracts.push({ role: 'wrapped native (WETH)', address: c.wrappedNative, source: `lib/chains.ts#APP_CHAINS[${c.key}].wrappedNative` })
      chains.push(chainRow(c.id, contracts))
    }
  }
  return {
    slug: 'uniswap',
    name: 'Uniswap v3 (+ v4 fallback)',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { fleetSlug: 'uniswap-free', host: UNISWAP_POLICY_HOST, pinnedIn: 'free-mcps/services/uniswap/lib/chain.ts' },
    chains,
    selectors: [
      ...selectorsOf(SWAP_ROUTER_02_ABI, 'lib/uniswap-venue.ts#SWAP_ROUTER_02_ABI'),
      ...selectorsOf(QUOTER_V2_ABI, 'lib/uniswap-venue.ts#QUOTER_V2_ABI'),
      ...selectorsOf(UNIVERSAL_ROUTER_ABI, 'lib/uniswap-v4.ts#UNIVERSAL_ROUTER_ABI'),
      ...selectorsOf(V4_QUOTER_ABI, 'lib/uniswap-v4.ts#V4_QUOTER_ABI'),
      ...selectorsOf(PERMIT2_ABI, 'lib/uniswap-v4.ts#PERMIT2_ABI'),
      ...selectorsOf(erc20Abi, 'viem#erc20Abi (approve step)', ['approve']),
      { signature: 'deposit()', selector: WETH_DEPOSIT_SELECTOR as `0x${string}`, source: 'lib/weth-wrap.ts#WETH_DEPOSIT_SELECTOR' },
    ],
    operations: [
      { name: 'quote', shape: 'read', description: 'QuoterV2 across every fee tier, read over RPC.' },
      { name: 'swap (v3)', shape: 'txChain', description: 'approve (exact amount) → SwapRouter02 multicall(deadline, exactInputSingle | exactInput); the chain carries validUntil and a server refresh recipe, so stale calldata is never offered.' },
      { name: 'swap (v4 fallback)', shape: 'txChain', description: 'Permit2 approve → Universal Router execute(V4_SWAP[, PAY_PORTION, SWEEP]); only when v3 has no pool (NoV3PoolError), only on chains with uniswapV4 pinned.' },
      { name: 'wrap / unwrap', shape: 'tx', description: 'WETH deposit / withdraw on the pinned wrapped-native contract.' },
    ],
    guards: [
      { module: 'lib/uniswap-venue.ts', function: 'guardUniswapV3Build', refuses: ['a target that is not the pinned SwapRouter02 on the asked chain', 'an outer call that is not multicall(deadline, …) or a deadline other than the one stamped', 'a pool fee tier outside FEE_TIERS or not the quoted one', 'a recipient other than the signer', 'an amount or minimum-out other than the quoted one'] },
      { module: 'lib/uniswap-v4.ts', function: 'guardUniswapV4Build', refuses: ['a Permit2 approval wider than the swap', 'Universal Router commands other than the pinned set', 'a past deadline', 'an output recipient other than the signer'] },
      { module: 'lib/swap-exec.ts', function: 'buildGuardedSwap (the cascade)', refuses: ['a v3→v4 fallback on anything but NoV3PoolError, a v4→LiFi fallback on anything but GatedV4PoolError — a guard failure is a block, never a fallback trigger'] },
      { module: 'app/api/tx/refresh/route.ts', function: 'POST (rebuild)', refuses: ['client-supplied to/data/value — only intent params are accepted; every rebuild re-runs the full guard set plus an estimateGas revert probe'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: {
      feeTiers: FEE_TIERS,
      defaultSlippageBps: UNI_DEFAULT_SLIPPAGE_BPS,
      deadlineSec: UNI_DEADLINE_SEC,
      maxValidSec: MAX_VALID_SEC,
      swapFeeBps: SWAP_FEE_BPS,
      linkSwapFeeBps: LINK_SWAP_FEE_BPS,
    },
    policy: { defaultAllowed: true, notes: ['The fee rides as its own visible transfer step (or a PAY_PORTION command on v4), never buried in venue calldata.', 'Base pins are also exported as UNI_SWAP_ROUTER_02 / UNI_QUOTER_V2 (lib/uniswap-venue.ts); the pins script asserts they equal the registry.'] },
    custody: 'Signed by a browser or WalletConnect wallet today. A custody signer (Fireblocks, Copper, Safe) has not been drilled against the multicall deadline (an approver at lunch meets the refresh path).',
  }
}

function cowVenue(): ManifestVenue {
  const chains = APP_CHAINS.filter((c) => c.cow && COW_API_BASE[c.id]).map((c) =>
    chainRow(c.id, [
      { role: 'GPv2 settlement (verifying contract)', address: addr(GPV2_SETTLEMENT), source: 'lib/cow.ts#GPV2_SETTLEMENT' },
      { role: 'GPv2 vault relayer (the approval spender)', address: addr(COW_VAULT_RELAYER), source: 'lib/cow-guardrails.ts#COW_VAULT_RELAYER' },
    ]),
  )
  return {
    slug: 'cow',
    name: 'CoW Protocol',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { fleetSlug: 'cow-free', pinnedIn: 'free-mcps/services/cow/lib/cow.ts' },
    chains,
    selectors: selectorsOf(erc20Abi, 'viem#erc20Abi (approve step to the vault relayer)', ['approve']),
    typedData: {
      domain: { name: COW_EIP712_DOMAIN.name, version: COW_EIP712_DOMAIN.version, verifyingContract: GPV2_SETTLEMENT },
      primaryType: 'Order',
      fields: COW_ORDER_TYPES.Order.map((f) => `${f.name}:${f.type}`),
      source: 'lib/cow.ts#COW_EIP712_DOMAIN · COW_ORDER_TYPES',
    },
    operations: [
      { name: 'quote', shape: 'read', description: `The order book at ${COW_POLICY_HOST}.` },
      { name: 'swap order', shape: 'order', description: 'An EIP-712 GPv2 Order the wallet signs; solvers settle it in a batch auction (no MEV, no 600-second deadline race).' },
      { name: 'limit order', shape: 'order', description: 'The same Order struct with a limit price and a validTo measured in days.' },
      { name: 'submit · cancel', shape: 'read', description: 'Relays through /api/cow/submit, which re-gates on the server (recipient = signer, not expired, re-priced).' },
    ],
    guards: [
      { module: 'lib/cow-guardrails.ts', function: 'pureChecks', refuses: [`slippage above ${COW_MAX_SLIPPAGE_BPS} bps`, 'a receiver other than the signer', 'an expired or over-long validTo', 'a balance or allowance the chain does not show'] },
      { module: 'app/api/cow/submit/route.ts', function: 'POST (relay)', refuses: ['a signed order whose recipient is not the signer, that has expired, or that fails the live re-price and re-gate; a blocked quote withholds the raw order struct'] },
      PLANNER_GUARD,
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { maxSlippageBps: COW_MAX_SLIPPAGE_BPS, maxValidSec: MAX_VALID_SEC, swapFeeBps: SWAP_FEE_BPS, linkSwapFeeBps: LINK_SWAP_FEE_BPS },
    policy: { defaultAllowed: true, notes: ['The fee tier is written into the signed appData document, so the fee is visible in the order, never in calldata.', 'A Safe can pre-sign a GPv2 order — the natural first venue for a custody lane.'] },
    custody: 'Browser / WalletConnect wallets today. Safe presign (setPreSignature) is the designed custody lane; not yet drilled.',
  }
}

function aaveVenue(): ManifestVenue {
  return {
    slug: 'aave',
    name: 'Aave v4',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { host: new URL(AAVE_MCP).host, pinnedIn: 'free-mcps/services/aave/lib/tools.ts' },
    chains: [],
    selectors: (Object.keys(AAVE_OP_SELECTORS) as (keyof typeof AAVE_OP_SELECTORS)[]).map((op) =>
      pinnedSelector(`${op}(id, amount, ${op === 'withdraw' || op === 'borrow' ? 'receiver' : 'onBehalfOf'}) — spoke call`, AAVE_OP_SELECTORS[op], `lib/aave-supply.ts#AAVE_OP_SELECTORS.${op}`),
    ),
    operations: [
      { name: 'markets · reserves · portfolio', shape: 'read', description: 'The official AaveKit API (hub-and-spoke).' },
      { name: 'supply · withdraw · borrow · repay', shape: 'txChain', description: 'approve (exact) → the op call on the spoke; the spoke address is resolved from the official reserves list at build time and cross-checked against the reserve-id SET of the asked asset on that spoke — never an address a model or a tool asserted.' },
    ],
    guards: [
      { module: 'lib/aave-supply.ts', function: 'guardAaveOpBuild · guardAaveSupplyBuild', refuses: ['a final call whose target is not the spoke from the official reserves list', 'a selector other than the pinned one for THIS op (a borrow can never ride a withdraw build)', 'an amount word that is not the asked amount (or the live-probed withdraw-max sentinel / a repay-max within the bounded buffer)', 'an approval to any spender but the spoke, or wider than the op', 'a step on another chain'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { maxValidSec: MAX_VALID_SEC },
    policy: { defaultAllowed: true, notes: ['No spoke address is pinned in this repo on purpose: Aave v4 lists spokes dynamically, so the guard pins the SOURCE (the official reserves list) and the selector, then re-verifies the build against both.'] },
    custody: 'Plain approve + call transactions — the easiest venue for a custody signer; not yet drilled.',
  }
}

function morphoVenue(): ManifestVenue {
  const opsSig: Record<keyof typeof MORPHO_OP_SELECTORS, string> = {
    lend: 'supply(MarketParams,uint256,uint256,address,bytes)',
    'supply-collateral': 'supplyCollateral(MarketParams,uint256,address,bytes)',
    borrow: 'borrow(MarketParams,uint256,uint256,address,address)',
    repay: 'repay(MarketParams,uint256,uint256,address,bytes)',
    withdraw: 'withdraw(MarketParams,uint256,uint256,address,address)',
    'withdraw-collateral': 'withdrawCollateral(MarketParams,uint256,address,address)',
  }
  return {
    slug: 'morpho',
    name: 'Morpho Blue',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { host: new URL(MORPHO_MCP).host, pinnedIn: 'free-mcps/services/morpho/lib/morpho.ts' },
    chains: MORPHO_CHAIN_IDS.map((id) => chainRow(id, [{ role: 'Morpho Blue singleton (bytecode-verified)', address: addr(MORPHO_SINGLETON), source: 'lib/morpho-supply.ts#MORPHO_SINGLETON' }])),
    selectors: (Object.keys(MORPHO_OP_SELECTORS) as (keyof typeof MORPHO_OP_SELECTORS)[]).map((op) => pinnedSelector(opsSig[op], MORPHO_OP_SELECTORS[op], `lib/morpho-supply.ts#MORPHO_OP_SELECTORS.${op}`)),
    operations: [
      { name: 'markets · position · preview', shape: 'read', description: 'The official Blue API with a pinned on-chain fallback.' },
      { name: 'lend · supply collateral · borrow · repay · withdraw · withdraw collateral', shape: 'txChain', description: 'approve (exact) → the op on the singleton with the market tuple resolved on-chain; the per-op 32-byte word layout is pinned (MORPHO_OP_LAYOUT) and every word is verified.' },
    ],
    guards: [
      { module: 'lib/morpho-supply.ts', function: 'guardMorphoOpBuild', refuses: ['a target other than the singleton', 'a selector other than the pinned one for THIS op', 'a market tuple other than the one resolved on-chain', 'an onBehalf / receiver other than the signer', 'an amount word other than the asked amount', 'a thin health factor, a balance or borrowing power the chain does not show'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { maxValidSec: MAX_VALID_SEC },
    policy: { defaultAllowed: true, notes: [] },
    custody: 'Plain approve + call transactions; not yet drilled with a custody signer.',
  }
}

function lidoVenue(): ManifestVenue {
  return {
    slug: 'lido',
    name: 'Lido',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { host: new URL(LIDO_MCP).host, pinnedIn: 'free-mcps/services/lido/lib/chain.ts (stETH, wstETH, the withdrawal queue)' },
    chains: [
      chainRow(1, [
        { role: 'stETH (submit target)', address: addr(LIDO_STETH_MAINNET), source: 'lib/lido-stake.ts#LIDO_STETH_MAINNET' },
        { role: 'wstETH', address: addr(LIDO_WSTETH_MAINNET), source: 'lib/lido-stake.ts#LIDO_WSTETH_MAINNET' },
      ]),
    ],
    selectors: selectorsOf(STETH_SUBMIT_ABI, 'lib/lido-stake.ts#STETH_SUBMIT_ABI'),
    operations: [
      { name: 'stats · position · earnings · withdrawals', shape: 'read', description: 'RPC + Lido’s public APIs through the MCP.' },
      { name: 'stake', shape: 'tx', description: 'ONE payable submit(referral) on the pinned stETH contract for the asked ETH, built natively and re-decoded.' },
      { name: 'wrap · unwrap · request withdrawal · claim', shape: 'tx', description: 'Construction-only builds from the free MCP (pins in free-mcps/lido), guarded by the generic planner guard on this side.' },
    ],
    guards: [
      { module: 'lib/lido-stake.ts', function: 'guardLidoStakeBuild', refuses: ['anything but a single send_transaction step', 'a target other than the pinned stETH contract on Ethereum', 'a value other than the asked ETH', 'calldata that is not submit(referral)'] },
      PLANNER_GUARD,
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { gasBufferEth: LIDO_GAS_BUFFER_ETH, maxValidSec: MAX_VALID_SEC },
    policy: { defaultAllowed: true, notes: [] },
    custody: 'One payable call; not yet drilled with a custody signer.',
  }
}

function hyperliquidVenue(): ManifestVenue {
  return {
    slug: 'hyperliquid',
    name: 'Hyperliquid (HyperCore perps)',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { fleetSlug: 'hyperliquid-free', host: HL_EXEC_POLICY_HOST, pinnedIn: 'free-mcps/services/hyperliquid/lib/tools.ts (read-only)' },
    chains: [
      chainRow(ARBITRUM_CHAIN_ID, [
        { role: 'Hyperliquid Bridge2 (deposit target)', address: addr(HL_BRIDGE2_ARBITRUM), source: 'lib/hyperliquid-exec.ts#HL_BRIDGE2_ARBITRUM' },
        { role: 'USDC on Arbitrum (the only deposit asset)', address: addr(ARBITRUM_USDC), source: 'lib/hyperliquid-exec.ts#ARBITRUM_USDC' },
      ]),
    ],
    selectors: selectorsOf(erc20Abi, 'viem#erc20Abi (the deposit is a USDC transfer to Bridge2)', ['transfer']),
    typedData: {
      domain: { chainId: HL_DOMAIN_CHAIN_ID },
      primaryType: 'HyperliquidTransaction (the venue’s L1 action envelope: order · updateLeverage · approveBuilderFee · batch)',
      fields: ['action (msgpack-hashed, key order pinned by canonicalizeHlAction)', 'nonce', 'builder { b, f } when the builder fee is on'],
      source: 'lib/desk-wire.ts#HL_DOMAIN_CHAIN_ID · lib/hyperliquid-exec.ts#hlActionTypedData',
    },
    operations: [
      { name: 'markets · books · funding · portfolio · fills', shape: 'read', description: 'The public info API through the free MCP (read-only).' },
      { name: 'open · close · stop', shape: 'hlAction', description: 'An L1 order action the wallet signs; the relay (/api/hl/submit) re-derives the typed data from the raw action and nonce, recovers the signer, re-guards against the live market, then forwards.' },
      { name: 'batch', shape: 'hlAction', description: `Up to ${HL_BATCH_MAX_MEMBERS} members in one signature (guardHlBatch).` },
      { name: 'set leverage', shape: 'hlAction', description: 'Cross-mode leverage within the coin’s venue range, guarded.' },
      { name: 'approve builder fee', shape: 'hlAction', description: 'Approves EXACTLY the fee charged (HL_BUILDER_MAX_FEE_RATE), never a looser cap.' },
      { name: 'deposit', shape: 'tx', description: 'A USDC transfer on Arbitrum to Bridge2, minimum HL_MIN_DEPOSIT_USDC.' },
    ],
    guards: [
      { module: 'lib/hyperliquid-exec.ts', function: 'guardHlExecBuild · guardHlLeverageBuild · guardHlBuilderFeeApproval', refuses: ['an order whose coin, side, size or reduce-only flag differs from the intent', `a limit price further than ${HL_EXEC_SLIPPAGE_BPS} bps from the live mark`, 'leverage outside the coin’s 1–max range', 'a builder field naming any address but the treasury or any fee but the configured one', `an order under $${HL_MIN_ORDER_USD}`] },
      { module: 'lib/hl-batch.ts', function: 'guardHlBatch', refuses: [`more than ${HL_BATCH_MAX_MEMBERS} members`, 'a member whose nonce or shape is not the composed one'] },
      { module: 'app/api/hl/submit/route.ts', function: 'POST (relay)', refuses: ['a signature that does not recover to the account the action names', 'an action that fails the live re-guard'] },
      KILL_SWITCH,
    ],
    bounds: { signingDomainChainId: HL_DOMAIN_CHAIN_ID, execSlippageBps: HL_EXEC_SLIPPAGE_BPS, minOrderUsd: HL_MIN_ORDER_USD, minDepositUsdc: HL_MIN_DEPOSIT_USDC, batchMaxMembers: HL_BATCH_MAX_MEMBERS, builderFeeTenthBps: HL_BUILDER_FEE_TENTH_BPS, builderMinAccountUsd: HL_BUILDER_MIN_ACCOUNT_USD },
    policy: { defaultAllowed: true, notes: ['The builder fee (tenths of a bp) pays the treasury and is approved exactly once at exactly that rate.', 'Guardians (standing stop-loss / take-profit) run under a delegated agent key that the venue bars from withdrawing.'] },
    custody: 'UNMEASURED through custody. The fixed 1337 signing domain, the approveAgent delegation for standing intents and the builder-fee approval are the most custody friction of any venue here; measure a custody signer before promising perps.',
  }
}

function nearIntentsVenue(): ManifestVenue {
  // Every origin the ask grammar can name; the chain rows below are the ones in
  // the app registry (the rest are accepted by the MCP, named here as ids).
  const originIds = Array.from(new Set(Object.values(ORIGIN_CHAIN_IDS))).sort((a, b) => a - b)
  const registryOrigins = originIds.filter((id) => APP_CHAINS.some((c) => c.id === id))
  return {
    slug: 'near-intents',
    name: 'NEAR Intents (cross-chain via 1Click)',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { host: 'near-intents.yeetful.com', pinnedIn: 'free-mcps/services/near-intents/lib/oneclick.ts' },
    chains: registryOrigins.map((id) => chainRow(id, [])),
    selectors: selectorsOf(erc20Abi, 'viem#erc20Abi (an ERC-20 deposit is a transfer)', ['transfer']),
    operations: [
      { name: 'quote (dry run)', shape: 'read', description: 'The 1Click quote: route, delivered amount, the venue’s own share, a one-time deposit address.' },
      { name: 'swap', shape: 'tx', description: 'ONE unsigned deposit transfer on the origin chain moving EXACTLY the quoted amount to the quote’s own deposit address; solvers deliver on the destination; settlement is tracked to SUCCESS.' },
    ],
    guards: [
      { module: 'lib/cross-chain-swap.ts', function: 'guardCrossChainBuild · checkCrossChainFee · checkRecipient', refuses: ['a transfer that does not move exactly the quoted amount to the quote’s deposit address (born from a live fabricated-address near-miss, PR #374)', 'a built tx whose chainId is not the named origin chain', `a venue share above ${VENUE_SHARE_MAX_BPS} bps`, 'an app fee we did not request, to an address we did not pin, or above the bps we asked', 'a delivery address that fails the EIP-55 checksum'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { venueShareMaxBps: VENUE_SHARE_MAX_BPS, crossChainFeeBps: CROSS_CHAIN_FEE_BPS, oneClickFeeSplit: ONECLICK_FEE_SPLIT, confidentialLevel: CONFIDENTIAL_LEVEL, originChainIds: originIds },
    policy: { defaultAllowed: true, notes: ['No contract is pinned here by design: the deposit address is per quote and belongs to the venue; the guard pins the AMOUNT and the ADDRESS to the quote it just received, byte for byte.', 'Robinhood Chain and Arc inbound redirect to the LiFi funding plan (lib/jobs); outbound builds here.'] },
    custody: 'A single ERC-20 or native transfer; not yet drilled with a custody signer.',
  }
}

function lifiVenue(): ManifestVenue {
  const chains: ManifestChain[] = []
  for (const c of APP_CHAINS) {
    const contracts: ManifestContract[] = []
    for (const r of lifiRoutersFor(c.id)) contracts.push({ role: 'LiFi diamond (settlement router)', address: r, source: 'lib/lifi-venue.ts#lifiRoutersFor', env: 'LIFI_ROUTERS' })
    for (const r of lifiBridgeRoutersFor(c.id)) contracts.push({ role: 'LiFi diamond (funding bridge router)', address: r, source: 'lib/lifi-bridge.ts#lifiBridgeRoutersFor', env: 'LIFI_BRIDGE_ROUTERS' })
    if (contracts.length) chains.push(chainRow(c.id, contracts))
  }
  return {
    slug: 'lifi',
    name: 'LiFi (settlement on Robinhood Chain · the funding bridge)',
    kind: 'native',
    repo: ['Pantessa/website'],
    produces: 'tx-shaped',
    chains,
    selectors: selectorsOf(erc20Abi, 'viem#erc20Abi (exact-amount approval to the router)', ['approve']),
    operations: [
      { name: 'swap settlement (Robinhood Chain)', shape: 'txChain', description: 'Only when v4 has no executable pool (GatedV4PoolError): LiFi’s aggregator calldata, pinned to the per-chain router allowlist, with the approval re-decoded to the exact amount and the fill price-checked against our own quote.' },
      { name: 'funding bridge leg', shape: 'txChain', description: 'Moves the user’s own money between chains to fund an ask (no fee on funding legs).' },
    ],
    guards: [
      { module: 'lib/lifi-venue.ts', function: 'guardLifiBuild · verifyLifiQuoteEcho · lifiPriceAcceptable', refuses: ['a target outside the router allowlist for that chain (an empty allowlist = no venue)', 'an approval that is not exact-amount to the router', `a fill paying more than ${LIFI_MAX_QUOTE_SHORTFALL_BPS} bps worse than our quote`, `a quote older than ${LIFI_QUOTE_TTL_SEC} seconds`] },
      { module: 'lib/lifi-bridge.ts', function: 'guardLifiBridgeBuild', refuses: ['a router outside the bridge allowlist', 'a leg that does not deliver to the signer on the destination chain'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { maxQuoteShortfallBps: LIFI_MAX_QUOTE_SHORTFALL_BPS, quoteTtlSec: LIFI_QUOTE_TTL_SEC, legFlatUsd: LIFI_LEG_FLAT_USD, policyHost: LIFI_POLICY_HOST },
    policy: { defaultAllowed: true, notes: ['LIFI_ROUTERS / LIFI_BRIDGE_ROUTERS env vars REPLACE the pinned allowlists at runtime; an invalid entry is dropped and an empty result fails closed.', 'LiFi price and simulation checks degrade to warnings on RPC transport failure (GUARDRAILS.md, honest residuals).'] },
    custody: 'Not yet drilled with a custody signer.',
  }
}

function openseaVenue(): ManifestVenue {
  const chains = Object.keys(OPENSEA_CHAINS).map(Number).map((id) =>
    chainRow(id, [
      { role: 'Seaport 1.6', address: SEAPORT_1_6, source: 'lib/opensea.ts#SEAPORT_1_6' },
      { role: 'OpenSea conduit (the only operator a listing approves)', address: OPENSEA_CONDUIT, source: 'lib/opensea.ts#OPENSEA_CONDUIT' },
      { role: 'OpenSea fee recipient', address: OPENSEA_FEE_RECIPIENT, source: 'lib/opensea.ts#OPENSEA_FEE_RECIPIENT' },
    ]),
  )
  return {
    slug: 'opensea',
    name: 'OpenSea (Seaport 1.6)',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { fleetSlug: 'opensea-free', pinnedIn: 'free-mcps/services/opensea/lib/registry.ts' },
    chains,
    selectors: [],
    typedData: {
      domain: { verifyingContract: SEAPORT_1_6, conduitKey: OPENSEA_CONDUIT_KEY },
      primaryType: 'OrderComponents',
      fields: Object.keys(SEAPORT_EIP712_TYPES),
      source: 'lib/opensea.ts#SEAPORT_EIP712_TYPES · OPENSEA_CONDUIT_KEY',
    },
    operations: [
      { name: 'owned · meta · collection', shape: 'read', description: 'The OpenSea API.' },
      { name: 'list', shape: 'typedData', description: 'A Seaport OrderComponents signature riding the pinned conduit key; the only approval ever built is setApprovalForAll to the pinned conduit, on the collection the user is listing.' },
      { name: 'buy', shape: 'tx', description: 'The fulfillment is re-encoded LOCALLY against Seaport 1.6 — never forwarded opaque from the API.' },
      { name: 'transfer', shape: 'tx', description: 'ERC-721 / ERC-1155 safeTransfer with ownership and recipient verified (guardNftTransfer).' },
    ],
    guards: [
      { module: 'lib/nft-layer.ts', function: 'buildNftListing · buildNftBuy · guardNftTransfer', refuses: ['an order that does not ride the OpenSea conduit', 'a fulfillment the local re-encode does not reproduce', 'a transfer of a token the signer does not own'] },
      { module: 'app/api/opensea/submit/route.ts', function: 'POST (relay)', refuses: ['a signature that does not recover to the claimed offerer over the exact order params', 'a payout outside the collection’s LIVE fee schedule', 'a target other than Seaport 1.6', 'a listing while the account is frozen (a sale is never spend-gated)'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { maxValidSec: MAX_VALID_SEC },
    policy: { defaultAllowed: true, notes: ['Inflows (sales) are never spend-gated; the kill switch still refuses a listing.'] },
    custody: 'Not yet drilled with a custody signer.',
  }
}

function snapshotVenue(): ManifestVenue {
  return {
    slug: 'snapshot',
    name: 'Snapshot (off-chain governance)',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { fleetSlug: 'snapshot-free' },
    chains: [],
    selectors: [],
    typedData: {
      domain: { name: SNAPSHOT_VOTE_DOMAIN.name, version: SNAPSHOT_VOTE_DOMAIN.version },
      primaryType: 'Vote',
      fields: ['from:address', 'space:string', 'timestamp:uint64', 'proposal', 'choice', 'reason:string', 'app:string', 'metadata:string'],
      source: 'lib/snapshot-vote.ts#SNAPSHOT_VOTE_DOMAIN · buildVoteTypedData',
    },
    operations: [
      { name: 'spaces · proposals · votes', shape: 'read', description: 'The Snapshot hub.' },
      { name: 'vote', shape: 'typedData', description: 'The canonical Vote struct, built here (the MCP’s prepare_vote and the UI buttons produce the identical payload), stamped at build time, relayed to the sequencer. No chain, no contract, no value moves.' },
    ],
    guards: [PLANNER_GUARD],
    bounds: {},
    policy: { defaultAllowed: true, notes: ['Off-chain: a vote signature cannot move funds. The guard still refuses a non-Vote struct behind a governance label and any on-chain domain.'] },
    custody: 'An off-chain EIP-712 signature; a custody signer that supports typed data can cast it. Not yet drilled.',
  }
}

function robinhoodChainVenue(): ManifestVenue {
  return {
    slug: 'robinhood-chain',
    name: 'Robinhood Chain (bridge; tokenized stocks trade via Uniswap v4 above)',
    kind: 'native+free-mcp',
    repo: ['Pantessa/website', 'Pantessa/free-mcps'],
    produces: 'tx-shaped',
    mcp: { pinnedIn: 'free-mcps/services/robinhood/lib/registry.ts' },
    chains: [
      chainRow(1, [{ role: 'Robinhood Chain Delayed Inbox (depositEth)', address: RH_L1_INBOX, source: 'lib/robinhood-bridge.ts#RH_L1_INBOX' }]),
      chainRow(ROBINHOOD_CHAIN_ID, [{ role: 'ArbSys precompile (withdrawEth)', address: ARB_SYS, source: 'lib/robinhood-bridge.ts#ARB_SYS' }]),
    ],
    selectors: [...selectorsOf(INBOX_ABI, 'lib/robinhood-bridge.ts#INBOX_ABI'), ...selectorsOf(ARB_SYS_ABI, 'lib/robinhood-bridge.ts#ARB_SYS_ABI')],
    operations: [
      { name: 'bridge in', shape: 'tx', description: 'depositEth() on the pinned Delayed Inbox on Ethereum, value = the asked ETH.' },
      { name: 'bridge out', shape: 'tx', description: 'withdrawEth(signer) on the ArbSys precompile on Robinhood Chain (the canonical ~7-day exit; NEAR Intents is the ~30 s exit).' },
    ],
    guards: [
      { module: 'lib/robinhood-bridge.ts', function: 'guardRobinhoodBridge', refuses: ['a deposit not addressed to the pinned inbox on Ethereum', 'a withdrawal not addressed to ArbSys on Robinhood Chain', 'a destination other than the signer', 'a value other than the asked amount'] },
      RECIPIENT_AND_VALIDITY,
      KILL_SWITCH,
    ],
    bounds: { chainId: ROBINHOOD_CHAIN_ID },
    policy: { defaultAllowed: true, notes: ['Tokenized stocks (xyz tickers) are swapped through the Uniswap v4 fallback on this chain, settled through LiFi when v4 has no executable pool — see those venues.'] },
    custody: 'Not yet drilled with a custody signer.',
  }
}

function transfersVenue(): ManifestVenue {
  return {
    slug: 'transfers',
    name: 'Token sends (the transfer layer)',
    kind: 'native',
    repo: ['Pantessa/website'],
    produces: 'tx-shaped',
    chains: APP_CHAINS.map((c) => chainRow(c.id, [])),
    selectors: selectorsOf(erc20Abi, 'viem#erc20Abi (encodeFunctionData in lib/transfer-exec.ts)', ['transfer']),
    operations: [
      { name: 'send native', shape: 'tx', description: 'A plain value transfer with empty calldata, to the asked recipient only.' },
      { name: 'send ERC-20', shape: 'tx', description: 'transfer(to, amount) on the token the registry (or a raw 0x address the user typed) names; decimals read on-chain.' },
    ],
    guards: [
      { module: 'lib/transfer-exec.ts', function: 'buildTransferArtifact (transfer-guard pin)', refuses: ['calldata that does not re-decode to transfer(asked recipient, asked amount)', 'a native send whose to / value / empty-calldata triple does not match the ask', 'an opaque payload it cannot decode'] },
      KILL_SWITCH,
    ],
    bounds: {},
    policy: { defaultAllowed: true, notes: ['The ONLY layer that may name a third-party recipient; it takes the full (non-exempt) policy gate. Every other venue returns proceeds to the signer.'] },
    custody: 'The simplest shape for a custody signer; not yet drilled.',
  }
}

function walletVenue(): ManifestVenue {
  return {
    slug: 'wallet',
    name: 'Pantessa Wallet (reads)',
    kind: 'free-mcp',
    repo: ['Pantessa/free-mcps'],
    produces: 'read-only',
    mcp: { fleetSlug: 'yeetful-tool-wallet', pinnedIn: 'free-mcps/services/yeetful-tool-wallet' },
    chains: [],
    selectors: [],
    operations: [{ name: 'portfolio · gas balances · token balance · recent transactions · tx status', shape: 'read', description: 'Multichain reads via Alchemy; spam-filtered; the fresh-data layer after a settlement. Produces nothing signable.' }],
    guards: [],
    bounds: {},
    policy: { defaultAllowed: true, notes: ['Read-only by construction.'] },
    custody: 'n/a (no signature).',
  }
}

// ── The manifest ─────────────────────────────────────────────────────────────

export const NATIVE_VENUE_SLUGS = ['uniswap', 'cow', 'aave', 'morpho', 'lido', 'hyperliquid', 'near-intents', 'lifi', 'opensea', 'snapshot', 'robinhood-chain', 'transfers'] as const

export function buildVenueManifest(opts: { now?: Date; commit?: string | null } = {}): VenueManifest {
  const venues: ManifestVenue[] = [
    uniswapVenue(),
    cowVenue(),
    aaveVenue(),
    morphoVenue(),
    lidoVenue(),
    hyperliquidVenue(),
    nearIntentsVenue(),
    lifiVenue(),
    openseaVenue(),
    snapshotVenue(),
    robinhoodChainVenue(),
    transfersVenue(),
    walletVenue(),
  ]
  const body = {
    chains: APP_CHAINS.map((c) => ({ chainId: c.id, name: c.name, key: c.key, nativeSymbol: c.nativeSymbol, explorerTx: c.explorerTx })),
    fees: {
      treasury: TREASURY_ADDRESS,
      swapFeeBps: SWAP_FEE_BPS,
      linkSwapFeeBps: LINK_SWAP_FEE_BPS,
      creatorSplit: CREATOR_FEE_SPLIT,
      hlBuilderFeeTenthBps: HL_BUILDER_FEE_TENTH_BPS,
      crossChainFeeBps: CROSS_CHAIN_FEE_BPS,
      oneClickFeeSplit: ONECLICK_FEE_SPLIT,
      source: 'lib/fees.ts (the one fee source; the treasury address appears nowhere else — grep-enforced by the audit)',
    },
    invariants: [
      { name: 'The model never writes calldata', detail: 'The planner classifies intent; per-venue builders in this repo produce every to / data / value / typed-data field from on-chain reads and the pinned constants above.', source: 'GUARDRAILS.md §1' },
      { name: 'Fail closed, everywhere', detail: 'A guard error refuses the build; a blocked report withholds the artifact; a fallback never fires on a guard failure.', source: 'GUARDRAILS.md §2 · lib/tx-guardrails.ts#buildReport' },
      { name: 'Nothing stale reaches a wallet', detail: 'Deadline-bearing calldata ships as a txChain with validUntil and a server refresh recipe; the refresh route accepts intent params only.', source: 'GUARDRAILS.md §3 · app/api/tx/refresh/route.ts' },
      { name: 'Only the kill switch refuses', detail: 'The retail spend policy was retired 2026-10-30; a frozen or revoked account refuses every outflow on every path and every relay.', source: 'GUARDRAILS.md §4 · lib/tx-guardrails.ts#policyCheck' },
      { name: 'Relays re-gate on the server', detail: 'Signing is client-side; acceptance is not. CoW, OpenSea and Hyperliquid submits re-derive, recover the signer and re-guard before anything reaches a venue.', source: 'GUARDRAILS.md §5' },
      { name: 'Recipient and validity are venue-neutral', detail: `Proceeds return to the requesting wallet; nothing stays signable past ${MAX_VALID_SEC / 86400} days.`, source: 'lib/tx-guardrails.ts#recipientCheck · validityCheck · MAX_VALID_SEC' },
      { name: 'External tools are fenced', detail: 'A directory MCP that returns a signable payload passes guardPlannerArtifact; the drain shapes are refused outright.', source: 'lib/planner-artifact-guard.ts#guardPlannerArtifact' },
    ],
    signing: {
      signer: 'The user’s own wallet (or, for standing intents, a delegated key under venue-side limits). Pantessa never holds a key and never takes custody.',
      lanesProven: ['browser wallet over EIP-1193 / WalletConnect v2 (the chat, /i links, the embed)', 'the agent-signed desk path: any viem Account drives one guarded leg at a time (pantessa SDK driveJob)', 'delegated keys for standing intents (Guardians, autopilots) that the venue bars from withdrawing'],
      custody: 'No institutional custody lane (Fireblocks, Copper, Fordefi, Safe) has been drilled end to end as of 2026-11-02. The desk wire is custody-shaped (poll → one unsigned leg → their signer → on-chain verification); the measurement is the open item.',
    },
    venues,
  }
  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    commit: opts.commit === undefined ? (process.env.VERCEL_GIT_COMMIT_SHA ?? null) : opts.commit,
    integrity: manifestIntegrity(body),
    ...body,
  }
}

export function venueOf(m: VenueManifest, slug: string | null | undefined): ManifestVenue | null {
  const s = (slug ?? '').trim().toLowerCase()
  return s ? (m.venues.find((v) => v.slug === s) ?? null) : null
}

/** The free-fleet slugs the manifest must name — the pins walk this. */
export const MANIFEST_FLEET_SLUGS: readonly string[] = FREE_FLEET_SLUGS

/** Re-exported so the pins compare the registry's Base pins against the legacy constants. */
export const UNISWAP_BASE_LEGACY_PINS = { swapRouter02: UNI_SWAP_ROUTER_02, quoterV2: UNI_QUOTER_V2 } as const
