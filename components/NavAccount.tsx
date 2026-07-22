'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  LayoutDashboard,
  LogIn,
  LogOut,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import Caret from '@/components/Caret'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'

/**
 * Consolidated account control for the brochure (non-chat) surface.
 *
 * Replaces the old three-part cluster — a "Dashboard" button, a "Signed in"
 * chip, AND a separate wallet address pill — with ONE pill + dropdown. The pill
 * carries the account identity; the menu holds every action (Dashboard, wallet
 * details, sign in / out). Built on RainbowKit's Custom render so the
 * wrong-network state and the wallet modal (chain switch / disconnect / copy)
 * are preserved.
 *
 * SIWE session and wallet connection are distinct: a visitor can be
 * wallet-connected without a signed session. The dot + menu reflect both — a
 * green ring means authenticated, amber means connected-but-not-signed with a
 * "Sign in" action surfaced at the top of the menu.
 */
export default function NavAccount() {
  const router = useRouter()
  const pathname = usePathname()
  const { address: sessionAddress, connectAndSignIn, signOut, signingIn } = useSession()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const authed = !!sessionAddress
  const closeNow = useCallback(() => setOpen(false), [])

  // On the chat surface this pill IS the chat account control, so signing in
  // from it must keep the user on chat (query included), not send them to the
  // dashboard. Everywhere else the dashboard is the right post-sign-in landing.
  const signInRedirect =
    pathname.startsWith('/chat') && typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '/dashboard'

  useEffect(() => closeNow(), [pathname, closeNow])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeNow()
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeNow()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, closeNow])

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, mounted, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== 'loading'
        const connected =
          ready && account && chain && (!authenticationStatus || authenticationStatus === 'authenticated')

        if (!ready) {
          return <div aria-hidden style={{ opacity: 0, pointerEvents: 'none', width: 120, height: 34 }} />
        }

        if (connected && chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              type="button"
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full',
                'bg-red-500/10 text-red-400 border border-red-500/30',
                'text-xs font-medium hover:bg-red-500/20 transition-colors',
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Wrong network
            </button>
          )
        }

        const label = connected ? account.displayName : 'Sign in'

        return (
          <div className="navacct" ref={wrapRef}>
            <button
              type="button"
              className={`navacct__pill ${open ? 'is-active' : ''} ${authed ? 'is-authed' : ''}`}
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <span className={`navacct__dot ${authed ? 'is-authed' : ''}`} aria-hidden />
              <span className="navacct__addr mono">{label}</span>
              <Caret className="navacct__chev" />
            </button>

            <div className={`navacct__menu ${open ? 'is-open' : ''}`} role="menu">
              <div className="navacct__head">
                <span className={`navacct__badge ${authed ? 'is-authed' : ''}`}>
                  <ShieldCheck width={13} height={13} strokeWidth={2.5} />
                  {authed ? 'Signed in' : 'Connected'}
                </span>
                {connected && <span className="navacct__full mono">{account.displayName}</span>}
              </div>

              {!authed && (
                <button
                  type="button"
                  role="menuitem"
                  className="navacct__item navacct__item--accent"
                  disabled={signingIn}
                  onClick={() => {
                    closeNow()
                    connectAndSignIn(signInRedirect)
                  }}
                >
                  <LogIn width={15} height={15} strokeWidth={2.25} />
                  {signingIn ? 'Signing in…' : 'Sign in with wallet'}
                </button>
              )}

              <Link href="/dashboard" role="menuitem" className="navacct__item" onClick={closeNow}>
                <LayoutDashboard width={15} height={15} strokeWidth={2.25} />
                Dashboard
              </Link>

              {connected && (
                <button
                  type="button"
                  role="menuitem"
                  className="navacct__item"
                  onClick={() => {
                    closeNow()
                    openAccountModal()
                  }}
                >
                  <Wallet width={15} height={15} strokeWidth={2.25} />
                  Wallet details
                </button>
              )}

              {authed && (
                <>
                  <span className="navacct__sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="navacct__item navacct__item--danger"
                    onClick={() => {
                      closeNow()
                      signOut().then(() => router.push('/'))
                    }}
                  >
                    <LogOut width={15} height={15} strokeWidth={2.25} />
                    Sign out
                  </button>
                </>
              )}
            </div>
          </div>
        )
      }}
    </ConnectButton.Custom>
  )
}
