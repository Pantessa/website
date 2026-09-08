// ─────────────────────────────────────────────────────────────────────────
//  Planner-artifact guard — the missing gate on the GENERIC passthrough.
//
//  Every native builder (CoW, Uniswap v3/v4, LiFi, cross-chain, Aave, Lido,
//  NFT, transfers, bridges) re-verifies its calldata deterministically before
//  anything is offered for signature. The one exception was the generic
//  planner path: an MCP tool the ENDPOINT PLANNER picked could return
//  `{action:'send_transaction', tx:{to,data,value}}` (or a sign_order typed
//  payload) and buildSignableArtifact surfaced it VERBATIM — the only check
//  was an address-format regex (2026-07-20 audit finding). A hostile,
//  compromised, or hallucinating directory MCP could hand the user a
//  drain-shaped transaction dressed as the thing they asked for.
//
//  This guard closes the known drain shapes while keeping bring-your-own-MCP
//  alive. It is PURE (no I/O) so the harness pins every rule. Philosophy:
//  the clearest theft patterns are BLOCK-level (an artifact is never
//  offered); everything else the user's wallet can render honestly (native
//  value, bounded approvals) rides through with a warning.
//
//  Block rules — fail closed, reasons name the native alternative:
//   · unknown/unsupported chainId (the wallet relay only signs app chains)
//   · malformed `to` / non-hex calldata
//   · ERC-20 transfer(...) to anyone but the requesting wallet
//   · transferFrom / safeTransferFrom / safeBatchTransferFrom (any standard)
//   · setApprovalForAll — an operator grant over a whole collection
//   · UNLIMITED ERC-20 approve (≥2^255); bounded approvals pass with a warn
//   · any call targeting Permit2 (native v4 layer builds its own permits)
//   · bare native send (value>0, empty calldata) to a third party
//   · generic sign_order for any protocol but CoW; CoW orders must verify
//     against the pinned GPv2 settlement contract and pay the requesting
//     wallet (receiver = user or the 0x0 self sentinel)
//
//  TRUST GATE (2026-09-08) — the rule the shape rules cannot express.
//  Every rule above reads CALLDATA, and calldata alone cannot separate a
//  hostile venue from a novel legitimate one: `approve(X, 500 USDC)` +
//  `X.someCall()` is byte-for-byte the shape of an honest approve-then-swap
//  and of a two-step drain. The only thing that distinguishes them is WHO
//  wrote the bytes. So the source is now part of the verdict: only
//  FIRST-PARTY MCPs (the Pantessa fleet, `source: 'yeetful'`) may hand a
//  user something to sign through the generic planner path. Directory
//  services (`agentic.market`, 75 of 91 prod rows) and user-added `custom`
//  rows can still read anything and answer anything — they just cannot
//  produce a signature prompt. Nothing legitimate loses: every venue that
//  builds transactions today (Uniswap, CoW, Aave, Morpho, Lido, NEAR
//  Intents, OpenSea, Robinhood, Hyperliquid) is first-party AND has a
//  native layer that bypasses this path entirely with a stronger,
//  venue-specific guard. The shape rules still run on first-party
//  artifacts — defense in depth, not either/or.
// ─────────────────────────────────────────────────────────────────────────

import { GPV2_SETTLEMENT } from '@/lib/cow'
import { sanitizeChainId } from '@/lib/chains'
import type { EvmTxRequest, SignableArtifact } from '@/lib/transaction-layer'

/**
 * The `McpServer.source` value the Pantessa fleet carries (schema default for
 * everything else is `'agentic.market'`). This is the ONLY source trusted to
 * produce a signable artifact through the generic planner path.
 */
export const FIRST_PARTY_MCP_SOURCE = 'yeetful'

/**
 * Fail-closed trust read. `undefined`/`null` (an endpoint whose source we
 * could not establish) is NOT first-party — an unknown provenance is exactly
 * the case this gate exists for.
 */
export function isFirstPartyMcp(source: string | null | undefined): boolean {
  return source === FIRST_PARTY_MCP_SOURCE
}

export interface PlannerArtifactContext {
  /** The wallet that will sign. Null → every recipient rule fails closed. */
  from: string | null
  /** `McpServer.source` of the service that returned the artifact. Omitted →
   *  treated as third-party and refused (fail closed). */
  source?: string | null
}

export interface PlannerArtifactVerdict {
  ok: boolean
  /** Block reasons — when non-empty the artifact must NOT be offered. */
  reasons: string[]
  warnings: string[]
}

/** Permit2 singleton (same address on every chain) — token allowance root. */
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

// 4-byte selectors of the calldata shapes wallets render worst — the classic
// drain vectors. Standard ABI, stable since the respective EIPs.
const SEL_ERC20_TRANSFER = 'a9059cbb' // transfer(address,uint256)
const SEL_ERC20_APPROVE = '095ea7b3' // approve(address,uint256)
const SEL_TRANSFER_FROM = '23b872dd' // transferFrom(address,address,uint256) — ERC-20 AND ERC-721
const SEL_721_SAFE_TRANSFER = '42842e0e' // safeTransferFrom(address,address,uint256)
const SEL_721_SAFE_TRANSFER_DATA = 'b88d4fde' // safeTransferFrom(address,address,uint256,bytes)
const SEL_1155_SAFE_TRANSFER = 'f242432a' // safeTransferFrom(address,address,uint256,uint256,bytes)
const SEL_1155_BATCH_TRANSFER = '2eb2c2d6' // safeBatchTransferFrom(...)
const SEL_SET_APPROVAL_FOR_ALL = 'a22cb465' // setApprovalForAll(address,bool)

/** ≥2^255 reads as "unlimited" (MaxUint256 and the common 2^255−1 sentinel). */
const UNLIMITED_FLOOR = BigInt(1) << BigInt(255)

const eqAddr = (a?: string | null, b?: string | null): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** 32-byte calldata words after the selector, or null when not word-aligned. */
function dataWords(data: string): { selector: string; words: string[] } | null {
  const hex = data.toLowerCase().replace(/^0x/, '')
  if (hex.length < 8 || !/^[0-9a-f]*$/.test(hex)) return null
  const words: string[] = []
  for (let i = 8; i + 64 <= hex.length; i += 64) words.push(hex.slice(i, i + 64))
  return { selector: hex.slice(0, 8), words }
}

const wordAddr = (word: string): string => `0x${word.slice(24)}`

function checkTx(tx: EvmTxRequest, from: string | null, reasons: string[], warnings: string[]): void {
  if (!ADDR_RE.test(tx.to)) {
    reasons.push(`Target "${tx.to}" is not a valid address.`)
    return
  }
  if (sanitizeChainId(tx.chainId) === null) {
    reasons.push(`Chain ${tx.chainId ?? '(unspecified)'} isn't a Pantessa app chain — refusing a transaction we can't attribute to a known network.`)
  }
  if (eqAddr(tx.to, PERMIT2_ADDRESS)) {
    reasons.push('Targets Permit2 (the token-allowance root). External tools never get to route your allowances — Pantessa builds its own permits.')
  }
  const value = (() => {
    try {
      return BigInt(tx.value ?? '0')
    } catch {
      return null
    }
  })()
  if (value === null) {
    reasons.push(`Unreadable native value "${tx.value}".`)
  }
  const data = tx.data && tx.data !== '0x' ? tx.data : null
  if (!data) {
    // Bare native send. Self-sends (wrap patterns aside) are pointless but
    // harmless; anything else is a plain transfer an external tool has no
    // business building — the native send layer decodes + prices those.
    if (value !== null && value > BigInt(0) && !eqAddr(tx.to, from)) {
      reasons.push(`Sends native currency to ${tx.to} — an external tool built a plain transfer. Ask me to "send X to …" and Pantessa's guarded transfer layer builds it instead.`)
    }
    return
  }
  const parsed = dataWords(data)
  if (!parsed) {
    reasons.push('Calldata is not valid hex.')
    return
  }
  const { selector, words } = parsed
  switch (selector) {
    case SEL_ERC20_TRANSFER: {
      const dest = words.length >= 2 ? wordAddr(words[0]) : null
      if (!dest || !from || !eqAddr(dest, from)) {
        reasons.push(
          `ERC-20 transfer to ${dest ?? 'an undecodable recipient'} — not the requesting wallet. External tools don't move your tokens to third parties; use Pantessa's guarded send instead.`,
        )
      }
      break
    }
    case SEL_ERC20_APPROVE: {
      const spender = words.length >= 2 ? wordAddr(words[0]) : null
      const amount = words.length >= 2 ? BigInt(`0x${words[1]}`) : null
      if (spender === null || amount === null) {
        reasons.push('Approve calldata is malformed.')
      } else if (amount >= UNLIMITED_FLOOR) {
        reasons.push(`UNLIMITED token approval to ${spender} — a standing drain authorization. Refused; a bounded approval sized to the action would pass.`)
      } else {
        warnings.push(`Grants ${spender} a bounded token allowance — verify it's the venue you expect before signing.`)
      }
      break
    }
    case SEL_TRANSFER_FROM:
    case SEL_721_SAFE_TRANSFER:
    case SEL_721_SAFE_TRANSFER_DATA:
    case SEL_1155_SAFE_TRANSFER:
    case SEL_1155_BATCH_TRANSFER:
      reasons.push('transferFrom-family calldata from an external tool — Pantessa’s native NFT/transfer layers own those moves (with ownership + recipient verification).')
      break
    case SEL_SET_APPROVAL_FOR_ALL:
      reasons.push('setApprovalForAll — hands an operator your entire collection. Refused from external tools; OpenSea listings get the pinned-conduit approval via the native NFT layer.')
      break
    default:
      if (value !== null && value > BigInt(0)) {
        warnings.push(`Attaches ${tx.value} wei of native value to a ${tx.to} call — your wallet will display the amount; check it.`)
      }
  }
}

/**
 * Gate a signable artifact that came off the GENERIC planner path (an MCP
 * tool result, not a native builder). `from` is the wallet that will sign —
 * pass null when unknown and every recipient-sensitive rule fails closed.
 */
export function guardPlannerArtifact(art: SignableArtifact, ctx: PlannerArtifactContext): PlannerArtifactVerdict {
  const reasons: string[] = []
  const warnings: string[] = []
  const from = ctx.from && ADDR_RE.test(ctx.from) ? ctx.from : null

  // Trust gate first — see the TRUST GATE note in the header. A third-party
  // service's calldata never reaches a sign button, whatever shape it is, so
  // there is no point decoding it. First-party artifacts fall through to the
  // shape rules below.
  if (!isFirstPartyMcp(ctx.source)) {
    return {
      ok: false,
      reasons: [
        'This came from a directory service, not one of Pantessa\u2019s own venues. Added services can read anything and answer anything, but only Pantessa\u2019s verified venues build transactions you sign \u2014 a swap, a lend, a send or a bridge asked for in plain words goes through the native layer, which re-derives every address and amount itself.',
      ],
      warnings: [],
    }
  }

  switch (art.kind) {
    case 'eip712-vote': {
      // A "vote" is the one artifact kind with no economic outflow — but
      // ONLY if it is really a vote. voteRequestFromToolResult passes
      // `typedData` through verbatim (it checks that domain/types.Vote/
      // message exist, nothing more) and buildVoteRequest reads
      // `primaryType` FROM THE PAYLOAD, so a tool could ship
      // `types: { Vote: [...], Permit: [...] }` with `primaryType: 'Permit'`
      // and a verifyingContract domain — a real token permit wearing a
      // governance label. Pin the envelope to Snapshot's own shape: only a
      // Vote struct, only the Vote primary type, an off-chain domain (no
      // verifyingContract / chainId — Snapshot signs `{name, version}`), and
      // a `from` that is the wallet actually signing.
      const td = art.vote.typedData as unknown as {
        domain?: Record<string, unknown>
        types?: Record<string, unknown>
        primaryType?: string
        message?: { from?: string }
      } | null
      const typeNames = Object.keys(td?.types ?? {})
      if (typeNames.length !== 1 || typeNames[0] !== 'Vote') {
        reasons.push(`Vote payload declares ${typeNames.length === 0 ? 'no' : typeNames.join(' + ')} struct${typeNames.length === 1 ? '' : 's'} — a Snapshot vote signs exactly one, named Vote.`)
      }
      if (td?.primaryType !== undefined && td.primaryType !== 'Vote') {
        reasons.push(`Vote payload's primaryType is "${td.primaryType}", not Vote — refusing to sign a non-vote struct behind a governance label.`)
      }
      const dom = td?.domain ?? {}
      if (dom.verifyingContract !== undefined || dom.chainId !== undefined) {
        reasons.push('Vote payload carries an on-chain EIP-712 domain (verifyingContract/chainId) — Snapshot votes are off-chain and sign a {name, version} domain only.')
      }
      if (dom.name !== undefined && dom.name !== 'snapshot') {
        reasons.push(`Vote payload's domain names "${String(dom.name)}", not snapshot.`)
      }
      const voter = td?.message?.from
      if (!from || !voter || !eqAddr(voter, from)) {
        reasons.push(`Vote is cast as ${voter ?? '(missing from)'} — not the requesting wallet.`)
      }
      break
    }
    case 'eip712-order': {
      // Every intent protocol Pantessa supports is built natively (CoW,
      // Seaport, Hyperliquid) with its own pinned guard. A generic typed-data
      // payload from a directory MCP could just as well be a Permit2 grant or
      // a Seaport listing paying someone else — refuse everything except a
      // CoW order that verifies against the pinned settlement contract.
      if (art.order.protocol !== 'cow') {
        reasons.push(`Generic "${art.order.protocol}" order from an external tool — only natively-built orders are offered for signature.`)
        break
      }
      const td = art.order.typedData as { domain?: { verifyingContract?: string }; message?: { receiver?: string } } | null
      const verifying = td?.domain?.verifyingContract
      if (!eqAddr(verifying, GPV2_SETTLEMENT)) {
        reasons.push(`CoW order's verifying contract ${verifying ?? '(missing)'} isn't the pinned GPv2 settlement — refused.`)
      }
      const receiver = td?.message?.receiver
      if (!from || !receiver || !(eqAddr(receiver, from) || eqAddr(receiver, ZERO_ADDR))) {
        reasons.push(`CoW order pays ${receiver ?? '(missing receiver)'} — not the requesting wallet.`)
      }
      break
    }
    case 'evm-tx':
      checkTx(art.tx, from, reasons, warnings)
      break
    case 'evm-tx-chain':
      for (const step of art.chain.steps) checkTx(step.tx, from, reasons, warnings)
      break
  }

  return { ok: reasons.length === 0, reasons, warnings }
}
