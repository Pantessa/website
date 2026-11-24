import type { ReactNode } from 'react'

// A two-column fact table: label on the left, value on the right. A <dl>, so
// it reads as pairs; stacks to one column on a phone.

export default function DocsFacts({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="docs__facts">
      {rows.map(([label, value], i) => (
        <div className="docs__factrow" key={i}>
          <dt className="docs__factlabel">{label}</dt>
          <dd className="docs__factvalue">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
