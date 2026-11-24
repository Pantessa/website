import Footer from '@/components/Footer'
import DocsSidebar from '@/components/DocsSidebar'
import DocsHeadingAnchors from '@/components/DocsHeadingAnchors'
import { DocsToc } from '@/components/docs'
import { AppRailHeader } from '@/components/AppShell'
import './docs.css'

// Docs shell: FULL-WIDTH (no --maxw cap) with a sticky left rail. Content
// pages are server components — the copy must be crawlable, not hydrated in.
// The page sits in .docs__page; DocsToc ("On this page") is its right column
// at >=1280px and renders nothing on a page with fewer than three h2s.

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="docs">
        <aside className="docs__rail">
          <AppRailHeader />
          <p className="docs__railtitle mono">DOCS</p>
          <DocsSidebar />
        </aside>
        <main className="docs__main">
          <div className="docs__page">{children}</div>
          <DocsToc />
        </main>
      </div>
      <DocsHeadingAnchors />
      <Footer />
    </>
  )
}
