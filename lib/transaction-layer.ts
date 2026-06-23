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

/** A signable artifact the engine surfaces for explicit approval. Extensible:
 *  EIP-712 vote today; raw EVM tx reserved for swap/transfer/mint MCPs. */
export type SignableArtifact =
  | { kind: 'eip712-vote'; summary: string; vote: VoteRequest }
  | { kind: 'evm-tx'; summary: string; tx: EvmTxRequest }

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
export function buildSignableArtifact(toolResult: unknown): SignableArtifact | null {
  // Snapshot vote — the existing prototype, now one artifact kind.
  const vote = voteRequestFromToolResult(toolResult)
  if (vote) return { kind: 'eip712-vote', summary: vote.summary, vote }

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
