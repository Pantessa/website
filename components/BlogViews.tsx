'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye } from 'lucide-react'

// View counter for a blog post's meta row. Renders the server-fetched count
// immediately, then fires the view beacon once per page load and swaps in the
// fresh total. The ref guard keeps React 19 strict-mode's double effect (and
// any re-render) from counting one load twice.
export default function BlogViews({ slug, initial }: { slug: string; initial: number }) {
  const [views, setViews] = useState(initial)
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    fetch(`/api/blog/${encodeURIComponent(slug)}/view`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.views === 'number') setViews(d.views)
      })
      .catch(() => {}) // the count is decoration — never let the beacon surface an error
  }, [slug])

  return (
    <span className="blog__views" title={`${views.toLocaleString('en-US')} page loads`}>
      <Eye width={13} height={13} aria-hidden="true" />
      {views.toLocaleString('en-US')} {views === 1 ? 'view' : 'views'}
    </span>
  )
}
