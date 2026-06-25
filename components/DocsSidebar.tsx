'use client'

// Docs left rail (top scroll-row on phones — same pattern as the dashboard).
// Pathname-driven active state; pages appear as their iterations ship them.
// Legal pages render in their own labeled group at the bottom.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { guidePages, legalPages } from '@/lib/docs'

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
      {guidePages().map((p) => link(p.slug, p.title))}
      {legal.length > 0 && (
        <>
          <p className="docs__sidegroup mono">LEGAL</p>
          {legal.map((p) => link(p.slug, p.title))}
        </>
      )}
    </nav>
  )
}
