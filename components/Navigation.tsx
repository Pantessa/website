'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useAccountEffect } from 'wagmi'
import { useSession } from '@/lib/session'
import { Menu, X } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import ConnectWallet from '@/components/ConnectWallet'
import AuthButton from '@/components/AuthButton'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { YeetfulMark } from '@/components/Logo'

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const activeCount = useYeetfulStore((s) => s.activeServerIds.length)
  const { isConnected } = useAccount()

  // A fresh, user-initiated wallet connect enters the app (→ /dashboard).
  // isReconnected guards against auto-reconnect on page reload, which would
  // otherwise yank a returning visitor off the brochure on every load. We
  // also stay put on /chat (connecting there is to pay a turn, not to leave)
  // and inside /dashboard (already there). Read the live pathname to avoid a
  // stale closure.
  useAccountEffect({
    onConnect({ isReconnected }) {
      if (isReconnected) return
      const path = window.location.pathname
      if (path.startsWith('/dashboard') || path.startsWith('/chat')) return
      router.push('/dashboard')
    },
  })

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
  // wallet-connected) visitor on the brochure sees a "Dashboard" button.
  const { address: sessionAddress } = useSession()
  const inDashboard = pathname.startsWith('/dashboard')
  const showDashboardCta = mounted && (isConnected || !!sessionAddress)
  // The "create an account" CTA is the newcomer path — only when no wallet is
  // connected / signed in, and only if the embedded-wallet SDK is configured.
  const showCreateAccount = mounted && cdpEnabled && !isConnected && !sessionAddress
  const createAccountPill =
    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-400 text-zinc-950 text-xs font-semibold hover:bg-emerald-300 active:scale-[0.98] transition-all'

  const dashboardCta = showDashboardCta ? (
    <Link href="/dashboard" className="nav__dash">
      Dashboard
    </Link>
  ) : null

  const tabs = (
    <>
      <Link href="/" className={`nav__tab ${pathname === '/' ? 'is-on' : ''}`}>
        Router
      </Link>
      <Link href="/servers" className={`nav__tab ${pathname.startsWith('/servers') ? 'is-on' : ''}`}>
        Servers
      </Link>
      <Link href="/chat" className={`nav__tab ${pathname === '/chat' ? 'is-on' : ''}`}>
        Chat
        {activeCount > 0 && <span className="nav__badge mono">{activeCount}</span>}
      </Link>
      <Link href="/activity" className={`nav__tab ${pathname === '/activity' ? 'is-on' : ''}`}>
        Activity
      </Link>
      <Link
        href="/developers"
        className={`nav__tab ${pathname === '/developers' ? 'is-on' : ''}`}
      >
        Developers
      </Link>
      <Link href="/docs" className={`nav__tab ${pathname.startsWith('/docs') ? 'is-on' : ''}`}>
        Docs
      </Link>
      <Link href="/blog" className={`nav__tab ${pathname.startsWith('/blog') ? 'is-on' : ''}`}>
        Blog
      </Link>
    </>
  )

  return (
    <header className={`nav ${inDashboard ? 'nav--fluid' : ''}`}>
      <div className="nav__inner">
        {/* Logged in, the logo leads back into the app; otherwise to the
            brochure. mounted-gated (via showDashboardCta) keeps SSR at "/". */}
        <Link className="logo" href={showDashboardCta ? '/dashboard' : '/'}>
          <YeetfulMark size={24} />
          <span className="logo__word">yeetful</span>
        </Link>

        {/* Brochure tabs only outside the dashboard — inside, the left rail
            owns navigation (Stripe-style). */}
        {!inDashboard && <nav className="nav__tabs">{tabs}</nav>}

        <div className="nav__right">
          {!inDashboard && (
            <span className="nav__status">
              <span className="nav__statusdot" />
              <span className="mono">{activeCount} active</span>
            </span>
          )}
          {!inDashboard && dashboardCta}
          {showCreateAccount && <CreateAccountButton className={createAccountPill} label="Sign in" />}
          <AuthButton />
          <ConnectWallet />
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
              <nav className="drawer__tabs">{tabs}</nav>
              <div className="drawer__foot">
                {dashboardCta}
                {showCreateAccount && <CreateAccountButton className={createAccountPill} label="Sign in" />}
                <AuthButton />
                <ConnectWallet />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  )
}
