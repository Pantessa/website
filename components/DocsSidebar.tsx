'use client'

// Docs left rail (top scroll-row on phones — same pattern as the dashboard).
// Pathname-driven active state; pages appear as their iterations ship them.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { readyPages } from '@/lib/docs'

export default function DocsSidebar() {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)

  // Keep the active entry in view on the mobile scroll-row.
  useEffect(() => {
    nav.current
      ?.querySelector('.is-on')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <nav className="docs__side" aria-label="Docs pages" ref={nav}>
      {readyPages().map((p) => {
        const href = p.slug ? `/docs/${p.slug}` : '/docs'
        const active = pathname === href
        return (
          <Link key={href} href={href} className={`docs__link ${active ? 'is-on' : ''}`}>
            {p.title}
          </Link>
        )
      })}
    </nav>
  )
}
