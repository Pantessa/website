'use client'

// The apps page's data: the same scan the old splash ran (POST /api/splash →
// SplashTile + the wallet's money map), with the same delta discipline
// (components/SplashDashboard, where this logic was first written):
//   · a different wallet / chain, or Retry → a FULL scan (loader);
//   · an app toggled OFF → its tiles leave at once, no fetch;
//   · an app toggled ON → only ITS tiles are fetched (`serversOnly`) and
//     merge in; everything already on the page stays put.
// Every app on the page is a deliberate pick (the chip row), so every app is
// scanned as a manual pick: it always earns a section, a preview when the
// wallet has nothing on it.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { chainById } from '@/lib/chains'
import type { MoneyMap, SplashTile } from '@/lib/splash/types'

export interface AppTiles {
  /** null while the first full scan is in flight. */
  tiles: SplashTile[] | null
  map: MoneyMap | null
  loading: boolean
  /** Apps just toggled on whose own scan is still in flight. */
  pending: McpServer[]
  retry: () => void
}

/** The last settled scan, kept for the session. The page unmounts whenever
 *  another tab or the full-width conversation takes the main area; coming
 *  back to the SAME wallet, apps and chain paints this at once and re-reads
 *  quietly behind it, instead of sending the whole page back to the loader. */
let LAST: { key: string; tiles: SplashTile[]; map: MoneyMap | null } | null = null

export function useAppTiles(address: string | undefined, servers: McpServer[]): AppTiles {
  const selectedChainId0 = useYeetfulStore.getState().selectedChainId
  const key0 = `${address ?? ''}|${servers.map((s) => s.id).sort().join(',')}|${selectedChainId0 ? chainById(selectedChainId0)?.key ?? '' : ''}`
  const [tiles, setTiles] = useState<SplashTile[] | null>(() => (LAST && LAST.key === key0 ? LAST.tiles : null))
  const [map, setMap] = useState<MoneyMap | null>(() => (LAST && LAST.key === key0 ? LAST.map : null))
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<McpServer[]>([])
  const [reload, setReload] = useState(0)
  const selectedChainId = useYeetfulStore((s) => s.selectedChainId)
  const chainKey = selectedChainId ? chainById(selectedChainId)?.key ?? '' : ''

  const slugs = useMemo(() => servers.map((s) => s.slug), [servers])
  const key = `${address ?? ''}|${servers.map((s) => s.id).sort().join(',')}|${chainKey}`

  const coveredRef = useRef<{ base: string; byId: Map<string, string> } | null>(null)
  const tilesRef = useRef<SplashTile[] | null>(tiles)
  const commit = (next: SplashTile[] | null) => {
    tilesRef.current = next
    setTiles(next)
  }
  const lastReloadRef = useRef(reload)

  useEffect(() => {
    if (!address || servers.length === 0) {
      coveredRef.current = null
      commit(servers.length === 0 && address ? [] : null)
      setPending([])
      setLoading(false)
      return
    }
    let alive = true
    const base = `${address}|${chainKey}`
    const covered = coveredRef.current
    const forceFull = reload !== lastReloadRef.current
    lastReloadRef.current = reload

    if (forceFull || !covered || covered.base !== base) {
      // A remembered scan of this exact page is on screen: re-read behind it.
      const warm = !forceFull && !covered && LAST?.key === key && tilesRef.current !== null
      if (!warm) {
        setLoading(true)
        commit(null)
      }
      setPending([])
      const scanned = servers.map((s) => [s.id, s.slug] as const)
      fetch('/api/splash', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, servers, manualSlugs: slugs, ...(chainKey ? { chain: chainKey } : {}) }),
      })
        .then((r) => r.json())
        .then((data: { tiles?: SplashTile[]; map?: MoneyMap | null }) => {
          if (!alive) return
          setMap(data.map && typeof data.map === 'object' ? data.map : null)
          coveredRef.current = { base, byId: new Map(scanned) }
          commit(Array.isArray(data.tiles) ? data.tiles : [])
        })
        .catch(() => {
          // Transport failure: settle empty (or keep the remembered page) and
          // leave `covered` unset, so the next change retries the whole scan.
          if (alive && !warm) commit([])
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
      return () => {
        alive = false
      }
    }

    // Same wallet + chain: only the set changed.
    const ids = new Set(servers.map((s) => s.id))
    const removed = new Set<string>()
    for (const [id, slug] of covered.byId) {
      if (!ids.has(id)) {
        removed.add(slug)
        covered.byId.delete(id)
      }
    }
    if (removed.size > 0) commit((tilesRef.current ?? []).filter((t) => !removed.has(t.mcpSlug)))
    const fresh = servers.filter((s) => !covered.byId.has(s.id))
    if (fresh.length === 0) {
      setPending((prev) => (prev.length ? [] : prev))
      return
    }
    setPending(fresh)
    fetch('/api/splash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address,
        servers: fresh,
        manualSlugs: fresh.map((s) => s.slug),
        serversOnly: true,
        ...(chainKey ? { chain: chainKey } : {}),
      }),
    })
      .then((r) => r.json())
      .then((data: { tiles?: SplashTile[] }) => {
        if (!alive) return
        const freshSlugs = new Set(fresh.map((s) => s.slug))
        const add = (Array.isArray(data.tiles) ? data.tiles : []).filter((t) => freshSlugs.has(t.mcpSlug))
        commit([...(tilesRef.current ?? []).filter((t) => !freshSlugs.has(t.mcpSlug)), ...add])
        for (const s of fresh) covered.byId.set(s.id, s.slug)
        setPending([])
      })
      .catch(() => {
        if (alive) setPending([])
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload])

  // Remember every settled page (a full scan, a delta add, a removal).
  useEffect(() => {
    if (address && tiles && !loading && pending.length === 0 && servers.length > 0) LAST = { key, tiles, map }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, map, loading, pending.length, key])

  return { tiles, map, loading, pending, retry: () => setReload((n) => n + 1) }
}
