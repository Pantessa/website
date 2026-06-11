'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { Menu, X } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import ConnectWallet from '@/components/ConnectWallet'
import AuthButton from '@/components/AuthButton'
import { YeetfulMark } from '@/components/Logo'

export default function Navigation() {
  const pathname = usePathname()
  const activeCount = useYeetfulStore((s) => s.activeServerIds.length)
  const { isConnected } = useAccount()

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

  const tabs = (
    <>
      <Link href="/" className={`nav__tab ${pathname === '/' ? 'is-on' : ''}`}>
        Servers
      </Link>
      <Link href="/chat" className={`nav__tab ${pathname === '/chat' ? 'is-on' : ''}`}>
        Chat
        {activeCount > 0 && <span className="nav__badge mono">{activeCount}</span>}
      </Link>
      {mounted && isConnected && (
        <Link
          href="/dashboard"
          className={`nav__tab ${pathname.startsWith('/dashboard') ? 'is-on' : ''}`}
        >
          Dashboard
        </Link>
      )}
      <Link
        href="/developers"
        className={`nav__tab ${pathname === '/developers' ? 'is-on' : ''}`}
      >
        Developers
      </Link>
      <Link href="/blog" className={`nav__tab ${pathname.startsWith('/blog') ? 'is-on' : ''}`}>
        Blog
      </Link>
    </>
  )

  return (
    <header className="nav">
      <div className="nav__inner">
        <Link className="logo" href="/">
          <YeetfulMark size={24} />
          <span className="logo__word">yeetful</span>
        </Link>

        <nav className="nav__tabs">{tabs}</nav>

        <div className="nav__right">
          <span className="nav__status">
            <span className="nav__statusdot" />
            <span className="mono">{activeCount} active</span>
          </span>
          <AuthButton />
          <ConnectWallet />
          <button
            className="nav__burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X width={20} height={20} /> : <Menu width={20} height={20} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer — portaled to <body>: the nav's backdrop-filter makes
          the sticky header the containing block for fixed descendants, which
          would trap the drawer inside the 64px bar. */}
      {open &&
        mounted &&
        createPortal(
          <div className="drawer">
            <button className="drawer__backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="drawer__panel" role="dialog" aria-label="Navigation">
              <nav className="drawer__tabs">{tabs}</nav>
              <div className="drawer__foot">
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
