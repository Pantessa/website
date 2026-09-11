'use client'

// The app spine: the product's constant across chat and dashboard. On
// desktop (≥lg) it's a persistent icon COLUMN — brand seat on top, the
// workspace destinations (new chat, MCPs, jobs, links, history) as labeled
// icons, the way out to settings (the dashboard) pinned at the bottom. Below lg the
// SAME destinations render as a fixed bottom TAB BAR — the phone-native
// shape of the same spine. One component, one badge poll, two postures.
//
// It replaces the drawer's own tab strip, the toolbar's reopen chips + NEW
// button, and the rail's pinned Dashboard row on every breakpoint. Mounted
// by surface shells (ChatWorkspace + the dashboard layout), NEVER by
// ChatInterface — so /embed and /i can't inherit it. The MARKETS surface
// (/markets + /t/<symbol>, 2026-09-11) mounts it too: there the brochure
// nav is gone, the spine IS the navigation, and the MARKETS seat wears the
// active state. The WALLET page (/wallet, 2026-09-11) is the same shape: its
// seat sits above DOCS in both postures and lights on its own page.
//
// Click grammar: a tab icon opens the drawer on that tab; clicking the tab
// you're already looking at collapses the drawer. From the dashboard a tab
// icon is a shortcut INTO chat, landing with that drawer tab open.
//
// The destination lives in the URL (`?tab=<name>`, lib/app-tab-url): the
// spine reads it on arrival and mirrors every change back, so a reload keeps
// you where you were instead of dropping you on MCPs, and any destination is
// linkable. Mirroring uses replaceState — the back button stays the way OFF
// the page, not a tab-undo.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Boxes, CandlestickChart, Ellipsis, Link2, ListChecks, MessageSquare, Plus, Settings, Users, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEFAULT_TAB, parseTabParam, syncTabParam, tabUrl } from '@/lib/app-tab-url'
import { useYeetfulStore, type RailTab } from '@/lib/store'
import { useSession } from '@/lib/session'
import { useRunningWork } from '@/lib/use-running-work'
import { rosterEnabledClient } from '@/lib/roster-client'
import { WALLET_PAGE_HREF } from '@/lib/wallet-page'
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

// Drawer tabs the PHONE bar folds behind MORE (see the capacity note in the
// component). The desktop column has room for every seat.
const PHONE_MORE_TABS: ReadonlySet<RailTab> = new Set<RailTab>(['team'])

const WALLET_TITLE = 'Wallet — balances on every chain, gas, send and receive'

export default function AppSpine({ surface = 'chat' }: { surface?: 'chat' | 'dashboard' | 'markets' | 'wallet' }) {
  const router = useRouter()
  const {
    railTab,
    setRailTab,
    mainView,
    setMainView,
    mcpRailOpen,
    setMcpRailOpen,
    mobileMcpRailOpen,
    setMobileMcpRailOpen,
  } = useYeetfulStore()
  const onDashboard = surface === 'dashboard'
  const onMarkets = surface === 'markets'
  const onWallet = surface === 'wallet'
  // Off the chat, a tab icon is a shortcut INTO chat (landing with that
  // drawer tab open) and the URL mirror stays off — the page owns its URL.
  const offChat = surface !== 'chat'

  // The live connected wallet (NOT the SIWE session — under connect-to-act a
  // visitor runs on connect alone), so the reset below fires at the moment the
  // user actually names themselves.
  const { walletAddress } = useSession()

  // THE one running-work poll on first-party surfaces: the column and the
  // bar render from this single mount, and the drawer/toolbar instances are
  // gone — so this is always enabled while the shell is up.
  const { badgeCount } = useRunningWork(true)

  // Which posture is live — the URL names one destination, but the two
  // drawers are separate flags (desktop persists its open state, the mobile
  // overlay never does), so the mirror below has to know which one counts.
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)')
    const on = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
    setIsNarrow(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])

  // THE PHONE BAR'S CAPACITY. The full set doesn't fit a phone: ten seats at
  // 375px are 37.5px apiece, and SETTINGS (50px of 10px mono) runs straight
  // into DOCS. Below sm the bar keeps its seats through WALLET and folds the
  // rest (TEAM while the roster is on, DOCS, SETTINGS) behind MORE, the tab
  // bar's standard answer. From sm up every seat has room and MORE goes away.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  // URL → spine. `?tab=<name>` (lib/app-tab-url) opens the drawer on that
  // destination: it's how a reload comes back to where you were, how
  // /dashboard/links redirects into the studio, and how the storefront's
  // "hire from the Team tab" door lands the visitor IN the hire flow. Read
  // off location, not useSearchParams — AppSpine mounts outside any Suspense
  // boundary, and reading the hook there would opt every chat route out of
  // static rendering. Unknown or flag-hidden tab names aren't in TABS and do
  // nothing (the roster stays invisible while it ships dark).
  const applyTabFromUrl = useCallback(
    (search: string, { resetWhenAbsent }: { resetWhenAbsent: boolean }): RailTab | null => {
      const tab = parseTabParam(search)
      const known = tab && TABS.some((t) => t.tab === tab) ? tab : null
      if (!known) {
        // Back/forward off a destination returns to the resting spine; on
        // ARRIVAL we leave the store alone, so a tab picked before the
        // navigation (the dashboard's shortcut into chat) survives the hop.
        if (resetWhenAbsent) {
          setRailTab(DEFAULT_TAB)
          setMainView('chat')
        }
        return null
      }
      setRailTab(known)
      setMainView(known === 'links' ? 'links' : 'chat')
      if (window.matchMedia('(max-width: 1023px)').matches) setMobileMcpRailOpen(true)
      else setMcpRailOpen(true)
      return known
    },
    [setRailTab, setMainView, setMcpRailOpen, setMobileMcpRailOpen],
  )

  const deepLinkedRef = useRef(false)
  useEffect(() => {
    if (offChat) return
    // Only a destination we actually APPLIED counts as a deep link — a
    // flag-hidden tab name changed nothing, so it must not eat the
    // wallet-arrival reset below.
    if (applyTabFromUrl(window.location.search, { resetWhenAbsent: false })) {
      deepLinkedRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Back/forward across destinations. The spine's own clicks use
  // replaceState (see syncTabParam), so this only fires for real
  // navigations — a pushed deep link, or leaving and returning to a chat.
  useEffect(() => {
    if (offChat) return
    const onPop = () => applyTabFromUrl(window.location.search, { resetWhenAbsent: true })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [offChat, applyTabFromUrl])

  // A WALLET ARRIVING IS A FIRST LOOK — lead with the MCP set.
  //
  // railTab is already session-only (store v6), so a fresh load leads with
  // MCPs. But a turn that births a standing intent flips the rail to Jobs
  // (ChatInterface), and two of the empty state's starter chips do exactly
  // that ("DCA $10 into AAPL weekly", "Protect my Hyperliquid position") —
  // so a newcomer who taps one and THEN connects to sign meets Jobs as their
  // first view of the rail. Connecting (or switching to another account) is a
  // new person's first look: snap back to MCPs, the composable set that IS
  // the product's front door. An already-connected user who arms a job still
  // gets carried to Jobs — their address didn't change.
  //
  // The ?tab= deep link wins over the auto-reconnect that follows it.
  const lastWalletRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = lastWalletRef.current
    lastWalletRef.current = walletAddress
    if (!walletAddress || walletAddress === prev) return
    if (deepLinkedRef.current) {
      deepLinkedRef.current = false
      return
    }
    setRailTab('mcps')
    setMainView('chat')
  }, [walletAddress, setRailTab, setMainView])

  // The dashboard's floating rail-reopen pill, the mobile page paddings and
  // the markets and wallet pages' docked ask pill key off the spine's
  // presence — flag it on the document element.
  useEffect(() => {
    if (!offChat) return
    document.documentElement.setAttribute('data-spine', '1')
    return () => document.documentElement.removeAttribute('data-spine')
  }, [offChat])

  // LINKS is a destination, not just a drawer: picking it renders the
  // public /links board in the chat's MAIN screen (LinksWorkspace); picking
  // any other tab returns the main screen to the conversation. The collapse
  // gesture (clicking the tab you're on) is also the way back.
  const mainViewFor = (tab: RailTab): 'chat' | 'links' => (tab === 'links' ? 'links' : 'chat')

  // Spine → URL. The destination the address bar should name: the lit tab
  // while the drawer is open, and LINKS whenever the board owns the main
  // screen (on phones it shows with the overlay closed). A collapsed drawer
  // on the default tab is just the conversation, so the param comes off —
  // /chat and /chat?tab=mcps restore identically, and shared chat links stay
  // clean.
  const drawerOpen = isNarrow ? mobileMcpRailOpen : mcpRailOpen
  const urlTab: RailTab | null =
    mainView === 'links' && railTab === 'links' ? 'links' : drawerOpen ? railTab : null

  // Every setRailTab in the app funnels through this one write — the spine's
  // clicks, the auto-flip to Jobs when a turn births a standing intent, the
  // rail's own "open the studio". Skips the first run: on arrival the URL is
  // already the truth (applyTabFromUrl is mid-flight), and writing from
  // not-yet-applied state would wipe the very param we're restoring.
  const mirroredRef = useRef(false)
  useEffect(() => {
    if (offChat) return
    if (!mirroredRef.current) {
      mirroredRef.current = true
      return
    }
    syncTabParam(urlTab)
  }, [urlTab, offChat])

  // Desktop: the drawer is the in-flow panel (persisted open state).
  const pickDesktop = (tab: RailTab) => {
    if (offChat) {
      setRailTab(tab)
      setMainView(mainViewFor(tab))
      setMcpRailOpen(true)
      router.push(tabUrl(tab, '/chat', ''))
      return
    }
    if (railTab === tab && mcpRailOpen) {
      // Lit LINKS tab with the board already gone (a send flipped the main
      // screen back to the thread): the click means "show me the board
      // again", not collapse. Every other lit-tab click stays a collapse.
      if (tab === 'links' && mainView !== 'links') {
        setMainView('links')
      } else {
        setMcpRailOpen(false)
        setMainView('chat')
      }
    } else {
      setRailTab(tab)
      setMainView(mainViewFor(tab))
      setMcpRailOpen(true)
    }
  }

  // Mobile: the drawer is a transient overlay (never persisted).
  const pickMobile = (tab: RailTab) => {
    if (offChat) {
      setRailTab(tab)
      setMainView(mainViewFor(tab))
      setMobileMcpRailOpen(true)
      router.push(tabUrl(tab, '/chat', ''))
      return
    }
    if (railTab === tab && mobileMcpRailOpen) {
      if (tab === 'links' && mainView !== 'links') {
        setMainView('links')
        setMobileMcpRailOpen(false) // reveal the board — the overlay covers it on phones
      } else {
        setMobileMcpRailOpen(false)
        setMainView('chat')
      }
    } else {
      setRailTab(tab)
      setMainView(mainViewFor(tab))
      setMobileMcpRailOpen(true)
    }
  }

  const jobsBadge = badgeCount > 0 && (
    <span className="absolute -top-0.5 right-0 mono text-[9px] leading-4 px-1 rounded-full bg-amber-500/15 text-amber-400 ring-1 ring-[var(--surf-1)]">
      {badgeCount > 99 ? '99+' : badgeCount}
    </span>
  )

  // What MORE holds on a phone, and whether it wears the "you are here" tick
  // (the settings page, or the TEAM drawer open over the chat).
  const moreTab = TABS.find((t) => PHONE_MORE_TABS.has(t.tab))
  const moreLit = onDashboard || (!offChat && !!moreTab && railTab === moreTab.tab && mobileMcpRailOpen)
  const moreItem =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 min-h-[44px] text-left text-[color:var(--muted)] hover:bg-[var(--surf-2)] hover:text-[color:var(--fg)] transition-colors'

  return (
    <>
      {/* ── Desktop: the column ── */}
      <aside
        className={cn(
          'max-lg:hidden flex-shrink-0 w-14 flex flex-col items-center border-r border-[var(--line)] bg-[var(--surf-1)]',
          // Chat's shell is height-constrained (h-dvh flex), so the spine
          // just fills it; the dashboard, markets and wallet PAGES scroll,
          // so it rides sticky.
          offChat ? 'sticky top-0 h-dvh self-start' : 'h-full',
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
          <YeetfulMark size={25} />
        </Link>

        <div className="flex flex-col items-center gap-1 pt-2 w-full px-1">
          <button
            onClick={() => {
              // NEW always lands on the conversation, whatever the main
              // screen was showing.
              setMainView('chat')
              router.push('/chat')
            }}
            title="Start a new chat"
            aria-label="Start a new chat"
            className="w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)] transition-colors"
          >
            <Plus className="w-[18px] h-[18px]" />
            <span className="mono text-[9px] font-medium tracking-wide">NEW</span>
          </button>

          {/* MARKETS is a destination PAGE (/markets → /t/<symbol>), not a
              drawer tab — it sits first among the seats because the chart
              that executes is the front door (2026-09-11). */}
          <Link
            href="/markets"
            title="Markets — stocks 24/7, spot, perps; the chart that executes"
            aria-label="MARKETS"
            aria-current={onMarkets ? 'page' : undefined}
            className={cn(
              'relative w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors',
              onMarkets
                ? 'bg-[var(--surf-2)] text-white'
                : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)]',
            )}
          >
            {onMarkets && (
              <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-[var(--accent)]" />
            )}
            <CandlestickChart className="w-[18px] h-[18px]" />
            <span className="mono text-[9px] font-medium tracking-wide">MARKETS</span>
          </Link>

          {TABS.map(({ tab, label, title, Icon }) => {
            const selected = !offChat && railTab === tab && mcpRailOpen
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

          {/* WALLET is a destination PAGE (/wallet: the "Wallet details"
              window given the whole screen), seated above DOCS (2026-09-11,
              Nate: "put it on the left side bar as an option above docs").
              It wears the active state on its own page. */}
          <Link
            href={WALLET_PAGE_HREF}
            title={WALLET_TITLE}
            aria-label="WALLET"
            aria-current={onWallet ? 'page' : undefined}
            className={cn(
              'relative w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors',
              onWallet
                ? 'bg-[var(--surf-2)] text-white'
                : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)]',
            )}
          >
            {onWallet && (
              <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-[var(--accent)]" />
            )}
            <Wallet className="w-[18px] h-[18px]" />
            <span className="mono text-[9px] font-medium tracking-wide">WALLET</span>
          </Link>

          {/* DOCS is a destination PAGE, seated under CHATS (2026-09-11,
              Nate) — the docs left the brochure nav's reach once the nav
              left the app. */}
          <Link
            href="/docs"
            title="Docs — how Pantessa builds, guards and signs"
            aria-label="DOCS"
            className="relative w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)] transition-colors"
          >
            <BookOpen className="w-[18px] h-[18px]" />
            <span className="mono text-[9px] font-medium tracking-wide">DOCS</span>
          </Link>
        </div>

        <div className="flex-1" />

        {/* The labeled way out. The dashboard is settings now — the links
            studio moved into the spine's LINKS tab — so the seat says so and
            wears a gear. On the dashboard it wears the active state. */}
        <Link
          href="/dashboard"
          title="Settings — creator page, keys, billing, account"
          aria-label="Settings"
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
          <Settings className="w-[18px] h-[18px]" />
          <span className="mono text-[9px] font-medium tracking-wide">SETTINGS</span>
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
          onClick={() => {
            // NEW always lands on the conversation, whatever the main
            // screen was showing.
            setMainView('chat')
            router.push('/chat')
          }}
          title="Start a new chat"
          aria-label="Start a new chat"
          className="flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[color:var(--muted)]"
        >
          <Plus className="w-[18px] h-[18px]" />
          <span className="mono text-[10px] font-medium tracking-wide">NEW</span>
        </button>
        <Link
          href="/markets"
          title="Markets — stocks 24/7, spot, perps; the chart that executes"
          aria-label="MARKETS"
          aria-current={onMarkets ? 'page' : undefined}
          className={cn(
            'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors',
            onMarkets ? 'text-white' : 'text-[color:var(--muted)]',
          )}
        >
          {onMarkets && (
            <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent)]" />
          )}
          <CandlestickChart className="w-[18px] h-[18px]" />
          <span className="mono text-[10px] font-medium tracking-wide">MARKETS</span>
        </Link>
        {TABS.map(({ tab, label, title, Icon }) => {
          const selected = !offChat && railTab === tab && mobileMcpRailOpen
          return (
            <button
              key={tab}
              onClick={() => pickMobile(tab)}
              title={title}
              aria-label={label}
              aria-pressed={selected}
              className={cn(
                'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors',
                // Folded behind MORE below sm (the capacity note above).
                PHONE_MORE_TABS.has(tab) && 'max-sm:hidden',
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
              <span className="mono text-[10px] font-medium tracking-wide">{label}</span>
            </button>
          )
        })}
        <Link
          href={WALLET_PAGE_HREF}
          title={WALLET_TITLE}
          aria-label="WALLET"
          aria-current={onWallet ? 'page' : undefined}
          className={cn(
            'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors',
            onWallet ? 'text-white' : 'text-[color:var(--muted)]',
          )}
        >
          {onWallet && (
            <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent)]" />
          )}
          <Wallet className="w-[18px] h-[18px]" />
          <span className="mono text-[10px] font-medium tracking-wide">WALLET</span>
        </Link>
        <Link
          href="/docs"
          title="Docs — how Pantessa builds, guards and signs"
          aria-label="DOCS"
          className="relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[color:var(--muted)] transition-colors max-sm:hidden"
        >
          <BookOpen className="w-[18px] h-[18px]" />
          <span className="mono text-[10px] font-medium tracking-wide">DOCS</span>
        </Link>
        <Link
          href="/dashboard"
          title="Settings — creator page, keys, billing, account"
          aria-label="Settings"
          className={cn(
            'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors max-sm:hidden',
            onDashboard ? 'text-white' : 'text-[color:var(--muted)]',
          )}
        >
          {onDashboard && (
            <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent)]" />
          )}
          <Settings className="w-[18px] h-[18px]" />
          <span className="mono text-[10px] font-medium tracking-wide">SETTINGS</span>
        </Link>
        {/* MORE — phones only (below sm). TEAM, DOCS and SETTINGS ride here
            so the seats before it keep legible labels at 375px. The menu
            mounts on open, like every menu in the app. */}
        <div ref={moreRef} className="relative flex-1 flex sm:hidden">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            title="More — docs and settings"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className={cn(
              'relative flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors',
              moreLit || moreOpen ? 'text-white' : 'text-[color:var(--muted)]',
            )}
          >
            {moreLit && (
              <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent)]" />
            )}
            <Ellipsis className="w-[18px] h-[18px]" />
            <span className="mono text-[10px] font-medium tracking-wide">MORE</span>
          </button>
          {moreOpen && (
            <div
              role="menu"
              aria-label="More destinations"
              data-spine-more
              className="absolute bottom-full right-1.5 mb-2 w-60 rounded-xl border border-[var(--line-2)] bg-[var(--bg)] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
            >
              {moreTab && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    pickMobile(moreTab.tab)
                  }}
                  className={moreItem}
                >
                  <moreTab.Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-[color:var(--fg)]">Team</span>
                    <span className="block text-[11px] truncate">Your wallet&rsquo;s staff</span>
                  </span>
                </button>
              )}
              <Link href="/docs" role="menuitem" onClick={() => setMoreOpen(false)} className={moreItem}>
                <BookOpen className="w-[18px] h-[18px] flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[color:var(--fg)]">Docs</span>
                  <span className="block text-[11px] truncate">How Pantessa builds, guards and signs</span>
                </span>
              </Link>
              <Link
                href="/dashboard"
                role="menuitem"
                aria-current={onDashboard ? 'page' : undefined}
                onClick={() => setMoreOpen(false)}
                className={moreItem}
              >
                <Settings className="w-[18px] h-[18px] flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[color:var(--fg)]">Settings</span>
                  <span className="block text-[11px] truncate">Creator page, keys, billing, account</span>
                </span>
              </Link>
            </div>
          )}
        </div>
      </nav>
    </>
  )
}
