import type { ReactNode } from 'react'

// Numbered steps. <DocsSteps> is the <ol>; each <DocsStep title> is one step.
// The number is drawn by CSS (a counter in a violet tile), so the markup stays
// a plain ordered list a screen reader counts. The step title is not a
// heading on purpose: DocsHeadingAnchors and DocsToc read h2/h3 only, and a
// step is not a section.

export function DocsSteps({ children }: { children: ReactNode }) {
  return <ol className="docs__steps">{children}</ol>
}

export function DocsStep({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <li className="docs__step">
      <p className="docs__steptitle">{title}</p>
      {children != null && <div className="docs__stepbody">{children}</div>}
    </li>
  )
}
