'use client'

import { Terminal, X, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore, type RouterTraceEvent } from '@/lib/store'
import RouteTraceTerminal from '@/components/RouteTraceTerminal'

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

      <RouteTraceTerminal trace={trace} className="flex-1" />
    </div>
  )
}
