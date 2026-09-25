'use client'

// The APPS destination's body: the working set on top, then the free fleet
// (or the paid x402 catalog behind the toggle), then "Add your own MCP".
// Extracted from ChatRail (squad mobile-native, 2026-09-24) so the desktop
// drawer and the phone's APPS screen render ONE component: at lg and up the
// drawer shows it in its 248px column, below lg it is the whole main area
// (components/phone). Clicking an MCP toggles it in/out of the working set;
// the check button on an active row also removes it.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, Info, Plus } from 'lucide-react'
import { cleanServerName, cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { fleetRank } from '@/lib/free-fleet'
import BrandIcon from '@/components/BrandIcon'
import AddMcpModal from '@/components/AddMcpModal'

export default function AppsRailTab({
  /** The parent scrolls (the phone screen's one scroller): the list is laid
   *  out flat instead of being its own scroll container, and the hover-only
   *  affordances stay visible, since a touch never hovers. */
  flat,
}: {
  flat?: boolean
}) {
  const { servers, activeServerIds, setActiveServerIds, updateChatServers, markManualMcp, currentChatId } = useYeetfulStore()

  // Free (default) vs the paid x402 catalog.
  const [freeView, setFreeView] = useState(true)
  // "Add your own MCP" modal (portaled — a drawer clips fixed children).
  const [addOpen, setAddOpen] = useState(false)

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
    persist(turningOn ? [...activeServerIds, server.id] : activeServerIds.filter((id) => id !== server.id))
  }

  const removeMcp = (server: (typeof servers)[number]) => {
    markManualMcp(server.slug, false)
    persist(activeServerIds.filter((id) => id !== server.id))
  }

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
        flat && 'min-h-[48px] md:min-h-[48px] active:bg-[var(--surf-1)]',
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
        <span className={cn('block font-medium truncate', flat ? 'text-[13px]' : 'text-xs')}>{cleanServerName(server.name)}</span>
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
        className={cn(
          'flex-shrink-0 grid place-items-center rounded-md text-[color:var(--muted-2)] hover:text-white hover:bg-white/5 transition-all',
          flat ? 'w-10 h-10 opacity-70' : 'w-6 h-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
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
          className={cn(
            'flex-shrink-0 grid place-items-center rounded-md border border-transparent text-[color:var(--accent)] hover:border-[var(--line-2)] hover:text-red-400 transition-colors',
            flat ? 'w-10 h-10' : 'w-6 h-6',
          )}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </button>
      ) : (
        <Plus className={cn('w-3.5 h-3.5 flex-shrink-0 transition-opacity', flat ? 'opacity-60' : 'opacity-0 group-hover:opacity-70')} strokeWidth={2.5} />
      )}
    </div>
  )

  return (
    <>
      {/* Free / Paid segmented toggle — no counts: the list below IS the
          answer, and the number was one more thing to read before any
          content. */}
      <div className={cn('px-3 pb-2', flat && 'pt-3')}>
        <div className="flex rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-0.5" role="tablist" aria-label="MCP pricing view">
          <button
            role="tab"
            aria-selected={freeView}
            onClick={() => setFreeView(true)}
            className={cn(
              'flex-1 rounded-[10px] px-2 py-1.5 text-[11px] font-medium transition-colors',
              flat && 'min-h-[40px] text-[13px]',
              freeView ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
            )}
          >
            Free
          </button>
          <button
            role="tab"
            aria-selected={!freeView}
            onClick={() => setFreeView(false)}
            className={cn(
              'flex-1 rounded-[10px] px-2 py-1.5 text-[11px] font-medium transition-colors',
              flat && 'min-h-[40px] text-[13px]',
              !freeView ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white',
            )}
          >
            Paid
          </button>
        </div>
      </div>

      {/* The scrolling list: actives pinned on top, then the view. "Add your
          own" rides the END of the list — a rare action shouldn't hold
          premium space above every row (Nate's crowding report, 2026-07-29).
          In the drawer this is the rail's own scroller; on the phone screen
          the screen scrolls and this lies flat. */}
      <div className={cn('px-2 pb-3 space-y-0.5', !flat && 'flex-1 overflow-y-auto')}>
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
        {/* Bring-your-own — the modal discovers tools from the server and
            lets the user star what a new account should ping first. */}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          data-sheet-open="addmcp"
          className={cn(
            'mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line-2)] px-2 py-2 text-[11px] font-medium text-[color:var(--muted)] hover:text-white hover:border-[var(--muted-2)] hover:bg-white/[0.03] transition-colors',
            flat && 'min-h-[44px] text-[13px]',
          )}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          Add your own MCP
        </button>
      </div>

      <p className={cn('px-3 pb-3 text-[10px] leading-relaxed text-[color:var(--muted-2)] border-t border-[var(--line)] pt-2', flat && 'text-[12px]')}>
        {flat ? 'Tap an MCP to add or remove it from your set.' : 'Click an MCP to add or remove it from your set.'}
      </p>

      {/* Portaled — lives outside any width-animated drawer so it never clips. */}
      <AddMcpModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
