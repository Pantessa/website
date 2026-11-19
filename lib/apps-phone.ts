// THE APPS PAGE ON A PHONE — the rules (pure, client-safe; squad apps-page,
// PHONE lane, 2026-11-17). The desktop page's rules (lib/apps-page) decide
// how many apps get how much room; a phone has one column, so "side by side"
// becomes "one under another" and the rest stands as it is:
//   1 app      → FULL (the section's own one-column layout)
//   2 or 3     → SIDE sections, STACKED (never columns)
//   4 or more  → one LINE each, the quiet ones folded into one sentence
// Pinned in scripts/apps-phone-pins.ts.

import { densityFor, type AppsDensity, type SectionDensity } from '@/lib/apps-page'
import type { SuggestedPrompt } from '@/lib/splash/types'

export type PhoneLayout = 'empty' | 'full' | 'stack' | 'lines'

/** How the phone lays the apps out, and what each section is asked to draw. */
export function phoneLayoutFor(count: number): { layout: PhoneLayout; density: AppsDensity; section: SectionDensity | null } {
  const density = densityFor(count)
  switch (density) {
    case 'empty':
      return { layout: 'empty', density, section: null }
    case 'full':
      return { layout: 'full', density, section: 'full' }
    case 'side':
      return { layout: 'stack', density, section: 'side' }
    case 'lines':
      return { layout: 'lines', density, section: 'line' }
  }
}

/** How many suggestions ride above the pinned ask bar: one sideways row. */
export const PHONE_SUGGESTION_CAP = 2

/** The suggestions above the ask bar: the open apps' own asks, deduped by
 *  the sentence, at most two (a phone row has room for two pills). */
export function phoneSuggestions(all: SuggestedPrompt[], cap = PHONE_SUGGESTION_CAP): SuggestedPrompt[] {
  const seen = new Set<string>()
  const out: SuggestedPrompt[] = []
  for (const p of all) {
    if (!p?.prompt || seen.has(p.prompt)) continue
    seen.add(p.prompt)
    out.push(p)
    if (out.length >= cap) break
  }
  return out
}

/** What a submit on the ask bar does: a sentence runs in the chat; an empty
 *  bar only opens the conversation. */
export function askBarSubmit(text: string): { kind: 'send'; text: string } | { kind: 'open' } {
  const t = text.trim()
  return t ? { kind: 'send', text: t } : { kind: 'open' }
}
