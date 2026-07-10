'use client'

// The per-MCP action window: opens when an MCP is clicked in the rail and
// shows what the CONNECTED ACCOUNT can do with it right now — the same
// wallet-aware tiles as the splash dashboard (portfolio, open proposals,
// positions, orders), scoped to one MCP, plus its suggested prompts.
//
// No wallet → the MCP's example prompts + a "connect to personalize" hint,
// so the window always answers "what can I do here". Closes on X, Escape, or
// the moment the user starts typing (ChatInterface clears mcpActionSlug).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight, Wallet, X } from 'lucide-react'
import type { McpServer } from '@/lib/store'
import type { SplashTile } from '@/lib/splash/types'
import { splashCapable } from '@/lib/splash/types'
import { TileCard, SkeletonTiles } from '@/components/SplashDashboard'
import BrandIcon from '@/components/BrandIcon'

export default function McpActionPanel({
  server,
  address,
  onPick,
  onClose,
}: {
  server: McpServer
  address?: string
  /** Drops a prompt into the chat input (and keeps the MCP in the set). */
  onPick: (prompt: string, slug?: string) => void
  onClose: () => void
}) {
  const [tiles, setTiles] = useState<SplashTile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)

  const personal = !!address && splashCapable(server)

  useEffect(() => {
    if (!personal) {
      setTiles(null)
      return
    }
    let alive = true
    setLoading(true)
    setTiles(null)
    fetch('/api/splash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, servers: [server] }),
    })
      .then((r) => r.json())
      .then((data: { tiles?: SplashTile[] }) => {
        if (alive) setTiles(Array.isArray(data.tiles) ? data.tiles : [])
      })
      .catch(() => {
        if (alive) setTiles([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, server.id, reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const examples = (server.exampleQueries ?? []).slice(0, 4)

  return (
    <AnimatePresence>
      <motion.div
        key={server.id}
        initial={{ opacity: 0, x: -12, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: -8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="absolute left-3 top-16 z-30 w-[400px] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-9rem)] overflow-y-auto rounded-2xl border border-[var(--line-2)] bg-[#0d0d0f]/95 backdrop-blur-md shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        role="dialog"
        aria-label={`${server.name} actions`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-[var(--line)] bg-[#0d0d0f]/95 backdrop-blur-md">
          <span className="w-7 h-7 grid place-items-center rounded-lg bg-black/40 border border-[var(--line)]">
            <BrandIcon server={server} size={16} />
          </span>
          <div className="flex-1 min-w-0">
            {/* The name IS the way in — server page (tools, pricing, reputation)
                in a new tab so the chat stays put. */}
            <Link
              href={`/servers/${server.slug}`}
              target="_blank"
              title={`${server.name} — server details`}
              className="group/link inline-flex items-center gap-1 max-w-full text-sm font-semibold text-white"
            >
              <span className="truncate underline-offset-4 decoration-[color:var(--muted-2)] group-hover/link:underline">
                {server.name}
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)] opacity-0 group-hover/link:opacity-100 transition-opacity" />
            </Link>
            <div className="mono text-[10px] text-[color:var(--muted-2)]">
              {server.gated === false ? <span style={{ color: 'var(--accent)' }}>FREE</span> : `$${server.priceUsd}/call`}
              {' · in your set'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {personal ? (
            loading || tiles === null ? (
              <SkeletonTiles count={1} />
            ) : tiles.length > 0 ? (
              <TileCard tiles={tiles} onPick={onPick} onRetry={() => setReload((n) => n + 1)} />
            ) : (
              <Fallback server={server} examples={examples} onPick={onPick} />
            )
          ) : (
            <>
              {!address && (
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[color:var(--muted)]">
                  <Wallet className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[color:var(--muted-2)]" />
                  Connect your wallet and this window shows your own portfolio, orders, and
                  proposals here — not just examples.
                </p>
              )}
              <Fallback server={server} examples={examples} onPick={onPick} />
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

/** What this MCP can do, prompt-first — for guests, non-splash MCPs, and
 *  scan failures. Every chip drops a ready ask into the input. */
function Fallback({
  server,
  examples,
  onPick,
}: {
  server: McpServer
  examples: string[]
  onPick: (prompt: string, slug?: string) => void
}) {
  return (
    <div>
      <p className="text-xs leading-relaxed text-[color:var(--muted)] line-clamp-3">{server.description}</p>
      {examples.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q, server.slug)}
              className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
