'use client'

// THE APP PICKER (2026-11-19): one list where apps are added AND removed.
// The row above shows the apps that are on as marks alone; here every app is
// spelled out (mark, name, one plain line) with a switch. "Your apps" is the
// set that was on when the picker opened; "More apps" is the free fleet or the
// paid catalog. A search field leads and looks through both at once.
//
// A row stays where it is while the picker is open: flipping a switch never
// moves it out from under the cursor (lib/apps-dock pickerSections). The
// desktop row drops this from its "Add app" button (components/apps/AppChips);
// the phone puts the same list in a sheet (components/apps/AppsPhone).
//
// Keys: type to search (from a row too), Enter switches the first match, the
// arrows walk the rows, Escape clears the search and then closes.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Info, Search, X } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import { pickerSections, trayLine, trayPrice, type TrayView } from '@/lib/apps-dock'
import type { McpServer } from '@/lib/store'
import { cleanServerName } from '@/lib/utils'
import './picker.css'

/** How long the rows' entrance runs before the list goes still, ms. */
const ENTER_MS = 520

export default function AppPicker({
  servers,
  active,
  onToggle,
  focusSlug,
  autoFocus,
  sheet,
}: {
  servers: McpServer[]
  active: McpServer[]
  onToggle: (s: McpServer) => void
  /** Open on this app's row (a press on its mark in the row). */
  focusSlug?: string
  /** Put the cursor in the search field on open (never on a phone: it would
   *  raise the keyboard over the list). */
  autoFocus?: boolean
  /** Inside the phone's sheet: the sheet scrolls, the search sticks. */
  sheet?: boolean
}) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<TrayView>('free')
  // The set as it was when the picker opened: the order of "Your apps".
  const [pinnedIds] = useState(() => active.map((s) => s.id))
  const on = useMemo(() => new Set(active.map((s) => s.id)), [active])
  const { yours, more } = useMemo(() => pickerSections({ servers, pinnedIds, view, query }), [servers, pinnedIds, view, query])
  const searching = query.trim().length > 0

  // The rows rise in once, on open; a search never replays it.
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), ENTER_MS)
    return () => clearTimeout(t)
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // On open, and again when a mark in the row is pressed while it is open.
  const opened = useRef(false)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const row = focusSlug ? root.querySelector<HTMLElement>(`[data-picker-app="${CSS.escape(focusSlug)}"]`) : null
    if (row) {
      row.scrollIntoView({ block: 'nearest' })
      row.querySelector<HTMLElement>('[data-picker-toggle]')?.focus({ preventScroll: true })
    } else if (autoFocus && !opened.current) inputRef.current?.focus({ preventScroll: true })
    opened.current = true
  }, [focusSlug, autoFocus])

  const toggles = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-picker-toggle]') ?? [])]
  const onKeyDown = (e: React.KeyboardEvent) => {
    // A letter typed on a row goes to the search (and never reaches the
    // page's own keys, such as "/" for the chat).
    if (e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey && e.target !== inputRef.current) {
      e.stopPropagation()
      inputRef.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = toggles()
    if (!rows.length) return
    const at = rows.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    if (e.key === 'ArrowDown') rows[Math.min(rows.length - 1, at + 1)]?.focus()
    else if (at <= 0) inputRef.current?.focus()
    else rows[at - 1]?.focus()
  }

  const row = (s: McpServer, index: number) => <Row key={s.id} s={s} on={on.has(s.id)} flash={s.slug === focusSlug} index={index} onToggle={onToggle} />

  return (
    <div ref={rootRef} className={sheet ? 'apgk apgk--sheet' : 'apgk'} data-apps-picker="" data-entering={entering ? '' : undefined} onKeyDown={onKeyDown}>
      <div className="apgk-search">
        <Search width={16} height={16} aria-hidden className="apgk-search__icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              // The first Escape clears the search; the next one closes.
              e.preventDefault()
              setQuery('')
            } else if (e.key === 'Enter' && searching) {
              const first = [...yours, ...more][0]
              if (first) onToggle(first)
            }
          }}
          placeholder="Search apps"
          aria-label="Search apps"
          className="apgk-search__input"
          data-picker-search=""
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="apgk-search__clear" aria-label="Clear the search" onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}>
            <X width={14} height={14} aria-hidden />
          </button>
        )}
      </div>

      <div className="apgk-list" data-picker-list="">
        {yours.length > 0 && (
          <section className="apgk-sec" aria-label="Your apps" data-picker-section="yours">
            <header className="apgk-sec__head">
              <h3 className="apgk-sec__h">
                Your apps <span className="apgk-sec__n">{active.length}</span>
              </h3>
            </header>
            {yours.map((s, i) => row(s, i))}
          </section>
        )}

        <section className="apgk-sec" aria-label="More apps" data-picker-section="more" data-picker-count={more.length}>
          <header className="apgk-sec__head">
            <h3 className="apgk-sec__h">{searching ? 'More apps' : 'Add an app'}</h3>
            {!searching && (
              <div className="apgk-seg" role="tablist" aria-label="Free or paid apps" data-view={view}>
                <button type="button" role="tab" aria-selected={view === 'free'} onClick={() => setView('free')} className="apgk-seg__btn" data-picker-view="free">
                  Free
                </button>
                <button type="button" role="tab" aria-selected={view === 'paid'} onClick={() => setView('paid')} className="apgk-seg__btn" data-picker-view="paid">
                  Paid
                </button>
              </div>
            )}
          </header>
          {more.map((s, i) => row(s, yours.length + i))}
          {more.length === 0 && (
            <p className="apgk-none">
              {searching
                ? yours.length
                  ? 'No other app matches.'
                  : `No app matches "${query.trim()}".`
                : view === 'free'
                  ? 'Every free app is already on the page.'
                  : 'No paid apps are loaded.'}
            </p>
          )}
        </section>
      </div>

      <p className="apgk-foot">Each app adds its own section to the page and joins the chat.</p>
    </div>
  )
}

function Row({ s, on, flash, index, onToggle }: { s: McpServer; on: boolean; flash: boolean; index: number; onToggle: (s: McpServer) => void }) {
  const name = cleanServerName(s.name)
  const price = trayPrice(s)
  return (
    <div className="apgk-opt" data-picker-app={s.slug} data-on={on ? '' : undefined} data-flash={flash ? '' : undefined} style={{ ['--i' as string]: Math.min(index, 12) }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="apgk-opt__main"
        onClick={() => onToggle(s)}
        title={on ? `Remove ${name} from the page` : `Add ${name} to the page`}
        data-picker-toggle={s.slug}
      >
        <span className="apgk-opt__mark" aria-hidden>
          <BrandIcon server={s} size={20} />
        </span>
        <span className="apgk-opt__text">
          <span className="apgk-opt__name">
            {name}
            {price && <span className="apgk-opt__price">{price}</span>}
          </span>
          <span className="apgk-opt__line">{trayLine(s)}</span>
        </span>
      </button>
      <Link href={`/servers/${s.slug}`} target="_blank" className="apgk-opt__info" aria-label={`About ${name}`} title={`About ${name}: tools, pricing, reputation`}>
        <Info width={15} height={15} aria-hidden />
      </Link>
      <span className="apgk-switch" aria-hidden>
        <span className="apgk-switch__knob" />
      </span>
    </div>
  )
}
