'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, Clock, Vote } from 'lucide-react'
import VoteChoiceButtons from '@/components/VoteChoiceButtons'
import type { ProposalsTile } from '@/lib/splash/types'
import { postPanelTelemetry } from '@/lib/panel-telemetry'

/**
 * App Mode governance panel: open proposals with INLINE voting. Each row
 * expands into the standard VoteChoiceButtons — the same EIP-712 build →
 * wallet signature → /api/snapshot/relay path chat uses (the relay re-guards
 * server-side). The panel adds zero new signing surface.
 */
export default function GovernancePanel({ tile }: { tile: ProposalsTile }) {
  const [open, setOpen] = useState<string | null>(null)
  const reduced = useReducedMotion()

  return (
    <div className="flex-1">
      {tile.spaces.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {tile.spaces.slice(0, 6).map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full bg-white/5 py-0.5 pl-0.5 pr-2">
              <Avatar url={s.avatarUrl} label={s.name} size={16} />
              <span className="text-[10px] text-[color:var(--muted)]">{s.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {tile.proposals.slice(0, 6).map((p) => {
          const expanded = open === p.id
          return (
            <div key={p.id} className={expanded ? 'rounded-xl border border-[var(--line)] bg-white/[0.02] p-2' : undefined}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : p.id)}
                aria-expanded={expanded}
                className="group -mx-1 flex w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-white/5"
              >
                <Avatar url={p.avatarUrl} label={p.spaceName} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-white" title={p.title}>
                    {p.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[color:var(--muted-2)]">
                    <span className="flex items-center gap-1">
                      <Vote className="h-3 w-3" /> {p.spaceName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {endsIn(p.endsAt)}
                    </span>
                    {p.leadingChoice && <span className="text-[color:var(--accent)]">{p.leadingChoice} leading</span>}
                  </div>
                </div>
                <ChevronDown
                  className={`mt-1 h-3.5 w-3.5 flex-shrink-0 text-[color:var(--muted-2)] transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-1 px-1 pb-1"
                >
                  <VoteChoiceButtons
                    proposal={{
                      id: p.id,
                      title: p.title,
                      space: p.spaceId,
                      // Rows cached before `type` shipped default to single-choice
                      // (the encoding Snapshot uses for basic proposals too).
                      type: p.type ?? 'single-choice',
                      choices: p.choices,
                    }}
                    onSigned={() =>
                      postPanelTelemetry({ outcome: 'signed', artifact: 'vote', buildPath: 'app-mode-vote' })
                    }
                  />
                </motion.div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Avatar({ url, label, size }: { url: string; label: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-semibold text-[color:var(--muted)]"
        style={{ height: size, width: size }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={label}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ height: size, width: size }}
    />
  )
}

function endsIn(unixSec: number): string {
  const ms = unixSec * 1000 - Date.now()
  if (ms <= 0) return 'ended'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m left`
  if (h < 48) return `${h}h left`
  return `${Math.floor(h / 24)}d left`
}
