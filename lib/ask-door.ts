// The ask door — "ask Pantessa from anywhere" (2026-09-11).
//
// The product's thesis is one sentence in, a guarded transaction out. Until
// now that sentence could only be typed on /chat, on an intent link, or on a
// symbol page's Trade tab; the rest of the site was a brochure you had to
// leave. The door is the site-wide composer: a docked pill on every page, an
// Ask button in the nav, ⌘K anywhere — and the ask RUNS where you are, in a
// sheet, through the same ChatInterface the /i runtime mounts in `simple`
// mode. Your wallet signs; nothing else moves.
//
// This module is the door's state (a tiny zustand store any surface can open
// with a prefill) plus the two pure helpers the harness pins:
//   • askDoorNav — chart / markets asks are READS the client already owns:
//     "show me the ETH chart" navigates to /t/ETH, zero turns burned.
//   • askDoorChips — the suggestion row is context-aware: on /t/<sym> it is
//     that symbol's real trade asks (the chip IS the contract), elsewhere the
//     curated example prompts.

import { create } from 'zustand'
import { chartPairFor, normalizeChartSymbol, parseChartAsk } from '@/lib/charts'
import { parseMarketsNavAsk } from '@/lib/markets'
import { EXAMPLE_PROMPTS } from '@/lib/examples'
import { tradeAsks } from '@/lib/trade-asks'

export interface AskDoorChip {
  label: string
  ask: string
}

interface AskDoorState {
  open: boolean
  /** Text waiting in the door's composer (a surface opened it with a draft). */
  draft: string
  openDoor: (draft?: string) => void
  closeDoor: () => void
  setDraft: (draft: string) => void
}

export const useAskDoor = create<AskDoorState>()((set) => ({
  open: false,
  draft: '',
  openDoor: (draft) => set((s) => ({ open: true, draft: typeof draft === 'string' ? draft : s.draft })),
  closeDoor: () => set({ open: false }),
  setDraft: (draft) => set({ draft }),
}))

/** Routes the door never renders on: the chat IS the composer, the embed and
 *  the intent-link runtime own their whole viewport. Pure — pinned. */
export function askDoorHidden(pathname: string): boolean {
  return pathname === '/chat' || pathname.startsWith('/chat/') || pathname.startsWith('/embed') || pathname.startsWith('/i/')
}

/** The docked pill additionally steps aside where a composer already lives
 *  (the dashboard's DashAskBar). ⌘K still opens the door there. */
export function askDoorPillHidden(pathname: string): boolean {
  return askDoorHidden(pathname) || pathname.startsWith('/dashboard')
}

/**
 * A navigation ask → its href, else null. Chart asks land on the symbol page
 * (the chart, the tabs and the order panel — a strictly better answer than
 * the chat overlay for a visitor who isn't in the chat); markets-nav asks
 * likewise. A money verb never matches (parseChartAsk refuses it), so
 * "buy $5 of ETH" stays an action ask. Chartless tokens fall through to the
 * runtime, which refuses them by name.
 */
export function askDoorNav(text: string): string | null {
  const nav = parseMarketsNavAsk(text)
  if (nav) return nav.href
  const chart = parseChartAsk(text)
  if (chart?.pair) return `/t/${chart.pair.symbol}`
  return null
}

/** The symbol a pathname is about (/t/<sym>), when it is a charted one. */
export function askDoorSymbol(pathname: string): string | null {
  const m = pathname.match(/^\/t\/([^/?#]+)/)
  if (!m) return null
  const pair = chartPairFor(normalizeChartSymbol(decodeURIComponent(m[1])))
  return pair?.symbol ?? null
}

/** Context-aware suggestion chips for the door. */
export function askDoorChips(pathname: string): AskDoorChip[] {
  const sym = askDoorSymbol(pathname)
  if (sym) {
    const pair = chartPairFor(sym)
    if (pair) {
      const asks = tradeAsks(pair).map((a) => ({ label: a.label, ask: a.ask }))
      // "What's going on with X" is the read every trader asks first — a
      // planner turn with the venue's own data behind it.
      return [...asks, { label: `Why is ${sym} moving?`, ask: `What is moving ${sym} right now — price, 24h change, and the news behind it?` }]
    }
  }
  return EXAMPLE_PROMPTS.map((p) => ({ label: p.label, ask: p.prompt }))
}

/** The composer placeholder: names the symbol on a symbol page. */
export function askDoorPlaceholder(pathname: string): string {
  const sym = askDoorSymbol(pathname)
  return sym ? `Ask anything about ${sym} — buy it, protect it, chart it…` : 'Ask Pantessa — swaps, stocks, stop-losses, anything…'
}
