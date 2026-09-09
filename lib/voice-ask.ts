// The voice door's one pure seam: what the browser's speech recognizer
// heard → the sentence the ask ladder reads. Speech comes back in prose
// ("buy ten dollars worth of eth", "five percent stop") where a typed ask
// carries symbols ("$10", "5%"). The swap grammar already reads spelled-out
// dollars (the 2026-09-08 squad's affordability find), so this normalizer is
// belt-and-suspenders across EVERY layer: number words become digits, money
// words become the $ sign, percent becomes %. Nothing here decides what the
// ask MEANS — the same ladder that reads a typed ask reads the result, and
// every transactional outcome still ends at the wallet signature.
//
// Pure + client-safe (runs in the composer before the send). Pinned in
// scripts/test-api.ts.

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000 }

const NUMBER_WORD_RE = new RegExp(
  `\\b(?:(?:a|an|${[...Object.keys(UNITS), ...Object.keys(TENS)].join('|')})(?:[\\s-]+(?:and[\\s-]+)?(?:${[...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES)].join('|')}))*)\\b`,
  'gi',
)

/** "two hundred and fifty" → 250; "a hundred" → 100; "twenty five" → 25. */
function wordsToNumber(phrase: string): number | null {
  const parts = phrase.toLowerCase().split(/[\s-]+/).filter((p) => p && p !== 'and')
  let total = 0
  let current = 0
  let sawNumber = false
  for (const p of parts) {
    if (p === 'a' || p === 'an') {
      current = current || 1
      continue
    }
    if (p in UNITS) {
      current += UNITS[p]
      sawNumber = true
    } else if (p in TENS) {
      current += TENS[p]
      sawNumber = true
    } else if (p in SCALES) {
      const scale = SCALES[p]
      current = (current || 1) * scale
      if (scale >= 1000) {
        total += current
        current = 0
      }
      sawNumber = true
    } else {
      return null
    }
  }
  return sawNumber ? total + current : null
}

/**
 * Normalize a spoken transcript into a typed-looking ask. Idempotent on
 * already-typed asks ("Buy $10 of ETH" comes back byte-identical), so the
 * composer can run it on every send without a voice flag.
 */
export function normalizeSpokenAsk(transcript: string): string {
  let s = transcript.replace(/\s+/g, ' ').trim()
  if (!s) return ''

  // Number words → digits. A lone "a"/"an" is an article, not "1": only
  // convert it when a scale word follows ("a hundred", "a thousand").
  s = s.replace(NUMBER_WORD_RE, (m) => {
    const lower = m.toLowerCase()
    if (/^(a|an)$/.test(lower)) return m
    // "a five percent stop" / "a two x long": the article is prose — keep it
    // and convert the number that follows it.
    const article = /^(an?)[\s-]+/.exec(lower)
    if (article && !/(hundred|thousand|million)/.test(lower)) {
      const rest = m.slice(article[0].length)
      const n = wordsToNumber(rest)
      return n === null ? m : `${m.slice(0, article[1].length)} ${n}`
    }
    const n = wordsToNumber(m)
    return n === null ? m : String(n)
  })
  // "1 point 5" (speech splits decimals) → "1.5"
  s = s.replace(/\b(\d+) point (\d+)\b/gi, '$1.$2')
  // "2 x long" / "two ex long" (speech spaces the multiplier) → "2x long"
  s = s.replace(/\b(\d+(?:\.\d+)?) ?(?:x|ex|times) (long|short|leverage)\b/gi, '$1x $2')
  // Money words → the $ sign the ladder reads. "$ 10" (some recognizers
  // space it) and "10 dollars" / "10 bucks" / "10 USD" all become "$10".
  s = s.replace(/\$\s+(\d)/g, '$$$1')
  s = s.replace(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:us\s*)?(?:dollars?|bucks|usd)\b/gi, '$$$1')
  // "5 percent" → "5%"
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:percent|per cent)\b/gi, '$1%')
  return s.replace(/\s+/g, ' ').trim()
}
