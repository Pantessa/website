import type { ReactNode } from 'react'

// The "In short" box under a docs page's lead: 3 to 5 one-line facts the
// reader must not miss. Children are <li>s. Styles: app/docs/docs.css.

export default function DocsSummary({ title = 'In short', children }: { title?: string; children: ReactNode }) {
  return (
    <section className="docs__summary" aria-label={title}>
      <p className="docs__summarytitle mono">{title}</p>
      <ul className="docs__summarylist">{children}</ul>
    </section>
  )
}
