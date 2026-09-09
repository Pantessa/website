import { VOICE_CHAINS, VOICE_NOUNS, VOICE_VENUES } from './voice-lexicon'

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
  s = correctDomainWords(s)

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

// ── Domain-word correction ──────────────────────────────────────────────────
// The recognizer maps words it doesn't know to the nearest English ones:
// "show me my position on Morpho" came back "addition on Mortal" on the
// first real drill (2026-09-09). Full edit-distance can't rescue that
// (Mortal→Morpho is 3 substitutions in 6 letters) — but the SLOT can: after
// "on / in / at / with / via / from / to" the product only ever names a venue
// or a chain, so a word in that slot that STARTS like one of ours and is
// about the same length IS that one. Same idea for the noun before the slot
// ("addition" → "position" — a rhyme match, gated on a venue having resolved
// in the sentence so plain English never gets rewritten). Never touches a
// word that already is a vocabulary term.


const SLOT_PREP_RE = /\b(on|in|at|with|via|from|to|into|onto)\s+([A-Za-z][A-Za-z'-]{2,})\b/g
const SLOT_TERMS = [...new Set<string>([...VOICE_VENUES, ...VOICE_CHAINS])].filter((t) => !t.includes(' '))
const SLOT_LOWER = new Set(SLOT_TERMS.map((t) => t.toLowerCase()))
/** Nouns the slot corrector may re-hear, keyed by their rhyme (last 5 letters). */
const RHYME_NOUNS = (VOICE_NOUNS as readonly string[]).filter((n) => /^[a-z]+$/.test(n) && n.length >= 7)

/** "hyper liquid" / "open sea" / "cow swap" / "uni swap" / "near intents". */
const SPLIT_VENUES: [RegExp, string][] = [
  [/\bhyper[\s-]?liquid\b/gi, 'Hyperliquid'],
  [/\bopen[\s-]?sea\b/gi, 'OpenSea'],
  [/\bcow[\s-]?swap\b/gi, 'CoW Swap'],
  [/\buni[\s-]?swap\b/gi, 'Uniswap'],
  [/\bnear[\s-]?intents?\b/gi, 'NEAR Intents'],
  [/\brobin[\s-]?hood\b/gi, 'Robinhood'],
  [/\bmeta[\s-]?mask\b/gi, 'MetaMask'],
]

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

/** The venue/chain a mis-heard slot word most likely was, or null. */
export function nearestSlotTerm(word: string): string | null {
  const w = word.toLowerCase()
  if (SLOT_LOWER.has(w)) return null // already right
  let best: { term: string; score: number } | null = null
  for (const term of SLOT_TERMS) {
    const t = term.toLowerCase()
    const prefix = w.slice(0, 3) === t.slice(0, 3)
    const lenOk = Math.abs(w.length - t.length) <= 1
    const dist = levenshtein(w, t)
    // Two ways in: a shared 3-letter onset at the same length (Mortal →
    // Morpho, Moral → Morpho), or a small edit distance on a long term
    // (Hyperliquid, Arbitrum, Robinhood mis-heard by a letter or two).
    const ok = (prefix && lenOk) || (t.length >= 6 && dist <= 2)
    if (!ok) continue
    const score = dist - (prefix ? 1 : 0)
    if (!best || score < best.score) best = { term, score }
  }
  return best?.term ?? null
}

/** Correct venue/chain words in the preposition slot, then the noun before
 *  it when a venue did resolve. Returns the corrected sentence. */
export function correctDomainWords(text: string): string {
  // Compound venues the recognizer splits into two English words.
  let out = text
  for (const [split, term] of SPLIT_VENUES) out = out.replace(split, term)
  let venuePresent = false
  out = out.replace(SLOT_PREP_RE, (m, prep: string, word: string) => {
    if (SLOT_LOWER.has(word.toLowerCase())) {
      venuePresent = true
      return m
    }
    const term = nearestSlotTerm(word)
    if (!term) return m
    venuePresent = true
    return `${prep} ${term}`
  })
  if (!venuePresent) return out
  // "my addition on Morpho" → the noun that rhymes with one of ours.
  out = out.replace(/\b([a-z]{6,})\b(?=\s+(?:on|in|at|with|via|from)\s)/gi, (w: string) => {
    const lw = w.toLowerCase()
    if ((VOICE_NOUNS as readonly string[]).includes(lw)) return w
    const hit = RHYME_NOUNS.find((n) => n.slice(-5) === lw.slice(-5) && Math.abs(n.length - lw.length) <= 1)
    return hit ?? w
  })
  return out
}
