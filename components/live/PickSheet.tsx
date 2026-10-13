'use client'

// THE FIRST-RUN PICK (GTM squad 2026-10-13, lane ARENA). One tap fills an
// untouched row: "From your watchlist" · "From your wallet" · "Top gainers ·
// 24h" · "Biggest · open interest" + the add box — a sheet from the bottom on
// a phone (44px rows, safe-area padding), a popover beside the row on a
// desktop. Mounted (one line each, the coordinator's seats) in the battle
// picker head, the pulse band's row and the tape stage's row; reads
// lib/use-market-pick (the one pick) and writes it ONLY by hand
// (`pick.set(list, 'hand')` / `pick.add`). It never fires a chat turn.
//
// THE DECK's bar seat (`seat="deck"`, coordinator R1): the PHONE's trigger only
// — under 640px one 36px pill ("Your markets", a 44px hit area, the bar's own
// chip idiom) beside the channel chips; at 640px and up it is display:none
// (the channel rows carry the picker on a desktop) — CSS only, so the bar's
// height and the server frame never change. The pulse's own row stays hidden
// on phones (PHONE's budget), so on the Pulse channel this pill is the one
// way a phone adds a market.
//
// The rules (lib/arena, pinned): a row whose list resolves to nothing is
// OMITTED — never a dead button; the sheet may open BY ITSELF once per
// browser (`PICK_SHEET_SEEN_KEY`), only on a row no hand or link set, and
// only after mount + a short delay — the server renders NOTHING here, so the
// deck's SSR frame stays byte-identical (the deck pins read it); a dismiss
// writes the same flag. The words come from lib/market-pick pickSourceWord
// and lib/battle PICK_MODES; the lists from the same reads the surfaces
// already make (the watchlist hook, the held read, the venue's contexts),
// taken only while the panel is open so a closed seat costs nothing.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'
import { useHeld } from '@/lib/use-held'
import { heldArmies, pickList, resolveMarket, type ArmyContext } from '@/lib/battle'
import { readArmyContexts } from '@/lib/battle-feed'
import { watchlistMarkets } from '@/lib/live-markets'
import { MAX_PICK, pickSourceWord } from '@/lib/market-pick'
import type { MarketPickState } from '@/lib/use-market-pick'
import {
  PICK_SHEET_OFFER_DELAY_MS,
  fillRows,
  namesLine,
  pickSheetBlurb,
  pickSheetTitle,
  pickTriggerWord,
  readPickSheetSeen,
  shouldOfferFirstRun,
  writePickSheetSeen,
  type FillRow,
  type PickSheetSeat,
} from '@/lib/arena'
import './arena.css'

export interface PickSheetProps {
  pick: MarketPickState
  /** Where it sits; the words and the opening rule differ per seat. */
  seat: PickSheetSeat
}

export default function PickSheet({ pick, seat }: PickSheetProps) {
  // Nothing on the server and nothing on the first client paint: the deck's
  // SSR frame is its final frame (scripts/deck-pins), and the offer is a
  // decision only a browser can make (its memory, its once flag).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [open, setOpen] = useState(false)
  /** How it opened: by itself (the first-run moment) or by a hand. */
  const [how, setHow] = useState<'self' | 'hand'>('hand')
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)

  // ── The first-run offer: once per browser, on an untouched row ────────
  const source = pick.source
  useEffect(() => {
    if (!mounted || open) return
    if (!shouldOfferFirstRun({ source, seen: readPickSheetSeen() })) return
    const id = setTimeout(() => {
      // Decided again when the timer fires: a sibling seat may have claimed
      // the once flag, a memory or a link may have settled the row. A seat
      // the page's CSS hides never offers (it would spend the once flag on
      // a dialog nobody sees).
      if (!shouldOfferFirstRun({ source, seen: readPickSheetSeen() })) return
      if (!triggerRef.current || triggerRef.current.getClientRects().length === 0) return
      writePickSheetSeen()
      setHow('self')
      setOpen(true)
    }, PICK_SHEET_OFFER_DELAY_MS)
    return () => clearTimeout(id)
  }, [mounted, open, source])

  const close = useCallback(() => {
    // A dismiss remembers: the sheet never offers itself again in this browser.
    writePickSheetSeen()
    setOpen(false)
  }, [])
  const openByHand = useCallback(() => {
    setHow('hand')
    setOpen(true)
  }, [])

  if (!mounted) return null

  return (
    <div className={`picksheet picksheet--${seat}${open ? ' is-open' : ''}`} data-seat={seat}>
      <button
        ref={triggerRef}
        type="button"
        className="picksheet__trigger"
        onClick={open ? close : openByHand}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${titleId}-panel` : undefined}
        data-journey={seat === 'deck' ? 'Open pick sheet (deck bar)' : 'Open pick sheet'}
        title="Fill the row in one tap: your watchlist, your wallet, the venue's lists"
      >
        <span className="picksheet__trigger-w">{pickTriggerWord(pick.markets, seat)}</span>
        <span className="picksheet__trigger-c" aria-hidden>
          ▾
        </span>
      </button>
      {open && <PickSheetPanel pick={pick} seat={seat} how={how} titleId={titleId} onClose={close} />}
    </div>
  )
}

// ── The panel: mounted only while open, so its reads cost a closed seat nothing ──

function PickSheetPanel({ pick, seat, how, titleId, onClose }: { pick: MarketPickState; seat: PickSheetSeat; how: 'self' | 'hand'; titleId: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const firstRowRef = useRef<HTMLButtonElement>(null)
  const [ctxs, setCtxs] = useState<Map<string, ArmyContext> | null>(null)
  const [ctxFailed, setCtxFailed] = useState(false)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<{ text: string; tone: 'warn' | 'dim' } | null>(null)

  // The venue's rows: one read of metaAndAssetCtxs (lib/battle-feed), the
  // same read the battle makes; its keys are the universe when the pick's
  // own is still empty.
  useEffect(() => {
    const ac = new AbortController()
    readArmyContexts(ac.signal)
      .then((m) => {
        if (!ac.signal.aborted) setCtxs(m)
      })
      .catch(() => {
        if (!ac.signal.aborted) setCtxFailed(true)
      })
    return () => ac.abort()
  }, [])
  const universe = useMemo(() => (pick.universe.length ? pick.universe : ctxs ? [...ctxs.keys()] : []), [pick.universe, ctxs])

  // Yours: the watchlist (a second instance, lists only — never a wallet
  // read of its own) and the connected wallet's holdings (the shared read).
  const wl = useWatchlists({ holdings: false })
  const watchSymbols = useMemo(() => {
    if (!wl.ready) return [] as string[]
    const activeId = (wl.active as { id?: string } | null)?.id
    const ordered = [...wl.lists].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0))
    const out: string[] = []
    for (const l of ordered) for (const sym of l.symbols) if (!out.includes(sym)) out.push(sym)
    return out
  }, [wl.ready, wl.lists, wl.active])
  const held = useHeld()

  const rows = useMemo<FillRow[]>(() => {
    const watch = universe.length ? watchlistMarkets(watchSymbols, universe, MAX_PICK) : []
    const heldRow = held && universe.length ? heldArmies(held, universe, MAX_PICK) : []
    const gainers = ctxs ? pickList(ctxs, 'gainers').map((r) => r.market) : []
    const biggest = ctxs ? pickList(ctxs, 'biggest').map((r) => r.market) : []
    return fillRows({ watch, held: heldRow, gainers, biggest })
  }, [universe, watchSymbols, held, ctxs])
  const reading = !ctxs && !ctxFailed

  // Focus lands on the first row (or the box); Esc and an outside click close.
  useEffect(() => {
    const first = firstRowRef.current ?? panelRef.current?.querySelector<HTMLElement>('input,button')
    first?.focus({ preventScroll: true })
  }, [rows.length > 0])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: PointerEvent) => {
      const host = panelRef.current?.parentElement
      if (host && e.target instanceof Node && !host.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  const fill = useCallback(
    (row: FillRow) => {
      // The one write: a hand's. The sheet then closes on the filled row.
      pick.set(row.markets, 'hand')
      onClose()
    },
    [pick, onClose],
  )

  const addTyped = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const raw = draft.trim()
      if (!raw) return
      // Each name resolved against what the page knows (lib/battle
      // resolveMarket: `near` → NEAR, `pepe` → kPEPE, `nvda` → xyz:NVDA);
      // the resolved ones go through pick.add as one hand.
      const parts = raw.split(/[,\s]+/).filter(Boolean)
      const unknown: string[] = []
      const resolved: string[] = []
      for (const p of parts) {
        const m = resolveMarket(p, universe)
        if (m) resolved.push(m)
        else unknown.push(p)
      }
      const r = resolved.length ? pick.add(resolved.join(',')) : { added: [], unknown: [], full: [] }
      const allUnknown = [...unknown, ...r.unknown]
      if (allUnknown.length) setNote({ text: `Hyperliquid lists no market called ${allUnknown.map((u) => u.toUpperCase()).join(', ')}`, tone: 'warn' })
      else if (r.full.length) setNote({ text: `the row is full (${MAX_PICK}) — drop one to add ${namesLine(r.full)}`, tone: 'dim' })
      else setNote(null)
      setDraft(allUnknown.join(', '))
      if (r.added.length && !allUnknown.length && !r.full.length) onClose()
    },
    [draft, universe, pick, onClose],
  )

  const sourceWord = pickSourceWord(pick.source)
  const now = pick.markets.length ? `${namesLine(pick.markets, MAX_PICK)}${sourceWord ? ` · ${sourceWord}` : ''}` : 'nothing picked yet'

  return (
    <>
      <div className="picksheet__scrim" aria-hidden onPointerDown={onClose} />
      <div ref={panelRef} id={`${titleId}-panel`} className="picksheet__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} data-how={how}>
        <div className="picksheet__head">
          <div>
            <h3 id={titleId} className="picksheet__title">
              {pickSheetTitle(seat)}
            </h3>
            <p className="picksheet__blurb">{pickSheetBlurb(seat)}</p>
          </div>
          <button type="button" className="picksheet__close" onClick={onClose} aria-label="Close" data-journey="Dismiss pick sheet">
            ×
          </button>
        </div>
        <p className="picksheet__now mono">
          <span className="picksheet__now-k">now</span> {now}
        </p>
        <div className="picksheet__rows" role="group" aria-label="Fill the row from">
          {rows.map((r, i) => (
            <button key={r.id} ref={i === 0 ? firstRowRef : undefined} type="button" className={`picksheet__row picksheet__row--${r.id}`} onClick={() => fill(r)} data-journey={r.journey} title={r.hint}>
              <span className="picksheet__row-l">{r.label}</span>
              <span className="picksheet__row-m mono">{namesLine(r.markets, 5)}</span>
            </button>
          ))}
          {reading && <p className="picksheet__reading mono">reading the venue’s lists…</p>}
          {!reading && rows.length === 0 && <p className="picksheet__reading mono">{ctxFailed ? 'the venue did not answer — type a market below' : 'no list to fill from yet — type a market below'}</p>}
        </div>
        <form className="picksheet__add" onSubmit={addTyped}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={pick.markets.length >= MAX_PICK ? 'the row is full' : '+ your own · near, pepe, nvda'}
            aria-label="Add your own markets, several with commas"
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="done"
            disabled={pick.markets.length >= MAX_PICK}
          />
          <button type="submit" className="picksheet__addbtn" disabled={pick.markets.length >= MAX_PICK || !draft.trim()} data-journey="Add pick typed">
            Add
          </button>
        </form>
        <p className={`picksheet__note mono${note ? ` picksheet__note--${note.tone}` : ' picksheet__note--dim'}`} role="status">
          {note ? note.text : 'commas add several · only you write this row · nothing here fires a trade'}
        </p>
      </div>
    </>
  )
}
