'use client'

// The ⓘ beside "Verified on-chain": a small popover with the author's
// verified trades on this symbol (each placed before or after the stamp) and
// how the stamp is read. Kept out of the page so the chart, the ticket and
// the replies are what a visitor sees first.

import { useEffect, useState } from 'react'
import { ExternalLink, Info, ShieldCheck, X } from 'lucide-react'
import type { FillMarker } from '@/lib/chart-fills'
import { fillTiming, fillWords } from '@/lib/chart-calls'

export default function CallInfo({ symbol, fills, callT, heldAtCall }: { symbol: string; fills: FillMarker[]; callT: number; heldAtCall: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button type="button" className={`callpg__verified${fills.length ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} title="What the chain confirms, and how the stamp is read">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        <span>{heldAtCall ? 'Position verified on-chain' : fills.length ? `${fills.length} verified trade${fills.length === 1 ? '' : 's'}` : 'No verified trade yet'}</span>
        <Info className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </button>
      {open && (
        <div className="mkt-share" role="dialog" aria-modal="true" aria-label="Verified on-chain" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="mkt-share__card callinfo">
            <div className="mkt-share__head">
              <span className="mono mkt-share__eyebrow mkt-share__eyebrow--done">
                <ShieldCheck className="h-3 w-3" aria-hidden /> Verified on-chain
              </span>
              <button type="button" className="mkt-pop__x" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {fills.length === 0 ? (
              <p className="callpg__muted">No verified trade on {symbol} from this wallet yet. A trade made through Pantessa appears here once the chain confirms the transaction — nobody can type one in.</p>
            ) : (
              <ul className="callinfo__fills">
                {fills.map((f) => {
                  const timing = fillTiming(f.t, callT)
                  return (
                    <li key={f.id} className={timing.when === 'before' ? 'is-before' : undefined}>
                      <span className={f.side === 'buy' ? 'callpg__up' : 'callpg__down'}>{f.side === 'buy' ? '▲' : '▼'}</span>
                      <span className="callpg__fill">{fillWords(f, symbol)}</span>
                      <span className="callpg__timing mono">{timing.words}</span>
                      {f.txUrl && (
                        <a href={f.txUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label="View the transaction on the block explorer">
                          tx <ExternalLink className="inline h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <dl className="callinfo__how">
              <div>
                <dt className="mono">The time</dt>
                <dd>The moment our server stored the post. Never a clock the author set.</dd>
              </div>
              <div>
                <dt className="mono">The price</dt>
                <dd>Our own tape: the close of the last bar that had fully closed before the post. Never a number the author typed, never a bar still open.</dd>
              </div>
              <div>
                <dt className="mono">The lines</dt>
                <dd>What was drawn when the post was made. There is no edit.</dd>
              </div>
              <div>
                <dt className="mono">The trades</dt>
                <dd>Only transactions the chain confirmed — sender, target and receipt — from the author&apos;s wallet, on this symbol.</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </>
  )
}
