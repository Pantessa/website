// lib/phantom-lane.ts — the Phantom lane binds to PHANTOM, never to whatever
// `window.ethereum` happens to be (Nate, 2026-09-24: a visitor connected
// through MetaMask and the Wallet page said "Phantom").
//
// RainbowKit's `phantomWallet` builds its connector with
// `getInjectedConnector({ namespace: 'phantom.ethereum' })`, and that helper
// FALLS BACK when the namespace is missing:
//
//   window.phantom.ethereum ?? window.ethereum.providers[0] ?? window.ethereum
//
// So on a machine with MetaMask and no Phantom, the lane's connector IS
// MetaMask, wearing the id `phantom` and the name `Phantom`. Two things then
// go wrong, and both were live:
//
//   · The modal's Phantom row is `ready: false` (installed is namespace-
//     checked), so a click shows "Install Phantom" — but RainbowKit calls
//     `connectToWallet(wallet)` BEFORE that branch, unconditionally. The
//     click opened MetaMask's approval, and approving recorded the session
//     under connector `phantom` (+ `recentConnectorId`).
//   · Every later load reconnects that connector first, so the whole app —
//     the Wallet page header above all — names the wrong wallet while
//     MetaMask does the signing. A page that misnames the wallet holding the
//     money reads as a scam, whatever else it gets right.
//
// The cure is to say what we mean: the lane's provider is Phantom's own
// namespace or nothing. `injected({ target })` calls the target on every
// `getProvider()`, so this is also LIVE — a Phantom that injects after our
// config is built is picked up, where RainbowKit captured the provider once
// at config time.
//
// Pure + dependency-free so the harness pins both worlds without a browser.

/** Phantom's EVM provider on this window, or undefined. The ONLY place the
 *  lane is allowed to look: never `window.ethereum`, never `providers[0]`. */
export function phantomProvider(win: unknown): unknown {
  const w = win as { phantom?: { ethereum?: unknown } } | undefined
  return w?.phantom?.ethereum
}

/** The wagmi `injected` target for the Phantom lane. A missing Phantom leaves
 *  `provider` undefined, which is exactly right: `connect()` throws
 *  ProviderNotFoundError (the modal is already showing its install panel),
 *  `getProvider()` answers undefined, and wagmi's reconnect skips the lane
 *  instead of adopting somebody else's wallet under Phantom's name. */
export function phantomTarget(win: unknown): { id: 'phantom'; name: 'Phantom'; provider: unknown } {
  return { id: 'phantom', name: 'Phantom', provider: phantomProvider(win) }
}
