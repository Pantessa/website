'use client'

// The app spine: the product's constant across chat and dashboard. On
// desktop (≥lg) it's a persistent icon COLUMN — brand seat on top, the
// workspace destinations (new chat, MCPs, jobs, links, history) as labeled
// icons, the way out to the dashboard pinned at the bottom. Below lg the
// SAME destinations render as a fixed bottom TAB BAR — the phone-native
// shape of the same spine. One component, one badge poll, two postures.
//
// It replaces the drawer's own tab strip, the toolbar's reopen chips + NEW
// button, and the rail's pinned Dashboard row on every breakpoint. Mounted
// by surface shells (ChatWorkspace + the dashboard layout), NEVER by
// ChatInterface — so /embed and /i can't inherit it.
//
// Click grammar: a tab icon opens the drawer on that tab; clicking the tab
// you're already looking at collapses the drawer. From the dashboard a tab
// icon is a shortcut INTO chat, landing with that drawer tab open.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Boxes, LayoutDashboard, Link2, ListChecks, MessageSquare, Plus, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore, type RailTab } from '@/lib/store'
import { useRunningWork } from '@/lib/use-running-work'
import { rosterEnabledClient } from '@/lib/roster-client'
import { YeetfulMark } from '@/components/Logo'

const TABS: { tab: RailTab; label: string; title: string; Icon: typeof Boxes }[] = [
  { tab: 'mcps', label: 'MCPS', title: 'Your MCP set', Icon: Boxes },
  { tab: 'jobs', label: 'JOBS', title: 'Jobs and recurring buys running on this wallet', Icon: ListChecks },
  { tab: 'links', label: 'LINKS', title: 'Your intent links — mint and share from here', Icon: Link2 },
  // THE ROSTER (R1) — invisible until the owner flips NEXT_PUBLIC_ROSTER_ENABLED
  // (prod ships dark; the API is separately fail-closed behind ROSTER_ENABLED).
  ...(rosterEnabledClient()
    ? [{ tab: 'team' as RailTab, label: 'TEAM', title: "Your wallet's staff — mandate slots, hire and fire agents", Icon: Users }]
    : []),
  { tab: 'chats', label: 'CHATS', title: 'Your chat history', Icon: MessageSquare },
]

export default function AppSpine({ surface = 'chat' }: { surface?: 'chat' | 'dashboard' }) {
  const router = useRouter()
  const {
    railTab,
    setRailTab,
    mcpRailOpen,
    setMcpRailOpen,
    mobileMcpRailOpen,
    setMobileMcpRailOpen,
  } = useYeetfulStore()
  const onDashboard = surface === 'dashboard'

  // THE one running-work poll on first-party surfaces: the column and the
  // bar render from this single mount, and the drawer/toolbar instances are
  // gone — so this is always enabled while the shell is up.
  const { badgeCount } = useRunningWork(true)

  // The dashboard's floating rail-reopen pill and the mobile page paddings
  // key off the spine's presence — flag it on the document element.
  useEffect(() => {
    if (!onDashboard) return
    document.documentElement.setAttribute('data-spine', '1')
    return () => document.documentElement.removeAttribute('data-spine')
  }, [onDashboard])

  // Desktop: the drawer is the in-flow panel (persisted open state).
  const pickDesktop = (tab: RailTab) => {
    if (onDashboard) {
      setRailTab(tab)
      setMcpRailOpen(true)
      router.push('/chat')
      return
    }
    if (railTab === tab && mcpRailOpen) {
      setMcpRailOpen(false)
    } else {
      setRailTab(tab)
      setMcpRailOpen(true)
    }
  }

  // Mobile: the drawer is a transient overlay (never persisted).
  const pickMobile = (tab: RailTab) => {
    if (onDashboard) {
      setRailTab(tab)
      setMobileMcpRailOpen(true)
      router.push('/chat')
      return
    }
    if (railTab === tab && mobileMcpRailOpen) {
      setMobileMcpRailOpen(false)
    } else {
      setRailTab(tab)
      setMobileMcpRailOpen(true)
    }
  }

  const jobsBadge = badgeCount > 0 && (
    <span className="absolute -top-0.5 right-0 mono text-[9px] leading-4 px-1 rounded-full bg-amber-500/15 text-amber-400 ring-1 ring-[var(--surf-1)]">
      {badgeCount > 99 ? '99+' : badgeCount}
    </span>
  )

  return (
    <>
      {/* ── Desktop: the column ── */}
      <aside
        className={cn(
          'max-lg:hidden flex-shrink-0 w-14 flex flex-col items-center border-r border-[var(--line)] bg-[var(--surf-1)]',
          // Chat's shell is height-constrained (h-dvh flex), so the spine
          // just fills it; the dashboard PAGE scrolls, so it rides sticky.
          onDashboard ? 'sticky top-0 h-dvh self-start' : 'h-full',
        )}
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
            const selected = !onDashboard && railTab === tab && mcpRailOpen
            return (
              <button
                key={tab}
                onClick={() => pickDesktop(tab)}
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
                {tab === 'jobs' && jobsBadge}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        {/* The labeled way out — on the dashboard it wears the active state. */}
        <Link
          href="/dashboard"
          title="Pantessa dashboard — links, keys, billing"
          aria-label="Pantessa dashboard"
          className={cn(
            'relative w-12 flex flex-col items-center gap-0.5 py-1.5 mb-2 rounded-lg transition-colors',
            onDashboard
              ? 'bg-[var(--surf-2)] text-white'
              : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)]',
          )}
        >
          {onDashboard && (
            <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-[var(--accent)]" />
          )}
          <LayoutDashboard className="w-[18px] h-[18px]" />
          <span className="mono text-[9px] font-medium tracking-wide">DASH</span>
        </Link>
      </aside>

      {/* ── Mobile: the bar. Fixed above the overlay drawer (z-40) so tabs
          stay reachable while it's open; modals (z-70) still cover it. The
          surface shells reserve its height (see max-lg paddings). ── */}
      <nav
        className="lg:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
        aria-label="Workspace"
      >
        <button
          onClick={() => router.push('/chat')}
          title="Start a new chat"
          aria-label="Start a new chat"
          className="flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[color:var(--muted)]"
        >
          <Plus className="w-[18px] h-[18px]" />
          <span className="mono text-[9px] font-medium tracking-wide">NEW</span>
        </button>
        {TABS.map(({ tab, label, title, Icon }) => {
          const selected = !onDashboard && railTab === tab && mobileMcpRailOpen
          return (
            <button
              key={tab}
              onClick={() => pickMobile(tab)}
              title={title}
              aria-label={label}
              aria-pressed={selected}
              className={cn(
                'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors',
                selected ? 'text-white' : 'text-[color:var(--muted)]',
              )}
            >
              {selected && (
                <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent)]" />
              )}
              <span className="relative">
                <Icon className="w-[18px] h-[18px]" />
                {tab === 'jobs' && jobsBadge}
              </span>
              <span className="mono text-[9px] font-medium tracking-wide">{label}</span>
            </button>
          )
        })}
        <Link
          href="/dashboard"
          title="Pantessa dashboard — links, keys, billing"
          aria-label="Pantessa dashboard"
          className={cn(
            'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors',
            onDashboard ? 'text-white' : 'text-[color:var(--muted)]',
          )}
        >
          {onDashboard && (
            <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent)]" />
          )}
          <LayoutDashboard className="w-[18px] h-[18px]" />
          <span className="mono text-[9px] font-medium tracking-wide">DASH</span>
        </Link>
      </nav>
    </>
  )
}
