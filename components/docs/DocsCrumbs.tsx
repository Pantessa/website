import Link from 'next/link'
import { DOCS_GROUPS, DOCS_PAGES } from '@/lib/docs'

// The breadcrumb over a docs page: DOCS / GROUP / PAGE. Both names come from
// the registry (lib/docs), so the crumb, the sidebar, the landing card and the
// Next cards always say the same thing (squad docs-clean, fix-1).

export default function DocsCrumbs({ slug }: { slug: string }) {
  const page = DOCS_PAGES.find((p) => p.slug === slug)
  const group = page?.group ? DOCS_GROUPS.find((g) => g.id === page.group) : undefined
  return (
    <p className="docs__crumbs mono">
      <Link href="/docs">DOCS</Link>
      {group && (
        <>
          {' '}
          <span>/</span> {group.label}
        </>
      )}
      {page && (
        <>
          {' '}
          <span>/</span> {page.title.toUpperCase()}
        </>
      )}
    </p>
  )
}
