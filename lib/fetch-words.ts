// What a visitor reads when one of OUR routes fails without saying why.
//
// A route that throws answers an empty 500, and the callers used to fall back
// to `HTTP ${status}` (or let `res.json()` throw "Unexpected end of JSON
// input") and print that under the button. A stranger can't act on a status
// code and reads it as "this site is broken". Every fallback goes through
// here instead: the thing that failed, by name, and the one next step.
//
// Pure: no React, no fetch. Pinned in scripts/gtm-onboard-pins.ts.

/** `thing` is a noun phrase with its article: "The ideas board". */
export function notAnswering(thing: string, next = 'Try again in a moment.'): string {
  const t = thing.trim().replace(/[.\s]+$/, '')
  return `${t} is not answering right now. ${next}`
}

/** Read a JSON body that may be empty or not JSON at all. Never throws. */
export async function readJson<T>(res: Response): Promise<Partial<T> & { error?: string }> {
  try {
    return (await res.json()) as Partial<T> & { error?: string }
  } catch {
    return {}
  }
}

/** True for text that leaks plumbing: a status code, a parser exception,
 *  a fetch failure in the browser's own words. Used to filter a caught
 *  error's message before it is shown. */
export function leaksPlumbing(text: string): boolean {
  return /\bHTTP \d{3}\b|^[a-z]+ \d{3}$|Unexpected (end|token)|is not valid JSON|Failed to fetch|NetworkError|Load failed|execute 'json'/i.test(text)
}

/** The message to show for a caught error: its own words when they were
 *  written for a person, the named fallback when they leak plumbing. */
export function shownError(e: unknown, thing: string, next?: string): string {
  const m = e instanceof Error ? e.message : ''
  return m && !leaksPlumbing(m) ? m : notAnswering(thing, next)
}

/** The chat reply when the house model did not answer (an outage, a rate
 *  limit, a missing key). It used to read "house synthesis unavailable
 *  (ANTHROPIC_API_KEY missing or the API call failed)" in the thread. Trades
 *  don't need the model: the native builders answer money asks on their own,
 *  so the reply says so and keeps the visitor moving. */
export const HOUSE_UNAVAILABLE_REPLY =
  'I could not write an answer just now: the model behind open questions did not respond. Nothing moved. Ask again in a moment. Trades do not wait on it: a sentence like "Buy $25 of ETH" still builds for your wallet to sign.'

/** The site-wide error page (app/error.tsx, app/global-error.tsx). */
export const PAGE_ERROR_COPY = {
  eyebrow: 'something broke',
  title: 'This page did not load.',
  body: 'That is on us, not your wallet. Nothing ran and nothing was signed. Try again; if it keeps happening, the markets and the docs are still up.',
  retry: 'Try again',
  refLabel: 'Reference',
} as const
