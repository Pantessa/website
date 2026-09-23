// lib/wallet-handoff.ts — bringing the wallet APP forward on mobile.
//
// THE BUG THIS EXISTS FOR (2026-09-18, Nate, on a phone): "when trying to
// connect to metamask the second signing screen after connection does not pop
// up". Connect worked; the SIWE signature never appeared.
//
// Why. In a mobile browser RainbowKit's MetaMask lane is NOT WalletConnect —
// `metaMaskWallet` picks the wagmi `metaMask()` connector (the MetaMask SDK)
// whenever `isMobile()`, and the SDK talks to the app over its own socket. The
// app only comes forward because the SDK NAVIGATES the page to a
// `metamask://…` link (wagmi passes `useDeeplink: true`) every time it writes
// a method that needs approval — personal_sign, eth_sendTransaction,
// eth_signTypedData_v4, wallet_switchEthereumChain, eth_requestAccounts.
//
// That navigation is an app launch, and iOS Safari and Android Chrome only
// honour an app launch while the page holds a transient user activation. The
// CONNECT tap has one (RainbowKit navigates inside the click handler), so
// connecting works. The SIWE signature does not: lib/session fires it from the
// post-connect effect, seconds after the visitor walked back from the MetaMask
// app — no tap, no activation, so the navigation is dropped on the floor. The
// request sits queued on the SDK socket, the page says "Waiting for your
// signature… the request is open in your wallet", and the wallet it names is
// never brought up. Same family as the Coinbase popup-after-await gotcha
// already pinned in lib/wagmi.ts, one platform over.
//
// The fix is not to guess whether we hold an activation — it is to WATCH: ask
// for the app, and if the browser is still showing this page a moment later
// the launch didn't happen, so put a real button on screen. A tap carries its
// own activation, and the app comes up with the request already waiting in it.
//
// lib/wagmi.ts hands the SDK `openDeeplink: requestWalletAppOpen`, so every
// link the SDK would have navigated to comes here first (the SDK returns early
// when a `preferredOpenLink` is set and never navigates itself). The desktop
// lanes never reach this file: with the extension injected the SDK talks to it
// in-page, and with no extension the lane is WalletConnect.

// ── The pure decisions (harness-pinned) ─────────────────────────────────

/** How long the browser gets to leave for the wallet app before we decide the
 *  launch was dropped. Long enough that a real switch has hidden the page
 *  (both platforms fire visibilitychange well inside it), short enough that a
 *  visitor staring at a stalled page isn't left guessing. */
export const WALLET_APP_SETTLE_MS = 1200

/** Links we will navigate to. The SDK builds the link itself, so this is a
 *  belt on a brace: a navigation is the one thing on this path that can leave
 *  the site, and it may only ever leave for the wallet. */
//
//  Only the SDK's CONNECT link passes — `metamask://connect?…` and its universal
//  twin. MetaMask's other deeplinks are not wallet requests: `metamask://dapp/
//  <host>` opens an arbitrary site INSIDE the wallet's own browser, the most
//  trusted surface a phishing page could ask for, and the holder is reachable
//  from the public `pantessa:wallet-app-open` DOM event (the drives' seam).
//  Found by the mobile-onboarding squad's security pass (QA, 2026-09-23).
const WALLET_APP_LINKS: { test: RegExp; app: string }[] = [
  { test: /^metamask:\/\/connect(?:\?|$)/i, app: 'MetaMask' },
  { test: /^https:\/\/metamask\.app\.link\/connect(?:\?|$)/i, app: 'MetaMask' },
]

/** Whitespace or a control character anywhere in a link means the SDK didn't
 *  build it. Written as a range so the intent is one thing, not two. */
const NOT_A_LINK = /[\s\x00-\x1f\x7f]/

/** The wallet a link opens, or null when it opens something we won't launch. */
export function walletAppFor(link: string | null | undefined): string | null {
  if (!link || typeof link !== 'string') return null
  const trimmed = link.trim()
  if (!trimmed || NOT_A_LINK.test(trimmed)) return null
  return WALLET_APP_LINKS.find(({ test }) => test.test(trimmed))?.app ?? null
}

/** The DOM event a page may dispatch to stand in for the SDK's ask (the
 *  drives' seam; components/WalletAppHandoff listens). `detail.link` goes
 *  through walletAppFor like every other link. */
export const WALLET_APP_OPEN_EVENT = 'pantessa:wallet-app-open'

/** An open request we are holding: the link, the wallet it names, and whether
 *  the visitor has already tapped once without the app coming up. */
export type WalletAppOpen = { link: string; app: string; tried: boolean }

/** The one thing the card needs to know about the browser it is in: whether
 *  an app launch can work from here at all (lib/inapp-browser, LINKS lane —
 *  X's, LinkedIn's and a bare WKWebView's browsers drop `metamask://` and
 *  render a universal link as a web page). Passed in, never read here: the
 *  copy stays pure. */
export type HandoffBrowser = {
  inApp: boolean
  canLaunchApps: boolean
  /** From inAppEscapeCopy: the app's name and where its "open in the real
   *  browser" item lives. */
  escape?: { app: string; where: string; browser: string }
}

export type HandoffCopy = {
  title: string
  body: string
  cta: string
  /** The tap can never launch the app from this browser: the CTA carries
   *  the page's link out instead of asking for the same tap again. */
  escape: boolean
}

/**
 * What the handoff card says. Split out so the harness pins the words:
 *  · first time — the browser refused the launch silently, so this card is the
 *    first thing the visitor has seen about it. Say what to do.
 *  · after a tap that also didn't land — the wallet probably isn't on this
 *    phone. Say that, instead of asking for the same tap again.
 *  · inside an app's own browser that can't open wallet apps at all — no tap
 *    will ever work here; say which menu item leaves for the real browser and
 *    hand them the link to carry.
 */
export function handoffCopy(o: WalletAppOpen, browser?: HandoffBrowser | null): HandoffCopy {
  if (browser && browser.inApp && !browser.canLaunchApps) {
    const esc = browser.escape ?? { app: 'this app', where: 'use its menu to open the page in your browser', browser: 'your browser' }
    return {
      title: `This browser can't open ${o.app}`,
      body: `You're inside ${esc.app}'s browser, which never hands a page to a wallet app. Open this page in ${esc.browser} — ${esc.where} — then connect again there.`,
      cta: 'Copy this page\'s link',
      escape: true,
    }
  }
  if (o.tried) {
    return {
      title: `Still waiting on ${o.app}`,
      body: `${o.app} didn't come up. If it's installed, open it yourself — the request is waiting there, and approving it finishes this.`,
      cta: `Try ${o.app} again`,
      escape: false,
    }
  }
  return {
    title: `Open ${o.app} to continue`,
    body: `${o.app} has the request. This browser wouldn't switch apps on its own, so tap below — approve it there, then come back.`,
    cta: `Open ${o.app}`,
    escape: false,
  }
}

/** /embed signs through the host page's own wallet relay — the host owns that
 *  handoff, and a card of ours inside someone else's iframe is noise. */
export function handoffShownOn(pathname: string | null | undefined): boolean {
  return !(pathname ?? '').startsWith('/embed')
}

// ── The holder (browser) ────────────────────────────────────────────────

import { launchDroppedReport, reportWalletRefusal } from '@/lib/wallet-refusal'
import { armedLinkUsable, isDuplicateLaunch } from '@/lib/mobile-wallet'

type Listener = () => void

let pending: WalletAppOpen | null = null
/** The most recent request the SDK asked us to open — kept after the card
 *  is dismissed or the page hid, until the surface says its wallet method
 *  settled. A surface that shows its own "waiting for your wallet" card reads
 *  this to put an "Open MetaMask" button on it (the request is queued in the
 *  wallet the whole time; a tap is all the browser wants). */
let lastLink: { link: string; app: string } | null = null
/** The last link actually navigated to, for the SDK's own re-ask of the same
 *  channel (lib/mobile-wallet isDuplicateLaunch). */
let lastNavigated: { link: string; at: number } | null = null
/** The armed launch (R2): the door started the SDK's connection with the
 *  launch held back; the link waits here for the MetaMask tap. */
let armed: { link: string; app: string; at: number } | null = null
let arming = false
let settleTimer: ReturnType<typeof setTimeout> | null = null
/** Tears down the watch that is currently running, if any. One at a time:
 *  a second request supersedes the first, and its listeners go with it. */
let stopCurrentWatch: (() => void) | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function setPending(next: WalletAppOpen | null) {
  if (pending === next) return
  pending = next
  emit()
}

export function subscribeWalletAppOpen(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function walletAppOpenSnapshot(): WalletAppOpen | null {
  return pending
}

/** The last link the SDK asked for, if its request may still be waiting in
 *  the wallet (see lastLink). Same subscription as the card. */
export function walletAppLastLink(): { link: string; app: string } | null {
  return lastLink
}

/** Server render: nothing is pending before the page exists. */
export function walletAppOpenServerSnapshot(): WalletAppOpen | null {
  return null
}

/** The armed link, if the door has one waiting for the tap. */
export function walletAppArmedSnapshot(): { link: string; app: string; at: number } | null {
  return armed
}

/**
 * The door is about to start the SDK's connection on the visitor's behalf
 * (lib/wallet-arm): the next link the SDK asks us to open is HELD, not
 * navigated. A tap later launches it (launchArmedWalletApp).
 */
export function armWalletAppOpen(): void {
  arming = true
}

/** Whether arming is on or a link is armed — the door asks before starting
 *  a second SDK connection. */
export function walletAppArmedOrArming(): boolean {
  return arming || armed !== null
}

function markArmed(next: typeof armed) {
  armed = next
  if (typeof document !== 'undefined') {
    if (next) document.documentElement.setAttribute('data-wallet-armed', next.app)
    else document.documentElement.removeAttribute('data-wallet-armed')
  }
  emit()
}

/**
 * The tap: navigate to the armed link NOW, synchronously, while the browser
 * still holds the tap's activation. Returns false when nothing is armed (the
 * SDK's own socket-paced launch follows as before). Idempotent per link.
 */
export function launchArmedWalletApp(): boolean {
  const now = Date.now()
  if (!armedLinkUsable(armed, now) || typeof window === 'undefined') {
    if (armed) markArmed(null)
    return false
  }
  const o: WalletAppOpen = { link: armed!.link, app: armed!.app, tried: false }
  markArmed(null)
  lastLink = { link: o.link, app: o.app }
  lastNavigated = { link: o.link, at: now }
  setPending(null)
  try {
    navigate(o.link)
  } catch {
    setPending(o)
    return true
  }
  watchForLaunch(o)
  return true
}

/** The visitor dismissed the card. The request is still queued in the wallet,
 *  so the link stays readable (walletAppLastLink) for an inline button. */
export function clearWalletAppOpen(): void {
  stopCurrentWatch?.()
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  setPending(null)
}

/**
 * The wallet method the SDK asked us to open FOR has settled — resolved,
 * rejected, timed out. Nothing is waiting in the wallet any more, so the
 * card and the remembered link both go. Surfaces call this where their
 * request's promise settles (SignatureWaitTakeover does on sign-in end).
 */
export function walletAppRequestSettled(): void {
  clearWalletAppOpen()
  lastNavigated = null
  arming = false
  if (armed) markArmed(null)
  if (lastLink) {
    lastLink = null
    emit()
  }
}

function navigate(link: string) {
  // An app-scheme link is a location assignment; an https universal link is a
  // same-tab anchor click (Safari opens the app for a universal link, and a
  // plain assignment on some Android builds lands in the browser instead).
  if (link.startsWith('https://')) {
    const a = document.createElement('a')
    a.href = link
    a.target = '_self'
    a.rel = 'noreferrer noopener'
    a.click()
  } else {
    window.location.href = link
  }
}

/**
 * Watch whether the browser actually left. If the page hides (or unloads on
 * the way out) the app took over and there is nothing to show; if it is still
 * here after WALLET_APP_SETTLE_MS the launch was dropped and the card goes up.
 */
function watchForLaunch(o: WalletAppOpen) {
  stopCurrentWatch?.()

  const stopWatching = () => {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', left)
    if (stopCurrentWatch === stopWatching) stopCurrentWatch = null
  }
  const left = () => {
    stopWatching()
    // The app is up. Anything we were showing about it is stale.
    setPending(null)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') left()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', left)
  stopCurrentWatch = stopWatching

  settleTimer = setTimeout(() => {
    settleTimer = null
    stopWatching()
    if (document.visibilityState === 'hidden') return
    setPending(o)
    // A dropped launch is a /dashboard/failures row (lib/wallet-refusal,
    // SIGN lane): the wallet we can't name from here, the link's scheme
    // names the app, the settle window says how long the page stayed.
    reportWalletRefusal(launchDroppedReport({ wallet: null, link: o.link, app: o.app, settleMs: WALLET_APP_SETTLE_MS, tried: o.tried }))
  }, WALLET_APP_SETTLE_MS)
}

/**
 * The MetaMask SDK wants the wallet app. Try it now — while a tap is still
 * carrying us (connect, a Sign button) this is exactly what the SDK would have
 * done — and put a button on screen when the browser refuses.
 */
export function requestWalletAppOpen(link: string): void {
  const app = walletAppFor(link)
  if (!app || typeof window === 'undefined') return
  const o: WalletAppOpen = { link: link.trim(), app, tried: false }
  const now = Date.now()
  // The door armed: hold this link for the tap instead of navigating.
  if (arming) {
    arming = false
    markArmed({ link: o.link, app, at: now })
    return
  }
  // The SDK asking again for a channel a tap just launched (the armed
  // launch, or the card's tap): the app already has it. Never navigate twice.
  if (isDuplicateLaunch(lastNavigated, o.link, now)) return
  // A fresh request supersedes whatever card is up: same wallet, newer request.
  setPending(null)
  lastLink = { link: o.link, app }
  lastNavigated = { link: o.link, at: now }
  emit()
  try {
    navigate(o.link)
  } catch {
    // Blocked outright — the card is the whole answer then.
    setPending(o)
    return
  }
  watchForLaunch(o)
}

/** The card's button: the tap the browser was holding out for. */
export function openWalletAppNow(): void {
  const o = pending
  if (!o) return
  const next: WalletAppOpen = { ...o, tried: true }
  try {
    navigate(next.link)
  } catch {
    setPending(next)
    return
  }
  watchForLaunch(next)
}

/**
 * Any surface's own button: open the wallet app for the request it is
 * waiting on — the last one the SDK asked for unless a link is given. Call it
 * from a tap handler (that is the whole point). Returns false when there is
 * nothing to open; the same watch as the card follows a real attempt, so a
 * dropped tap still ends in the card rather than silence.
 */
export function openWalletApp(link?: string): boolean {
  const target = link ? { link: link.trim(), app: walletAppFor(link) } : lastLink
  if (!target?.app || typeof window === 'undefined') return false
  const o: WalletAppOpen = { link: target.link, app: target.app, tried: pending?.tried ?? false }
  lastLink = { link: o.link, app: o.app }
  lastNavigated = { link: o.link, at: Date.now() }
  setPending(null)
  try {
    navigate(o.link)
  } catch {
    setPending(o)
    return true
  }
  watchForLaunch(o)
  return true
}

/** SIGN's name for "open the last request again, from a tap" — the same
 *  call as openWalletApp() with no link. One holder, one behaviour. */
export function reopenWalletApp(): boolean {
  return openWalletApp()
}
