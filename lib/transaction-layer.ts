// ─────────────────────────────────────────────────────────────────────────
//  Transaction layer — the "action" half of the routing engine.
//
//  Read-routing (lib/router) fetches data. This layer turns an action intent
//  + a tool's return into a SIGNABLE artifact the user/agent approves — the
//  point where the spend grant / controls / receipts become powerful and
//  Yeetful is in the path.
//
//  The Snapshot vote flow is the working prototype: the snapshot MCP's
//  `prepare_vote` returns a `sign_vote` payload (EIP-712 typed data) that
//  <SignVoteButton> signs. This generalizes that one bespoke branch into a
//  reusable detector: any MCP that returns a recognized action payload becomes
//  a signable artifact. Vote (EIP-712) is wired today; a raw EVM transaction
//  (swap / transfer / mint / approve) is structured here so adding an action
//  MCP that returns a tx template is a small change, not a rewrite.
// ─────────────────────────────────────────────────────────────────────────

import { voteRequestFromToolResult, type VoteRequest } from '@/lib/snapshot-vote'

/** A raw EVM transaction an action MCP asks the user to sign + send. */
export interface EvmTxRequest {
  to: string
  data?: string
  /** wei, decimal string. */
  value?: string
  chainId?: number
  /** Human label for the confirm UI — e.g. "swap", "transfer", "mint". */
  action?: string
}

/** A generic EIP-712 order to sign off-chain (intent-based protocols: CoW
 *  swaps, OpenSea/Seaport listings & offers). Unlike `evm-tx` these settle via
 *  a solver/relayer after signing, so we carry the full typed-data payload +
 *  where the signed order is submitted (A4). */
export interface Eip712OrderRequest {
  /** Protocol label — 'cow' | 'opensea' | … (drives the submit + UI copy). */
  protocol: string
  /** Full EIP-712 typed data: { domain, primaryType, types, message }. */
  typedData: unknown
  /** Order-book endpoint the signed order is POSTed to after signing. */
  submitUrl?: string
  chainId?: number
  /** Protocol-specific extras submission needs beyond the signature — for CoW
   *  the full appData JSON (the order signs only its hash) + the quoteId. */
  appDataJson?: string
  quoteId?: number
}

/** One step of a multi-step on-chain action (approve → swap, wrap → swap…). */
export interface TxChainStep {
  /** Machine label — 'approve' | 'swap' | 'wrap' | … */
  label: string
  /** Human step title for the chain stepper, e.g. "Approve USDC". */
  title: string
  tx: EvmTxRequest
}

/** A multi-step transaction CHAIN the user signs step by step in ONE card —
 *  never "sign this, then type your message again" (the trap: step 1's green
 *  "Confirmed" reads as done, and the user walks away without the swap).
 *  The card advances itself: when step N confirms, step N+1's sign button
 *  appears. `refresh` marks a step to be REBUILT server-side right before
 *  it's offered (fresh quote + guardrails re-run — prices move while
 *  approvals mine); without it the prebuilt tx is used as-is (slippage
 *  bounds make stale-quote failure a revert, never a bad fill). */
export interface TxChainRequest {
  summary: string
  steps: TxChainStep[]
  refresh?: {
    /** Rebuild recipe — 'uniswap-swap' is wired today (POST /api/tx/refresh). */
    kind: 'uniswap-swap'
    /** 0-based index of the step to rebuild at advance time. */
    stepIndex: number
    params: { sellToken: string; buyToken: string; amountHuman: string }
  }
}

/** Narrow a persisted Message.meta into a TxChainRequest, or null. The sibling
 *  of txRequestOf — SendTxChain reads the step list from here. */
export function txChainOf(meta: unknown): TxChainRequest | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).txChain
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.steps) || d.steps.length === 0) return null
  const steps: TxChainStep[] = []
  for (const s of d.steps) {
    if (!s || typeof s !== 'object') return null
    const step = s as Record<string, unknown>
    const tx = txRequestOf({ txRequest: step.tx })
    if (!tx) return null
    steps.push({
      label: typeof step.label === 'string' ? step.label : 'transaction',
      title: typeof step.title === 'string' ? step.title : 'Sign transaction',
      tx,
    })
  }
  let refresh: TxChainRequest['refresh']
  const r = d.refresh as Record<string, unknown> | undefined
  if (r && typeof r === 'object' && r.kind === 'uniswap-swap' && typeof r.stepIndex === 'number' && r.params && typeof r.params === 'object') {
    const p = r.params as Record<string, unknown>
    if (typeof p.sellToken === 'string' && typeof p.buyToken === 'string' && typeof p.amountHuman === 'string') {
      refresh = { kind: 'uniswap-swap', stepIndex: r.stepIndex, params: { sellToken: p.sellToken, buyToken: p.buyToken, amountHuman: p.amountHuman } }
    }
  }
  return { summary: typeof d.summary === 'string' ? d.summary : '', steps, refresh }
}

/** A signable artifact the engine surfaces for explicit approval. Extensible:
 *  EIP-712 vote + raw EVM tx today; `eip712-order` for intent-based swaps
 *  (CoW) and marketplace orders (OpenSea); `evm-tx-chain` for multi-step
 *  actions that must land as ONE self-advancing card. */
export type SignableArtifact =
  | { kind: 'eip712-vote'; summary: string; vote: VoteRequest }
  | { kind: 'evm-tx'; summary: string; tx: EvmTxRequest }
  | { kind: 'eip712-order'; summary: string; order: Eip712OrderRequest }
  | { kind: 'evm-tx-chain'; summary: string; chain: TxChainRequest }

/** Narrow a persisted Message.meta into an Eip712OrderRequest, or null. The
 *  sibling of voteRequestOf — SignOrderButton reads the order from here. */
export function orderRequestOf(meta: unknown): Eip712OrderRequest | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).orderRequest
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.protocol !== 'string' || !d.typedData || typeof d.typedData !== 'object') return null
  return {
    protocol: d.protocol,
    typedData: d.typedData,
    submitUrl: typeof d.submitUrl === 'string' ? d.submitUrl : undefined,
    chainId: typeof d.chainId === 'number' ? d.chainId : undefined,
    appDataJson: typeof d.appDataJson === 'string' ? d.appDataJson : undefined,
    quoteId: typeof d.quoteId === 'number' ? d.quoteId : undefined,
  }
}

/** Narrow a persisted Message.meta into an EvmTxRequest, or null. The sibling
 *  of orderRequestOf — SendTxButton reads the built transaction from here. */
export function txRequestOf(meta: unknown): EvmTxRequest | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).txRequest
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(d.to)) return null
  return {
    to: d.to,
    data: typeof d.data === 'string' ? d.data : undefined,
    value: typeof d.value === 'string' ? d.value : undefined,
    chainId: typeof d.chainId === 'number' ? d.chainId : undefined,
    action: typeof d.action === 'string' ? d.action : undefined,
  }
}

const ACTION_RE = /\b(vote|swap|send|transfer|bridge|mint|approve|stake|unstake|delegate)\b/i

/** Does the message ask to DO something on-chain (not just read)? Cheap gate
 *  for routing a turn toward the transaction layer. Pure + tested. */
export function isActionIntent(message: string): boolean {
  return ACTION_RE.test(message)
}

/**
 * Build a SignableArtifact from an MCP tool's return, or null when the return
 * carries no recognized action. Today it recognizes:
 *  - Snapshot's `sign_vote` payload (delegates to the proven vote parser) →
 *    `eip712-vote` (renders via the existing SignVoteButton, no regression).
 *  - A generic `{action:'send_transaction'|'sign_transaction', tx:{to,…}}`
 *    template → `evm-tx` (reserved for swap/transfer/mint MCPs).
 */
/** Narrow a `{action:'send_transaction', tx:{…}}` payload into an EvmTxRequest. */
function evmTxOf(payload: unknown): { tx: EvmTxRequest; summary?: string; label?: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const d = payload as Record<string, unknown>
  if (d.action !== 'send_transaction' && d.action !== 'sign_transaction') return null
  if (!d.tx || typeof d.tx !== 'object') return null
  const tx = d.tx as Record<string, unknown>
  if (typeof tx.to !== 'string') return null
  const label = typeof d.label === 'string' ? d.label : undefined
  return {
    tx: {
      to: tx.to,
      data: typeof tx.data === 'string' ? tx.data : undefined,
      value: typeof tx.value === 'string' ? tx.value : typeof tx.value === 'number' ? String(tx.value) : undefined,
      chainId: typeof tx.chainId === 'number' ? tx.chainId : undefined,
      action: label,
    },
    summary: typeof d.summary === 'string' ? d.summary : undefined,
    label,
  }
}

export function buildSignableArtifact(toolResult: unknown): SignableArtifact | null {
  // Snapshot vote — the existing prototype, now one artifact kind.
  const vote = voteRequestFromToolResult(toolResult)
  if (vote) return { kind: 'eip712-vote', summary: vote.summary, vote }

  // Multi-step build (uniswap-free build_swap): the tool returns BOTH the
  // allowance approval it found necessary AND the swap — surface them as ONE
  // self-advancing chain card, never "sign this, then ask again".
  if (toolResult && typeof toolResult === 'object') {
    const d = toolResult as Record<string, unknown>
    const approve = d.approve as Record<string, unknown> | undefined
    const swapStep = evmTxOf(d.swap)
    if (swapStep && approve && typeof approve === 'object' && approve.needed === true) {
      const approveStep = evmTxOf(approve.tx)
      if (approveStep) {
        const summary = swapStep.summary ?? (typeof d.summary === 'string' ? d.summary : 'Multi-step transaction')
        return {
          kind: 'evm-tx-chain',
          summary,
          chain: {
            summary,
            steps: [
              { label: approveStep.label ?? 'approve', title: approveStep.summary ?? 'Approve token allowance', tx: approveStep.tx },
              { label: swapStep.label ?? 'swap', title: swapStep.summary ?? 'Sign the swap', tx: swapStep.tx },
            ],
            // MCP-sourced chains carry no refresh recipe — the prebuilt swap's
            // slippage bound makes a stale quote revert, never fill badly.
          },
        }
      }
    }
    // Same shape, allowance already in place → plain single-tx artifact.
    if (swapStep && approve && typeof approve === 'object' && approve.needed === false) {
      return { kind: 'evm-tx', summary: swapStep.summary ?? 'Sign the swap', tx: swapStep.tx }
    }
  }

  // Generic EIP-712 order (CoW swap, OpenSea/Seaport order). The tool returns
  // `{ action:'sign_order', protocol, typedData, summary, submitUrl?, chainId? }`.
  if (toolResult && typeof toolResult === 'object') {
    const d = toolResult as Record<string, unknown>
    if (d.action === 'sign_order' && d.typedData && typeof d.protocol === 'string') {
      return {
        kind: 'eip712-order',
        summary: typeof d.summary === 'string' ? d.summary : `Sign a ${d.protocol} order`,
        order: {
          protocol: d.protocol,
          typedData: d.typedData,
          submitUrl: typeof d.submitUrl === 'string' ? d.submitUrl : undefined,
          chainId: typeof d.chainId === 'number' ? d.chainId : undefined,
          appDataJson: typeof d.appDataJson === 'string' ? d.appDataJson : undefined,
          quoteId: typeof d.quoteId === 'number' ? d.quoteId : undefined,
        },
      }
    }
  }

  // Generic on-chain transaction template (swap/transfer/mint/approve MCPs).
  if (toolResult && typeof toolResult === 'object') {
    const d = toolResult as Record<string, unknown>
    if ((d.action === 'send_transaction' || d.action === 'sign_transaction') && d.tx && typeof d.tx === 'object') {
      const tx = d.tx as Record<string, unknown>
      if (typeof tx.to === 'string') {
        const label = typeof d.label === 'string' ? d.label : typeof d.action === 'string' ? d.action : undefined
        return {
          kind: 'evm-tx',
          summary: typeof d.summary === 'string' ? d.summary : `Sign a ${label ?? 'transaction'}`,
          tx: {
            to: tx.to,
            data: typeof tx.data === 'string' ? tx.data : undefined,
            value: typeof tx.value === 'string' ? tx.value : typeof tx.value === 'number' ? String(tx.value) : undefined,
            chainId: typeof tx.chainId === 'number' ? tx.chainId : undefined,
            action: label,
          },
        }
      }
    }
  }
  return null
}
