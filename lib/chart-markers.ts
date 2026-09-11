'use client'

// "Show on chart" — the client-side bridge between the News tab (COMM) and
// the chart engine (CHART). A headline toggled on becomes a marker
// `{ t, label, url }` keyed by symbol; `MarketChart` reads
// `useChartMarkers(symbol)` and draws them on the matching bar. No provider,
// no dependency: a module-level store + useSyncExternalStore, so the tab and
// the chart can live anywhere in the tree (or in different lanes' code).
//
// Session-only on purpose: markers are a reading aid, not saved state; a
// reload starts clean.

import { useSyncExternalStore } from 'react'

export interface ChartMarker {
  /** Stable id (the news item id) so a refetch keeps the toggle. */
  id: string
  /** Unix seconds. */
  t: number
  label: string
  url?: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let markers: Record<string, ChartMarker[]> = {}
const EMPTY: ChartMarker[] = []

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getChartMarkers(symbol: string): ChartMarker[] {
  return markers[symbol] ?? EMPTY
}

export function isMarked(symbol: string, id: string): boolean {
  return getChartMarkers(symbol).some((m) => m.id === id)
}

export function toggleChartMarker(symbol: string, marker: ChartMarker): void {
  const cur = getChartMarkers(symbol)
  const next = cur.some((m) => m.id === marker.id) ? cur.filter((m) => m.id !== marker.id) : [...cur, marker].sort((a, b) => a.t - b.t)
  markers = { ...markers, [symbol]: next }
  emit()
}

export function clearChartMarkers(symbol: string): void {
  if (!markers[symbol]?.length) return
  markers = { ...markers, [symbol]: EMPTY }
  emit()
}

/** Live markers for a symbol — what the chart draws. */
export function useChartMarkers(symbol: string): ChartMarker[] {
  return useSyncExternalStore(
    subscribe,
    () => getChartMarkers(symbol),
    () => EMPTY,
  )
}
