'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
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

  return (
    <header className="nav">
      <div className="nav__inner">
        <Link className="logo" href="/">
          <YeetfulMark size={24} />
          <span className="logo__word">yeetful</span>
        </Link>

        <nav className="nav__tabs">
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
              className={`nav__tab ${pathname === '/dashboard' ? 'is-on' : ''}`}
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
        </nav>

        <div className="nav__right">
          <span className="nav__status">
            <span className="nav__statusdot" />
            <span className="mono">{activeCount} active</span>
          </span>
          <AuthButton />
          <ConnectWallet />
        </div>
      </div>
    </header>
  )
}
