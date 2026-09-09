/**
 * What the in-turn row says while a build is taking a while.
 *
 * A native build reads balances and live quotes on-chain, and a funding
 * scan walks five chains — 10–12s of "Thinking…" on a money surface reads
 * as stuck (a stranger on /i with an authorized wallet, MOBILE finding 11,
 * squad gtm 2026-09-08). After SLOW_TURN_MS the row names what is taking
 * the time. Deliberately generic and true of every native lane; the
 * server's own status lines (routing, payments) always win over it.
 */
export const SLOW_TURN_MS = 3500
export const SLOW_TURN_CAPTION = 'Still working — reading balances and live quotes on-chain. Usually under 15 seconds.'
