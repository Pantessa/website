'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Server, Plus, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import ConnectWallet from '@/components/ConnectWallet'

const navItems = [
  { href: '/', label: 'Servers', icon: Server },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/servers', label: 'Add MCP', icon: Plus },
]

export default function Navigation() {
  const pathname = usePathname()
  const activeServerIds = useYeetfulStore((s) => s.activeServerIds)

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-white text-sm tracking-tight hidden sm:block">
              Yeetful
            </span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200',
                    active
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                  {href === '/chat' && activeServerIds.length > 0 && (
                    <span className="ml-0.5 bg-white text-zinc-950 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {activeServerIds.length}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>

          {/* Right side: active-servers badge + wallet */}
          <div className="flex items-center gap-2">
            {activeServerIds.length > 0 && (
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-zinc-300 font-medium">
                  {activeServerIds.length} server{activeServerIds.length > 1 ? 's' : ''} active
                </span>
              </div>
            )}
            <ConnectWallet />
          </div>
        </div>
      </div>
    </nav>
  )
}
