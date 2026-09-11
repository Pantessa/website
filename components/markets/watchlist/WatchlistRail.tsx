'use client'

// The watchlist rail (MARKETS/WATCH) — the TradingView-shaped column beside
// the chart: list picker (unlimited lists), collapsible sections, rows of
// mark · symbol · last · chg%, a ⋯ menu per row (remove, move to section,
// set alert, Buy/Sell chips), the add-ticker search, "Import from
// TradingView", and the needs-you strip where fired alerts hand you their
// chip. Guests build lists in localStorage; signing in adopts them.
//
// Chips follow the chip-send contract: with an `onAsk` (a chat surface
// mounted next to the chart) they SEND; without one they PREFILL /chat —
// a URL never fires a turn. Either way the wallet signs or nothing moves.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, BellRing, Check, ChevronDown, ChevronRight, ClipboardPaste, Link2, MoreHorizontal, Plus, Trash2, Wallet, X } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import CreateAccountButton from '@/components/CreateAccountButton'
import { chartPairFor } from '@/lib/charts'
import { useToast } from '@/lib/toast'
import { DEFAULT_LIST_NAME, fmtQuotePrice, heldAutofillNote, heldTitle, sectionedRows, symbolName, type Quote, type WatchlistShape } from '@/lib/watchlists'
import AddTicker from './AddTicker'
import AlertForm from './AlertForm'
import ImportModal from './ImportModal'
import { useAlerts, useQuotes, useWatchlists } from './useWatchlists'

const promptHref = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// The rows scroll inside the rail (docked full-height on /markets), and that
// scroller clips a row's menu: open it toward the side with room and cap it
// to that room — past the cap the menu scrolls itself.
function rowMenuPlacement(btn: HTMLElement): { up: boolean; maxH: number } {
  const box = (btn.closest('.wl__rows') ?? document.documentElement).getBoundingClientRect()
  const b = btn.getBoundingClientRect()
  const below = box.bottom - b.bottom - 8
  const above = b.top - box.top - 8
  const up = below < 240 && above > below
  return { up, maxH: Math.max(160, Math.min(320, Math.floor(up ? above : below))) }
}

export interface WatchlistRailProps {
  /** The page's symbol — offered as a one-tap add when it isn't on the list. */
  symbol?: string
  /** Chip-send: present when a chat surface can take the ask. */
  onAsk?: (ask: string) => void
  /** Where the sign-in door lands afterwards (defaults to the current path). */
  redirectTo?: string
  className?: string
  onClose?: () => void
}

export default function WatchlistRail({ symbol, onAsk, redirectTo, className, onClose }: WatchlistRailProps) {
  const router = useRouter()
  const { toast } = useToast()
  const wl = useWatchlists()
  const alerts = useAlerts(wl.mode === 'authed')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [rowMenuPlace, setRowMenuPlace] = useState<{ up: boolean; maxH: number }>({ up: false, maxH: 320 })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [alertFor, setAlertFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [alertsOpen, setAlertsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const active = wl.active
  const symbols = useMemo(() => active?.symbols ?? [], [active])
  const { quotes } = useQuotes(symbols)
  const held = useMemo(() => new Set(symbols), [symbols])
  const here = redirectTo ?? (typeof window !== 'undefined' ? window.location.pathname : '/markets')

  // Send or prefill — the one door for every chip on the rail.
  const send = useCallback(
    (ask: string) => {
      if (onAsk) onAsk(ask)
      else router.push(promptHref(ask))
    },
    [onAsk, router],
  )
  const sendLabel = onAsk ? 'sends in chat' : 'prefills chat · you send it'

  // The holdings autofill says what it added, once, and how to undo it.
  useEffect(() => {
    if (wl.autofill) toast(heldAutofillNote(wl.autofill.added, wl.autofill.listName), 'success')
  }, [wl.autofill, toast])

  // Close popovers on outside click / Esc.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
        setMenuOpen(false)
        setRowMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpen(false)
        setMenuOpen(false)
        setRowMenu(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const ensureList = useCallback(async (): Promise<WatchlistShape | null> => {
    if (active) return active
    return wl.createList(DEFAULT_LIST_NAME)
  }, [active, wl])

  const addSymbol = useCallback(
    async (sym: string, section?: string | null) => {
      const list = await ensureList()
      if (!list) return
      await wl.addSymbols(list.id, [sym], section)
    },
    [ensureList, wl],
  )

  const share = useCallback(async () => {
    if (!active || wl.mode !== 'authed') return
    const slug = await wl.setPublic(active.id, true)
    if (slug) {
      const url = `${window.location.origin}/lists/${slug}`
      try {
        await navigator.clipboard.writeText(url)
        toast('Public link copied', 'success')
      } catch {
        toast(url, 'info')
      }
    }
  }, [active, wl, toast])

  const rows = active ? sectionedRows(active) : []
  const sections = (active?.sections ?? []).map((s) => s.name)
  const pageSym = symbol ? chartPairFor(symbol)?.symbol ?? symbol : null
  const activeAlerts = alerts.alerts.filter((a) => a.status !== 'fired')

  return (
    <div ref={rootRef} className={`wl${className ? ` ${className}` : ''}`} data-mode={wl.mode}>
      {/* ── Head: list picker + list menu ─────────────────────────── */}
      <div className="wl__head">
        <div className="wl__picker">
          {renaming && active ? (
            <form
              className="wl__renameForm"
              onSubmit={async (e) => {
                e.preventDefault()
                await wl.renameList(active.id, nameDraft)
                setRenaming(false)
              }}
            >
              <input className="wl__input" value={nameDraft} autoFocus onChange={(e) => setNameDraft(e.target.value)} aria-label="List name" onBlur={() => setRenaming(false)} />
            </form>
          ) : (
            <button type="button" className="wl__pickBtn" onClick={() => setPickerOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={pickerOpen}>
              <span className="wl__pickName">{active?.name ?? 'Watchlist'}</span>
              <span className="wl__pickCount mono">{symbols.length}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
          {pickerOpen && (
            <ul className="wl__pop" role="listbox" aria-label="Your lists">
              {wl.lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={l.id === active?.id}
                    className={`wl__popItem${l.id === active?.id ? ' wl__popItem--on' : ''}`}
                    onClick={() => {
                      wl.setActiveId(l.id)
                      setPickerOpen(false)
                    }}
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="wl__popMeta mono">
                      {l.symbols.length}
                      {l.isPublic ? ' · public' : ''}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="wl__popItem wl__popItem--new"
                  onClick={async () => {
                    setPickerOpen(false)
                    const n = wl.lists.length + 1
                    await wl.createList(n === 1 ? DEFAULT_LIST_NAME : `List ${n}`)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> New list
                  <span className="wl__popMeta mono">unlimited</span>
                </button>
              </li>
            </ul>
          )}
        </div>
        <div className="wl__headActs">
          <button type="button" className="wl__icon" title="Import from TradingView" aria-label="Import from TradingView" onClick={() => setImportOpen(true)}>
            <ClipboardPaste className="h-3.5 w-3.5" />
          </button>
          <div className="wl__menuWrap">
            <button type="button" className="wl__icon" aria-label="List menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && active && (
              <ul className="wl__pop wl__pop--right" role="menu">
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="wl__popItem"
                    onClick={() => {
                      setNameDraft(active.name)
                      setRenaming(true)
                      setMenuOpen(false)
                    }}
                  >
                    Rename
                  </button>
                </li>
                <li>
                  {wl.mode === 'authed' ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="wl__popItem"
                      onClick={async () => {
                        setMenuOpen(false)
                        if (active.isPublic && active.slug) {
                          await navigator.clipboard.writeText(`${window.location.origin}/lists/${active.slug}`).catch(() => {})
                          toast('Public link copied', 'success')
                        } else await share()
                      }}
                    >
                      <Link2 className="h-3.5 w-3.5" /> {active.isPublic ? 'Copy public link' : 'Share as a public list'}
                    </button>
                  ) : (
                    <CreateAccountButton className="wl__popItem wl__popItem--door" label="Sign in to share this list" redirectTo={here} />
                  )}
                </li>
                {active.isPublic && (
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      className="wl__popItem"
                      onClick={async () => {
                        setMenuOpen(false)
                        await wl.setPublic(active.id, false)
                      }}
                    >
                      Make private
                    </button>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="wl__popItem wl__popItem--danger"
                    onClick={async () => {
                      setMenuOpen(false)
                      if (window.confirm(`Delete “${active.name}”? Its ${symbols.length} tickers go with it.`)) await wl.deleteList(active.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete list
                  </button>
                </li>
              </ul>
            )}
          </div>
          {onClose && (
            <button type="button" className="wl__icon" aria-label="Close watchlist" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Needs you: fired alerts hand you their chip ───────────── */}
      {alerts.notifications.length > 0 && (
        <div className="wl__fired" role="status">
          {alerts.notifications.slice(0, 3).map((n) => (
            <div key={n.id} className="wl__firedRow">
              <BellRing className="wl__firedIcon" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="wl__firedTitle">{n.title}</div>
                {n.actionAsk && (
                  <button type="button" className="wl__chip wl__chip--accent" onClick={() => send(n.actionAsk!)} title={sendLabel}>
                    {n.actionAsk}
                  </button>
                )}
              </div>
              <button type="button" className="wl__icon" aria-label="Dismiss" onClick={() => alerts.dismiss([n.id])}>
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {alerts.notifications.length > 3 && (
            <button type="button" className="wl__link mono" onClick={() => alerts.dismiss('all')}>
              +{alerts.notifications.length - 3} more · clear all
            </button>
          )}
        </div>
      )}

      {/* ── Add ticker ────────────────────────────────────────────── */}
      <div className="wl__addWrap">
        <AddTicker held={held} onAdd={(s) => void addSymbol(s)} />
        {pageSym && !held.has(pageSym) && (
          <button type="button" className="wl__addHere" onClick={() => void addSymbol(pageSym)}>
            <Plus className="h-3 w-3" /> Add {pageSym}
          </button>
        )}
      </div>

      {/* ── Rows ──────────────────────────────────────────────────── */}
      <div className="wl__rows">
        {!wl.ready && <div className="wl__empty mono">loading…</div>}
        {wl.ready && symbols.length === 0 && (
          <div className="wl__empty">
            <p>Nothing watched yet.</p>
            <p className="wl__muted">Type a ticker or a company above, or paste a TradingView export. Unlimited lists, unlimited tickers, free.</p>
          </div>
        )}
        {rows.map((group) => {
          const key = group.name ?? '__tail'
          const isCollapsed = !!collapsed[key]
          return (
            <div key={key} className="wl__section">
              {group.name && (
                <button type="button" className="wl__sectionHead" onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} aria-expanded={!isCollapsed}>
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <span className="truncate">{group.name}</span>
                  <span className="wl__popMeta mono">{group.symbols.length}</span>
                </button>
              )}
              {!isCollapsed &&
                group.symbols.map((sym) => {
                  const q: Quote | undefined = quotes[sym]
                  const pair = chartPairFor(sym)
                  const up = q ? q.chgPct > 0 : false
                  const down = q ? q.chgPct < 0 : false
                  const cur = pageSym === sym
                  const inWallet = wl.held.get(sym)
                  return (
                    <div key={sym} className={`wl__row${cur ? ' wl__row--cur' : ''}`} data-symbol={sym}>
                      <Link href={`/t/${sym}`} className="wl__rowMain" onClick={onClose}>
                        <TokenIcon symbol={sym} size={20} {...(pair?.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {})} />
                        <span className="wl__rowId">
                          <span className="wl__rowSym">
                            {sym}
                            {inWallet && (
                              <span className="wl__rowHeld" title={heldTitle(inWallet)} aria-label={heldTitle(inWallet)} data-held="">
                                <Wallet aria-hidden />
                              </span>
                            )}
                          </span>
                          <span className="wl__rowName">{pair ? symbolName(sym) : 'no chart yet'}</span>
                        </span>
                        <span className="wl__rowQuote mono">
                          {q ? (
                            <>
                              <span className="wl__rowLast">{fmtQuotePrice(q.last)}</span>
                              <span className={`wl__rowChg${up ? ' wl__rowChg--up' : down ? ' wl__rowChg--down' : ''}`}>
                                {q.chgPct > 0 ? '+' : ''}
                                {q.chgPct.toFixed(2)}%
                              </span>
                            </>
                          ) : (
                            <span className="wl__rowLast wl__rowLast--dim">{pair ? '…' : '—'}</span>
                          )}
                        </span>
                      </Link>
                      <div className="wl__menuWrap">
                        <button
                          type="button"
                          className="wl__icon wl__rowMore"
                          aria-label={`${sym} menu`}
                          aria-haspopup="menu"
                          aria-expanded={rowMenu === sym}
                          onClick={(e) => {
                            setRowMenuPlace(rowMenuPlacement(e.currentTarget))
                            setRowMenu((r) => (r === sym ? null : sym))
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {rowMenu === sym && active && (
                          <ul
                            className={`wl__pop wl__pop--right${rowMenuPlace.up ? ' wl__pop--up' : ''}`}
                            style={{ maxHeight: rowMenuPlace.maxH }}
                            role="menu"
                            aria-label={`${sym} actions`}
                          >
                            <li className="wl__popChips">
                              <button type="button" className="wl__chip wl__chip--accent" onClick={() => send(`Buy $10 of ${sym}`)} title={sendLabel}>
                                Buy $10
                              </button>
                              <button type="button" className="wl__chip" onClick={() => send(`Sell $10 of ${sym}`)} title={sendLabel}>
                                Sell $10
                              </button>
                              <button type="button" className="wl__chip" onClick={() => send(`DCA $10 into ${sym} weekly`)} title={sendLabel}>
                                DCA weekly
                              </button>
                            </li>
                            <li>
                              {wl.mode === 'authed' ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="wl__popItem"
                                  onClick={() => {
                                    setRowMenu(null)
                                    setAlertFor(sym)
                                  }}
                                >
                                  <Bell className="h-3.5 w-3.5" /> Set an alert
                                </button>
                              ) : (
                                <CreateAccountButton className="wl__popItem wl__popItem--door" label="Sign in to set alerts" redirectTo={here} />
                              )}
                            </li>
                            <li className="wl__popGroup">
                              <span className="wl__popLabel mono">move to</span>
                              {sections
                                .filter((s) => !(group.name === s))
                                .map((s) => (
                                  <button
                                    key={s}
                                    type="button"
                                    role="menuitem"
                                    className="wl__popItem"
                                    onClick={async () => {
                                      setRowMenu(null)
                                      await wl.moveToSection(active.id, sym, s)
                                    }}
                                  >
                                    {s}
                                  </button>
                                ))}
                              {group.name && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="wl__popItem"
                                  onClick={async () => {
                                    setRowMenu(null)
                                    await wl.moveToSection(active.id, sym, null)
                                  }}
                                >
                                  no section
                                </button>
                              )}
                              <button
                                type="button"
                                role="menuitem"
                                className="wl__popItem"
                                onClick={async () => {
                                  const name = window.prompt('New section name')
                                  setRowMenu(null)
                                  if (name?.trim()) await wl.moveToSection(active.id, sym, name.trim())
                                }}
                              >
                                <Plus className="h-3 w-3" /> new section…
                              </button>
                            </li>
                            <li>
                              <button
                                type="button"
                                role="menuitem"
                                className="wl__popItem wl__popItem--danger"
                                onClick={async () => {
                                  setRowMenu(null)
                                  await wl.removeSymbol(active.id, sym)
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Remove
                              </button>
                            </li>
                          </ul>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>

      {/* ── Alerts (armed) ────────────────────────────────────────── */}
      {wl.mode === 'authed' && activeAlerts.length > 0 && (
        <div className="wl__alerts">
          <button type="button" className="wl__sectionHead" onClick={() => setAlertsOpen((o) => !o)} aria-expanded={alertsOpen}>
            {alertsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Bell className="h-3 w-3" /> Alerts
            <span className="wl__popMeta mono">{activeAlerts.length}</span>
          </button>
          {alertsOpen &&
            activeAlerts.map((a) => (
              <div key={a.id} className="wl__alertRow">
                <span className="wl__alertLabel">
                  {a.symbol} {a.condition === 'above' ? '≥' : a.condition === 'below' ? '≤' : '±'} {a.condition === 'pct_move' ? `${a.value}%` : `$${fmtQuotePrice(a.value)}`}
                  {a.actionAsk ? <span className="wl__muted"> · hands you a chip</span> : null}
                  {a.status === 'paused' ? <span className="wl__muted"> · paused</span> : null}
                </span>
                <button type="button" className="wl__link mono" onClick={() => alerts.setStatus(a.id, a.status === 'paused' ? 'resume' : 'pause')}>
                  {a.status === 'paused' ? 'resume' : 'pause'}
                </button>
                <button type="button" className="wl__icon" aria-label="Delete alert" onClick={() => alerts.remove(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* ── Foot ──────────────────────────────────────────────────── */}
      <div className="wl__foot mono">
        {wl.mode === 'guest' ? (
          <span>
            saved in this browser ·{' '}
            <CreateAccountButton className="wl__link" label="sign in to keep it everywhere" redirectTo={here} />
          </span>
        ) : (
          <span title={active?.owner ?? ''}>∞ lists · ∞ tickers · ∞ alerts · free{active?.owner ? ` · ${short(active.owner)}` : ''}</span>
        )}
        {wl.error && <span className="wl__err"> · {wl.error}</span>}
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        listName={active?.name ?? null}
        onAddToList={async (syms, secs) => {
          const list = await ensureList()
          if (!list) return
          await wl.addSymbols(list.id, syms)
          for (const s of secs) for (const sym of s.symbols) await wl.moveToSection(list.id, sym, s.name)
        }}
        onCreateList={async (name, syms, secs) => {
          await wl.createList(name, syms, secs)
        }}
      />
      {alertFor && (
        <AlertForm
          open
          symbol={alertFor}
          last={quotes[alertFor]?.last ?? null}
          onClose={() => setAlertFor(null)}
          onCreate={async (body) => {
            const a = await alerts.create(body)
            if (!a) throw new Error(alerts.error ?? 'Could not set the alert.')
            toast(`Alert set on ${body.symbol}`, 'success')
          }}
          onSend={(ask) => {
            setAlertFor(null)
            send(ask)
          }}
          sendLabel={sendLabel}
        />
      )}
    </div>
  )
}
