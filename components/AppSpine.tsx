'use client'

// The app spine: a persistent icon column that is the product's constant
// across chat and dashboard — brand seat on top, the workspace destinations
// (new chat, MCPs, jobs, links, history) as labeled icons, the way out to
// the dashboard pinned at the bottom. It replaces three scattered systems on
// desktop: the drawer's own tab strip, the toolbar's reopen chips, and the
// rail's pinned Dashboard row.
//
// Desktop-only (≥lg): below lg the existing overlay-drawer + toolbar-chip
// pattern stays. Mounted by surface shells (ChatWorkspace now, the dashboard
// layout next), NEVER by ChatInterface — so /embed and /i can't inherit it.
//
// Click grammar: a tab icon opens the drawer on that tab; clicking the tab
// you're already looking at collapses the drawer. The spine never navigates
// away from the surface you're on except the two labeled exits (mark → chat,
// Dashboard → dashboard).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Boxes, LayoutDashboard, Link2, ListChecks, MessageSquare, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore, type RailTab } from '@/lib/store'
import { useRunningWork } from '@/lib/use-running-work'
import { YeetfulMark } from '@/components/Logo'

const TABS: { tab: RailTab; label: string; title: string; Icon: typeof Boxes }[] = [
  { tab: 'mcps', label: 'MCPS', title: 'Your MCP set', Icon: Boxes },
  { tab: 'jobs', label: 'JOBS', title: 'Jobs and recurring buys running on this wallet', Icon: ListChecks },
  { tab: 'links', label: 'LINKS', title: 'Your intent links — mint and share from here', Icon: Link2 },
  { tab: 'chats', label: 'CHATS', title: 'Your chat history', Icon: MessageSquare },
]

export default function AppSpine() {
  const router = useRouter()
  const { railTab, setRailTab, mcpRailOpen, setMcpRailOpen } = useYeetfulStore()

  // The spine is display-hidden below lg, but hidden still means mounted —
  // gate the poll on the breakpoint so the mobile surfaces keep their own
  // single-instance discipline (drawer strip / toolbar chips poll there).
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    setEnabled(mql.matches)
    const on = (e: MediaQueryListEvent) => setEnabled(e.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  const { badgeCount } = useRunningWork(enabled)

  const pick = (tab: RailTab) => {
    if (railTab === tab && mcpRailOpen) {
      setMcpRailOpen(false)
    } else {
      setRailTab(tab)
      setMcpRailOpen(true)
    }
  }

  return (
    <aside
      className="max-lg:hidden flex-shrink-0 h-full w-14 flex flex-col items-center border-r border-[var(--line)] bg-[var(--surf-1)]"
      aria-label="Workspace"
    >
      {/* Brand seat — the product's home is the chat. */}
      <Link
        href="/chat"
        title="Pantessa — chat"
        aria-label="Pantessa chat"
        className="grid place-items-center w-full h-14 flex-shrink-0 border-b border-[var(--line)] text-white hover:bg-[var(--surf-2)] transition-colors"
      >
        <YeetfulMark size={22} />
      </Link>

      <div className="flex flex-col items-center gap-1 pt-2 w-full px-1">
        <button
          onClick={() => router.push('/chat')}
          title="Start a new chat"
          aria-label="Start a new chat"
          className="w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)] transition-colors"
        >
          <Plus className="w-[18px] h-[18px]" />
          <span className="mono text-[9px] font-medium tracking-wide">NEW</span>
        </button>

        {TABS.map(({ tab, label, title, Icon }) => {
          const selected = railTab === tab && mcpRailOpen
          return (
            <button
              key={tab}
              onClick={() => pick(tab)}
              title={title}
              aria-label={label}
              aria-pressed={selected}
              className={cn(
                'relative w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors',
                selected
                  ? 'bg-[var(--surf-2)] text-white'
                  : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)]',
              )}
            >
              {/* The notch: the accent tick that says "you are here". */}
              {selected && (
                <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-[var(--accent)]" />
              )}
              <Icon className="w-[18px] h-[18px]" />
              <span className="mono text-[9px] font-medium tracking-wide">{label}</span>
              {tab === 'jobs' && badgeCount > 0 && (
                <span className="absolute top-0 right-0.5 mono text-[9px] px-1 rounded-full bg-amber-500/15 text-amber-400">
                  {badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1" />

      {/* The labeled way out — same destination as the old pinned rail row. */}
      <Link
        href="/dashboard"
        title="Pantessa dashboard — links, keys, billing"
        aria-label="Pantessa dashboard"
        className="w-12 flex flex-col items-center gap-0.5 py-1.5 mb-2 rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)] transition-colors"
      >
        <LayoutDashboard className="w-[18px] h-[18px]" />
        <span className="mono text-[9px] font-medium tracking-wide">DASH</span>
      </Link>
    </aside>
  )
}
