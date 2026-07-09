'use client'

// The vertical MCP rail — chat's left tool column. The free first-party fleet
// is the default view (fleet order); the paid x402 catalog sits behind the
// Free/Paid toggle at the top. Clicking an MCP adds it to the working set AND
// opens its action window (per-MCP wallet-aware splash — McpActionPanel);
// clicking an active row re-opens the window. Deactivation is the check
// button on the row.
//
// Layout model mirrors ChatSidebar: in-flow motion.aside on desktop
// (persisted preference), fixed overlay below lg (transient).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Info, PanelLeftClose, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { fleetRank } from '@/lib/free-fleet'
import BrandIcon from '@/components/BrandIcon'
import AddMcpModal from '@/components/AddMcpModal'

export default function McpRail() {
  const {
    servers,
    activeServerIds,
    setActiveServerIds,
    updateChatServers,
    currentChatId,
    mcpRailOpen,
    setMcpRailOpen,
    mobileMcpRailOpen,
    setMobileMcpRailOpen,
    setMcpActionSlug,
  } = useYeetfulStore()

  // Free (default) vs the paid x402 catalog.
  const [freeView, setFreeView] = useState(true)
  // "Add your own MCP" modal (portaled — the rail clips fixed children).
  const [addOpen, setAddOpen] = useState(false)

  // Mount gate + breakpoint — same rationale as ChatSidebar: the breakpoint is
  // unknowable server-side, and toggling an AnimatePresence child
  // mid-hydration orphans it.
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

  const open = isMobile ? mobileMcpRailOpen : mcpRailOpen

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

  // Row click: make sure it's in the set, then open its action window.
  const openMcp = (server: (typeof servers)[number]) => {
    if (!activeServerIds.includes(server.id)) persist([...activeServerIds, server.id])
    setMcpActionSlug(server.slug)
  }

  const removeMcp = (server: (typeof servers)[number]) => {
    persist(activeServerIds.filter((id) => id !== server.id))
    setMcpActionSlug(null)
  }

  if (!mounted) return null

  const Row = ({ server, isActive }: { server: (typeof servers)[number]; isActive: boolean }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openMcp(server)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openMcp(server)
        }
      }}
      title={isActive ? `${server.name} — open actions` : `Add ${server.name} and see what it can do`}
      className={cn(
        'group w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[44px] md:min-h-0 rounded-xl cursor-pointer transition-all text-left',
        isActive
          ? 'bg-[var(--surf-2)] text-white'
          : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)]',
      )}
    >
      <span className="w-9 h-9 grid place-items-center flex-shrink-0 rounded-lg bg-black/30 border border-[var(--line)]">
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
          animate={{ width: 248, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="flex-shrink-0 border-r border-[var(--line)] bg-black/20 overflow-hidden h-full max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:bg-[#0b0b0c] max-lg:shadow-[8px_0_32px_rgba(0,0,0,0.55)]"
        >
          <div className="flex flex-col h-full" style={{ width: 248 }}>
            {/* Header: label + collapse */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
                MCPs · {active.length} in set
              </span>
              <button
                className="apprail__toggle"
                onClick={() => (isMobile ? setMobileMcpRailOpen(false) : setMcpRailOpen(false))}
                aria-label="Collapse MCP rail"
                title="Collapse MCP rail"
              >
                <PanelLeftClose width={17} height={17} />
              </button>
            </div>

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
                    <Row key={s.id} server={s} isActive />
                  ))}
                  <div aria-hidden className="my-2 h-px bg-[var(--line)]" />
                </>
              )}
              {listed.map((s) => (
                <Row key={s.id} server={s} isActive={false} />
              ))}
              {listed.length === 0 && (
                <p className="px-2 py-4 text-[11px] text-[color:var(--muted-2)]">
                  {freeView ? 'All free MCPs are in your set.' : 'No paid MCPs loaded.'}
                </p>
              )}
            </div>

            <p className="px-3 pb-3 text-[10px] leading-relaxed text-[color:var(--muted-2)] border-t border-[var(--line)] pt-2">
              Click an MCP to see what it can do with your account.
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
    {/* Portaled — lives outside the width-animated aside so it never clips. */}
    <AddMcpModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
