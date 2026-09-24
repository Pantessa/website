'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { isWalletPath } from '@/lib/wallet-page'
import { Menu, X } from 'lucide-react'
import AuthButton from '@/components/AuthButton'
import CreateAccountButton, { CreateAccountModal } from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { YeetfulMark } from '@/components/Logo'
import { AskDoorTrigger } from '@/components/AskDoor'
import { isMarketsPath } from '@/lib/markets'
import SiteAccount, { signInLabel, signInPill } from '@/components/SiteAccount'
import SpineLink from '@/components/SpineLink'
import Sheet from '@/components/mobile/Sheet'
import { useAskDoor } from '@/lib/ask-door'

export default function Navigation() {
  const pathname = usePathname()
  const { isConnected } = useAccount()

  // Post-connect routing is now owned by the sign-in flow itself
  // (connectAndSignIn → redirect on a successful signature), so a bare wallet
  // connect (e.g. to pay a chat turn) no longer yanks the user to /dashboard.

  // Wallet state only exists client-side — gate the Dashboard tab on mount to
  // keep the server-rendered nav hydration-safe.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // The phone menu is the ONE Sheet (squad mobile-native, 2026-09-24): it
  // closes on a tap outside, Escape, its close button, a swipe and the back
  // gesture (the Sheet's own), on navigation (pathname change), on a tap of
  // the page you're already on, and the moment the ask door opens (its Ask
  // row): the door is z 60 and the sheet z 90, so it would open underneath.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname])
  const askOpen = useAskDoor((s) => s.open)
  useEffect(() => {
    if (askOpen) setOpen(false)
  }, [askOpen])
  // The sheet's "Sign in" hands off to the door at THIS level: a door opened
  // from inside the sheet would unmount with it.
  const [doorOpen, setDoorOpen] = useState(false)
  const closeOnSamePage = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
    if (a && new URL(a.href, window.location.href).pathname === window.location.pathname) setOpen(false)
  }

  // Stripe-style portal split: the marketing shell (brochure tabs) lives on
  // yeetful.com; once inside /dashboard the top nav drops the brochure tabs —
  // navigation moves to the dashboard's left rail. A signed-in (or
  // wallet-connected) visitor on the brochure sees the account control.
  const { address: sessionAddress } = useSession()

  // /embed renders inside third-party iframes — no site chrome at all.
  // (After every hook, so the hook order stays stable across routes.)
  if (pathname.startsWith('/embed')) return null

  // /i/<slug> is a focused intent-link landing — the runtime owns the full
  // viewport (its own mark + ask header), so no brochure nav either.
  // ('/i/' with the trailing slash: /incidents must keep its nav.)
  if (pathname.startsWith('/i/')) return null

  // The wallet page (/wallet) is an app page: the spine is its navigation
  // and its own header carries its one account action (switch or
  // disconnect). No brochure nav for anyone. Pure path test, same on the
  // server.
  if (isWalletPath(pathname)) return null

  // When a signed-in user is on an app surface (dashboard / docs) the
  // brochure top-nav is removed entirely — the app shell (left rail + its
  // collapse/home toggle) owns the viewport. Logged-out visitors still get the
  // full brochure nav there. mounted-gated so SSR keeps the nav.
  const onAppSurface = pathname.startsWith('/dashboard') || pathname.startsWith('/docs')
  if (mounted && !!sessionAddress && onAppSurface) return null

  // The app (/chat) has no brochure nav for ANYONE (2026-09-11, Nate:
  // "remove the header in the App if they are not logged in and move the
  // sign in down next to Embed"): the spine is its navigation and the
  // toolbar's account slot (SiteAccount, beside Embed) is the sign-in door.
  // Pure path test, same on the server — no guest-only 64px flash.
  if (pathname.startsWith('/chat')) return null

  // The markets surface (/markets, /t/<symbol>) is a terminal: the app spine
  // is its navigation and the Ask door + account control dock in the
  // watchlist column (MarketsTopStrip), so the brochure nav is gone for
  // everyone — signed in or not. Pure path test, same on the server.
  if (isMarketsPath(pathname)) return null

  const inDashboard = pathname.startsWith('/dashboard')
  const showDashboardCta = mounted && (isConnected || !!sessionAddress)

  // When logged out, a single "Sign in" opens the modal (wallet / Google /
  // email).
  const disconnected = !isConnected && !sessionAddress

  // The disconnected sign-in affordance (one control) — shared everywhere. It
  // names no destination: a sign-in from the landing page goes on to Markets,
  // and one from any other page (the docs, a link board, a share page)
  // keeps you there (lib/app-entry signInLandingFor, 2026-09-16).
  const disconnectedCta = cdpEnabled ? (
    <CreateAccountButton className={signInPill} label={signInLabel} />
  ) : (
    <AuthButton />
  )

  // DESKTOP account cluster (top bar):
  // - disconnected: one "Sign in" / "Create account".
  // - connected / signed in: ONE consolidated account pill (NavAccount) that
  //   folds Dashboard + wallet + sign-out into a single dropdown. This kills
  //   the old "Signed in chip + separate wallet pill + Dashboard button" triple.
  // Chat used to get the plain ConnectWallet pill here — a copy-address/
  // disconnect-only modal that read as inconsistent with the brochure nav.
  // NavAccount already covers the connect-to-pay case (it offers "Sign in with
  // wallet" + Wallet details while connected-but-not-signed-in), so chat now
  // shows the exact same dropdown as everywhere else.
  // The account seat. It stays in the bar on a PHONE too (2026-09-23, the
  // mobile-onboarding squad): the rest of `.nav__right` collapses into the
  // burger below 900px, which put the sign-in door two taps deep and left a
  // connected phone visitor with no account menu at all on a brochure page —
  // the drawer carries AuthButton + ConnectWallet, never NavAccount.
  const desktopAccount = <span className="nav__acct"><SiteAccount /></span>

  const dashboardCta = showDashboardCta ? (
    <Link href="/dashboard" className="nav__dash">
      Dashboard
    </Link>
  ) : null

  // Desktop primary tabs — links-first: the leaderboard is top-level; chat is
  // the LINK BUILDER; deep-dive surfaces (Benchmarks, Tools, MCP Directory)
  // live in the footer, out of the main story.
  // Markets leads (2026-09-11): the chart that executes is the front door;
  // /t/<symbol> pages light the same tab.
  // Activity left the tabs (2026-09-11, Nate) pending a rework — the page
  // stays routable from the footer and the in-content links.
  const onMarkets = pathname.startsWith('/markets') || pathname.startsWith('/t/')
  const desktopTabs = (
    <>
      <SpineLink href="/markets" className={`nav__tab ${onMarkets ? 'is-on' : ''}`}>
        Markets
      </SpineLink>
      <Link href="/links" className={`nav__tab ${pathname.startsWith('/links') ? 'is-on' : ''}`}>
        Links
      </Link>
      <SpineLink href="/chat" className={`nav__tab ${pathname === '/chat' ? 'is-on' : ''}`}>
        App
      </SpineLink>
      <Link href="/pricing" className={`nav__tab ${pathname.startsWith('/pricing') ? 'is-on' : ''}`}>
        Pricing
      </Link>
      <Link href="/docs" className={`nav__tab ${pathname.startsWith('/docs') ? 'is-on' : ''}`}>
        Docs
      </Link>
      <Link href="/blog" className={`nav__tab ${pathname.startsWith('/blog') ? 'is-on' : ''}`}>
        Blog
      </Link>
    </>
  )

  // Drawer tabs — same destinations, one tap each.
  const drawerTabs = (
    <>
      <AskDoorTrigger variant="drawer" />
      <SpineLink href="/markets" className={`nav__tab ${onMarkets ? 'is-on' : ''}`}>
        Markets
      </SpineLink>
      <Link href="/links" className={`nav__tab ${pathname.startsWith('/links') ? 'is-on' : ''}`}>
        Links
      </Link>
      <SpineLink href="/chat" className={`nav__tab ${pathname === '/chat' ? 'is-on' : ''}`}>
        App
      </SpineLink>
      <span className="drawer__group mono">More</span>
      <Link href="/pricing" className={`nav__tab drawer__sub ${pathname.startsWith('/pricing') ? 'is-on' : ''}`}>
        Pricing
      </Link>
      <Link href="/docs" className={`nav__tab drawer__sub ${pathname.startsWith('/docs') ? 'is-on' : ''}`}>
        Docs
      </Link>
      <Link href="/blog" className={`nav__tab drawer__sub ${pathname.startsWith('/blog') ? 'is-on' : ''}`}>
        Blog
      </Link>
      <Link href="/benchmarks" className={`nav__tab drawer__sub ${pathname.startsWith('/benchmarks') ? 'is-on' : ''}`}>
        Benchmarks
      </Link>
      <Link href="/tools" className={`nav__tab drawer__sub ${pathname.startsWith('/tools') ? 'is-on' : ''}`}>
        Tools
      </Link>
    </>
  )

  return (
    <header className={`nav ${inDashboard ? 'nav--fluid' : ''}`}>
      <div className="nav__inner">
        {/* Logged in, the logo leads back into the app; otherwise to the
            brochure. mounted-gated (via showDashboardCta) keeps SSR at "/". */}
        <Link className="logo" href={showDashboardCta ? '/dashboard' : '/'}>
          {/* The gem's ink box is 112×88 in the 128 grid, so a nominal size
              renders ~0.69× that in visual height — retuned from the pangolin
              era's 34 to keep the same visual weight. */}
          <YeetfulMark size={28} />
          <span className="logo__word">pantessa</span>
        </Link>

        {/* Brochure tabs only outside the dashboard — inside, the left rail
            owns navigation (Stripe-style). */}
        {!inDashboard && <nav className="nav__tabs">{desktopTabs}</nav>}

        <div className="nav__right">
          {/* Ask from anywhere — the door's nav trigger (⌘K). Hidden on the
              surfaces that already are the composer (lib/ask-door). */}
          {!inDashboard && <AskDoorTrigger />}
          {!inDashboard && mounted && desktopAccount}
          {!inDashboard && (
            <button
              className="nav__burger"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X width={20} height={20} /> : <Menu width={20} height={20} />}
            </button>
          )}
        </div>
      </div>

      {/* The phone menu: the Sheet (it portals to <body> itself, so the
          nav's backdrop-filter can't trap it inside the 64px bar). The
          account seat stays in the bar on a phone (SiteAccount), so the
          sheet's foot carries only the way into the app for a connected
          visitor: a second account control here would open its own modals
          under a sheet that is about to close. */}
      {mounted && !inDashboard && (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="Menu"
          id="site-nav"
          className="navsheet"
          footer={
            disconnected ? (
              cdpEnabled ? (
                <button
                  type="button"
                  className="nav__dash navsheet__signin"
                  onClick={() => {
                    setOpen(false)
                    setDoorOpen(true)
                  }}
                >
                  {signInLabel}
                </button>
              ) : (
                disconnectedCta
              )
            ) : (
              dashboardCta ?? undefined
            )
          }
        >
          <nav className="drawer__tabs navsheet__tabs" aria-label="Site" onClick={closeOnSamePage}>
            {drawerTabs}
          </nav>
        </Sheet>
      )}
      {doorOpen && cdpEnabled && <CreateAccountModal onClose={() => setDoorOpen(false)} />}
    </header>
  )
}
