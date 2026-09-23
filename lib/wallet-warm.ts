// lib/wallet-warm.ts — pre-arm the wallet lane a phone will tap.
//
// wagmi's `metaMask()` connector (RainbowKit's MetaMask lane whenever
// isMobile()) creates the MetaMask SDK inside `getProvider()`, and only on the
// first call: a dynamic import of `@metamask/sdk` (~470KB), `sdk.init()`, and
// the relay socket's first handshake. Left to the connect tap, all of that
// runs between the tap and the `metamask://` launch — measured 0.7–1.8s on a
// fresh visitor (squad mobile-onboarding, CONNECT lane, 2026-09-23). The
// browser's activation has to survive the whole wait; WebKit's does not
// survive a network callback at all. So the door warms the connector when it
// OPENS: the tap then only pays the channel JOIN.
//
// Warming never connects and never launches: `getProvider()` builds the SDK
// and its provider; it does not call `connect()`. Idempotent (the connector
// memoises its provider promise); errors are swallowed — a warm-up that fails
// simply leaves the tap to do the work it did before.

import type { Connector } from 'wagmi'

/** wagmi's id for the MetaMask SDK connector (@wagmi/connectors metaMask.js). */
export const METAMASK_SDK_CONNECTOR_ID = 'metaMaskSDK'

let warmed: Promise<void> | null = null

/** Pure: the connector the warm-up targets, if the lineup has it. */
export function connectorToWarm<C extends { id: string }>(connectors: readonly C[]): C | null {
  return connectors.find((c) => c.id === METAMASK_SDK_CONNECTOR_ID) ?? null
}

/** Build the MetaMask SDK now, off the tap. Resolves when the provider
 *  exists (or the attempt failed); never throws. */
export function warmWalletConnector(connectors: readonly Connector[]): Promise<void> {
  if (warmed) return warmed
  const target = connectorToWarm(connectors)
  if (!target) return Promise.resolve()
  warmed = Promise.resolve()
    .then(() => target.getProvider())
    .then(
      () => undefined,
      () => {
        // Leave the next call free to try again.
        warmed = null
      },
    )
  return warmed
}

/** Test seam: forget a warm-up. */
export function resetWalletWarm(): void {
  warmed = null
}
