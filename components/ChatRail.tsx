'use client'

// The chat's single left rail: MCPs | Jobs | Chats as TABS of one panel —
// ordered by importance (the working set, then running work with its
// needs-you badge, then history: findable, never competing). A pinned
// Dashboard row at the bottom is the labeled way out of chat. They used to
// be two independent sliding sidebars with near-identical collapse toggles,
// which read as the whole UI shoving around. One rail, one collapse.
//
// MCPs stays the primary tab (it never steals the default). The free
// first-party fleet is the default MCP view; the paid x402 catalog sits
// behind the Free/Paid toggle. Clicking an MCP toggles it in/out of the
// working set; the check button on an active row also removes it.
//
// Layout model: in-flow motion.aside on desktop (persisted preference), fixed
// overlay below lg (transient).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Boxes, Check, Globe, Info, LayoutDashboard, Link2, ListChecks, Loader2, MessageSquare, PanelLeftClose, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { useSession } from '@/lib/session'
import { fleetRank } from '@/lib/free-fleet'
import { useRunningWork } from '@/lib/use-running-work'
import BrandIcon from '@/components/BrandIcon'
import AddMcpModal from '@/components/AddMcpModal'
import JobsRailTab from '@/components/JobsRailTab'
import LinksRailTab from '@/components/LinksRailTab'

const RAIL_WIDTH = 248

export default function ChatRail() {
  const router = useRouter()
  const {
    servers,
    activeServerIds,
    setActiveServerIds,
    updateChatServers,
    markManualMcp,
    currentChatId,
    chats,
    chatsLoading,
    deleteChat,
    railTab,
    setRailTab,
    mcpRailOpen,
    setMcpRailOpen,
    mobileMcpRailOpen,
    setMobileMcpRailOpen,
  } = useYeetfulStore()
  const { address, needsSignIn, signIn, signingIn } = useSession()

  // Free (default) vs the paid x402 catalog.
  const [freeView, setFreeView] = useState(true)
  // "Add your own MCP" modal (portaled — the rail clips fixed children).
  const [addOpen, setAddOpen] = useState(false)

  // Mount gate + breakpoint: the breakpoint is unknowable server-side, and
  // toggling an AnimatePresence child mid-hydration orphans it (panel sticks
  // open) — so nothing renders until the client knows which open-flag governs.
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)')
    setIsMobile(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    setMounted(true)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Phones: transient overlay state (default closed, never persisted).
  // Desktop: the persisted preference.
  const open = isMobile ? mobileMcpRailOpen : mcpRailOpen

  // Running work (jobs + recurring buys) — the Jobs tab's badge. Polled only
  // while the rail is open; the collapsed toolbar chip runs its own instance.
  const { badgeCount } = useRunningWork(open)

  const active = useMemo(
    () =>
      activeServerIds
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is (typeof servers)[number] => s !== undefined),
    [servers, activeServerIds],
  )
  // The browsable list under the toggle — actives are pinned above it, so
  // they're excluded here regardless of which view they belong to.
  const listed = useMemo(() => {
    const rest = servers.filter((s) => !activeServerIds.includes(s.id))
    return freeView
      ? rest.filter((s) => s.gated === false).sort((a, b) => fleetRank(a.slug) - fleetRank(b.slug))
      : rest.filter((s) => s.gated !== false)
  }, [servers, activeServerIds, freeView])

  const freeCount = useMemo(() => servers.filter((s) => s.gated === false).length, [servers])

  const persist = (next: string[]) => {
    setActiveServerIds(next)
    if (currentChatId) updateChatServers(currentChatId, next)
  }

  // Row click toggles the MCP in or out of the working set. A rail toggle is a
  // DELIBERATE pick — mark it manual so the splash shows this MCP's card even
  // with zero wallet activity (the affinity gate only applies to the auto scan).
  const toggleMcp = (server: (typeof servers)[number]) => {
    const turningOn = !activeServerIds.includes(server.id)
    markManualMcp(server.slug, turningOn)
    persist(
      turningOn
        ? [...activeServerIds, server.id]
        : activeServerIds.filter((id) => id !== server.id),
    )
  }

  const removeMcp = (server: (typeof servers)[number]) => {
    markManualMcp(server.slug, false)
    persist(activeServerIds.filter((id) => id !== server.id))
  }

  // Below lg the rail is an overlay — navigation should dismiss it.
  const closeOnMobile = () => {
    if (window.matchMedia('(max-width: 1023px)').matches) setMobileMcpRailOpen(false)
  }

  const handleDeleteChat = (id: string) => {
    deleteChat(id)
    if (currentChatId === id) router.push('/chat')
  }

  if (!mounted) return null

  const McpRow = ({ server, isActive }: { server: (typeof servers)[number]; isActive: boolean }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={() => toggleMcp(server)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggleMcp(server)
        }
      }}
      title={isActive ? `${server.name} — click to remove from your set` : `Add ${server.name} to your set`}
      className={cn(
        'group w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[44px] md:min-h-0 rounded-xl cursor-pointer transition-all text-left',
        isActive
          ? 'bg-[var(--surf-2)] text-white'
          : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)]',
      )}
    >
      {/* In-set rows tint the mark with the accent (the vendored marks render
          in currentColor, so this is just a color flip; full-color logo_url
          <img> customs keep their own colors). */}
      <span
        className={cn(
          'w-9 h-9 grid place-items-center flex-shrink-0 rounded-lg bg-black/30 border border-[var(--line)] transition-colors',
          isActive && 'text-[color:var(--accent)]',
        )}
      >
        <BrandIcon server={server} size={22} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-medium truncate">{server.name}</span>
        {server.gated !== false && (
          <span className="block text-[10px] mono text-[color:var(--muted-2)]">
            {`$${server.priceUsd}/call`}
          </span>
        )}
      </span>
      {/* Server page in a new tab — hover affordance so the row stays clean.
          stopPropagation: the row click adds/opens, the ⓘ only informs. */}
      <Link
        href={`/servers/${server.slug}`}
        target="_blank"
        onClick={(e) => e.stopPropagation()}
        aria-label={`About ${server.name} — tools, pricing, reputation`}
        title={`About ${server.name}`}
        className="flex-shrink-0 w-6 h-6 grid place-items-center rounded-md text-[color:var(--muted-2)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-white/5 transition-all"
      >
        <Info className="w-3.5 h-3.5" />
      </Link>
      {isActive ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            removeMcp(server)
          }}
          aria-label={`Remove ${server.name} from the set`}
          title="In your set — click to remove"
          className="flex-shrink-0 w-6 h-6 grid place-items-center rounded-md border border-transparent text-[color:var(--accent)] hover:border-[var(--line-2)] hover:text-red-400 transition-colors"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </button>
      ) : (
        <Plus className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-70 transition-opacity" strokeWidth={2.5} />
      )}
    </div>
  )

  return (
    <>
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: RAIL_WIDTH, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="flex-shrink-0 border-r border-[var(--line)] bg-black/20 overflow-hidden h-full max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:bg-[#0b0b0c] max-lg:shadow-[8px_0_32px_rgba(0,0,0,0.55)]"
        >
          <div className="flex flex-col h-full" style={{ width: RAIL_WIDTH }}>
            {/* Header: the MCPs/Chats tabs + the rail's ONE collapse control. */}
            <div className="flex items-center gap-1 px-2 pt-3 pb-2">
              <div
                className="flex-1 flex rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-0.5"
                role="tablist"
                aria-label="Rail view"
              >
                <button
                  role="tab"
                  aria-selected={railTab === 'mcps'}
                  onClick={() => setRailTab('mcps')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 rounded-[10px] px-1 py-1.5 text-[11px] font-medium transition-colors',
                    railTab === 'mcps' ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
                  )}
                >
                  <Boxes className="w-3.5 h-3.5" />
                  MCPs
                </button>
                {/* Four tabs share the 248px rail, ordered by importance:
                    MCPs (the working set), Jobs (running work — its badge is
                    the one number that must interrupt), Links (the creator's
                    links — minting lives where the aha happens), then Chats
                    (history: findable, never competing for attention). The
                    MCPs inline count went with the fourth tab — actives are
                    pinned at the top of the list, and the collapsed toolbar
                    chip still carries the number. */}
                <button
                  role="tab"
                  aria-selected={railTab === 'jobs'}
                  onClick={() => setRailTab('jobs')}
                  title="Jobs and recurring buys running on this wallet"
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 rounded-[10px] px-1 py-1.5 text-[11px] font-medium transition-colors',
                    railTab === 'jobs' ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
                  )}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  Jobs
                  {badgeCount > 0 && (
                    <span className="mono text-[10px] px-1 rounded-full bg-amber-500/15 text-amber-400">{badgeCount}</span>
                  )}
                </button>
                <button
                  role="tab"
                  aria-selected={railTab === 'links'}
                  onClick={() => setRailTab('links')}
                  title="Your intent links — mint and share from here"
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 rounded-[10px] px-1 py-1.5 text-[11px] font-medium transition-colors',
                    railTab === 'links' ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
                  )}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Links
                </button>
                <button
                  role="tab"
                  aria-selected={railTab === 'chats'}
                  onClick={() => setRailTab('chats')}
                  title="Your chat history"
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 rounded-[10px] px-1 py-1.5 text-[11px] font-medium transition-colors',
                    railTab === 'chats' ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
                  )}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Chats
                </button>
              </div>
              <button
                className="apprail__toggle flex-shrink-0"
                onClick={() => (isMobile ? setMobileMcpRailOpen(false) : setMcpRailOpen(false))}
                aria-label="Collapse the rail"
                title="Collapse"
              >
                <PanelLeftClose width={17} height={17} />
              </button>
            </div>

            {railTab === 'jobs' ? (
              <JobsRailTab onAct={closeOnMobile} />
            ) : railTab === 'links' ? (
              <LinksRailTab />
            ) : railTab === 'mcps' ? (
              <>
                {/* Free / Paid segmented toggle */}
                <div className="px-3 pb-2">
                  <div className="flex rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-0.5" role="tablist" aria-label="MCP pricing view">
                    <button
                      role="tab"
                      aria-selected={freeView}
                      onClick={() => setFreeView(true)}
                      className={cn(
                        'flex-1 rounded-[10px] px-2 py-1.5 text-[11px] font-medium transition-colors',
                        freeView ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
                      )}
                    >
                      Free <span className="mono text-[10px] text-[color:var(--muted-2)]">{freeCount}</span>
                    </button>
                    <button
                      role="tab"
                      aria-selected={!freeView}
                      onClick={() => setFreeView(false)}
                      className={cn(
                        'flex-1 rounded-[10px] px-2 py-1.5 text-[11px] font-medium transition-colors',
                        !freeView ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
                      )}
                    >
                      Paid
                    </button>
                  </div>
                  {/* Bring-your-own — the modal discovers tools from the server and
                      lets the user star what a new account should ping first. */}
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line-2)] px-2 py-2 text-[11px] font-medium text-[color:var(--muted)] hover:text-white hover:border-[var(--muted-2)] hover:bg-white/[0.03] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                    Add your own MCP
                  </button>
                </div>

                {/* The scrolling list: actives pinned on top, then the view */}
                <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
                  {active.length > 0 && (
                    <>
                      {active.map((s) => (
                        <McpRow key={s.id} server={s} isActive />
                      ))}
                      <div aria-hidden className="my-2 h-px bg-[var(--line)]" />
                    </>
                  )}
                  {listed.map((s) => (
                    <McpRow key={s.id} server={s} isActive={false} />
                  ))}
                  {listed.length === 0 && (
                    <p className="px-2 py-4 text-[11px] text-[color:var(--muted-2)]">
                      {freeView ? 'All free MCPs are in your set.' : 'No paid MCPs loaded.'}
                    </p>
                  )}
                </div>

                <p className="px-3 pb-3 text-[10px] leading-relaxed text-[color:var(--muted-2)] border-t border-[var(--line)] pt-2">
                  Click an MCP to add or remove it from your set.
                </p>
              </>
            ) : (
              <>
                <div className="px-3 pb-2">
                  <button
                    onClick={() => { closeOnMobile(); router.push('/chat') }}
                    className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-all text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    New Chat
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
                  {chatsLoading && chats.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-6 text-xs text-[color:var(--muted-2)]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading chats…
                    </div>
                  )}

                  {!chatsLoading && chats.length === 0 && (
                    <div className="text-center py-6 px-3 space-y-3">
                      <p className="text-xs text-[color:var(--muted-2)]">
                        {address
                          ? 'No chats yet. Add MCPs, then start one here.'
                          : 'Your chats are saved when you sign in with your wallet.'}
                      </p>
                      {needsSignIn && (
                        <button
                          onClick={() => signIn()}
                          disabled={signingIn}
                          className="text-xs font-semibold text-white underline underline-offset-2 hover:text-zinc-300 disabled:opacity-60"
                        >
                          {signingIn ? 'Signing in…' : 'Sign in to save chats'}
                        </button>
                      )}
                    </div>
                  )}

                  {chats.map((chat) => (
                    <div
                      key={chat.id}
                      className={cn(
                        'group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all',
                        currentChatId === chat.id
                          ? 'bg-[var(--surf-2)] text-white'
                          : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)]'
                      )}
                      onClick={() => { closeOnMobile(); router.push(`/chat/${chat.id}`) }}
                    >
                      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1 text-xs truncate">{chat.title}</span>
                      {chat.isPublic && (
                        <Globe
                          className="w-3 h-3 flex-shrink-0 text-emerald-400/80"
                          aria-label="Shared publicly"
                        />
                      )}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {chat.activeServerIds.length > 0 && (
                          <span className="text-[10px] text-zinc-600">
                            {chat.activeServerIds.length}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteChat(chat.id)
                          }}
                          className="p-0.5 text-zinc-700 hover:text-red-400 transition-colors"
                          aria-label="Delete chat"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Pinned dashboard entry — the way OUT of chat is a labeled,
                permanent row, not just the tiny Y mark in the toolbar. */}
            <Link
              href="/dashboard"
              onClick={closeOnMobile}
              title="Yeetful dashboard — keys, embeds, billing"
              className="flex-shrink-0 flex items-center gap-2.5 px-4 py-3 border-t border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)] transition-colors"
            >
              <LayoutDashboard className="w-4 h-4 flex-shrink-0" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium">Dashboard</span>
                <span className="block text-[10px] text-[color:var(--muted-2)]">keys · embeds · billing</span>
              </span>
            </Link>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
    {/* Portaled — lives outside the width-animated aside so it never clips. */}
    <AddMcpModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
