'use client'

// The /t/<symbol> page body — a full-bleed chart workspace, not an article.
// The chart fills the viewport under the nav, and "expand" is the same markup
// with one class plus the Fullscreen API, so leaving fullscreen lands back on
// the full-bleed layout with nothing to re-lay-out.
//
// Trade actions ride the price in the top bar rather than sitting under the
// chart: at full width a bottom row strands them a screen away from the number
// that motivates them, and the bar never scrolls. Left to right the bar reads
// what it is → what it costs → what you can do.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Maximize2, Minimize2 } from 'lucide-react'
import CandleChart, { fmtPrice, type ChartStats } from '@/components/CandleChart'
import TokenIcon from '@/components/TokenIcon'
import { chartPairFor } from '@/lib/charts'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

type FsDoc = Document & { webkitExitFullscreen?: () => Promise<void>; webkitFullscreenElement?: Element | null }
type FsEl = HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }

export default function TokenPageView({ symbol }: { symbol: string }) {
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const [stats, setStats] = useState<ChartStats | null>(null)
  const [expanded, setExpanded] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)

  const chg = stats?.changePct24h ?? null
  const chgClass = chg === null ? 'tok__chg--flat' : chg > 0 ? 'tok__chg--up' : chg < 0 ? 'tok__chg--down' : 'tok__chg--flat'
  const chgLabel = chg === null ? '24h —' : `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% 24h`
  const sym = pair?.symbol ?? symbol

  // The CSS takeover carries the mode on its own; native fullscreen is a
  // best-effort upgrade on top (iOS Safari refuses element fullscreen, and a
  // button that silently does nothing there would read as broken).
  const toggleExpand = useCallback(() => {
    const el = shellRef.current as FsEl | null
    const doc = document as FsDoc
    if (expanded) {
      setExpanded(false)
      if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
        void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => {})
      }
      return
    }
    setExpanded(true)
    if (el) void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch(() => {})
  }, [expanded])

  // Esc (native fullscreen or the CSS-only takeover) must leave BOTH states —
  // otherwise the browser drops fullscreen and the page keeps a fixed overlay.
  useEffect(() => {
    const doc = document as FsDoc
    const onFsChange = () => {
      if (!(doc.fullscreenElement ?? doc.webkitFullscreenElement)) setExpanded(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const expandButton = (
    <button
      type="button"
      onClick={toggleExpand}
      className="tchart__fs"
      aria-pressed={expanded}
      aria-label={expanded ? 'Exit full screen' : 'Full screen chart'}
      title={expanded ? 'Exit full screen (Esc)' : 'Full screen chart'}
    >
      {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
    </button>
  )

  return (
    <div ref={shellRef} className={expanded ? 'tchart tchart--expanded' : 'tchart'}>
      {/* Top bar: identity → quote → act. Never scrolls, survives expand. */}
      <div className="tchart__bar">
        <div className="tchart__id">
          <TokenIcon symbol={sym} size={26} />
          <div className="min-w-0">
            <h1 className="tchart__pair truncate">{pair ? pair.label : sym || 'Token'}</h1>
            <p className="tchart__src mono">{pair ? `Live chart · ${pair.source}` : 'No live chart yet'}</p>
          </div>
        </div>

        {pair && stats?.last != null && (
          <div className="tchart__quote">
            <span className="tchart__last">${fmtPrice(stats.last)}</span>
            <span className={`tok__chg ${chgClass}`}>{chgLabel}</span>
          </div>
        )}

        {sym && (
          <div className="tchart__acts">
            <Link href={promptHref(`Buy $50 of ${sym}`)} className="tchart__act tchart__act--buy">
              Buy {sym}
            </Link>
            <Link href={promptHref(`Sell $50 of ${sym}`)} className="tchart__act">
              Sell {sym}
            </Link>
            <Link href={promptHref(`DCA $10 into ${sym} weekly`)} className="tchart__act">
              DCA weekly
            </Link>
            <span className="tchart__hint mono">prefills chat · you send it</span>
          </div>
        )}
      </div>

      {/* Canvas: the chart takes every pixel that's left. */}
      <div className="tchart__canvas">
        {pair ? (
          <CandleChart symbol={sym} height="fill" onStats={setStats} controlsRight={expandButton} resizeKey={expanded} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-md rounded-2xl border border-[var(--line)] px-5 py-10 text-center">
              <p className="text-[14px] text-[color:var(--fg)]">No live chart for {sym || 'this token'} yet.</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--muted)]">
                Stablecoins chart flat by design, and tokenized stocks get their candle feed next.
                You can still act on it in chat — one sentence, guarded, signed only by your wallet.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
