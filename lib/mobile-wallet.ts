// lib/mobile-wallet.ts — the pure decisions behind bringing a wallet APP
// forward on a phone. No React, no window: the harness pins every rule
// without a browser, and lib/wagmi.ts + lib/wallet-handoff.ts + the mobile
// drive read the same rules.
//
// THE MEASUREMENT THESE ENCODE (squad mobile-onboarding, CONNECT lane,
// 2026-09-23 — Playwright + Chrome, iPhone 13 UA, `isMobile: true`; Nate on a
// phone: "when you click metamask the app does not open for connection"):
//
// On a mobile UA RainbowKit's MetaMask lane is the MetaMask SDK (wagmi's
// `metaMask()` connector), and on the CONNECT tap TWO navigations to the SAME
// `metamask://connect?channelId=…` link fired ~2ms apart, ~0.4–1.1s after the
// tap (after the SDK's socket JOIN ack):
//
//   1. the SDK's own launch — through our `openDeeplink` (lib/wallet-handoff)
//      since #822, the SDK itself before it. Chrome honours it and CONSUMES
//      the tap's activation (`navigator.userActivation.isActive` flips true →
//      false across it; the console then says the scheme has no handler,
//      which on a phone is the app opening).
//   2. RainbowKit's `WalletButton.onMobileUri` — `window.location.href =
//      display_uri` right after it writes WALLETCONNECT_DEEPLINK_CHOICE —
//      refused: "Not allowed to launch 'metamask://…' because a user gesture
//      is required".
//
// The pre-#822 tree shows the identical pair, so #822 did not change the
// connect tap. Chrome's consumed-activation rule makes the first attempt win
// there; WebKit has no such rule, and a second `location.href` REPLACES a
// pending external-scheme navigation — so on iOS the duplicate can cancel the
// launch it duplicates. And RainbowKit's copy is a race (its
// `once('display_uri')` is attached after an await; the sign-in door's run
// lost it and fired once): behaviour that differs by a few milliseconds is
// exactly what "sometimes the app doesn't open" looks like.
//
// The rule: on the SDK lane there is ONE navigator — the SDK, through
// lib/wallet-handoff — and RainbowKit's duplicate is removed at the source
// (`withoutDuplicateMobileLaunch`). WalletConnect lanes are the opposite:
// there RainbowKit's `mobile.getUri` navigation IS the only launch, and it is
// kept.

/** What RainbowKit's `isMobile()` decides from, made pure. `maxTouchPoints`
 *  + `platform` cover iPadOS, which wears a Macintosh user agent. */
export type MobilePlatform = 'ios' | 'android' | 'desktop'

export function mobilePlatform(
  ua: string | null | undefined,
  opts: { maxTouchPoints?: number; platform?: string } = {},
): MobilePlatform {
  const s = ua ?? ''
  if (/android/i.test(s)) return 'android'
  if (/iPhone|iPod/.test(s)) return 'ios'
  if (/iPad/.test(s)) return 'ios'
  if (opts.platform === 'MacIntel' && (opts.maxTouchPoints ?? 0) > 1) return 'ios'
  return 'desktop'
}

/**
 * Inside a wallet's OWN in-app browser the provider is injected and there is
 * no app to bring forward — a launch there would be a page navigating to
 * itself. The MetaMask SDK's test (`isMetaMaskMobileWebView`): a React Native
 * WebView bridge AND a user agent ending in `MetaMaskMobile`. Both are
 * required; either alone is somebody else's WebView.
 */
export type WalletBrowser = 'metamask' | null

export function insideWalletBrowser(ua: string | null | undefined, hasReactNativeWebView: boolean): WalletBrowser {
  if (hasReactNativeWebView && (ua ?? '').endsWith('MetaMaskMobile')) return 'metamask'
  return null
}

/**
 * Which connector RainbowKit's `metaMaskWallet` picks (2.2.10):
 *  · the provider is injected (extension, or the wallet's in-app browser) →
 *    wagmi `metaMask()` talking to the injected provider in-page — no launch;
 *  · a phone without it → the same connector as the MetaMask SDK over its
 *    socket — the app is brought forward by a `metamask://` navigation;
 *  · desktop without it → WalletConnect (QR).
 */
export type MetaMaskLane = 'injected' | 'sdk' | 'walletconnect'

export function metaMaskLaneFor(i: { platform: MobilePlatform; injected: boolean }): MetaMaskLane {
  if (i.injected) return 'injected'
  return i.platform === 'desktop' ? 'walletconnect' : 'sdk'
}

/** The lane on which a wallet method is an app launch this site must carry. */
export function launchesWalletApp(lane: MetaMaskLane): boolean {
  return lane === 'sdk'
}

/**
 * How a wallet link is navigated. An app-scheme link is a location
 * assignment. An https universal link would be an anchor click — but a
 * programmatic click is not a user navigation, so iOS Safari may open the
 * web fallback for it; lib/wagmi pins `useDeeplink: true` so the SDK never
 * hands us one on mobile web. (Anything else is not a wallet link.)
 */
export type LaunchMethod = 'assign' | 'anchor'

export function launchMethodFor(link: string): LaunchMethod | null {
  if (/^metamask:\/\//i.test(link)) return 'assign'
  if (/^https:\/\/metamask\.app\.link\//i.test(link)) return 'anchor'
  return null
}

/**
 * The shape of a RainbowKit wallet that matters here. `mobile.getUri` is
 * what RainbowKit's mobile list navigates to after `connect()` starts;
 * `qrCode` is set only on the WalletConnect lane.
 */
export type RainbowKitWalletShape = {
  mobile?: { getUri?: unknown } | undefined
  qrCode?: unknown
}

/**
 * Whether RainbowKit's mobile list would navigate to the wallet itself for
 * this wallet (a second launch beside the SDK's on the SDK lane; the ONLY
 * launch on a WalletConnect lane).
 */
export function rainbowKitNavigates(w: RainbowKitWalletShape): boolean {
  return typeof w.mobile?.getUri === 'function'
}

/**
 * The SDK lane's wallet object with RainbowKit's duplicate launch removed.
 * `metaMaskWallet` returns `mobile.getUri: (uri) => uri` exactly when it
 * chose the SDK connector (injected or mobile) and `qrCode` exactly when it
 * chose WalletConnect — so "getUri without a qrCode" is the SDK lane, and
 * dropping `mobile` there leaves the SDK as the one navigator. A wallet that
 * carries BOTH (rainbowWallet, walletConnectWallet: WC lane, `mobile.getUri`
 * = its `rainbow://wc?uri=` link) is untouched — there RainbowKit's
 * navigation is the launch.
 */
export function withoutDuplicateMobileLaunch<W extends RainbowKitWalletShape>(wallet: W): W {
  if (rainbowKitNavigates(wallet) && !wallet.qrCode) return { ...wallet, mobile: undefined }
  return wallet
}

/**
 * Chrome's two verdicts on an external-scheme launch, as it prints them.
 * The drive reads these; the harness pins the parser so a Chrome wording
 * change is caught as a red, never as "no launch attempt".
 */
export const CHROME_LAUNCH_REFUSED = /Not allowed to launch '([^']+)'.*user gesture is required/
export const CHROME_LAUNCH_NO_HANDLER = /Failed to launch '([^']+)'.*does not have a registered handler/

export type LaunchVerdict = { verdict: 'dropped' | 'allowed'; link: string }

export function readLaunchVerdict(consoleLine: string): LaunchVerdict | null {
  const d = CHROME_LAUNCH_REFUSED.exec(consoleLine)
  if (d) return { verdict: 'dropped', link: d[1] }
  const a = CHROME_LAUNCH_NO_HANDLER.exec(consoleLine)
  if (a) return { verdict: 'allowed', link: a[1] }
  return null
}
