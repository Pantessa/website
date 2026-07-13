'use client'

// The chat chain picker — makes one chain first-class for the session:
// splash cards re-scan scoped to it, and swap asks build on it (the wallet
// is switched to the chain when the user signs). Default = all supported
// chains. Options come from the app chain registry (lib/chains); marks from
// components/chain-marks.
//
// Compact dropdown chip so it lives in the chat toolbar next to the MCPS
// button — reachable mid-conversation, not just on the splash.

import { useEffect, useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { APP_CHAINS, chainById } from '@/lib/chains'
import { getChainMark } from '@/components/chain-marks'
import { useYeetfulStore } from '@/lib/store'

export default function ChainPicker() {
  const selectedChainId = useYeetfulStore((s) => s.selectedChainId)
  const setSelectedChainId = useYeetfulStore((s) => s.setSelectedChainId)
  const { isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape — same lightweight idiom as the other
  // toolbar popovers.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = chainById(selectedChainId)
  const SelectedMark = selected ? getChainMark(selected.key) : null

  const pick = (id: number | null) => {
    setSelectedChainId(id)
    setOpen(false)
    // Make the selection first-class immediately: nudge the connected wallet
    // onto the chain (best-effort — SendTxButton re-switches at sign time, so
    // a refusal here costs nothing).
    if (id && isConnected) void switchChainAsync({ chainId: id }).catch(() => {})
  }

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Chain: ${selected.name}` : 'Chain: all supported chains'}
        title={selected ? `Cards and swaps scoped to ${selected.name}` : 'Pick a chain to scope cards and swaps'}
        className={
          'flex items-center gap-1.5 px-2.5 min-h-[40px] md:min-h-[32px] rounded-lg border transition-colors ' +
          (selected
            ? 'bg-[var(--surf-2)] border-white/30 text-white'
            : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]')
        }
      >
        {SelectedMark ? <SelectedMark size={16} /> : <Globe className="w-4 h-4" />}
        <span className="text-[11px] whitespace-nowrap font-medium mono hidden sm:inline">
          {selected ? selected.short.toUpperCase() : 'ALL CHAINS'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-24px)] z-20 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] shadow-xl shadow-black/40 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[var(--line)] text-[10px] uppercase tracking-wider mono text-[color:var(--muted-2)]">
            Chain — cards &amp; swaps
          </div>
          <button
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white transition-colors hover:bg-[var(--surf-2)]"
          >
            <Globe className="w-[18px] h-[18px] text-[color:var(--muted-2)]" />
            <span className="flex-1">All supported chains</span>
            {!selected && <Check className="w-3.5 h-3.5 text-[color:var(--accent)]" />}
          </button>
          {APP_CHAINS.map((c) => {
            const Mark = getChainMark(c.key)
            const active = selected?.id === c.id
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(c.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white transition-colors hover:bg-[var(--surf-2)]"
              >
                {Mark ? <Mark size={18} /> : <span className="w-[18px] h-[18px] rounded-full" style={{ background: c.color }} />}
                <span className="flex-1">{c.name}</span>
                {active && <Check className="w-3.5 h-3.5 text-[color:var(--accent)]" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
