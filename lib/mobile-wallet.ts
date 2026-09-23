// lib/mobile-wallet.ts — pure decisions for wallets on a PHONE.
//
// Contract stub committed by the mobile-onboarding squad coordinator
// (2026-09-23) so every lane compiles against one name from minute one.
// OWNED BY THE CONNECT LANE: platform (UA → phone / desktop / inside a
// wallet's own in-app browser), which lane a wallet takes on that platform
// (injected / MetaMask SDK / WalletConnect), and how an app launch link must
// be navigated. Everything here is pure and harness-pinned.
export type MobilePlatform = 'desktop' | 'ios' | 'android' | 'wallet-webview'

/** Placeholder — CONNECT replaces this with the real UA reading. */
export function mobilePlatformOf(userAgent: string | null | undefined): MobilePlatform {
  const ua = (userAgent ?? '').toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}
