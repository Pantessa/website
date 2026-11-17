// A send the wallet refused because THIS WALLET ALREADY HAS A TRANSACTION ON
// THE SAME NONCE is not a failure to retry: it is a transaction in flight.
//
// 2026-11-17, prod (job cmwkvauga001mkbdvwjipojey, a Pantessa account on
// Ethereum): a $2 gas bridge went out on nonce 0 and the card still painted
// "Replacement transaction underpriced." beside "Retry - sign & send bridge".
// Three presses, three identical refusals in 108 seconds, while the first
// transaction sat in the mempool and then mined. Every press asked the
// wallet to sign the SAME bridge on the SAME nonce, which a node only takes
// at a 10% higher fee; a press landing after it mined would have bridged the
// $2 a second time. Two rules come out of it, both pure and pinned here:
//
//   1. One request per card at a time (the component's re-entrancy latch).
//   2. A nonce conflict means "find the transaction that is already out and
//      follow THAT one", never "sign again". The card finds it by its exact
//      destination and calldata among the wallet's mined transactions.
//
// Pure: no framework, no wallet library, no browser globals.

/** The node's words for "this wallet already has a transaction on that
 *  nonce" (geth, erigon, reth, nethermind, besu and the L2 forks of each):
 *  a same-nonce send whose fee is not 10% higher, a nonce already mined, or
 *  the very same signed bytes offered twice. */
const NONCE_CONFLICT =
  /replacement transaction underpriced|replacement fee too low|transaction underpriced: .*replace|nonce too low|nonce is too low|nonce has already been used|already known|already imported|already_exists|known transaction|transaction with the same hash was already imported/i

export function isNonceConflict(words: string | null | undefined): boolean {
  return !!words && NONCE_CONFLICT.test(words)
}

export interface SentTxLike {
  from?: string | null
  to?: string | null
  input?: string | null
  hash?: string | null
}

const lc = (v: string | null | undefined) => (v ?? '').toLowerCase()

/** The transaction THIS card built, among a block's transactions: same
 *  sender, same destination, byte-identical calldata. Calldata is the
 *  identity (a re-quote changes it), so another transfer from the same
 *  wallet to the same contract is never mistaken for this step. */
export function matchSentTx<T extends SentTxLike>(txs: readonly T[], want: { from: string; to: string; data?: string | null }): T | null {
  const data = lc(want.data) || '0x'
  return txs.find((t) => lc(t.from) === lc(want.from) && lc(t.to) === lc(want.to) && (lc(t.input) || '0x') === data && !!t.hash) ?? null
}

/** How far back the first look goes (the transaction may have mined just
 *  before the refusal: "nonce too low"), and the most blocks one look reads. */
export const INFLIGHT_LOOKBACK_BLOCKS = 12
export const INFLIGHT_MAX_BLOCKS_PER_LOOK = 40
export const INFLIGHT_POLL_MS = 4_000
export const INFLIGHT_WATCH_MS = 10 * 60_000

/** The block numbers one look reads, newest first: everything after the
 *  cursor up to the tip, capped (a fast chain can outrun one look; the
 *  newest blocks are where a just-mined transaction is). */
export function inflightScanBlocks(i: { cursor: bigint; latest: bigint }): bigint[] {
  const out: bigint[] = []
  for (let b = i.latest; b > i.cursor && out.length < INFLIGHT_MAX_BLOCKS_PER_LOOK; b--) out.push(b)
  return out
}

/** What one look concluded.
 *   found    the card's own transaction is mined: follow its receipt.
 *   waiting  the wallet's mined count has not moved: it is still in flight.
 *   cleared  the count moved and the mined transaction was NOT this card's
 *            (something else used the nonce): the step is free to sign. */
export function inflightVerdict(i: { found: boolean; minedAtStart: number | null; minedNow: number | null; scannedAll: boolean }): 'found' | 'waiting' | 'cleared' {
  if (i.found) return 'found'
  if (i.minedAtStart == null || i.minedNow == null) return 'waiting'
  // Only call it cleared when every block since the cursor was read: a look
  // that hit the cap may simply not have reached the block it mined in.
  return i.minedNow > i.minedAtStart && i.scannedAll ? 'cleared' : 'waiting'
}

export const INFLIGHT_COPY = {
  /** Beside the spinner while the earlier transaction is followed. */
  waiting: 'Your wallet already sent this step. Nothing new was signed; this card is following that transaction and continues on its own when it lands.',
  button: 'Following your transaction…',
  /** The nonce was used by a different transaction: this step never went out. */
  cleared: 'Another transaction from this wallet was still confirming. It has landed now, so this step is ready to sign.',
  /** Ten minutes and nothing mined. */
  timeout: 'A transaction from this wallet has been pending for 10 minutes. Check the wallet’s activity on the explorer before sending this step again.',
} as const
