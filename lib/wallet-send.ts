// lib/wallet-send.ts — the Wallet panel's "Send" door, the request half.
//
// The panel (components/WalletPanel.tsx) shows every chain's holdings; the
// obvious next question after "what do I have?" is "move some of it". A
// MetaMask user has the extension's Send button; a Pantessa (CDP embedded)
// wallet, created by email, has NO other window onto its money — without
// this, the only way out of that wallet is to type "send 5 USDC on base to
// 0x…" into the chat. That works, and it stays the chat's lane. This is the
// same guarded transfer (lib/transfer-exec buildTransferArtifact — encode →
// independent re-decode → live balance → spend policy) reached from a form
// instead of a sentence: the chain and token come from the holdings the
// panel just read, so the picker can never name a token the wallet doesn't
// hold, and the amount/recipient are the only free fields.
//
// This module is the PURE half: turn an untrusted request body into the
// TransferSegment the builder takes, or say exactly what's wrong. No I/O —
// the harness pins every refusal. POST /api/wallet/send is the I/O shell.

import { getAddress, isAddress } from 'viem'
import { APP_CHAINS, chainById } from '@/lib/chains'
import type { TransferSegment } from '@/lib/transfer-exec'

/** Chain ids the door builds on — the registry, nothing else. The builder
 *  keeps its own per-chain gas reserves for "all" ETH sends; a chain missing
 *  there falls to the L2 default, which is correct for every registry chain
 *  except mainnet (which is present). */
export const WALLET_SEND_CHAIN_IDS: ReadonlySet<number> = new Set(APP_CHAINS.map((c) => c.id))

/** Longest decimal string the amount field accepts — 30 digits either side
 *  covers any real balance; longer is a script, not a person. */
const AMOUNT_RE = /^(?:\d{1,30})(?:\.\d{1,30})?$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const ENS_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}(?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,62})*\.eth$/
/** A token slot is a ticker (2–12 letters/digits, as the panel shows it) or
 *  the holding's own contract address (what the panel prefers to send — a
 *  ticker can be squatted on another chain, an address can't). */
const SYMBOL_RE = /^[A-Za-z0-9]{2,12}$/

export interface WalletSendRequest {
  from: `0x${string}`
  segment: TransferSegment
}

export type WalletSendParse = WalletSendRequest | { problem: string; field: 'from' | 'chainId' | 'token' | 'amount' | 'to' }

/** Validate a POST /api/wallet/send body. Every refusal names the field so
 *  the form can mark it, and none of them ever guesses: an amount that
 *  isn't a plain decimal (or the literal 'all') is refused, not rounded. */
export function parseWalletSendBody(body: unknown): WalletSendParse {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const from = typeof b.from === 'string' ? b.from.trim() : ''
  if (!ADDRESS_RE.test(from)) return { problem: 'from must be the connected wallet’s 0x address.', field: 'from' }

  const chainId = typeof b.chainId === 'number' ? b.chainId : Number(b.chainId)
  const chain = Number.isInteger(chainId) ? chainById(chainId) : null
  if (!chain || !WALLET_SEND_CHAIN_IDS.has(chain.id)) {
    return { problem: `chainId must be one of ${APP_CHAINS.map((c) => `${c.id} (${c.name})`).join(', ')}.`, field: 'chainId' }
  }

  const token = typeof b.token === 'string' ? b.token.trim() : ''
  // A 0x-prefixed slot is an address or nothing — "0x1234" is not a ticker.
  if (!(ADDRESS_RE.test(token) || (SYMBOL_RE.test(token) && !/^0x/i.test(token)))) {
    return { problem: 'token must be a ticker like USDC or the token’s contract address.', field: 'token' }
  }

  const amountRaw = typeof b.amount === 'string' ? b.amount.trim() : typeof b.amount === 'number' ? String(b.amount) : ''
  const amountHuman = amountRaw.toLowerCase() === 'all' || amountRaw.toLowerCase() === 'max' ? 'all' : amountRaw
  if (amountHuman !== 'all') {
    if (!AMOUNT_RE.test(amountHuman)) return { problem: 'amount must be a plain number like 0.5 or 25, or "all".', field: 'amount' }
    if (Number(amountHuman) <= 0) return { problem: 'The amount must be greater than zero.', field: 'amount' }
  }

  let to = typeof b.to === 'string' ? b.to.trim() : ''
  if (!(ADDRESS_RE.test(to) || ENS_RE.test(to))) {
    return { problem: 'to must be a 0x address or an ENS name ending in .eth.', field: 'to' }
  }
  if (ADDRESS_RE.test(to)) {
    // EIP-55: a mixed-case address carries its own checksum, and a mismatch
    // is the typo signal the checksum exists for — refuse it by name rather
    // than let viem's "Address is invalid" leak from the builder. All-lower
    // (or all-upper) carries no checksum and is accepted as written, then
    // normalized so the artifact the user signs shows the checksummed form.
    const hex = to.slice(2)
    const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase()
    if (mixed && !isAddress(to, { strict: true })) {
      return { problem: 'That address’s checksum doesn’t match — a letter is off somewhere. Copy it again from the source.', field: 'to' }
    }
    to = getAddress(to.toLowerCase())
    if (to.toLowerCase() === from.toLowerCase()) {
      return { problem: 'That recipient is your own wallet — nothing to send.', field: 'to' }
    }
  }

  return {
    from: from as `0x${string}`,
    segment: { amountHuman, token: ADDRESS_RE.test(token) ? token.toLowerCase() : token.toUpperCase(), to, chainId: chain.id, chainName: chain.name },
  }
}
