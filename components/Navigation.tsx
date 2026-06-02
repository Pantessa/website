'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useYeetfulStore } from '@/lib/store'
import ConnectWallet from '@/components/ConnectWallet'
import { YeetfulMark } from '@/components/Logo'

export default function Navigation() {
  const pathname = usePathname()
  const activeCount = useYeetfulStore((s) => s.activeServerIds.length)

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
        </nav>

        <div className="nav__right">
          <span className="nav__status">
            <span className="nav__statusdot" />
            <span className="mono">{activeCount} active</span>
          </span>
          <ConnectWallet />
        </div>
      </div>
    </header>
  )
}
