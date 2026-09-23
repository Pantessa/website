// lib/wallet-arm.ts — arm the MetaMask launch at the door, fire it on the tap.
//
// WHY (squad mobile-onboarding, CONNECT lane, 2026-09-23 — the relay socket
// trace): on the MetaMask tap the SDK opens its relay WebSocket, joins a
// channel, and only on the JOIN ack (+771ms) navigates to `metamask://…`.
// That navigation runs in a socket callback. Chrome's transient activation
// (5s) covers it; WebKit's does not — it propagates a gesture into microtasks
// only from fetch/XHR/MediaDevices (Source/WebCore/dom/UserGestureIndicator.cpp)
// and through DOMTimers for 1s, never through a socket message. So on an
// iPhone the tap's launch is never user-initiated: Safari falls back to the
// document's external-URL policy (a prompt at best), a WKWebView drops it.
//
// HOW: when the door opens on a phone, start the SDK's connection ourselves
// (`provider.request({ method: 'eth_requestAccounts' })` — the exact call
// wagmi's connect makes) with lib/wallet-handoff ARMED, so the link the SDK
// builds (channel joined, key exchanged) is held instead of navigated. A
// capture-phase click listener on RainbowKit's MetaMask row (components/
// WalletAppHandoff) then navigates to it SYNCHRONOUSLY in the tap. RainbowKit's
// own connect goes on to `eth_requestAccounts` again; the SDK sees one is
// pending and only re-emits display_uri (metamask-sdk.js initializeMobileProvider
// sendRequest: "waiting for initialization to complete"), which our holder
// dedupes by channel id. Both resolve when the wallet approves.
//
// Never on desktop, never inside a wallet's own browser (injected provider).
// Idempotent; errors are swallowed — a failed arm leaves the tap to the
// socket-paced launch it had before.

import type { Connector } from 'wagmi'
import { insideWalletBrowser, mobilePlatform, shouldArmLaunch } from '@/lib/mobile-wallet'
import { armWalletAppOpen, walletAppArmedOrArming } from '@/lib/wallet-handoff'

/** wagmi's id for the MetaMask SDK connector (@wagmi/connectors metaMask.js). */
export const METAMASK_SDK_CONNECTOR_ID = 'metaMaskSDK'

/** Pure: the connector the arm targets, if the lineup has it. */
export function connectorToArm<C extends { id: string }>(connectors: readonly C[]): C | null {
  return connectors.find((c) => c.id === METAMASK_SDK_CONNECTOR_ID) ?? null
}

/** Pure: should THIS browser arm? */
export function armHere(nav: { userAgent: string; maxTouchPoints?: number; platform?: string } | null | undefined, hasReactNativeWebView: boolean): boolean {
  if (!nav) return false
  return shouldArmLaunch({
    platform: mobilePlatform(nav.userAgent, { maxTouchPoints: nav.maxTouchPoints, platform: nav.platform }),
    walletBrowser: insideWalletBrowser(nav.userAgent, hasReactNativeWebView),
  })
}

let inFlight: Promise<void> | null = null

type SdkProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

/** Start the SDK's connection with the launch held. Resolves once the
 *  request has been ISSUED (the link arrives on the holder within ~1s);
 *  the request itself settles only when a wallet approves — never awaited. */
export function armMetaMaskLaunch(connectors: readonly Connector[]): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (!armHere(navigator, 'ReactNativeWebView' in window)) return Promise.resolve()
  if (walletAppArmedOrArming()) return inFlight ?? Promise.resolve()
  const target = connectorToArm(connectors)
  if (!target) return Promise.resolve()
  inFlight = (async () => {
    try {
      const provider = (await target.getProvider()) as SdkProvider
      armWalletAppOpen()
      // Not awaited: it resolves when the wallet approves the connect, which
      // is after the tap and after the round trip to the app.
      provider.request({ method: 'eth_requestAccounts', params: [] }).catch(() => {})
    } catch {
      // The tap keeps the socket-paced launch it had.
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
