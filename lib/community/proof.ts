// TRADE PROOF — a 'trade' post carries the author's OWN receipt-verified fill
// (lane CORE owns the bodies). The poster sends an embed_turns id and one
// switch (show the size or not); everything shown is re-read here from the
// row the chain already confirmed (verification = 'verified': the tx, its
// sender and its target). A row that is not verified, not the author's, or
// internal (outside an internal run) is no proof — refused by name.

import type { TradeProof } from './spec'

export interface MyFill {
  turnId: string
  symbols: string[]
  sizeUsd: number | null
  chain: string | null
  txUrl: string | null
  signedAt: number
  /** A plain-words line the composer shows, e.g. "Bought $25 of ETH on Base". */
  label: string
}

/** The caller's own verified fills, newest first — the composer's picker. */
export async function listMyFills(_wallet: string, _opts?: { symbol?: string; limit?: number; includeInternal?: boolean }): Promise<MyFill[]> {
  throw new Error('lib/community/proof listMyFills: lane CORE lands this')
}

/** Re-derive the proof for a post. null = not provable (the route refuses). */
export async function resolveTradeProof(_author: string, _turnId: string, _opts: { showSize: boolean; includeInternal?: boolean }): Promise<TradeProof | null> {
  throw new Error('lib/community/proof resolveTradeProof: lane CORE lands this')
}
