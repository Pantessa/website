// THE SCORE BAR (squad mobile-sleek, 2026-11-24): a record's whole tally as
// one flat bar, each verdict a segment as wide as its share, the counts in
// words under it. It replaces a row of four pills: on a phone the bar is one
// line tall and the proportions read before the numbers do.
//
// Honest by construction: every verdict the scan counted has a segment
// (misses sit beside hits), and the words are the contract's own
// (lib/called-it/spec VERDICT_WORDS), passed in by the caller so this file
// stays free of the feature's imports.
//
// Server-safe: no state.

import type { Verdict } from './VerdictTile'

export interface ScoreCounts {
  right: number
  wrong: number
  flat: number
  open: number
}

const ORDER: Verdict[] = ['right', 'wrong', 'flat', 'open']

export interface ScoreBarProps {
  counts: ScoreCounts
  /** The word for each verdict, e.g. spec's VERDICT_WORDS. */
  words: Record<Verdict, string>
  size?: 'md' | 'lg'
  /** The bar alone (the counts are printed elsewhere on the surface). */
  bare?: boolean
  className?: string
}

export default function ScoreBar({ counts, words, size = 'md', bare, className }: ScoreBarProps) {
  const shown = ORDER.filter((v) => counts[v] > 0)
  if (shown.length === 0) return null
  const spoken = shown.map((v) => `${counts[v]} ${words[v]}`).join(', ')
  return (
    <div className={`sk-score${size === 'lg' ? ' sk-score--lg' : ''}${bare ? ' sk-score--bare' : ''}${className ? ` ${className}` : ''}`}>
      <div className="sk-score__bar" role="img" aria-label={spoken}>
        {shown.map((v) => (
          <i key={v} className={`sk-${v}`} style={{ flexGrow: counts[v], flexBasis: 0 }} />
        ))}
      </div>
      {!bare && (
        <ul className="sk-score__nums" aria-hidden="true">
          {shown.map((v) => (
            <li key={v} className={`sk-${v}`}>
              <b>{counts[v]}</b>
              <span>{words[v]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
