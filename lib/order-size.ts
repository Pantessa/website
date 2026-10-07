// One order size per symbol page (2026-10-07, Nate: "when I enter my own
// amount can you update the amounts here" — the venue map still quoted $50
// a row while the order ticket said $25).
//
// The header's order ticket, the Trade tab's order card and every RouteTable
// on the page (Overview, Trade) share ONE dollar size for the symbol through
// this store. A surface that CHANGES the size — a typed amount, a preset, the
// slider — publishes it under its own id; every other surface follows. A
// follower never re-publishes what it followed (the store returns the same
// state for an unchanged size, and a follow is applied as state, never as a
// hand-edit), so two tickets and a table cannot chase each other. Leverage
// rides one way: a perp ticket's leverage sets the table's slider; the
// table's own slider stays local (the ticket's presets are the sentence's
// grammar, pinned shape by shape).
//
// Pure helpers first (the harness pins them without rendering); the store at
// the end. Nothing here prices, builds or signs.

import { create } from 'zustand'

/** The route table's size presets (whole dollars). */
export const ROUTE_USD_PRESETS = [10, 25, 50, 100, 250] as const

export interface OrderSize {
  /** The chart symbol the size was set on — a size never follows across pages. */
  symbol: string
  /** Dollars as typed, to the cent; the route table rounds for its quotes. */
  usd: number
  /** A perp ticket's leverage (2 and up); null when the writer states none. */
  leverage: number | null
  /** The writer's own id (React useId) — a follower ignores its own writes. */
  by: string
}

interface OrderSizeState {
  size: OrderSize | null
  /** Publish a size. An unchanged size (same symbol, dollar and leverage, whoever wrote it) is a no-op. */
  setSize: (next: OrderSize) => void
  clear: () => void
}

/** The route table's dollar for a size: whole dollars, at least $1. */
export const routeUsdOf = (usd: number): number => Math.max(1, Math.round(usd))

/** Two sizes agree when symbol, dollar (to the cent) and leverage agree; the writer never matters. */
export function sameOrderSize(a: Pick<OrderSize, 'symbol' | 'usd' | 'leverage'> | null, b: Pick<OrderSize, 'symbol' | 'usd' | 'leverage'>): boolean {
  return !!a && a.symbol === b.symbol && Math.abs(a.usd - b.usd) < 0.005 && (a.leverage ?? null) === (b.leverage ?? null)
}

/** A publishable size: a finite dollar of at least $1 on a symbol, to the cent; leverage only above 1. */
export function orderSizeOf(symbol: string, usd: number | null | undefined, leverage: number | null | undefined, by: string): OrderSize | null {
  if (!symbol || usd == null || !Number.isFinite(usd) || usd < 1) return null
  const lev = leverage != null && Number.isFinite(leverage) && leverage > 1 ? Math.round(leverage) : null
  return { symbol, usd: Math.round(usd * 100) / 100, leverage: lev, by }
}

/** What a surface follows: a size set on THIS symbol by SOMEONE ELSE. */
export function followOrderSize(size: OrderSize | null, symbol: string, self: string): OrderSize | null {
  if (!size || size.symbol !== symbol || size.by === self) return null
  return size
}

/** How the route table shows a followed dollar: the matching preset lit, else its custom box with the whole dollar. */
export function routeSizeView(usd: number, presets: readonly number[] = ROUTE_USD_PRESETS): { preset: number | null; custom: string } {
  const whole = routeUsdOf(usd)
  return presets.includes(whole) && Math.abs(usd - whole) < 0.005 ? { preset: whole, custom: '' } : { preset: null, custom: String(whole) }
}

export const useOrderSize = create<OrderSizeState>((set) => ({
  size: null,
  setSize: (next) => set((s) => (sameOrderSize(s.size, next) ? s : { size: next })),
  clear: () => set({ size: null }),
}))
