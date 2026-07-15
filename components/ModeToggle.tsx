'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { LayoutGrid, MessageSquare } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import { panelCapable } from '@/lib/panels/types'
import { cn } from '@/lib/utils'

/**
 * Chat ↔ App segmented toggle (the chat toolbar, next to the chain picker).
 * Renders only when the working set can host at least one App Mode panel —
 * a set of pure data MCPs has no workspace to show, so the toggle would be a
 * dead control. The active pill slides between segments (shared layout), the
 * one piece of motion this control owns.
 */
export default function ModeToggle() {
  const { workspaceMode, setWorkspaceMode, servers, activeServerIds } = useYeetfulStore()
  const reduced = useReducedMotion()
  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))
  if (!panelCapable(activeServers)) return null

  const segments = [
    { mode: 'chat' as const, label: 'Chat', Icon: MessageSquare },
    { mode: 'app' as const, label: 'App', Icon: LayoutGrid },
  ]
  return (
    <div
      role="tablist"
      aria-label="Workspace mode"
      className="flex-shrink-0 flex items-center rounded-lg border border-[var(--line)] bg-[var(--surf-1)] p-0.5"
    >
      {segments.map(({ mode, label, Icon }) => {
        const active = workspaceMode === mode
        return (
          <button
            key={mode}
            role="tab"
            aria-selected={active}
            onClick={() => setWorkspaceMode(mode)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-md px-2.5 min-h-[32px] md:min-h-[26px] text-[11px] font-medium mono transition-colors',
              active ? 'text-white' : 'text-[color:var(--muted)] hover:text-white',
            )}
          >
            {active && (
              <motion.span
                layoutId="workspace-mode-pill"
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
                className="absolute inset-0 rounded-md bg-[var(--surf-2)] border border-white/20"
                aria-hidden
              />
            )}
            <Icon className="relative z-10 w-3.5 h-3.5" />
            <span className="relative z-10 whitespace-nowrap">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
