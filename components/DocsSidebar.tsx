'use client'

// Docs left rail (top scroll-row on phones — same pattern as the dashboard).
// Pathname-driven active state; pages appear as their iterations ship them.
// Legal pages render in their own labeled group at the bottom.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, useEffect, useRef } from 'react'
import { DOORS, doorPages, legalPages } from '@/lib/docs'

export default function DocsSidebar() {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)
  const legal = legalPages()

  // Keep the active entry in view on the mobile scroll-row.
  useEffect(() => {
    nav.current
      ?.querySelector('.is-on')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' as ScrollBehavior })
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
      {DOORS.map((d) => (
        <Fragment key={d.id}>
          <p className="docs__sidegroup mono">{`${d.label} · ${d.reader}`.toUpperCase()}</p>
          {doorPages(d.id).map((p) => link(p.slug, p.title))}
        </Fragment>
      ))}
      {legal.length > 0 && (
        <>
          <p className="docs__sidegroup mono">LEGAL</p>
          {legal.map((p) => link(p.slug, p.title))}
        </>
      )}
    </nav>
  )
}
