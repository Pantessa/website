// lib/inapp-browser.ts — is this page inside an IN-APP browser, and can that
// browser hand the visitor to a wallet app at all?
//
// OWNED BY THE LINKS LANE of the mobile-onboarding squad (2026-09-23). A link
// (/i/<slug>) is opened from a tweet, a DM, a LinkedIn post, an iMessage
// preview — and those apps open it in THEIR browser, not the phone's. That
// browser decides whether "Connect a wallet → MetaMask" can ever work:
//
//   · iOS, WKWebView-based in-app browsers (X, LinkedIn, Facebook, Instagram,
//     a bare WKWebView): a custom-scheme navigation (`metamask://…`) is
//     dropped unless the HOST app forwards it to UIApplication.open — X and
//     LinkedIn don't — and a universal link (`https://metamask.app.link/…`)
//     renders as a WEB PAGE inside the webview instead of opening the app
//     (universal links only cross apps from Safari / SFSafariViewController).
//     The MetaMask SDK lane therefore ends at the handoff card's "Still
//     waiting on MetaMask" — with the wallet installed. No escape exists in
//     script: iOS gives a page no way to open Safari. The visitor has to use
//     the app's own menu ("Open in Safari" / "Open in browser"), so the page
//     must SAY that and hand them the URL to carry.
//   · Android in-app WebViews (the `; wv)` token: Facebook, Instagram, X's
//     own browser): custom schemes are blocked unless the host app handles
//     them; app links open in the webview. Android DOES have an escape —
//     an `intent://…#Intent;scheme=https;package=com.android.chrome;…;end`
//     link opens Chrome from most WebViews — offered as a link, with the
//     copyable URL beside it because it is unmeasured on a real phone here.
//   · SFSafariViewController (Telegram iOS, Gmail iOS, many others) and
//     Chrome Custom Tabs (Telegram/Gmail Android): the SYSTEM engine with the
//     system UA — undetectable, and app launches work like the real browser.
//   · A wallet's OWN in-app browser (MetaMask Mobile, Coinbase Wallet,
//     Phantom): in-app, but the wallet is INJECTED there — nothing to launch,
//     everything signs in-page. Never show the escape line to those.
//
// Pure: a UA string in, a verdict out, harness-pinned against the exact
// strings the apps send (scripts/drive-mobile-links.ts MOBILE_UAS). Read on
// the server from the request UA (the /i page passes it down, so the escape
// line is in the SSR HTML) and re-read on the client for the same answer.

export type InAppVendor =
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'snapchat'
  | 'tiktok'
  | 'webview'
  | 'metamask'
  | 'coinbase-wallet'
  | 'phantom'
  | 'trust'

export type InAppBrowser = {
  /** The page is inside an app's own browser (not Safari / Chrome / Samsung
   *  Internet, and not a system in-app tab, which is indistinguishable). */
  inApp: boolean
  vendor: InAppVendor | null
  /** Whether a `metamask://` / universal-link launch can bring a wallet app
   *  forward from here. False = show the escape line instead of a launch. */
  canLaunchApps: boolean
  /** The wallet whose browser this is — signing happens in-page there. */
  walletInjected: boolean
  platform: 'ios' | 'android' | 'other'
}

const VENDOR_TOKENS: Array<{ re: RegExp; vendor: InAppVendor }> = [
  // Wallet browsers first: they also carry the bare-webview shape below.
  { re: /MetaMaskMobile/i, vendor: 'metamask' },
  { re: /CoinbaseWallet|CoinbaseBrowser/i, vendor: 'coinbase-wallet' },
  { re: /\bPhantom\b/i, vendor: 'phantom' },
  { re: /\bTrust\b.*\bAndroid\b|TrustWallet/i, vendor: 'trust' },
  { re: /Twitter for iPhone|Twitter for iPad|TwitterAndroid|\bXApp\b/i, vendor: 'x' },
  { re: /LinkedInApp/i, vendor: 'linkedin' },
  { re: /\bFBAN\b|\bFBAV\b|FB_IAB|\bFBIOS\b/i, vendor: 'facebook' },
  { re: /\bInstagram\b/i, vendor: 'instagram' },
  { re: /\bSnapchat\b/i, vendor: 'snapchat' },
  { re: /\bBytedanceWebview\b|\bmusical_ly\b|\bTikTok\b/i, vendor: 'tiktok' },
]

const WALLET_VENDORS = new Set<InAppVendor>(['metamask', 'coinbase-wallet', 'phantom', 'trust'])

/** iOS WebKit without the Safari token = a WKWebView (Safari and
 *  SFSafariViewController both send `Safari/`). */
function bareIosWebView(ua: string): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(ua) && /AppleWebKit/.test(ua) && !/\bSafari\//.test(ua) && !/\bCriOS\/|\bFxiOS\/|\bEdgiOS\//.test(ua)
}

/** Android's system WebView stamps `; wv)` into the UA (Chrome Custom Tabs
 *  and Chrome itself never do). */
function androidWebView(ua: string): boolean {
  return /\bAndroid\b/.test(ua) && /;\s*wv\)/.test(ua)
}

export function platformOf(ua: string): InAppBrowser['platform'] {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return 'ios'
  if (/\bAndroid\b/.test(ua)) return 'android'
  return 'other'
}

/** The verdict for one UA string. Unknown = a normal browser (fail OPEN to
 *  the normal door: a wrong "you're in an app" line on Safari would cost
 *  more than a missed one in some unnamed webview). */
export function inAppBrowserOf(userAgent: string | null | undefined): InAppBrowser {
  const ua = (userAgent ?? '').trim()
  const platform = platformOf(ua)
  const vendor = VENDOR_TOKENS.find(({ re }) => re.test(ua))?.vendor ?? null
  if (vendor && WALLET_VENDORS.has(vendor)) {
    return { inApp: true, vendor, canLaunchApps: true, walletInjected: true, platform }
  }
  const shape = bareIosWebView(ua) || androidWebView(ua)
  if (vendor || shape) {
    return { inApp: true, vendor: vendor ?? 'webview', canLaunchApps: false, walletInjected: false, platform }
  }
  return { inApp: false, vendor: null, canLaunchApps: true, walletInjected: false, platform }
}

/** What the app calls its own "leave me" menu item — the one thing the page
 *  can tell the visitor to press. Generic when we don't know the app. */
export function inAppEscapeCopy(b: InAppBrowser): { app: string; where: string; browser: string } {
  const browser = b.platform === 'android' ? 'Chrome' : 'Safari'
  switch (b.vendor) {
    case 'x':
      return { app: 'X', where: b.platform === 'ios' ? 'tap the share icon, then "Open in Safari"' : 'tap the three dots, then "Open in browser"', browser }
    case 'linkedin':
      return { app: 'LinkedIn', where: 'tap the three dots at the top, then "Open in browser"', browser }
    case 'facebook':
      return { app: 'Facebook', where: 'tap the three dots, then "Open in browser"', browser }
    case 'instagram':
      return { app: 'Instagram', where: 'tap the three dots, then "Open in browser"', browser }
    case 'snapchat':
      return { app: 'Snapchat', where: 'tap the share icon, then open it in your browser', browser }
    case 'tiktok':
      return { app: 'TikTok', where: 'tap the three dots, then "Open in browser"', browser }
    default:
      return { app: 'this app', where: `use its menu to open the page in ${browser}`, browser }
  }
}

/** Android's Chrome intent link for a page URL — the one scripted escape a
 *  WebView honours (unmeasured on a phone here; offered beside the copyable
 *  URL, never instead of it). Null off Android or for a non-https URL. */
export function androidChromeIntent(pageUrl: string, b: InAppBrowser): string | null {
  if (b.platform !== 'android') return null
  let u: URL
  try {
    u = new URL(pageUrl)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(pageUrl)};end`
}

/** Storage that may not be there: a WKWebView with "Prevent cross-site
 *  tracking", a private tab, a blocked origin — `window.localStorage` itself
 *  THROWS on access in some of them. Never touch storage bare on /i. */
export function safeStorage(win: { localStorage?: Storage; sessionStorage?: Storage } | null | undefined, kind: 'local' | 'session' = 'local'): Storage | null {
  if (!win) return null
  try {
    const s = kind === 'local' ? win.localStorage : win.sessionStorage
    if (!s) return null
    const probe = '__pantessa_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}
