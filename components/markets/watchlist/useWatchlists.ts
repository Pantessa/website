'use client'

// The rail's data hook (MARKETS/WATCH). Two modes, one API:
//   guest  — lists live in localStorage (lib/watchlists readGuestLists);
//            every op edits the local copy and persists.
//   authed — lists live in the DB via /api/watchlists; every op is a fetch
//            and the response's list replaces the local row.
// The moment the SIWE session hydrates authed with guest lists present, the
// hook POSTs them to /api/watchlists/adopt and clears the key — the
// adoptLocalChat idiom, one table over. Nothing here counts or caps.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/lib/session'
import {
  dedupeSymbols,
  moveToSection as moveToSectionPure,
  newGuestList,
  readGuestLists,
  writeGuestLists,
  isGuestListId,
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

export interface WatchlistsApi {
  lists: WatchlistShape[]
  active: WatchlistShape | null
  setActiveId: (id: string) => void
  /** 'guest' until SIWE; the rail uses it to open the door on account-only ops. */
  mode: 'guest' | 'authed'
  ready: boolean
  busy: boolean
  error: string | null
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
  const { status, address } = useSession()
  const authed = status === 'authed' && !!address
  const [lists, setLists] = useState<WatchlistShape[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const adoptingFor = useRef<string | null>(null)

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id)
    try {
      window.localStorage.setItem(ACTIVE_KEY, id)
    } catch {
      /* per-viewer convenience only */
    }
  }, [])

  const persistGuest = useCallback((next: WatchlistShape[]) => {
    setLists(next)
    writeGuestLists(next)
  }, [])

  const load = useCallback(async () => {
    if (status === 'loading') return
    if (!authed) {
      setLists(readGuestLists())
      setReady(true)
      return
    }
    // Authed: adopt any guest lists first (once per address), then read.
    const guest = readGuestLists()
    if (guest.length && adoptingFor.current !== address) {
      adoptingFor.current = address
      try {
        await api('/api/watchlists/adopt', {
          method: 'POST',
          body: JSON.stringify({ lists: guest.map((l) => ({ name: l.name, symbols: l.symbols, sections: l.sections })) }),
        })
        writeGuestLists([])
      } catch (e) {
        adoptingFor.current = null
        setError((e as Error).message)
      }
    }
    try {
      const { lists: rows } = await api<{ lists: WatchlistShape[] }>('/api/watchlists')
      setLists(rows)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setReady(true)
  }, [authed, address, status])

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

  const replace = useCallback((list: WatchlistShape) => {
    setLists((prev) => prev.map((l) => (l.id === list.id ? list : l)))
  }, [])

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
        persistGuest([...lists, list])
        setActiveId(list.id)
        return list
      }
      const created = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'POST', body: JSON.stringify({ name, symbols, sections }) })).list)
      if (created) {
        setLists((prev) => [...prev, created])
        setActiveId(created.id)
      }
      return created
    },
    [authed, lists, persistGuest, run, setActiveId],
  )

  const renameList = useCallback<WatchlistsApi['renameList']>(
    async (id, name) => {
      if (isGuestListId(id)) return persistGuest(lists.map((l) => (l.id === id ? { ...l, name } : l)))
      const r = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'PATCH', body: JSON.stringify({ id, name }) })).list)
      if (r) replace(r)
    },
    [lists, persistGuest, run, replace],
  )

  const deleteList = useCallback<WatchlistsApi['deleteList']>(
    async (id) => {
      if (isGuestListId(id)) return persistGuest(lists.filter((l) => l.id !== id))
      const ok = await run(async () => api('/api/watchlists', { method: 'DELETE', body: JSON.stringify({ id }) }))
      if (ok) setLists((prev) => prev.filter((l) => l.id !== id))
    },
    [lists, persistGuest, run],
  )

  const addSymbols = useCallback<WatchlistsApi['addSymbols']>(
    async (id, symbolsRaw, section) => {
      const symbols = dedupeSymbols(symbolsRaw)
      if (!symbols.length) return
      if (isGuestListId(id)) {
        return persistGuest(
          lists.map((l) => {
            if (l.id !== id) return l
            const next = { ...l, symbols: dedupeSymbols([...l.symbols, ...symbols]) }
            return section ? symbols.reduce((acc, s) => moveToSectionPure(acc, s, section), next) : next
          }),
        )
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>(`/api/watchlists/${id}/items`, { method: 'POST', body: JSON.stringify({ symbols, section }) })).list)
      if (r) replace(r)
    },
    [lists, persistGuest, run, replace],
  )

  const removeSymbol = useCallback<WatchlistsApi['removeSymbol']>(
    async (id, symbol) => {
      if (isGuestListId(id)) {
        return persistGuest(
          lists.map((l) =>
            l.id === id
              ? { ...moveToSectionPure(l, symbol, null), symbols: l.symbols.filter((s) => s !== symbol) }
              : l,
          ),
        )
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>(`/api/watchlists/${id}/items?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' })).list)
      if (r) replace(r)
    },
    [lists, persistGuest, run, replace],
  )

  const moveToSection = useCallback<WatchlistsApi['moveToSection']>(
    async (id, symbol, section) => {
      if (isGuestListId(id)) return persistGuest(lists.map((l) => (l.id === id ? moveToSectionPure(l, symbol, section) : l)))
      const r = await run(async () => (await api<{ list: WatchlistShape }>(`/api/watchlists/${id}/items`, { method: 'PATCH', body: JSON.stringify({ symbol, section }) })).list)
      if (r) replace(r)
    },
    [lists, persistGuest, run, replace],
  )

  const reorder = useCallback<WatchlistsApi['reorder']>(
    async (id, order) => {
      if (isGuestListId(id)) {
        return persistGuest(
          lists.map((l) => {
            if (l.id !== id) return l
            const wanted = order.filter((s) => l.symbols.includes(s))
            return { ...l, symbols: [...wanted, ...l.symbols.filter((s) => !wanted.includes(s))] }
          }),
        )
      }
      const r = await run(async () => (await api<{ list: WatchlistShape }>('/api/watchlists', { method: 'PATCH', body: JSON.stringify({ id, order }) })).list)
      if (r) replace(r)
    },
    [lists, persistGuest, run, replace],
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
