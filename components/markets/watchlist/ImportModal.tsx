'use client'

// "Import from TradingView" (MARKETS/WATCH). TradingView exports a watchlist
// as a plain symbol list (`###Section,NASDAQ:AAPL,COINBASE:ETHUSD,…`);
// paste it, every symbol we can chart lights up, the rest are listed as
// "not tradable here yet". Switching cost to zero in one paste
// (BUSINESS-MODEL-chart-first §5.2). The parse is /api/watchlists/import
// (pure, no auth) so a guest previews before keeping anything.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardPaste, X } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import type { WatchlistSection } from '@/lib/watchlists'

interface Parsed {
  tradable: string[]
  notYet: string[]
  sections: WatchlistSection[]
  skipped: string[]
  entries: { symbol: string | null; tradable: boolean; source: string | null }[]
}

export const TV_EXPORT_SAMPLE = '###Stocks,NASDAQ:AAPL,NASDAQ:TSLA,NASDAQ:NVDA,###Crypto,COINBASE:ETHUSD,COINBASE:BTCUSD,HYPERLIQUID:HYPEUSD.P'

export default function ImportModal({
  open,
  onClose,
  listName,
  onAddToList,
  onCreateList,
}: {
  open: boolean
  onClose: () => void
  /** The active list's name (null = no list yet → only "create" is offered). */
  listName: string | null
  onAddToList: (symbols: string[], sections: WatchlistSection[]) => Promise<void> | void
  onCreateList: (name: string, symbols: string[], sections: WatchlistSection[]) => Promise<void> | void
}) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = useMemo(() => (typeof document === 'undefined' ? null : document.body), [])

  if (!open || !body) return null

  const parse = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/watchlists/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      const j = (await res.json()) as Parsed & { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setParsed(j)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tradableSections = (p: Parsed) =>
    p.sections.map((s) => ({ name: s.name, symbols: s.symbols.filter((x) => p.tradable.includes(x)) })).filter((s) => s.symbols.length)

  const close = () => {
    setText('')
    setParsed(null)
    setError(null)
    onClose()
  }

  return createPortal(
    <div className="wl__scrim" onClick={close}>
      <div role="dialog" aria-label="Import from TradingView" className="wl__modal" onClick={(e) => e.stopPropagation()}>
        <div className="wl__modalHead">
          <span className="wl__modalIcon">
            <ClipboardPaste className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="wl__modalTitle">Import a TradingView watchlist</div>
            <div className="wl__modalSub mono">paste the export · what charts here lights up</div>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="wl__x">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="wl__modalBody">
          {!parsed && (
            <>
              <p className="wl__help">
                In TradingView: watchlist menu → <strong>Export list</strong>. Paste the text below. Sections (<code>###Stocks</code>) and
                <code> EXCHANGE:SYMBOL</code> pairs are understood.
              </p>
              <textarea
                className="wl__ta"
                rows={7}
                value={text}
                placeholder={TV_EXPORT_SAMPLE}
                onChange={(e) => setText(e.target.value)}
                aria-label="TradingView export text"
              />
              <div className="wl__row wl__row--end">
                <button type="button" className="wl__btn" onClick={() => setText(TV_EXPORT_SAMPLE)}>
                  Use the sample
                </button>
                <button type="button" className="wl__btn wl__btn--accent" disabled={busy || !text.trim()} onClick={parse}>
                  {busy ? 'Reading…' : 'Read the list'}
                </button>
              </div>
              {error && <p className="wl__err">{error}</p>}
            </>
          )}
          {parsed && (
            <>
              <div className="wl__importGroup">
                <div className="wl__importHead">
                  <span className="wl__importCount wl__importCount--on">{parsed.tradable.length}</span> chart here — added with a Buy chip
                </div>
                <div className="wl__importSyms">
                  {parsed.tradable.map((s) => {
                    const src = parsed.entries.find((e) => e.symbol === s)?.source
                    return (
                      <span key={s} className="wl__pill wl__pill--on">
                        <TokenIcon symbol={s} size={14} {...(src === 'robinhood' ? { chain: 'Robinhood Chain' } : {})} />
                        {s}
                      </span>
                    )
                  })}
                  {parsed.tradable.length === 0 && <span className="wl__muted">nothing we can chart yet</span>}
                </div>
              </div>
              {parsed.notYet.length > 0 && (
                <div className="wl__importGroup">
                  <div className="wl__importHead">
                    <span className="wl__importCount">{parsed.notYet.length}</span> not tradable here yet
                  </div>
                  <div className="wl__importSyms">
                    {parsed.notYet.map((s) => (
                      <span key={s} className="wl__pill">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {parsed.skipped.length > 0 && (
                <p className="wl__muted mono">skipped: {parsed.skipped.slice(0, 8).join(', ')}{parsed.skipped.length > 8 ? '…' : ''}</p>
              )}
              {parsed.sections.length > 0 && (
                <p className="wl__muted mono">sections kept: {parsed.sections.map((s) => s.name).join(' · ')}</p>
              )}
              <div className="wl__row wl__row--end">
                <button type="button" className="wl__btn" onClick={() => setParsed(null)}>
                  Back
                </button>
                {listName && (
                  <button
                    type="button"
                    className="wl__btn"
                    disabled={busy || parsed.tradable.length === 0}
                    onClick={async () => {
                      setBusy(true)
                      await onAddToList(parsed.tradable, tradableSections(parsed))
                      setBusy(false)
                      close()
                    }}
                  >
                    Add {parsed.tradable.length} to “{listName}”
                  </button>
                )}
                <button
                  type="button"
                  className="wl__btn wl__btn--accent"
                  disabled={busy || parsed.tradable.length === 0}
                  onClick={async () => {
                    setBusy(true)
                    await onCreateList('From TradingView', parsed.tradable, tradableSections(parsed))
                    setBusy(false)
                    close()
                  }}
                >
                  New list from import
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    body,
  )
}
