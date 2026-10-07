// THE FIRST RUN — the words every empty door says (squad pre-gtm, 2026-10-06,
// FIRSTRUN lane). Pure: no React, no DOM, so the harness pins it
// (scripts/guide-pins.ts): every ask a door offers as its first action must
// land on a native gate as an action through the ladder replica — a door
// never teaches a dead end — and every fee figure is derived from lib/fees,
// never typed.
//
// Honesty: a door says only what CAN happen here. "Sign in to keep" is the
// account contract (connect to act, sign in to keep — CLAUDE.md rule 6); a
// job's steps are the compiler's own ("fund, wait, buy"); the creator share
// is lib/fees' number.

import { CREATOR_FEE_SPLIT, LINK_FEE_PCT } from '@/lib/fees'

const SPLIT_WORD: string =
  CREATOR_FEE_SPLIT === 0.5 ? 'half' : CREATOR_FEE_SPLIT === 0.25 ? 'a quarter' : `${Math.round(CREATOR_FEE_SPLIT * 100)}%`

/** The JOBS rail, empty or signed out. The ask is the hero reel's own
 *  four-step job at a first-run size (fund → wait → buy); the ladder builds
 *  it (pinned). */
export const JOBS_DOOR = {
  eyebrow: 'Jobs · what lands here',
  title: 'An ask with “then” is a job.',
  body: 'Fund, wait, buy, protect — one signature per step. It waits out the bridge for you and every state stays visible here, nothing signed without you.',
  lines: ['You say the whole plan in one sentence.', 'Each step is built and guarded, then offered to your wallet.', 'Stops and recurring buys arm here too, and you can pause or fire them.'],
  ctaLabel: 'Try a 4-step job →',
  ask: 'Fund Robinhood Chain with $12 from Base including gas, then buy $10 of AAPL',
} as const

/** The CHATS rail with nothing in it. */
export const CHATS_DOOR = {
  eyebrow: 'Chats · kept with your wallet',
  title: 'Connect to act. Sign in to keep.',
  body: 'A connected wallet can already ask and sign. One signature more — a sign-in — keeps every thread on this wallet, on every device.',
  bodySignedIn: 'Every conversation on this wallet lands here, on every device. Start one: the first ask is the whole first turn.',
  lines: ['Asking is free; a tap on a chip sends it.', 'Anything that moves money ends at your wallet’s signature.', 'Signed in, the thread follows you.'],
} as const

/** The LINKS studio with no links minted yet. */
export const LINKS_DOOR = {
  eyebrow: 'Links · none minted yet',
  title: 'Any ask is a link that pays you.',
  body: `Paste the sentence you’d type in chat. Whoever opens the link connects a wallet and the path builds for them — and you earn ${SPLIT_WORD} of the ${LINK_FEE_PCT} fee on every swap it produces.`,
  lines: ['Mint it above — the ask is the whole form.', 'Share it anywhere a link goes.', 'Its opens, builds and signatures show here, live.'],
  ctaLabel: 'Mint your first link ↑',
  /** The example ask the CTA drops into the form (the hero’s own buy). */
  exampleAsk: 'Buy $25 of AAPL',
} as const

/** The WALLET page with nothing connected. */
export const WALLET_DOOR = {
  eyebrow: 'Wallet · every chain, one window',
  title: 'Your wallet, on every chain.',
  lines: ['Balances and gas on each chain, priced.', 'Every flag with its fix beside it — a card door, a receive address, a top-up.', 'Looking takes no signature. Moving money takes yours.'],
} as const

/** The WALLET window (page or popup) for a connected wallet that holds
 *  nothing on any chain it read. */
export const WALLET_EMPTY_DOOR = {
  eyebrow: 'Wallet · empty on every chain',
  title: 'Nothing here yet — two ways in.',
  body: 'This window prices what you hold on every chain, flags what’s stuck, and offers the fix. Money gets in by card, or by sending to this address.',
  lines: ['A card lands ETH here through Stripe — gas and value in one delivery.', 'Or send from another wallet to the address above.', 'The moment it lands, this window says so, and the chat can act on it.'],
  card: 'Add funds with a card',
  receive: 'Show my address',
} as const

/** The chat’s empty surface. */
export const CHAT_EMPTY = {
  title: 'Say what should happen.',
  tap: 'Run one — a tap sends it',
} as const

/** The /i splash: what happens after the tap, in order — a stranger from a
 *  tweet reads a quoted sentence and one button; this is the missing line
 *  between them. Step 2 is the promise that matters: nothing is signed by
 *  looking. */
export const I_STEPS: readonly { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Connect a wallet', body: 'or make one with email or Google — no app to install.' },
  { n: '2', title: 'See the plan first', body: 'we read your balances and build every step. Nothing is signed by looking.' },
  { n: '3', title: 'Sign it, or close the tab', body: 'your wallet is the only thing that can move money.' },
]

/** The keep-it moment after the first signed receipt (components/guide/KeepItBar). */
export const KEEP_IT = {
  aria: 'Signed — keep this?',
  title: 'Signed.',
  receipt: 'receipt on-chain →',
  body: 'That was the whole thing — your wallet signed, nothing else could. One more signature keeps this thread and your record on this wallet, on every device. Nothing moves.',
  cta: 'Keep this — sign in',
  busy: 'Waiting for your wallet…',
  later: 'Not now',
} as const

/** The last signed receipt this browser produced in the chat (ChatInterface
 *  reports it; ChatSignInGate reads it to turn its connected banner into the
 *  keep-it moment). A tiny module store — no React at import time. */
export interface SignedReceipt {
  artifact: string
  valueUsd?: number
  txUrl?: string
  at: number
}
let lastReceipt: SignedReceipt | null = null
const receiptListeners = new Set<() => void>()
export function noteSignedReceipt(r: Omit<SignedReceipt, 'at'>, now = Date.now()): void {
  lastReceipt = { ...r, at: now }
  for (const fn of receiptListeners) fn()
}
export function getSignedReceipt(): SignedReceipt | null {
  return lastReceipt
}
export function subscribeSignedReceipt(fn: () => void): () => void {
  receiptListeners.add(fn)
  return () => {
    receiptListeners.delete(fn)
  }
}

/** Every ask a door offers — pinned through the ladder replica. */
export const FIRST_RUN_ASKS: readonly string[] = [JOBS_DOOR.ask, LINKS_DOOR.exampleAsk]
