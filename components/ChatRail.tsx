'use client'

// The chat's single left rail (DESKTOP, lg and up): APPS | JOBS | LINKS |
// TEAM | CHATS as the contextual panel beside the spine, ordered by
// importance (the working set, then running work with its needs-you badge,
// then links, then history: findable, never competing). They used to be two
// independent sliding sidebars with near-identical collapse toggles, which
// read as the whole UI shoving around. One rail, one collapse.
//
// Below lg there is NO drawer any more (squad mobile-native, 2026-09-24,
// Nate: "when you click a bottom nav the drawer pops out automatically but
// does not feel like the right flow"): a tab is a place, and the same bodies
// render as full screens in the /chat main area (components/phone). The
// overlay posture this file used to carry (an absolutely positioned 248px
// aside over the chat, no scrim) is retired; this component renders nothing
// in the phone posture.
//
// Layout model: in-flow motion.aside on desktop (persisted preference).

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PanelLeftClose } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import { PHONE_MQ } from '@/lib/phone-shell'
import AppsRailTab from '@/components/AppsRailTab'
import ChatsRailTab from '@/components/ChatsRailTab'
import JobsRailTab from '@/components/JobsRailTab'
import LinksRailTab from '@/components/LinksRailTab'
import TeamRailTab from '@/components/TeamRailTab'

const RAIL_WIDTH = 248

export default function ChatRail() {
  const { railTab, mcpRailOpen, setMcpRailOpen } = useYeetfulStore()

  // Mount gate + breakpoint: the breakpoint is unknowable server-side, and
  // toggling an AnimatePresence child mid-hydration orphans it (panel sticks
  // open) — so nothing renders until the client knows the posture.
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(PHONE_MQ)
    setIsMobile(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    setMounted(true)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // The phone has no drawer: its destinations are screens (lib/phone-nav).
  if (!mounted || isMobile) return null

  return (
    <AnimatePresence initial={false}>
      {mcpRailOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: RAIL_WIDTH, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="flex-shrink-0 border-r border-[var(--line)] bg-black/20 overflow-hidden h-full"
        >
          <div className="flex flex-col h-full" style={{ width: RAIL_WIDTH }}>
            {/* Header: the spine carries the tabs (the column at lg+), so the
                drawer just names what it's showing + holds the one collapse
                control. */}
            <div className="flex items-center gap-1 px-3 pt-3 pb-2">
              <span className="flex-1 mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] truncate">
                {railTab === 'mcps'
                  ? 'Your apps'
                  : railTab === 'jobs'
                    ? 'Running work'
                    : railTab === 'links'
                      ? 'Intent links'
                      : railTab === 'team'
                        ? 'Your team'
                        : 'Chat history'}
              </span>
              <button
                className="apprail__toggle flex-shrink-0"
                onClick={() => setMcpRailOpen(false)}
                aria-label="Collapse the drawer"
                title="Collapse"
              >
                <PanelLeftClose width={17} height={17} />
              </button>
            </div>

            {railTab === 'jobs' ? (
              <JobsRailTab />
            ) : railTab === 'links' ? (
              <LinksRailTab />
            ) : railTab === 'team' ? (
              <TeamRailTab />
            ) : railTab === 'mcps' ? (
              <AppsRailTab />
            ) : (
              <ChatsRailTab />
            )}

            {/* (The old pinned Dashboard row is gone on every breakpoint —
                the spine's SETTINGS item is the permanent, labeled way out.) */}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
