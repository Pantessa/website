// lib/inapp-browser.ts — is this page inside an in-app browser?
//
// Contract stub committed by the mobile-onboarding squad coordinator
// (2026-09-23). OWNED BY THE LINKS LANE: a pure UA reading for the browsers
// a link opens in from a tweet / DM / chat app (X, LinkedIn, Telegram,
// iMessage preview, a bare WebView), and whether that browser can launch a
// wallet app at all.
export type InAppBrowser = { inApp: boolean; vendor: string | null; canLaunchApps: boolean }

/** Placeholder — LINKS replaces this with the measured table. */
export function inAppBrowserOf(userAgent: string | null | undefined): InAppBrowser {
  void userAgent
  return { inApp: false, vendor: null, canLaunchApps: true }
}
