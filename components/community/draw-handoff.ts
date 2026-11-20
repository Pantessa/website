// "Draw it on the chart" from a composer that has no chart (a room, the
// community feed), 2026-11-20. Before the link leaves, the composer hands its
// draft to the market page's own composer (the one that sees the live
// drawing) and leaves a note saying where the post was going. The market page
// reads the note and shows one bar over the chart: "Post to <room>". Pressing
// it opens the Community tab, where the draft is waiting with the room picked
// and "Attach my current chart" ready. Everything lives in sessionStorage:
// this tab only, gone with it, never sent anywhere.

import type { FeedKind } from '@/lib/community/spec'

/** The composer's saved draft (Composer.tsx reads and writes it). */
export const DRAFT_KEY = 'pantessa.community.draft'
export const DRAFT_TTL_MS = 30 * 60_000
/** The note the market page reads: where the drawing is headed. */
export const DRAW_FOR_KEY = 'pantessa.community.drawFor'

export interface DrawFor {
  symbol: string
  /** Room slug, or '' for the market's own board. */
  room: string
  /** What the bar calls it ("UNI Corns", or the market's board). */
  label: string
  at: number
}

/** The scope key the market page's composer files its draft under (Composer: `${community}|${symbol}`). */
export const marketScope = (symbol: string) => `|${symbol}`

export function handOffDraw(input: { symbol: string; room: string; label: string; kind: FeedKind; title: string; body: string; url: string }): void {
  try {
    const at = Date.now()
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ scope: marketScope(input.symbol), at, draft: { kind: input.kind, market: input.symbol, title: input.title, body: input.body, url: input.url, room: input.room } }),
    )
    window.sessionStorage.setItem(DRAW_FOR_KEY, JSON.stringify({ symbol: input.symbol, room: input.room, label: input.label, at } satisfies DrawFor))
  } catch {
    // storage blocked: the link still opens the chart, the draft stays behind
  }
}

export function readDrawFor(symbol: string): DrawFor | null {
  try {
    const raw = window.sessionStorage.getItem(DRAW_FOR_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<DrawFor>
    if (d.symbol !== symbol || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_TTL_MS) return null
    return { symbol, room: typeof d.room === 'string' ? d.room : '', label: typeof d.label === 'string' && d.label ? d.label.slice(0, 60) : 'the community', at: d.at }
  } catch {
    return null
  }
}

export function clearDrawFor(): void {
  try {
    window.sessionStorage.removeItem(DRAW_FOR_KEY)
  } catch {
    // nothing stored
  }
}
