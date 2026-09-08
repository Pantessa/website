// ─────────────────────────────────────────────────────────────────────────
//  Dry-run classifier — what an eth_estimateGas failure actually MEANS.
//
//  A revert is chain evidence: the calldata cannot execute, withhold it. An
//  RPC that didn't answer — timeout, 5xx, rate limit, a lagging node's
//  "header not found", a gateway error code viem has never heard of — is
//  NOT chain evidence. viem surfaces every one of those with a different
//  first line ("RPC Request failed.", "HTTP request failed.", "The request
//  took too long to respond.", "Missing or invalid parameters."), none of
//  which say "timeout" or "rate limit", so the old first-line regex at each
//  dry-run site booked every transport failure as a revert. 2026-09-08: a
//  funded USDG→SPY step on Robinhood Chain was WITHHELD as "would revert
//  on-chain (RPC Request failed.)" — the same calldata estimated clean at
//  250k gas four minutes later. Classify by walking the WHOLE error chain.
// ─────────────────────────────────────────────────────────────────────────
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InsufficientFundsError,
  IntrinsicGasTooHighError,
} from 'viem'

/** The one call a dry-run needs. Structural on purpose: viem's PublicClient
 *  is generic over its chain (an OP-stack chain's client is not assignable
 *  to a mainnet one), and every caller here only estimates. */
export type DryRunClient = {
  estimateGas: (args: { account: `0x${string}`; to: `0x${string}`; data: `0x${string}`; value: bigint }) => Promise<bigint>
}

export type DryRunVerdict =
  | { kind: 'clean' }
  /** The chain itself refuses the calldata — withhold. */
  | { kind: 'revert'; reason: string; raw: string }
  /** The payer can't cover gas — withhold, and say what to send. */
  | { kind: 'no-gas'; reason: string; raw: string }
  /** The RPC didn't answer. Not chain evidence: the caller decides between
   *  retrying and failing open to the calldata's own slippage bound. */
  | { kind: 'unavailable'; detail: string }

export type DryRunFailure = Exclude<DryRunVerdict, { kind: 'clean' }>

/** Uniswap / ERC-20 revert strings → the words a person needs. The raw code
 *  rides along in parentheses so a support thread can still search it. */
const REVERT_WORDS: Array<[RegExp, string]> = [
  [/\bSTF\b|exceeds allowance|insufficient allowance|TRANSFER_FROM_FAILED/i, 'the token transfer failed — allowance or balance short'],
  [/Too little received|Too much requested|INSUFFICIENT_OUTPUT_AMOUNT|slippage/i, 'the price moved past the slippage bound'],
  [/Transaction too old|deadline|expired/i, 'the quote deadline passed'],
  [/\bSPL\b/, 'the pool cannot fill this size at the quoted price'],
]

/** An allowance-shaped revert right after a confirmed approval is node lag
 *  (the builder just READ that allowance on-chain), not chain truth — the
 *  caller should wait and retry, never withhold. */
export function isAllowanceLag(reason: string): boolean {
  return /\bSTF\b|allowance|TRANSFER_FROM_FAILED/i.test(reason)
}

function humanRevert(raw: string): string {
  const code = raw
    .replace(/^execution reverted:?\s*/i, '')
    .replace(/\.$/, '')
    .trim()
  for (const [re, words] of REVERT_WORDS) if (re.test(code)) return code ? `${words} (${code})` : words
  return code ? `execution reverted: ${code}` : 'execution reverted'
}

const firstLine = (s: string) => s.split('\n')[0].trim()

/** Details + short message of a viem error — `details` is inherited down
 *  the cause chain, so the top-level error already carries the node's own
 *  words ("execution reverted: STF", "rate limited", "header not found"). */
function wordsOf(e: BaseError): string {
  return e.details || e.shortMessage || firstLine(e.message)
}

export function classifyDryRunError(err: unknown, opts: { chainName?: string } = {}): DryRunFailure {
  if (!(err instanceof BaseError)) {
    const msg = err instanceof Error ? firstLine(err.message) : String(err)
    return { kind: 'unavailable', detail: msg || 'unknown error' }
  }
  const words = wordsOf(err)
  const revert = err.walk(
    (e) =>
      e instanceof ExecutionRevertedError ||
      e instanceof ContractFunctionRevertedError ||
      e instanceof IntrinsicGasTooHighError ||
      (e as { code?: unknown } | null)?.code === ExecutionRevertedError.code,
  )
  if (revert instanceof BaseError) {
    const raw = revert instanceof ContractFunctionRevertedError ? revert.reason || wordsOf(revert) : wordsOf(revert)
    return { kind: 'revert', reason: humanRevert(raw), raw }
  }
  if (/execution reverted|\brevert(ed)?\b/i.test(words)) {
    // A node that reverts under a code viem doesn't map still SAID revert.
    return { kind: 'revert', reason: humanRevert(words), raw: words }
  }
  if (err.walk((e) => e instanceof InsufficientFundsError) || /insufficient funds/i.test(words)) {
    return {
      kind: 'no-gas',
      reason: `your wallet has no ETH for gas${opts.chainName ? ` on ${opts.chainName}` : ''}`,
      raw: words,
    }
  }
  // Everything else is the transport, not the chain. Name the whole chain
  // of errors + the node's words so the log says what the RPC actually did.
  const names: string[] = []
  let cur: unknown = err
  while (cur instanceof BaseError) {
    const code = (cur as { code?: unknown }).code
    names.push(`${cur.name}${typeof code === 'number' ? `(${code})` : ''}`)
    cur = cur.cause
  }
  if (cur && typeof cur === 'object' && 'code' in cur) names.push(`rpc(${String((cur as { code: unknown }).code)})`)
  return { kind: 'unavailable', detail: `${names.join(' > ')}: ${words}` }
}

/** Estimate the tx against the live chain. Transport failures are retried
 *  with a short backoff before being reported as `unavailable`; chain
 *  evidence (revert / no gas) returns on the first answer. */
export async function dryRunTx(
  client: DryRunClient,
  tx: { from: string; to: string; data: string; value?: string | bigint },
  opts: { attempts?: number; backoffMs?: number; chainName?: string } = {},
): Promise<DryRunVerdict> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const backoffMs = opts.backoffMs ?? 400
  let last: DryRunFailure | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      await client.estimateGas({
        account: tx.from as `0x${string}`,
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : BigInt(0),
      })
      return { kind: 'clean' }
    } catch (err) {
      last = classifyDryRunError(err, { chainName: opts.chainName })
      if (last.kind !== 'unavailable') return last
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)))
    }
  }
  return last ?? { kind: 'unavailable', detail: 'no attempt ran' }
}
