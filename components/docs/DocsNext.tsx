import Link from 'next/link'
import { DOCS_PAGES } from '@/lib/docs'

// The "Next" cards at the bottom of a docs page: two or three pages to read
// after this one. Plain Links (docs pages are public; a link INTO the signed-in
// app does not belong here). The title is not a heading so it stays out of
// the "On this page" list. A card that points at a docs page takes that
// page's registry title (lib/docs), so it never names a page differently from
// the sidebar; `title` is only for a card that points elsewhere.

export type DocsNextLink = { href: string; title?: string; desc: string }

function cardTitle(l: DocsNextLink): string {
  const m = l.href.match(/^\/docs(?:\/([^/?#]+))?\/?(?:[?#].*)?$/)
  const page = m ? DOCS_PAGES.find((p) => p.slug === (m[1] ?? '')) : undefined
  return page?.title ?? l.title ?? l.href
}

export default function DocsNext({ links, title = 'Next' }: { links: DocsNextLink[]; title?: string }) {
  if (!links.length) return null
  return (
    <nav className="docs__next" aria-label={title}>
      <p className="docs__nexttitle mono">{title}</p>
      <div className="docs__nextgrid">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="docs__nextcard">
            <span className="docs__nextcardtitle">
              {cardTitle(l)}
              <span className="docs__nextarrow" aria-hidden="true">
                {'→'}
              </span>
            </span>
            <span className="docs__nextcarddesc">{l.desc}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
