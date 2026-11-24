import Link from 'next/link'

// The "Next" cards at the bottom of a docs page: two or three pages to read
// after this one. Plain Links (docs pages are public; a link INTO the signed-in
// app does not belong here). The title is not a heading so it stays out of
// the "On this page" list.

export type DocsNextLink = { href: string; title: string; desc: string }

export default function DocsNext({ links, title = 'Next' }: { links: DocsNextLink[]; title?: string }) {
  if (!links.length) return null
  return (
    <nav className="docs__next" aria-label={title}>
      <p className="docs__nexttitle mono">{title}</p>
      <div className="docs__nextgrid">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="docs__nextcard">
            <span className="docs__nextcardtitle">
              {l.title}
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
