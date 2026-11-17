// The venues' top-of-book quotes a page holds (2026-11-10). MarketChart opens
// the light feed (lib/depth-feed openTopOfBook) and publishes here; the depth
// view reads it (its legend's last trade, Hyperliquid's exact mid) without
// re-rendering the chart on every quote. Keyed by lib/depth topQuoteKey.

import { create } from 'zustand'
import type { TopQuote } from '@/lib/depth'

interface TopQuoteStore {
  quotes: Record<string, TopQuote>
}

export const useTopQuotes = create<TopQuoteStore>(() => ({ quotes: {} }))

/** Publish a venue's quote; null drops it (the feed closed). */
export function publishTopQuote(key: string, quote: TopQuote | null): void {
  useTopQuotes.setState((s) => {
    if (!quote) {
      if (!(key in s.quotes)) return s
      const next = { ...s.quotes }
      delete next[key]
      return { quotes: next }
    }
    return { quotes: { ...s.quotes, [key]: quote } }
  })
}

/** One venue's quote, or null. */
export function useTopQuote(key: string | null): TopQuote | null {
  return useTopQuotes((s) => (key ? (s.quotes[key] ?? null) : null))
}
