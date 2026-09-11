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
// planHeldAutofill adds the symbols the ledger has never seen to the first
// list: the account's ledger on the server (POST), this browser's in
// localStorage. A removal joins the ledger, so it stays off until the owner
// adds it back by hand.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/lib/session'
import {
  DEFAULT_LIST_NAME,
  dedupeSymbols,
  guestHeldAdoption,
  isGuestListId,
  mirrorAccountLedger,
  moveToSection as moveToSectionPure,
  newGuestList,
  planHeldAutofill,
  readGuestLists,
  readHeldLedger,
  writeGuestLists,
  writeHeldLedger,
  type HeldSymbol,
  type Quote,
  type WatchlistShape,
} from '@/lib/watchlists'
import type { AlertShape, NotificationShape } from '@/lib/watchlists-store'

const ACTIVE_KEY = 'pantessa.watchlists.active'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

// ── Holdings reads ──────────────────────────────────────────────────────────
// Module-level so they outlive the rail remounting on every client navigation
// between /markets and /t pages: one read and one reconcile per wallet per
// mode per minute. A wallet doesn't change that fast, and the server rides
// the Wallet panel's cache anyway.
const HELD_EVERY_MS = 60_000
const heldReads = new Map<string, { at: number; read: Promise<HeldSymbol[] | null> }>()
const lastReconciled = new Map<string, number>()
const NO_HELD: ReadonlyMap<string, HeldSymbol> = new Map()

function readHeld(address: string): Promise<HeldSymbol[] | null> {
  const hit = heldReads.get(address)
  if (hit && Date.now() - hit.at < HELD_EVERY_MS) return hit.read
  const read = fetch(`/api/watchlists/holdings?address=${encodeURIComponent(address)}`, { cache: 'no-store' })
    .then(async (r) => (r.ok ? (((await r.json()) as { held?: HeldSymbol[] }).held ?? []) : null))
    .catch(() => null)
  heldReads.set(address, { at: Date.now(), read })
  // A failed read retries on the next mount instead of waiting out the window.
  void read.then((v) => {
    if (v === null && heldReads.get(address)?.read === read) heldReads.delete(address)
  })
  return read
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

export function useWatchlists(): WatchlistsApi {
  const { status, address, walletAddress } = useSession()
  const authed = status === 'authed' && !!address
  /** Whose lists these are — the account's or this browser's (null while the session hydrates). */
  const modeKey = status === 'loading' ? null : authed ? `a:${address}` : 'g'
  /** The wallet whose holdings feed the autofill. */
  const holder = status === 'loading' ? null : authed ? address : walletAddress
  const [lists, setListsState] = useState<WatchlistShape[]>([])
  const listsRef = useRef<WatchlistShape[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  // Ready means loaded FOR THIS MODE: a sign-in doesn't show the guest lists
  // as the account's while the account's load is still in flight.
  const ready = !!modeKey && loadedKey === modeKey
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [held, setHeld] = useState<ReadonlyMap<string, HeldSymbol>>(NO_HELD)
  const [autofill, setAutofill] = useState<WatchlistsApi['autofill']>(null)
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

  // Holdings autofill — every visit with a wallet behind the rail, not only
  // the first connect.
  useEffect(() => {
    if (!ready || !holder) {
      setHeld(NO_HELD)
      return
    }
    let alive = true
    const key = `${modeKey}|${holder}`
    void (async () => {
      const got = await readHeld(holder)
      if (!alive || !got) return
      setHeld(new Map(got.map((h) => [h.symbol, h])))
      const last = lastReconciled.get(key)
      if (last !== undefined && Date.now() - last < HELD_EVERY_MS) return
      lastReconciled.set(key, Date.now())
      const symbols = got.map((h) => h.symbol)
      if (authed) {
        try {
          const r = await api<{ list: WatchlistShape | null; added: string[]; dismissed: string[] }>('/api/watchlists/holdings', {
            method: 'POST',
            body: JSON.stringify({ symbols }),
          })
          if (!alive) return
          const list = r.list
          if (list) update((prev) => (prev.some((l) => l.id === list.id) ? prev.map((l) => (l.id === list.id ? list : l)) : [...prev, list]))
          writeHeldLedger(mirrorAccountLedger(readHeldLedger(), listsRef.current.flatMap((l) => l.symbols), r.dismissed))
          if (list && r.added.length) setAutofill({ added: r.added, listName: list.name, at: Date.now() })
        } catch {
          lastReconciled.delete(key)
        }
        return
      }
      const ledger = readHeldLedger()
      const plan = planHeldAutofill({ held: symbols, watched: listsRef.current.flatMap((l) => l.symbols), seen: ledger.seen })
      if (!plan.newlySeen.length) return
      let listName = DEFAULT_LIST_NAME
      if (plan.add.length) {
        updateGuest((prev) => {
          const first = prev[0] ?? newGuestList(DEFAULT_LIST_NAME)
          listName = first.name
          const filled = { ...first, symbols: dedupeSymbols([...first.symbols, ...plan.add]) }
          return prev.length ? [filled, ...prev.slice(1)] : [filled]
        })
      }
      writeHeldLedger({
        seen: dedupeSymbols([...ledger.seen, ...plan.newlySeen]),
        auto: dedupeSymbols([...ledger.auto, ...plan.add]),
        pending: ledger.pending,
      })
      if (plan.add.length) setAutofill({ added: plan.add, listName, at: Date.now() })
    })()
    return () => {
      alive = false
    }
  }, [ready, holder, authed, modeKey, update, updateGuest])

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
