'use client'

// The rail's data hook (MARKETS/WATCH). Two modes, one API:
//   guest  — lists live in localStorage (lib/watchlists readGuestLists);
//            every op edits the local copy and persists.
//   authed — lists live in the DB via /api/watchlists; every op is a fetch
//            and the response's list replaces the local row.
// The moment the SIWE session hydrates authed with guest lists present, the
// hook POSTs them to /api/watchlists/adopt and clears the key — the
// adoptLocalChat idiom, one table over. Nothing here counts or caps.
//
// Holdings autofill (2026-09-11): whenever a wallet is behind the rail — the
// session's wallet in account mode, the connected one in guest mode — the
// hook reads what it holds (GET /api/watchlists/holdings) and
// planHeldAutofill adds the held symbols the OPEN list lacks (and the owner
// never removed) to that list: the account's ledger on the server (POST), this browser's in
// localStorage. A removal joins the ledger, so it stays off until the owner
// adds it back by hand.
//
// Memory first, then a background check (Nate, 2026-09-18): the rail paints
// the positions this browser remembers (lib/watchlists readHeldSnapshot) while
// its own read is in flight, and the minute poll RECONCILES as well as
// reprices, so a token bought after the page loaded joins the list while the
// page is open. The autofill used to run once per mount, so a buy made in
// another tab waited for the next navigation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/lib/session'
import {
  DEFAULT_LIST_NAME,
  dedupeSymbols,
  guestHeldAdoption,
  heldReconcileReason,
  isGuestListId,
  mirrorAccountLedger,
  moveToSection as moveToSectionPure,
  newGuestList,
  planHeldAutofill,
  readGuestLists,
  readHeldLedger,
  readHeldSnapshot,
  writeGuestLists,
  writeHeldLedger,
  type HeldSymbol,
  type Quote,
  type WatchlistShape,
} from '@/lib/watchlists'
import type { AlertShape, NotificationShape } from '@/lib/watchlists-store'
import { HELD_EVERY_MS, readHeld } from '@/lib/held-read'

const ACTIVE_KEY = 'pantessa.watchlists.active'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

// ── Holdings reads ──────────────────────────────────────────────────────────
// The read itself is shared with the page (lib/held-read: the YOU HOLD pill
// and the Sell chips read the same one, holdings + the empty-wallet and card
// door flags). Rows show the position (2026-09-14), so a page left open
// re-reads once a minute while the tab is visible — and since 2026-09-18 that
// read reconciles too, so a token bought after the page loaded joins the list
// without a navigation. What each key last reconciled is remembered here, per
// page, so a read that turns up nothing new writes nothing at all (lib/
// watchlists heldReconcileReason). Module-level like the reads themselves: it
// outlives the rail remounting between /markets and /t.
const reconciledHeld = new Map<string, string[]>()
// …and WHICH list that reconcile filled. The list on screen is the one that
// follows the wallet, so opening another list is a reason to check again
// (heldReconcileReason 'list') — once per list, not once per poll.
const reconciledList = new Map<string, string>()
const NO_HELD: ReadonlyMap<string, HeldSymbol> = new Map()

// A page runs this hook more than once (the rail and the Morning tape beside
// it), and only ONE of them reads holdings — so the fill has to be announced,
// or the instance that didn't do it never learns. Found 2026-09-18 driving the
// rail: the autofill landed in localStorage and in the tape ("2 SYMBOLS")
// while the rail beside it still said "Nothing watched yet." for the whole
// visit, because whichever instance won the race kept the new list to itself.
interface HeldFill {
  /** Whose lists were filled: `a:<address>` signed in, 'g' as a guest. The
   *  wallet that was read is not the scope — the lists are. */
  modeKey: string
  mode: 'guest' | 'authed'
  /** The account's filled list (authed); guests re-read their own storage. */
  list: WatchlistShape | null
  added: string[]
  listName: string
}
type FillListener = (f: HeldFill) => void
const fillListeners = new Set<FillListener>()
function announceHeldFill(fill: HeldFill, from: FillListener | null): void {
  for (const fn of [...fillListeners]) if (fn !== from) fn(fill)
}

// The guest ledger's bookkeeping. Only the owner's own gestures call these;
// the autofill writes the ledger itself (its adds are never "by hand").
function ledgerRemoved(symbols: readonly string[]): void {
  if (!symbols.length) return
  const l = readHeldLedger()
  writeHeldLedger({
    seen: dedupeSymbols([...l.seen, ...symbols]),
    auto: l.auto.filter((s) => !symbols.includes(s)),
    pending: dedupeSymbols([...l.pending, ...symbols]),
  })
}

function ledgerAddedByHand(symbols: readonly string[]): void {
  const l = readHeldLedger()
  if (!l.auto.some((s) => symbols.includes(s)) && !l.pending.some((s) => symbols.includes(s))) return
  writeHeldLedger({ seen: l.seen, auto: l.auto.filter((s) => !symbols.includes(s)), pending: l.pending.filter((s) => !symbols.includes(s)) })
}

export interface WatchlistsApi {
  lists: WatchlistShape[]
  active: WatchlistShape | null
  setActiveId: (id: string) => void
  /** 'guest' until SIWE; the rail uses it to open the door on account-only ops. */
  mode: 'guest' | 'authed'
  ready: boolean
  busy: boolean
  error: string | null
  /** What the wallet behind the rail holds, by symbol (the row marker). */
  held: ReadonlyMap<string, HeldSymbol>
  /** A wallet is behind the rail (or on its way back) and its first holdings
   *  read + autofill haven't settled; the rail brews on an empty first list. */
  checkingWallet: boolean
  /** The wallet whose holdings the rail reads: the session's in account mode,
   *  the connected one as a guest. */
  holder: string | null
  /** Its last settled holdings read found nothing in it (every chain answered). */
  walletEmpty: boolean
  /** This deployment can sell that wallet funds by card (the rail's card door). */
  cardFunding: boolean
  /** Read the wallet again NOW, past the minute window and the server cache,
   *  and reconcile: a card purchase just landed and belongs on the list. */
  recheckWallet: () => void
  /** The last holdings autofill that added something (the rail's one note). */
  autofill: { added: string[]; listName: string; at: number } | null
  createList: (name: string, symbols?: string[], sections?: WatchlistShape['sections']) => Promise<WatchlistShape | null>
  renameList: (id: string, name: string) => Promise<void>
  deleteList: (id: string) => Promise<void>
  addSymbols: (id: string, symbols: string[], section?: string | null) => Promise<void>
  removeSymbol: (id: string, symbol: string) => Promise<void>
  moveToSection: (id: string, symbol: string, section: string | null) => Promise<void>
  reorder: (id: string, order: string[]) => Promise<void>
  /** Authed only — share/unshare; returns the public slug when shared. */
  setPublic: (id: string, isPublic: boolean) => Promise<string | null>
  refresh: () => Promise<void>
}

/** `holdings: false` for a second instance on the same page (the Morning
 *  tape): it keeps the lists — fills included, through the announcement
 *  above — without reading the wallet or reconciling a second time. */
export interface WatchlistsOptions {
  holdings?: boolean
}

export function useWatchlists(opts: WatchlistsOptions = {}): WatchlistsApi {
  const readsHoldings = opts.holdings !== false
  const { status, address, walletAddress, signedOut } = useSession()
  const authed = status === 'authed' && !!address
  /** Whose lists these are — the account's or this browser's (null while the session hydrates). */
  const modeKey = status === 'loading' ? null : authed ? `a:${address}` : 'g'
  /** The wallet whose holdings feed the autofill (none for a second instance). */
  const holder = !readsHoldings || status === 'loading' ? null : authed ? address : walletAddress
  const [lists, setListsState] = useState<WatchlistShape[]>([])
  const listsRef = useRef<WatchlistShape[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  // Ready means loaded FOR THIS MODE: a sign-in doesn't show the guest lists
  // as the account's while the account's load is still in flight.
  const ready = !!modeKey && loadedKey === modeKey
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [heldRead, setHeldRead] = useState<{ holder: string; held: ReadonlyMap<string, HeldSymbol> } | null>(null)
  // What this browser last saw in that wallet (lib/watchlists readHeldSnapshot),
  // painted until this visit's own read answers: on a cold load the rail shows
  // every row's position with the lists instead of popping it in a read later.
  // Read on the client only — the server render has no memory, so hydration
  // matches (the session hands over the wallet after it anyway).
  const remembered = useMemo<ReadonlyMap<string, HeldSymbol>>(() => {
    if (!holder) return NO_HELD
    const snap = readHeldSnapshot(holder)
    return snap ? new Map(snap.map((h) => [h.symbol, h])) : NO_HELD
  }, [holder])
  const held = holder && heldRead?.holder === holder ? heldRead.held : remembered
  const [autofill, setAutofill] = useState<WatchlistsApi['autofill']>(null)
  // The card door's inputs (2026-09-16), per wallet: did the last read find
  // nothing in it, and is card funding on. `recheck` bumps when a purchase
  // lands, which runs the read + reconcile below again, fresh.
  const [walletRead, setWalletRead] = useState<{ holder: string; empty: boolean; cardFunding: boolean } | null>(null)
  const [recheck, setRecheck] = useState(0)
  const recheckedRef = useRef(0)
  // This instance's own listener (so a fill never announces back to itself and
  // toasts twice), and the handler it runs, kept current without resubscribing.
  const selfListener = useRef<FillListener | null>(null)
  const onHeldFill = useRef<FillListener>(() => {})
  const recheckWallet = useCallback(() => setRecheck((n) => n + 1), [])
  // The wallet check (2026-09-14). Settled means this wallet's first holdings
  // read and reconcile finished, either way; until then an empty list is
  // waiting on the wallet, not empty. A remembered wallet wagmi is still
  // restoring (no address yet; lib/app-entry isSignedOut) is waited on too.
  const heldKey = `${modeKey}|${holder}`
  const [heldCheckedKey, setHeldCheckedKey] = useState<string | null>(null)
  const walletComing = readsHoldings && status === 'guest' && !walletAddress && !signedOut
  const checkingWallet = ready && (walletComing || (!!holder && heldCheckedKey !== heldKey))
  const adoptingFor = useRef<string | null>(null)

  // Every write goes through `update`, so an op reads the lists as they are
  // NOW. The guest branches used to map over the render's closure: a
  // create-then-add in one gesture mapped over the pre-create list and
  // persisted [] — signed-out adds never stuck (found 2026-09-11).
  const update = useCallback((fn: (prev: WatchlistShape[]) => WatchlistShape[]): WatchlistShape[] => {
    const next = fn(listsRef.current)
    listsRef.current = next
    setListsState(next)
    return next
  }, [])

  const updateGuest = useCallback(
    (fn: (prev: WatchlistShape[]) => WatchlistShape[]): WatchlistShape[] => {
      const next = update(fn)
      writeGuestLists(next)
      return next
    },
    [update],
  )

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id)
    try {
      window.localStorage.setItem(ACTIVE_KEY, id)
    } catch {
      /* per-viewer convenience only */
    }
  }, [])

  const load = useCallback(async () => {
    if (!modeKey) return
    if (!authed) {
      update(() => readGuestLists())
      setLoadedKey(modeKey)
      return
    }
    // Authed: adopt this browser's guest lists and guest removals first (once
    // per address), then read.
    const guest = readGuestLists()
    const ledger = readHeldLedger()
    if ((guest.length || ledger.pending.length) && adoptingFor.current !== address) {
      adoptingFor.current = address
      const { auto, dismissed } = guestHeldAdoption(ledger, guest)
      try {
        await api('/api/watchlists/adopt', {
          method: 'POST',
          body: JSON.stringify({ lists: guest.map((l) => ({ name: l.name, symbols: l.symbols, sections: l.sections })), auto, dismissed }),
        })
        writeGuestLists([])
        writeHeldLedger({ seen: ledger.seen, auto: [], pending: [] })
      } catch (e) {
        adoptingFor.current = null
        setError((e as Error).message)
      }
    }
    try {
      const { lists: rows } = await api<{ lists: WatchlistShape[] }>('/api/watchlists')
      update(() => rows)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoadedKey(modeKey)
  }, [authed, address, modeKey, update])

  useEffect(() => {
    void load()
  }, [load])

  // Active list: the remembered one if it still exists, else the first.
  useEffect(() => {
    if (!ready) return
    let remembered: string | null = null
    try {
      remembered = window.localStorage.getItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
    if (activeId && lists.some((l) => l.id === activeId)) return
    const pick = (remembered && lists.find((l) => l.id === remembered)?.id) ?? lists[0]?.id ?? null
    setActiveIdState(pick)
  }, [ready, lists, activeId])

  // ONE holdings read: reprice every row, then reconcile when there is
  // something to reconcile (lib/watchlists heldReconcileReason — a first read
  // for this wallet, a symbol it has never seen, or a landed purchase asking).
  // The visit's check and the minute poll below both call it, so the autofill
  // is no longer a once-per-mount thing: a token bought while the page is open
  // joins the list where it used to wait for the next navigation.
  const readAndReconcile = useCallback(
    async (opts: { maxAgeMs?: number; fresh?: boolean; alive?: () => boolean } = {}) => {
      if (!holder || !modeKey) return
      const alive = opts.alive ?? (() => true)
      const key = heldKey
      const listsKey = modeKey
      const fresh = opts.fresh === true
      const got = await readHeld(holder, opts.maxAgeMs ?? HELD_EVERY_MS, fresh)
      if (!alive() || !got) return
      setHeldRead({ holder, held: new Map(got.held.map((h) => [h.symbol, h])) })
      setWalletRead({ holder, empty: got.empty, cardFunding: got.cardFunding })
      const symbols = got.held.map((h) => h.symbol)
      // The list on screen (the first one until the owner picks another).
      // Read after the holdings answer, and from storage when the state hasn't
      // restored yet: the visit's check can start before the remembered list does.
      let openId = activeIdRef.current
      if (!openId) {
        try {
          openId = window.localStorage.getItem(ACTIVE_KEY)
        } catch {
          /* ignore */
        }
      }
      const target = listsRef.current.find((l) => l.id === openId) ?? listsRef.current[0] ?? null
      const targetId = target?.id ?? ''
      const reason = heldReconcileReason({
        held: symbols,
        reconciled: reconciledHeld.get(key) ?? null,
        forced: fresh,
        missingFromTarget: reconciledList.has(key) && reconciledList.get(key) !== targetId,
      })
      if (!reason) return
      // Claimed before the write, so a remount racing the poll can't sync the
      // same read twice; a failed sync gives the claim back.
      reconciledHeld.set(key, symbols)
      reconciledList.set(key, targetId)
      if (authed) {
        try {
          const r = await api<{ list: WatchlistShape | null; added: string[]; dismissed: string[] }>('/api/watchlists/holdings', {
            method: 'POST',
            body: JSON.stringify({ symbols, ...(targetId ? { listId: targetId } : {}) }),
          })
          if (!alive()) return
          const list = r.list
          if (list) update((prev) => (prev.some((l) => l.id === list.id) ? prev.map((l) => (l.id === list.id ? list : l)) : [...prev, list]))
          writeHeldLedger(mirrorAccountLedger(readHeldLedger(), listsRef.current.flatMap((l) => l.symbols), r.dismissed))
          if (list && r.added.length) {
            setAutofill({ added: r.added, listName: list.name, at: Date.now() })
            announceHeldFill({ modeKey: listsKey, mode: 'authed', list, added: r.added, listName: list.name }, selfListener.current)
          }
        } catch {
          reconciledHeld.delete(key)
          reconciledList.delete(key)
        }
        return
      }
      const ledger = readHeldLedger()
      const plan = planHeldAutofill({
        held: symbols,
        watched: listsRef.current.flatMap((l) => l.symbols),
        target: target?.symbols ?? [],
        seen: ledger.seen,
        dismissed: ledger.pending,
      })
      if (!plan.newlySeen.length && !plan.add.length) return
      let listName = target?.name ?? DEFAULT_LIST_NAME
      if (plan.add.length) {
        updateGuest((prev) => {
          const at = Math.max(0, prev.findIndex((l) => l.id === targetId))
          const open = prev[at] ?? newGuestList(DEFAULT_LIST_NAME)
          listName = open.name
          const filled = { ...open, symbols: dedupeSymbols([...open.symbols, ...plan.add]) }
          return prev.length ? prev.map((l, i) => (i === at ? filled : l)) : [filled]
        })
      }
      writeHeldLedger({
        seen: dedupeSymbols([...ledger.seen, ...plan.newlySeen]),
        auto: dedupeSymbols([...ledger.auto, ...plan.add]),
        pending: ledger.pending,
      })
      if (plan.add.length) {
        setAutofill({ added: plan.add, listName, at: Date.now() })
        announceHeldFill({ modeKey: listsKey, mode: 'guest', list: null, added: plan.add, listName }, selfListener.current)
      }
    },
    [holder, heldKey, modeKey, authed, update, updateGuest],
  )

  // The other instance on this page hears what was filled and shows it too —
  // its own lists were read before the fill happened.
  onHeldFill.current = (f: HeldFill) => {
    if (!modeKey || f.modeKey !== modeKey || !f.added.length) return
    if (f.mode === 'guest') update(() => readGuestLists())
    else if (f.list) {
      const list = f.list
      update((prev) => (prev.some((l) => l.id === list.id) ? prev.map((l) => (l.id === list.id ? list : l)) : [...prev, list]))
    }
    setAutofill({ added: f.added, listName: f.listName, at: Date.now() })
  }
  useEffect(() => {
    const fn: FillListener = (f) => onHeldFill.current(f)
    selfListener.current = fn
    fillListeners.add(fn)
    return () => {
      fillListeners.delete(fn)
      if (selfListener.current === fn) selfListener.current = null
    }
  }, [])

  // The visit's check — every visit with a wallet behind the rail, not only
  // the first connect. A landed purchase (recheckWallet) asks for another one
  // past both caches, so the buy joins the list the moment it arrives.
  useEffect(() => {
    if (!ready || !holder) return
    let alive = true
    const key = heldKey
    const fresh = recheck > recheckedRef.current
    recheckedRef.current = recheck
    // Settled either way: a failed read or sync ends the wait too.
    void readAndReconcile({ fresh, alive: () => alive }).finally(() => {
      if (alive) setHeldCheckedKey(key)
    })
    return () => {
      alive = false
    }
  }, [ready, holder, heldKey, recheck, readAndReconcile])

  // Opening another list: that one follows the wallet now. The read comes from
  // the minute cache, so this costs a sync only when the list lacks something.
  useEffect(() => {
    if (!ready || !holder || !activeId) return
    let alive = true
    void readAndReconcile({ alive: () => alive })
    return () => {
      alive = false
    }
  }, [ready, holder, activeId, readAndReconcile])

  // A page left open keeps up on its own: once a minute while the tab is
  // visible, and when it comes back into view. Positions stay current (a buy
  // made from the rail's own chips lands while you watch) and a symbol the
  // wallet didn't hold at load joins the list. A read with nothing new in it
  // still writes nothing.
  useEffect(() => {
    if (!ready || !holder) return
    let alive = true
    const refresh = () => {
      if (document.hidden) return
      // Half the window: by the next tick the last read is a minute old.
      void readAndReconcile({ maxAgeMs: HELD_EVERY_MS / 2, alive: () => alive })
    }
    const t = setInterval(refresh, HELD_EVERY_MS)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ready, holder, readAndReconcile])

  const replace = useCallback(
    (list: WatchlistShape) => {
      update((prev) => prev.map((l) => (l.id === list.id ? list : l)))
    },
    [update],
  )

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    try {
      const r = await fn()
      setError(null)
      return r
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const createList = useCallback<WatchlistsApi['createList']>(
    async (name, symbols = [], sections) => {
      if (!authed) {
        const list = newGuestList(name, symbols, sections)
        updateGuest((prev) => [...prev, list])
        if (list.symbols.length) ledgerAddedByHand(list.symbols)
        setActiveId(list.id)
        return list
      }
      const created = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'POST', body: JSON.stringify({ name, symbols, sections }) })).list)
      if (created) {
        update((prev) => [...prev, created])
        setActiveId(created.id)
      }
      return created
    },
    [authed, run, setActiveId, update, updateGuest],
  )

  const renameList = useCallback<WatchlistsApi['renameList']>(
    async (id, name) => {
      if (isGuestListId(id)) {
        updateGuest((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)))
        return
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'PATCH', body: JSON.stringify({ id, name }) })).list)
      if (r) replace(r)
    },
    [updateGuest, run, replace],
  )

  const deleteList = useCallback<WatchlistsApi['deleteList']>(
    async (id) => {
      if (isGuestListId(id)) {
        const gone = listsRef.current.find((l) => l.id === id)
        updateGuest((prev) => prev.filter((l) => l.id !== id))
        if (gone) ledgerRemoved(gone.symbols)
        return
      }
      const ok = await run(async () => api('/api/watchlists', { method: 'DELETE', body: JSON.stringify({ id }) }))
      if (ok) update((prev) => prev.filter((l) => l.id !== id))
    },
    [updateGuest, run, update],
  )

  const addSymbols = useCallback<WatchlistsApi['addSymbols']>(
    async (id, symbolsRaw, section) => {
      const symbols = dedupeSymbols(symbolsRaw)
      if (!symbols.length) return
      if (isGuestListId(id)) {
        updateGuest((prev) =>
          prev.map((l) => {
            if (l.id !== id) return l
            const next = { ...l, symbols: dedupeSymbols([...l.symbols, ...symbols]) }
            return section ? symbols.reduce((acc, s) => moveToSectionPure(acc, s, section), next) : next
          }),
        )
        ledgerAddedByHand(symbols)
        return
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>(`/api/watchlists/${id}/items`, { method: 'POST', body: JSON.stringify({ symbols, section }) })).list)
      if (r) replace(r)
    },
    [updateGuest, run, replace],
  )

  const removeSymbol = useCallback<WatchlistsApi['removeSymbol']>(
    async (id, symbol) => {
      if (isGuestListId(id)) {
        updateGuest((prev) =>
          prev.map((l) => (l.id === id ? { ...moveToSectionPure(l, symbol, null), symbols: l.symbols.filter((s) => s !== symbol) } : l)),
        )
        ledgerRemoved([symbol])
        return
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>(`/api/watchlists/${id}/items?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' })).list)
      if (r) replace(r)
    },
    [updateGuest, run, replace],
  )

  const moveToSection = useCallback<WatchlistsApi['moveToSection']>(
    async (id, symbol, section) => {
      if (isGuestListId(id)) {
        updateGuest((prev) => prev.map((l) => (l.id === id ? moveToSectionPure(l, symbol, section) : l)))
        return
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>(`/api/watchlists/${id}/items`, { method: 'PATCH', body: JSON.stringify({ symbol, section }) })).list)
      if (r) replace(r)
    },
    [updateGuest, run, replace],
  )

  const reorder = useCallback<WatchlistsApi['reorder']>(
    async (id, order) => {
      if (isGuestListId(id)) {
        updateGuest((prev) =>
          prev.map((l) => {
            if (l.id !== id) return l
            const wanted = order.filter((s) => l.symbols.includes(s))
            return { ...l, symbols: [...wanted, ...l.symbols.filter((s) => !wanted.includes(s))] }
          }),
        )
        return
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'PATCH', body: JSON.stringify({ id, order }) })).list)
      if (r) replace(r)
    },
    [updateGuest, run, replace],
  )

  const setPublic = useCallback<WatchlistsApi['setPublic']>(
    async (id, isPublic) => {
      if (isGuestListId(id)) return null
      const r = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'PATCH', body: JSON.stringify({ id, isPublic }) })).list)
      if (r) replace(r)
      return r?.isPublic ? r.slug : null
    },
    [run, replace],
  )

  const active = useMemo(() => lists.find((l) => l.id === activeId) ?? lists[0] ?? null, [lists, activeId])

  return {
    lists,
    active,
    setActiveId,
    mode: authed ? 'authed' : 'guest',
    ready,
    busy,
    error,
    held,
    checkingWallet,
    holder,
    walletEmpty: !!holder && walletRead?.holder === holder && walletRead.empty,
    cardFunding: !!holder && walletRead?.holder === holder && walletRead.cardFunding,
    recheckWallet,
    autofill,
    createList,
    renameList,
    deleteList,
    addSymbols,
    removeSymbol,
    moveToSection,
    reorder,
    setPublic,
    refresh: load,
  }
}

// ── Quotes ──────────────────────────────────────────────────────────────────

/** Poll /api/quotes for a symbol set. One request per poll for the whole
 *  set (batched by contract); pauses while the tab is hidden. */
export function useQuotes(symbols: readonly string[], intervalMs = 15_000): { quotes: Record<string, Quote>; missing: string[]; asOf: number | null } {
  const key = useMemo(() => dedupeSymbols(symbols).join(','), [symbols])
  const [state, setState] = useState<{ quotes: Record<string, Quote>; missing: string[]; asOf: number | null }>({ quotes: {}, missing: [], asOf: null })
  useEffect(() => {
    if (!key) return
    let alive = true
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { quotes?: Record<string, Quote>; missing?: string[]; asOf?: number }
        if (!alive) return
        setState((prev) => ({ quotes: { ...prev.quotes, ...(body.quotes ?? {}) }, missing: body.missing ?? [], asOf: body.asOf ?? Date.now() }))
      } catch {
        /* next tick */
      }
    }
    void tick()
    const t = setInterval(tick, intervalMs)
    const onVis = () => {
      if (!document.hidden) void tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [key, intervalMs])
  return state
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export interface AlertsApi {
  alerts: AlertShape[]
  notifications: NotificationShape[]
  ready: boolean
  error: string | null
  create: (body: { symbol: string; condition: string; value: number; basePrice?: number | null; actionAsk?: string | null; email?: string | null }) => Promise<AlertShape | null>
  setStatus: (id: string, op: 'pause' | 'resume' | 'rearm') => Promise<void>
  remove: (id: string) => Promise<void>
  dismiss: (ids: string[] | 'all') => Promise<void>
  refresh: () => Promise<void>
}

/** The owner's alerts + unseen notifications (authed only; a guest gets an
 *  empty, ready API and the rail offers the door). Polls the notifications
 *  so a firing lands on the rail within a minute of the cron. */
export function useAlerts(enabled: boolean, intervalMs = 30_000): AlertsApi {
  const [alerts, setAlerts] = useState<AlertShape[]>([])
  const [notifications, setNotifications] = useState<NotificationShape[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setAlerts([])
      setNotifications([])
      setReady(true)
      return
    }
    try {
      const [a, n] = await Promise.all([
        api<{ alerts: AlertShape[] }>('/api/alerts'),
        api<{ notifications: NotificationShape[] }>('/api/alerts/notifications'),
      ])
      setAlerts(a.alerts)
      setNotifications(n.notifications)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setReady(true)
  }, [enabled])

  useEffect(() => {
    void refresh()
    if (!enabled) return
    const t = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void refresh()
    }, intervalMs)
    return () => clearInterval(t)
  }, [refresh, enabled, intervalMs])

  const create = useCallback<AlertsApi['create']>(
    async (body) => {
      try {
        const { alert } = await api<{ alert: AlertShape }>('/api/alerts', { method: 'POST', body: JSON.stringify(body) })
        setAlerts((prev) => [alert, ...prev])
        setError(null)
        return alert
      } catch (e) {
        setError((e as Error).message)
        return null
      }
    },
    [],
  )

  const setStatus = useCallback<AlertsApi['setStatus']>(async (id, op) => {
    try {
      const { alert } = await api<{ alert: AlertShape }>('/api/alerts', { method: 'PATCH', body: JSON.stringify({ id, op }) })
      setAlerts((prev) => prev.map((a) => (a.id === id ? alert : a)))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const remove = useCallback<AlertsApi['remove']>(async (id) => {
    try {
      await api('/api/alerts', { method: 'DELETE', body: JSON.stringify({ id }) })
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const dismiss = useCallback<AlertsApi['dismiss']>(async (ids) => {
    setNotifications((prev) => (ids === 'all' ? [] : prev.filter((n) => !ids.includes(n.id))))
    try {
      await api('/api/alerts/notifications', { method: 'PATCH', body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) })
    } catch {
      /* the next poll restores anything the server still holds */
    }
  }, [])

  return { alerts, notifications, ready, error, create, setStatus, remove, dismiss, refresh }
}
