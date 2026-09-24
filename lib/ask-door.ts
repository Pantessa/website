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

/** A page that hosts its own ask composer takes the door (see `dock`). */
export type AskDock = (draft: string | undefined, opts?: { send?: boolean; mcps?: string[] }) => void

export interface AskDoorChip {
  label: string
  ask: string
}

interface AskDoorState {
  open: boolean
  /** Text waiting in the door's composer (a surface opened it with a draft). */
  draft: string
  /** An ask a surface handed over to RUN, not to draft — a wallet flag's
   *  "Fix gas on Arbitrum", a "Rebalance for me" shape. The sheet sends it
   *  the moment it opens (the chip-send contract: the click is the send,
   *  the wallet signature is the gate). `at` makes a repeat of the same
   *  text a fresh handoff. */
  fire: { text: string; at: number; mcps?: string[] } | null
  /** Open the door. With `send: true` the text runs instead of waiting in
   *  the composer (an empty text still just opens the door); `mcps` names
   *  the slugs the ask's gate needs on — the sheet turns them on first. */
  openDoor: (draft?: string, opts?: { send?: boolean; mcps?: string[] }) => void
  closeDoor: () => void
  setDraft: (draft: string) => void
  /** The sheet took the pending ask. */
  takeFire: () => void
  /** MK2/AI: the symbol brief's chips (the model's picks from OUR menu,
   *  ladder-approved server-side) for the symbol page they were written
   *  on. The door's suggestion row merges them in on /t/<sym>. */
  briefChips: { symbol: string; chips: AskDoorChip[] } | null
  setBriefChips: (v: { symbol: string; chips: AskDoorChip[] } | null) => void
  /** A page with its own conversation (2026-09-24: /t/<sym>'s Ask the chart,
   *  which builds trades in an order ticket beside it) takes the door while
   *  it is mounted: ⌘K, the pill, the rail's Ask and every `openDoor` call
   *  land THERE — a draft focuses its composer, a `send` runs in its ticket.
   *  One conversation per page, and never two chat runtimes sharing the
   *  store's current chat. Cleared on unmount; the sheet is the door again. */
  dock: AskDock | null
  setDock: (dock: AskDock | null) => void
}

export const useAskDoor = create<AskDoorState>()((set, get) => ({
  open: false,
  draft: '',
  fire: null,
  openDoor: (draft, opts) => {
    const dock = get().dock
    if (dock) {
      dock(draft, opts)
      return
    }
    set((s) =>
      opts?.send && typeof draft === 'string' && draft.trim()
        ? { open: true, draft: '', fire: { text: draft.trim(), at: Date.now(), ...(opts.mcps?.length ? { mcps: opts.mcps } : {}) } }
        : { open: true, draft: typeof draft === 'string' ? draft : s.draft },
    )
  },
  closeDoor: () => set({ open: false }),
  setDraft: (draft) => set({ draft }),
  takeFire: () => set({ fire: null }),
  briefChips: null,
  setBriefChips: (briefChips) => set({ briefChips }),
  dock: null,
  setDock: (dock) => set({ dock }),
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

/** Context-aware suggestion chips for the door. `brief` (MK2/AI) adds the
 *  symbol brief's chips on that symbol's page — after the trade asks,
 *  deduped by sentence, never on another symbol's page. Without it the
 *  row is byte-identical to before (the SSR pins). */
export function askDoorChips(pathname: string, brief?: { symbol: string; chips: AskDoorChip[] } | null): AskDoorChip[] {
  const sym = askDoorSymbol(pathname)
  if (sym) {
    const pair = chartPairFor(sym)
    if (pair) {
      const asks = tradeAsks(pair).map((a) => ({ label: a.label, ask: a.ask }))
      const seen = new Set(asks.map((a) => a.ask))
      const extra = brief && brief.symbol === sym ? brief.chips.filter((c) => !seen.has(c.ask)).slice(0, 4) : []
      // "What's going on with X" is the read every trader asks first — a
      // planner turn with the venue's own data behind it.
      return [...asks, ...extra, { label: `Why is ${sym} moving?`, ask: `What is moving ${sym} right now — price, 24h change, and the news behind it?` }]
    }
  }
  return EXAMPLE_PROMPTS.map((p) => ({ label: p.label, ask: p.prompt }))
}

/** The composer placeholder: names the symbol on a symbol page. */
export function askDoorPlaceholder(pathname: string): string {
  const sym = askDoorSymbol(pathname)
  return sym ? `Ask anything about ${sym} — buy it, protect it, chart it…` : 'Ask Pantessa — swaps, stocks, stop-losses, anything…'
}
