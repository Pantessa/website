'use client'

// Service description with a 2-line clamp + an inline more/less toggle, so a long
// description doesn't push the page content (and the trade rail) down.

import { useState } from 'react'

// ~2 lines at the .svc__desc measure (70ch). Below this, never clamp.
const CLAMP_THRESHOLD = 140

export default function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const clampable = text.length > CLAMP_THRESHOLD

  return (
    <div className="svc__descwrap">
      <p className={`svc__desc${clampable && !open ? ' svc__desc--clamp' : ''}`}>{text}</p>
      {clampable && (
        <button className="svc__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}
