'use client'

// THE TOUR · SIDES-A's one small control (squad landing, 2026-11-10): a
// segmented choice (a size, a side, an amount). A real group of buttons with
// aria-pressed, so a keyboard and a screen reader get what a thumb gets.
// Look: ./kit.css `.ta-seg`.

import type { ReactNode } from 'react'

export interface SegOption<T extends string | number> {
  value: T
  label: ReactNode
  /** What a screen reader says when the label is a bare number. It must
   *  CONTAIN the visible label (WCAG 2.5.3: "1,000" reads "1,000 readers");
   *  a label that reads by itself ("$25") takes none. */
  say?: string
}

export function Seg<T extends string | number>({ label, options, value, onChange, journey }: { label: string; options: readonly SegOption<T>[]; value: T; onChange: (v: T) => void; journey: (v: T) => string }) {
  return (
    <div className="ta-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`ta-seg__opt mono${o.value === value ? ' is-on' : ''}`} aria-pressed={o.value === value} aria-label={o.say} onClick={() => onChange(o.value)} data-journey={journey(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
