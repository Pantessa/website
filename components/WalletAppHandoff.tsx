'use client'

// The "open your wallet app" card — the button a mobile browser holds out for.
//
// lib/wallet-handoff has the whole story: on a phone the MetaMask lane is the
// MetaMask SDK, the SDK brings the app forward by navigating to a `metamask://`
// link, and the browser drops that navigation whenever the page isn't holding
// a user activation — which is exactly the case for the SIWE signature
// lib/session fires from its post-connect effect. The request is queued in the
// wallet the whole time; nothing is wrong except that nobody switched apps.
// This card is the switch, as a tap.
//
// It is global (Providers.tsx) rather than part of the sign-in door, because
// the same dropped launch hits every later approval on a phone too — a swap's
// eth_sendTransaction, a chain switch, an EIP-712 order. Whatever the SDK
// asked to open, this is what offers it.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { MetaMaskWalletMark } from '@/components/wallet-marks'
import { androidChromeIntent, inAppBrowserOf, inAppEscapeCopy } from '@/lib/inapp-browser'
import { METAMASK_TAP_SELECTOR } from '@/lib/mobile-wallet'
import {
  clearWalletAppOpen,
  handoffCopy,
  handoffShownOn,
  launchArmedWalletApp,
  openWalletAppNow,
  requestWalletAppOpen,
  WALLET_APP_OPEN_EVENT,
  subscribeWalletAppOpen,
  walletAppOpenServerSnapshot,
  walletAppOpenSnapshot,
} from '@/lib/wallet-handoff'

export default function WalletAppHandoff() {
  const pathname = usePathname()
  const pending = useSyncExternalStore(
    subscribeWalletAppOpen,
    walletAppOpenSnapshot,
    walletAppOpenServerSnapshot,
  )

  // The browser this card is in, read once on the client (the card never
  // renders on the server: nothing is pending there). Inside X's / LinkedIn's
  // / a bare WKWebView's browser no launch can work, so the card says how to
  // leave for Safari/Chrome instead of asking for a tap that goes nowhere
  // (lib/inapp-browser, LINKS lane).
  const browser = useMemo(() => {
    if (typeof navigator === 'undefined') return null
    const b = inAppBrowserOf(navigator.userAgent)
    return { inApp: b.inApp, canLaunchApps: b.canLaunchApps, escape: inAppEscapeCopy(b), intent: androidChromeIntent(typeof location === 'undefined' ? '' : location.href, b) }
  }, [])
  const [copied, setCopied] = useState(false)
  // The armed launch's tap (lib/wallet-arm): the door held the SDK's link;
  // RainbowKit's MetaMask row is the tap that carries the activation, so the
  // navigation happens HERE, synchronously, in the capture phase — before
  // RainbowKit's own click handler awaits anything. No-op when nothing is
  // armed (the SDK's socket-paced launch follows as before).
  useEffect(() => {
    const onTap = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t?.closest?.(METAMASK_TAP_SELECTOR)) return
      launchArmedWalletApp()
    }
    document.addEventListener('click', onTap, true)
    return () => document.removeEventListener('click', onTap, true)
  }, [])
  // The drive seam (SIGN N4): a page can stand in for the SDK's ask with
  // `document.dispatchEvent(new CustomEvent('pantessa:wallet-app-open',
  // { detail: { link } }))`. It reaches the same holder through the same
  // belt (only MetaMask's own links navigate), so a drive can assert the
  // card, an inline Open-MetaMask button and exactly one navigation without
  // the SDK's relay in the loop. Any script that could dispatch it could
  // already assign location.href; the belt is what keeps it wallet-only.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const link = (e as CustomEvent<{ link?: unknown }>).detail?.link
      if (typeof link === 'string') requestWalletAppOpen(link)
    }
    document.addEventListener(WALLET_APP_OPEN_EVENT, onAsk)
    return () => document.removeEventListener(WALLET_APP_OPEN_EVENT, onAsk)
  }, [])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  if (!pending || !handoffShownOn(pathname)) return null
  const { title, body, cta, escape } = handoffCopy(pending, browser)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
    } catch {
      // clipboard blocked: the URL is in the address bar, and the body
      // already says which menu item to use
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6"
      // Above RainbowKit's own modal (z-index 2147483646), on purpose. Its
      // mobile "Continue in MetaMask" screen is a dead end — a wallet icon,
      // a line of text and a close button, with nothing to press when the
      // launch was dropped — so during connect this card has to be reachable
      // through it, not behind it. Everywhere else it is simply the top of
      // the stack, which is what a "you have to do this to continue" card is.
      style={{ zIndex: 2147483647 }}
      data-wallet-handoff={pending.app}
    >
      <div className="relative max-w-sm w-full rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] px-6 py-7 text-center">
        <button
          type="button"
          onClick={clearWalletAppOpen}
          aria-label="Dismiss"
          className="absolute top-3 right-3 p-1 rounded-md text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        {/* The wallet's own mark: the card is about one app, and the visitor is
            about to go looking for it on their home screen. */}
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-[var(--line)] bg-[var(--surf-2)]">
          <MetaMaskWalletMark size={26} />
        </div>
        <h2 className="text-[17px] font-semibold text-[color:var(--fg)]">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">{body}</p>
        {escape ? (
          <>
            {browser?.intent && (
              <a
                href={browser.intent}
                className="btn btn--solid mt-5 inline-flex w-full items-center justify-center gap-2 text-[13px]"
              >
                Open in Chrome
              </a>
            )}
            <button
              type="button"
              onClick={copyLink}
              className={`btn ${browser?.intent ? 'mt-2' : 'btn--solid mt-5'} inline-flex w-full items-center justify-center gap-2 text-[13px]`}
            >
              {copied ? <><Check className="w-4 h-4" /> Copied</> : cta}
            </button>
            <p className="mt-3 break-all text-[12px] leading-relaxed text-[color:var(--muted-2)]">
              {typeof location === 'undefined' ? '' : location.href}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={openWalletAppNow}
              className="btn btn--solid mt-5 inline-flex w-full items-center justify-center gap-2 text-[13px]"
            >
              {cta}
            </button>
            <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--muted-2)]">
              Nothing moves until you approve it there.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
