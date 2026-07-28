'use client'

// The live chart view behind every token chart button. Clicking a token
// anywhere in chat opens this overlay OVER the conversation (the
// JobDetailOverlay pattern — no navigation away, context intact): live
// candles, timeframes, and act-on-it chips that PREFILL the composer and
// close — the user always sends and signs themselves. The same CandleChart
// powers the shareable /t/<symbol> page, linked from the header.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ExternalLink, X } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import { chartPairFor } from '@/lib/charts'
import CandleChart, { fmtPrice, type ChartStats } from '@/components/CandleChart'
import TokenIcon from '@/components/TokenIcon'

export default function ChartOverlay() {
  const { chartDetail, setChartDetail, setComposerPrefill } = useYeetfulStore()
  const [stats, setStats] = useState<ChartStats | null>(null)

  const close = useCallback(() => setChartDetail(null), [setChartDetail])

  // An action chip lands in the composer — never auto-sends.
  const prefill = (prompt: string) => {
    setComposerPrefill(prompt)
    close()
  }

  // Fresh header numbers per open — a previous token's price never flashes
  // under a new symbol.
  useEffect(() => {
    setStats(null)
  }, [chartDetail])

  // Esc closes.
  useEffect(() => {
    if (!chartDetail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chartDetail, close])

  if (typeof document === 'undefined') return null

  const pair = chartDetail ? chartPairFor(chartDetail.symbol) : null
  const chg = stats?.changePct24h ?? null
  const chgClass = chg === null ? 'tok__chg--flat' : chg > 0 ? 'tok__chg--up' : chg < 0 ? 'tok__chg--down' : 'tok__chg--flat'
  const chgLabel = chg === null ? '24h —' : `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% 24h`

  // Entrance ONLY — an exit animation strands the invisible backdrop over the
  // whole page when rAF starves (busy real tabs, not just headless: the App
  // Mode ghost-panel lesson), and a stranded backdrop eats every click. Close
  // is instant unmount.
  return createPortal(
    <>
      {chartDetail && pair && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${pair.label} live chart`}
            className="jobdetail__panel w-full max-w-2xl rounded-2xl border border-[var(--line-2)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 pb-2.5 pt-3.5">
              <TokenIcon symbol={pair.symbol} size={24} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{pair.label}</span>
                  <span className="mono text-[9.5px] uppercase tracking-wider text-[color:var(--muted-2)]">{pair.source}</span>
                </div>
              </div>
              {stats?.last != null && (
                <div className="mr-1 text-right">
                  <span className="mono text-[15px] font-semibold tabular-nums">${fmtPrice(stats.last)}</span>
                  <span className={`tok__chg ml-2 !text-[11px] ${chgClass}`}>{chgLabel}</span>
                </div>
              )}
              <a
                href={`/t/${pair.symbol}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the full chart page"
                title="Open the full chart page"
                className="grid h-7 w-7 place-items-center rounded-lg text-[color:var(--muted)] transition-colors hover:bg-[var(--surf-1)] hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={close}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-lg text-[color:var(--muted)] transition-colors hover:bg-[var(--surf-1)] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3">
              <CandleChart symbol={pair.symbol} height={340} onStats={setStats} />

              {/* act on it — the composer-prefill contract */}
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2.5">
                <button
                  onClick={() => prefill(`Buy $50 of ${pair.symbol}`)}
                  className="rounded-lg border border-[var(--line-2)] px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--accent)] transition-colors hover:bg-white/[0.04]"
                >
                  Buy {pair.symbol}
                </button>
                <button
                  onClick={() => prefill(`Sell $50 of ${pair.symbol}`)}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[color:var(--muted)] transition-colors hover:text-white"
                >
                  Sell {pair.symbol}
                </button>
                <button
                  onClick={() => prefill(`DCA $10 into ${pair.symbol} weekly`)}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[color:var(--muted)] transition-colors hover:text-white"
                >
                  DCA weekly
                </button>
                <span className="mono ml-auto text-[9.5px] uppercase tracking-widest text-[color:var(--muted-2)]">
                  fills the composer · you send it
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </>,
    document.body,
  )
}
