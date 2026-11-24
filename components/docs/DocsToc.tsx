'use client'

// "On this page": lists the page's h2s inside .docs__prose and marks the one
// in view. Mounted once by app/docs/layout.tsx, so every docs page gets it
// with no page edit. Shown as a sticky right column at >=1280px (docs.css),
// hidden below. Renders NOTHING on a page with fewer than three h2s.
//
// Ids come from DocsHeadingAnchors: anchorDocsHeadings() is idempotent, so
// calling it here first means this list never waits on (or fights) that
// component's effect order.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { anchorDocsHeadings } from '@/components/DocsHeadingAnchors'

type Item = { id: string; text: string }

const MIN_HEADINGS = 3
/** A heading counts as "in view" once its top passes this line (px from the viewport top). */
const ACTIVE_LINE = 140

export default function DocsToc() {
  const pathname = usePathname()
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    anchorDocsHeadings()
    const heads = Array.from(document.querySelectorAll<HTMLElement>('.docs__main .docs__prose h2')).filter((h) => h.id)
    const next = heads.map((h) => ({ id: h.id, text: (h.textContent || '').trim() })).filter((i) => i.text)
    setItems(next)
    if (next.length < MIN_HEADINGS) {
      setActive(null)
      return
    }

    let frame = 0
    const measure = () => {
      frame = 0
      let current = heads[0].id
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= ACTIVE_LINE) current = h.id
        else break
      }
      // At the very bottom the last short sections can never reach the line.
      const doc = document.documentElement
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) current = heads[heads.length - 1].id
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [pathname])

  if (items.length < MIN_HEADINGS) return null

  return (
    <nav className="docs__toc" aria-label="On this page">
      <p className="docs__toctitle mono">On this page</p>
      <ol className="docs__toclist">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className={`docs__toclink${active === i.id ? ' is-on' : ''}`}
              aria-current={active === i.id ? 'location' : undefined}
              onClick={() => setActive(i.id)}
            >
              {i.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
