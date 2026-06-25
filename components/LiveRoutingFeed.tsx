'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, Radio, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RouterTraceEvent } from '@/lib/store'
import RouteTraceTerminal from '@/components/RouteTraceTerminal'

/**
 * The public, realtime routing feed on the Activity page: every routed turn's
 * network calls (left) beside the routing engine's live reasoning terminal
 * (right). Polls /api/activity/live with a cursor; because local dev and prod
 * share one Neon DB, turns generated anywhere — including a local test run —
 * stream here. The terminal itself is the SAME component the chat engine window
 * uses (RouteTraceTerminal), so the two stay in lockstep.
 */

const POLL_MS = 1500
const MAX_TURNS = 15
const MAX_CALLS = 60

interface ApiLine {
  n: number
  turnId: string
  seq: number
  type: string
  event: RouterTraceEvent
  txHash: string | null
  payer: string | null
  createdAt: string
}

interface Turn {
  turnId: string
  payer: string | null
  firstN: number
  lastAt: string
  lines: RouterTraceEvent[]
}

interface Call {
  key: string
  service: string
  priceUsd?: string
  txHash: string | null
  ok: boolean
  note?: string
  at: string
}

export default function LiveRoutingFeed() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [live, setLive] = useState(false)
  const cursorRef = useRef<number | undefined>(undefined)
  const turnsRef = useRef<Map<string, Turn>>(new Map())

  const ingest = useCallback((lines: ApiLine[]) => {
    if (lines.length === 0) return
    const m = turnsRef.current
    const newCalls: Call[] = []
    for (const ln of lines) {
      const t = m.get(ln.turnId) ?? { turnId: ln.turnId, payer: ln.payer, firstN: ln.n, lastAt: ln.createdAt, lines: [] }
      t.lines.push(ln.event)
      t.lastAt = ln.createdAt
      m.set(ln.turnId, t)
      // A "network call" = a settle attempt (settled or failed).
      if (ln.type === 'receipt' && ln.event.type === 'receipt') {
        const r = ln.event.receipt
        newCalls.push({ key: `${ln.n}`, service: r.name, priceUsd: r.priceUsd, txHash: ln.txHash, ok: r.ok, note: r.note, at: ln.createdAt })
      }
    }
    // Newest turns first, capped.
    const ordered = [...m.values()].sort((a, b) => b.firstN - a.firstN).slice(0, MAX_TURNS)
    turnsRef.current = new Map(ordered.map((t) => [t.turnId, t]))
    setTurns(ordered)
    if (newCalls.length) setCalls((prev) => [...newCalls.reverse(), ...prev].slice(0, MAX_CALLS))
  }, [])

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const url = cursorRef.current === undefined ? '/api/activity/live' : `/api/activity/live?since=${cursorRef.current}`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as { lines: ApiLine[]; cursor: number }
          ingest(data.lines)
          cursorRef.current = data.cursor
          setLive(true)
        }
      } catch {
        setLive(false)
      }
      if (!stop) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [ingest])

  const activeTurn = turns[0]
  const settledCalls = calls.filter((c) => c.ok)
  const totalSpent = settledCalls.reduce((s, c) => s + (Number(c.priceUsd) || 0), 0)

  return (
    <section className="mt-10 mb-12">
      <div className="flex items-center gap-2 mb-3">
        <Radio className="w-4 h-4" style={{ color: live ? 'var(--accent)' : 'var(--muted)' }} />
        <h2 className="text-sm font-medium text-white mono uppercase tracking-wide">Live routing</h2>
        <span
          className={cn('w-1.5 h-1.5 rounded-full', live && 'animate-pulse')}
          style={{ background: live ? 'var(--accent)' : 'var(--muted-2)' }}
        />
        <span className="text-[11px] text-[color:var(--muted-2)] mono ml-1">
          {live ? 'streaming' : 'connecting…'}
        </span>
        <span className="ml-auto text-[11px] text-[color:var(--muted-2)] mono">
          {settledCalls.length} call{settledCalls.length === 1 ? '' : 's'} · ${totalSpent.toFixed(3)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 min-w-0">
        {/* Left: the rolling list of network calls, newest first. */}
        <div className="rounded-xl border border-[var(--line)] bg-black/40 overflow-hidden min-w-0">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-[var(--line)]">
            <span className="text-[11px] font-medium text-white mono uppercase tracking-wide">Network calls</span>
          </div>
          <div className="h-[420px] overflow-y-auto divide-y divide-[var(--line)]">
            {calls.length === 0 ? (
              <p className="px-3 py-6 text-[12px] text-[color:var(--muted-2)] mono">
                Waiting for the next paid call…
              </p>
            ) : (
              calls.map((c) => (
                <div key={c.key} className="flex items-center gap-2 px-3 py-2 text-[12px] min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: c.ok ? 'var(--accent)' : '#ff6b6b' }}
                  />
                  <span className="text-white truncate">{c.service}</span>
                  {!c.ok && c.note ? <span className="text-[#ff6b6b] truncate text-[11px]">— {c.note}</span> : null}
                  <span className="ml-auto flex items-center gap-2 flex-shrink-0 text-[color:var(--muted)] mono text-[11px]">
                    {c.priceUsd ? <span>${c.priceUsd}</span> : null}
                    {c.txHash ? (
                      <a
                        href={`https://basescan.org/tx/${c.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 hover:text-white"
                        title="View on BaseScan"
                      >
                        {c.txHash.slice(0, 8)}… <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                    <span className="text-[color:var(--muted-2)]">{relTime(c.at)}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: the routing engine terminal — the latest turn, streaming. */}
        <div className="rounded-xl border border-[var(--line)] bg-black/60 overflow-hidden flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-[var(--line)] bg-black/40">
            <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span className="text-[11px] font-medium text-white mono uppercase tracking-wide">Routing Engine</span>
            {activeTurn?.payer ? (
              <span className="text-[10px] text-[color:var(--muted-2)] mono">· {activeTurn.payer}</span>
            ) : null}
          </div>
          <RouteTraceTerminal
            trace={activeTurn?.lines ?? []}
            className="h-[420px]"
            emptyHint={
              <>
                <span style={{ color: 'var(--accent)' }}>$</span> idle — the engine&apos;s routing decisions stream
                here as agents pay across the network.
              </>
            }
          />
        </div>
      </div>
    </section>
  )
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
