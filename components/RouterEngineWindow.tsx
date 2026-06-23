'use client'

import { useEffect, useRef } from 'react'
import { Terminal, X, PanelRightOpen, CircleDollarSign, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore, type RouterTraceEvent } from '@/lib/store'

/**
 * The Auto-Router engine window — a terminal-style panel that renders the
 * routing engine's live reasoning trace (lib/store routerTrace, fed by the SSE
 * stream in ChatInterface.runAutoRouter). Shows the engine analyze the question,
 * shortlist MCPs, score/select an endpoint, pay, and settle — line by line, in
 * real time. Toggle open/closed at will; only present when Auto Router is on.
 */
export default function RouterEngineWindow() {
  const { autoRouter, routerTrace, engineWindowOpen, setEngineWindowOpen } = useYeetfulStore()

  if (!autoRouter) return null

  const close = () => setEngineWindowOpen(false)

  return (
    <>
      {/* Desktop: an inline column — a thin rail when closed, the panel when open. */}
      <aside
        className={cn(
          'hidden lg:flex flex-col flex-shrink-0 border-l border-[var(--line)] bg-black/60 transition-[width] duration-200',
          engineWindowOpen ? 'w-[340px]' : 'w-11',
        )}
      >
        {engineWindowOpen ? (
          <EnginePanel trace={routerTrace} onClose={close} />
        ) : (
          <button
            onClick={() => setEngineWindowOpen(true)}
            title="Show the routing engine"
            className="flex-1 flex flex-col items-center gap-3 pt-3 text-[color:var(--muted)] hover:text-white transition-colors"
          >
            <PanelRightOpen className="w-4 h-4" />
            <span className="text-[10px] tracking-widest [writing-mode:vertical-rl] rotate-180 mono uppercase">
              Engine
            </span>
            {routerTrace.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
            )}
          </button>
        )}
      </aside>

      {/* Mobile: a right-hand drawer overlay when open (no rail eating width). */}
      {engineWindowOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={close} aria-hidden />
          <div className="w-[86vw] max-w-[360px] bg-[var(--bg)] border-l border-[var(--line)] flex flex-col">
            <EnginePanel trace={routerTrace} onClose={close} />
          </div>
        </div>
      )}
    </>
  )
}

function EnginePanel({ trace, onClose }: { trace: RouterTraceEvent[]; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [trace.length])

  // Running tally for the header (settled calls + spend so far this turn).
  const settled = trace.filter((e) => e.type === 'receipt' && e.receipt.ok)
  const spent = settled.reduce((sum, e) => sum + (Number((e as Extract<RouterTraceEvent, { type: 'receipt' }>).receipt.priceUsd) || 0), 0)

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 h-12 border-b border-[var(--line)] bg-black/40">
        <Terminal className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-medium text-white mono uppercase tracking-wide">Routing Engine</span>
        <span className="ml-auto text-[10px] text-[color:var(--muted-2)] mono whitespace-nowrap">
          {settled.length} call{settled.length === 1 ? '' : 's'} · ${spent.toFixed(3)}
        </span>
        <button
          onClick={onClose}
          aria-label="Close engine window"
          className="flex-shrink-0 w-7 h-7 grid place-items-center rounded-md text-[color:var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto px-3 py-3 mono text-[11px] leading-relaxed">
        {trace.length === 0 ? (
          <p className="text-[color:var(--muted-2)]">
            <span style={{ color: 'var(--accent)' }}>$</span> idle — send a message and the engine&apos;s routing
            decisions stream here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {trace.map((e, i) => (
              <TraceLine key={i} event={e} />
            ))}
            <span className="inline-block w-1.5 h-3 align-middle animate-pulse" style={{ background: 'var(--accent)' }} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Shorten a URL to host + a trimmed path for the dense terminal rows. */
function shortEndpoint(url?: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    const path = u.pathname.length > 22 ? u.pathname.slice(0, 21) + '…' : u.pathname
    return u.host + (path === '/' ? '' : path)
  } catch {
    return url
  }
}

function TraceLine({ event }: { event: RouterTraceEvent }) {
  switch (event.type) {
    case 'status':
      return (
        <p className="text-[color:var(--muted)]">
          <span className="text-[color:var(--muted-2)]">▸</span> {event.label}
        </p>
      )
    case 'analyze':
      return (
        <div className="text-[color:var(--fg)]">
          <p>
            <span style={{ color: 'var(--accent)' }}>◆ intent</span> {event.intent}
          </p>
          {event.needs.length > 0 && (
            <ul className="mt-0.5 pl-3 text-[color:var(--muted)]">
              {event.needs.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'candidate':
      return (
        <p className="text-[color:var(--muted)] [overflow-wrap:anywhere]">
          <span className="text-[color:var(--muted-2)]">·</span> {event.service}
          {event.endpoint ? <span className="text-[color:var(--muted-2)]"> {shortEndpoint(event.endpoint)}</span> : null}
          {event.priceUsd ? <span className="text-[color:var(--muted-2)]"> ${event.priceUsd}</span> : null}
          {event.proven && event.proven > 0 ? (
            <span style={{ color: 'var(--accent)' }}> ✓proven({event.proven})</span>
          ) : null}
          <span className="text-[color:var(--muted-2)]"> ({Math.round(event.score * 100)}%)</span>
          {event.reason ? ` — ${event.reason}` : ''}
        </p>
      )
    case 'select':
      return (
        <p className="text-white [overflow-wrap:anywhere]">
          <span style={{ color: 'var(--accent)' }}>✓ selected</span> {event.service}
          {event.endpoint ? <span className="text-[color:var(--muted)]"> {shortEndpoint(event.endpoint)}</span> : null}
          {event.priceUsd ? <span className="text-[color:var(--muted)]"> ${event.priceUsd}</span> : null}
          {event.reason ? <span className="text-[color:var(--muted)]"> — {event.reason}</span> : null}
        </p>
      )
    case 'pay':
      return (
        <p className="text-[color:var(--muted)]">
          <CircleDollarSign className="inline w-3 h-3 -mt-0.5 mr-0.5" /> paying {event.service}{' '}
          <span className="text-[color:var(--muted-2)]">({event.host})</span> ${event.priceUsd}…
        </p>
      )
    case 'receipt': {
      const r = event.receipt
      if (r.ok) {
        return (
          <p className="[overflow-wrap:anywhere]" style={{ color: 'var(--accent)' }}>
            <Check className="inline w-3 h-3 -mt-0.5 mr-0.5" strokeWidth={3} /> settled {r.name} ${r.priceUsd ?? ''}
            {r.txHash ? <span className="text-[color:var(--muted)]"> · {r.txHash.slice(0, 10)}…</span> : null}
          </p>
        )
      }
      return (
        <p className="text-[#ff6b6b] [overflow-wrap:anywhere]">
          ✗ {r.name} — {r.note ?? 'failed'}
        </p>
      )
    }
    case 'note':
      return (
        <p
          className="[overflow-wrap:anywhere]"
          style={{ color: event.level === 'warn' ? '#f4b740' : 'var(--muted-2)' }}
        >
          <span>{event.level === 'warn' ? '⚠' : 'ℹ'}</span> {event.label}
        </p>
      )
    case 'error':
      return <p className="text-[#ff6b6b] [overflow-wrap:anywhere]">✗ error — {event.message}</p>
    default:
      return null
  }
}
