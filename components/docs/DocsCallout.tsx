import type { ReactNode } from 'react'

// A boxed aside. note and tip wear the brand violet, warn the brand magenta.
// Never green or red: those mean the market (up/down), not "good"/"bad".
// Children may be plain text or <p>s.

export type DocsCalloutKind = 'note' | 'warn' | 'tip'

const LABEL: Record<DocsCalloutKind, string> = { note: 'Note', tip: 'Tip', warn: 'Watch out' }

export default function DocsCallout({ kind = 'note', title, children }: { kind?: DocsCalloutKind; title?: ReactNode; children: ReactNode }) {
  return (
    <aside className={`docs__callout docs__callout--${kind}`} role="note">
      <p className="docs__callouttitle mono">{title ?? LABEL[kind]}</p>
      <div className="docs__calloutbody">{children}</div>
    </aside>
  )
}
