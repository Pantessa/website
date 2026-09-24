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
import WalletPanel from '@/components/WalletPanel'
import Sheet from '@/components/mobile/Sheet'
import { cn } from '@/lib/utils'
import { signInLandingHere, useSession } from '@/lib/session'
import { isPublicAppPath } from '@/lib/app-entry'
import { isPhoneViewport } from '@/lib/phone-shell'

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
  // On a phone the menu is the ONE Sheet (squad mobile-native, 2026-09-24):
  // a bottom sheet a thumb reaches, which closes on a tap outside, a swipe,
  // Escape and the back gesture. At lg+ it stays the dropdown. Read ON PRESS
  // (never at render: the server has no viewport).
  const [asSheet, setAsSheet] = useState(false)
  // "Wallet details" opens OUR panel (balances on every chain, gas, recent
  // transfers, the ways in) — not RainbowKit's copy/disconnect modal, which
  // is still reachable from inside the panel as "Wallet settings".
  const [walletOpen, setWalletOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const authed = !!sessionAddress
  const closeNow = useCallback(() => setOpen(false), [])
  const toggle = () => {
    setAsSheet(isPhoneViewport())
    setOpen((o) => !o)
  }

  useEffect(() => closeNow(), [pathname, closeNow])
  // The dropdown's own dismissals. `pointerdown`, not `mousedown`: iOS only
  // sends mouse events for a tap on something "clickable", so a tap on the
  // page around the menu never closed it. The sheet brings its own.
  useEffect(() => {
    if (!open || asSheet) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeNow()
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeNow()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, asSheet, closeNow])

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

        // The rows, once: the dropdown (lg+) and the phone sheet render them.
        const menuBody = (
          <>
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
                  // Signing in keeps you where you are: a chat, an intent
                  // link, a chart. Only a sign-in from the landing page goes
                  // on to Markets (lib/app-entry signInLandingFor).
                  connectAndSignIn(signInLandingHere())
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
                data-sheet-open="wallet"
                onClick={() => {
                  // One tap closes the account sheet and opens the wallet
                  // sheet in the same commit: the wallet sheet takes over the
                  // account sheet's history entry (lib/sheet-history), so back
                  // closes it and the page stays.
                  closeNow()
                  setWalletOpen(true)
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
                    // Signing out on a public page (the markets surface,
                    // 2026-09-14) stays on it: looking needs no wallet.
                    // Everywhere else it lands on the home page, since the
                    // signed-in app would send a signed-out visitor there
                    // anyway (AppSpine).
                    signOut().then(() => {
                      if (!isPublicAppPath(pathname)) router.push('/')
                    })
                  }}
                >
                  <LogOut width={15} height={15} strokeWidth={2.25} />
                  Sign out
                </button>
              </>
            )}
          </>
        )

        return (
          <div className="navacct" ref={wrapRef}>
            <button
              type="button"
              className={`navacct__pill ${open ? 'is-active' : ''} ${authed ? 'is-authed' : ''}`}
              aria-haspopup="true"
              aria-expanded={open}
              onClick={toggle}
              data-sheet-open="account"
            >
              <span className={`navacct__dot ${authed ? 'is-authed' : ''}`} aria-hidden />
              <span className="navacct__addr mono">{label}</span>
              <Caret className="navacct__chev" />
            </button>

            <div className={`navacct__menu ${open && !asSheet ? 'is-open' : ''}`} role="menu" hidden={asSheet || undefined}>
              {!asSheet && menuBody}
            </div>
            <Sheet open={open && asSheet} onClose={closeNow} title="Account" id="account" className="navacct--sheet">
              <div role="menu" className="navacct__sheetmenu">
                {menuBody}
              </div>
            </Sheet>
            {connected && <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} onWalletSettings={openAccountModal} />}
          </div>
        )
      }}
    </ConnectButton.Custom>
  )
}
