'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { LogIn, Menu, X } from 'lucide-react'
import ConnectWallet from '@/components/ConnectWallet'
import AuthButton from '@/components/AuthButton'
import CreateAccountButton from '@/components/CreateAccountButton'
import NavAccount from '@/components/NavAccount'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { YeetfulMark } from '@/components/Logo'

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

  // Mobile drawer: closes on navigation (pathname change), Escape, and
  // backdrop tap; locks body scroll while open.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

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

  // When a signed-in user is on an app surface (dashboard / chat / docs) the
  // brochure top-nav is removed entirely — the app shell (left rail + its
  // collapse/home toggle) owns the viewport. Logged-out visitors still get the
  // full brochure nav everywhere. mounted-gated so SSR keeps the nav.
  const onAppSurface =
    pathname.startsWith('/dashboard') || pathname.startsWith('/chat') || pathname.startsWith('/docs')
  if (mounted && !!sessionAddress && onAppSurface) return null

  const inDashboard = pathname.startsWith('/dashboard')
  const showDashboardCta = mounted && (isConnected || !!sessionAddress)

  // Chat connects a wallet to PAY a turn, not to sign in — so once a wallet is
  // connected we keep the plain Connect Wallet / auth controls there. When
  // logged out, a single "Sign in" opens the modal (wallet / Google / email).
  const onChat = pathname.startsWith('/chat')
  const disconnected = !isConnected && !sessionAddress
  const signInPill =
    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/15 text-zinc-200 text-xs font-semibold hover:bg-white/10 hover:border-white/25 transition-colors'

  // Signing in from an app surface should keep the user WHERE THEY ARE, not
  // yank them to /dashboard. On chat we return them to the same chat URL (query
  // included, so ?mcps=/?prompt= deep links survive). Only used inside the
  // mounted-gated account clusters below, so window is available and there's no
  // SSR/hydration mismatch (the value is read in click handlers, not rendered).
  const signInRedirect =
    onChat && typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '/dashboard'

  // The disconnected sign-in affordance (one control) — shared everywhere.
  const disconnectedCta = cdpEnabled ? (
    <CreateAccountButton
      className={signInPill}
      label={
        <>
          <LogIn className="w-3.5 h-3.5" strokeWidth={2.5} /> Sign in
        </>
      }
      redirectTo={signInRedirect}
    />
  ) : (
    <AuthButton redirectTo={signInRedirect} />
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
  const desktopAccount = disconnected ? disconnectedCta : <NavAccount />

  // MOBILE drawer account cluster — the drawer has room, so it stays explicit
  // (Dashboard link + auth + wallet) rather than the collapsed desktop pill.
  const drawerAccount = disconnected ? (
    disconnectedCta
  ) : (
    <>
      <AuthButton />
      {isConnected && <ConnectWallet />}
    </>
  )

  const dashboardCta = showDashboardCta ? (
    <Link href="/dashboard" className="nav__dash">
      Dashboard
    </Link>
  ) : null

  // Desktop primary tabs — links-first: the leaderboard and the money story
  // are top-level; chat is the LINK BUILDER; deep-dive surfaces (Benchmarks,
  // Tools, MCP Directory) live in the footer, out of the main story.
  const desktopTabs = (
    <>
      <Link href="/links" className={`nav__tab ${pathname.startsWith('/links') ? 'is-on' : ''}`}>
        Links
      </Link>
      <Link href="/chat" className={`nav__tab ${pathname === '/chat' ? 'is-on' : ''}`}>
        App
      </Link>
      <Link href="/activity" className={`nav__tab ${pathname.startsWith('/activity') ? 'is-on' : ''}`}>
        Activity
      </Link>
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
      <Link href="/links" className={`nav__tab ${pathname.startsWith('/links') ? 'is-on' : ''}`}>
        Links
      </Link>
      <Link href="/chat" className={`nav__tab ${pathname === '/chat' ? 'is-on' : ''}`}>
        App
      </Link>
      <Link href="/activity" className={`nav__tab ${pathname.startsWith('/activity') ? 'is-on' : ''}`}>
        Activity
      </Link>
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
          {/* The pangolin's ink box is 1.6× wider than tall, so a nominal size
              renders ~0.56× that in visual height — it needs a bigger number
              than the old square Y mark did to carry the same weight. */}
          <YeetfulMark size={34} />
          <span className="logo__word">pantessa</span>
        </Link>

        {/* Brochure tabs only outside the dashboard — inside, the left rail
            owns navigation (Stripe-style). */}
        {!inDashboard && <nav className="nav__tabs">{desktopTabs}</nav>}

        <div className="nav__right">
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

      {/* Mobile drawer — portaled to <body>: the nav's backdrop-filter makes
          the sticky header the containing block for fixed descendants, which
          would trap the drawer inside the 64px bar. */}
      {open &&
        mounted &&
        !inDashboard &&
        createPortal(
          <div className="drawer">
            <button className="drawer__backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="drawer__panel" role="dialog" aria-label="Navigation">
              <nav className="drawer__tabs">{drawerTabs}</nav>
              <div className="drawer__foot">
                {dashboardCta}
                {drawerAccount}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  )
}
