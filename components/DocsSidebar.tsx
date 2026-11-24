'use client'

// Docs left rail (top scroll-row on phones, same pattern as the dashboard).
// Pathname-driven active state; pages appear as their iterations ship them.
// The five groups (START HERE, EARN, SAFETY, BUILD, LEGAL) come from
// lib/docs DOCS_GROUPS in reading order, LEGAL last.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, useEffect, useRef } from 'react'
import { DOCS_GROUPS, groupPages } from '@/lib/docs'

export default function DocsSidebar() {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)

  // Keep the active entry in view on the mobile scroll-row. Scroll the ROW
  // itself, never scrollIntoView: on desktop the rail is a plain column and
  // an active entry below the fold (the desk page's, for one) made the
  // WINDOW jump ~74px on load — the H1 landed clipped under the sticky nav,
  // the exact frame a launch clip opens on.
  useEffect(() => {
    const el = nav.current
    const on = el?.querySelector<HTMLElement>('.is-on')
    if (!el || !on) return
    if (el.scrollWidth <= el.clientWidth) return // vertical rail — nothing to do
    const left = on.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
    el.scrollLeft = Math.max(0, left - (el.clientWidth - on.offsetWidth) / 2)
  }, [pathname])

  const link = (slug: string, title: string) => {
    const href = slug ? `/docs/${slug}` : '/docs'
    const active = pathname === href
    return (
      <Link key={href} href={href} className={`docs__link ${active ? 'is-on' : ''}`}>
        {title}
      </Link>
    )
  }

  return (
    <nav className="docs__side" aria-label="Docs pages" ref={nav}>
      {link('', 'Overview')}
      {/* Fragments, not wrappers: the phone layout flattens the list into a
          horizontal scroll-row, so links must stay direct flex children. */}
      {DOCS_GROUPS.map((g) => {
        const pages = groupPages(g.id)
        if (pages.length === 0) return null
        return (
          <Fragment key={g.id}>
            <p className="docs__sidegroup mono">{g.label}</p>
            {pages.map((p) => link(p.slug, p.title))}
          </Fragment>
        )
      })}
    </nav>
  )
}
