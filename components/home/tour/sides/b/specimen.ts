// THE TOUR · COMMUNITY — the specimen trade post (lane SIDES-B). It is an
// EXAMPLE and wears the tag; what makes it honest is that every line on it
// is composed by the SAME functions the real card uses
// (lib/community/proof-words: proofFactLine, proofTagLine, tradeHeadline),
// so the anatomy can never show wording the product does not print. The
// legend's sentences restate app/docs/community "What verified on-chain
// means" and nothing more. Pure and client-safe.

import { proofFactLine, proofTagLine, tradeHeadline } from '@/lib/community/proof-words'

/** The specimen's inputs: a $75 swap on Base the author tagged "bought ETH". */
export const SPECIMEN = {
  sizeUsd: 75,
  chain: 'Base',
  symbols: ['buy:ETH'],
  side: 'buy' as const,
  title: 'Adding on the retest',
  /** The docs' own placeholder for a room's address. */
  room: '/g/your-room',
}

export interface SpecimenLines {
  /** The chain-confirmed line, under the verified mark. */
  fact: string
  /** The author's tag, worded as theirs. */
  tag: string | null
  /** The typed title, quoted as the author's words. */
  said: string | null
  room: string
}

export function specimenLines(): SpecimenLines {
  const proof = { ...SPECIMEN, verification: 'verified' as const }
  return {
    fact: proofFactLine(proof),
    tag: proofTagLine(proof),
    said: tradeHeadline({ title: SPECIMEN.title, proof: proof as never }).authorWords,
    room: SPECIMEN.room,
  }
}

export interface AnatomyPart {
  id: 'proof' | 'call' | 'room'
  name: string
  what: string
}

/** The three callouts, in the order they are numbered on the card. */
export const ANATOMY: readonly AnatomyPart[] = [
  { id: 'proof', name: 'The proof', what: 'Read from the chain when the post is made: the author’s wallet sent this transaction, and this is what it moved, net, in a dollar stablecoin or ETH. Nobody types it.' },
  { id: 'call', name: 'The call', what: 'The market, the side and the title are the author’s own words, printed as theirs. They never sit under the verified mark, and nothing here speaks to profit.' },
  { id: 'room', name: 'The room', what: 'A feed with members. Joining is one tap and needs no wallet; reading needs no account.' },
]

/** What cannot carry proof yet (app/docs/community, the same list). */
export const PROOF_LIMIT = 'Proof covers a swap on one chain today. Perp fills and cross-chain swaps cannot be posted as proof yet.'
