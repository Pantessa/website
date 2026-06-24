import Footer from '@/components/Footer'
import DocsSidebar from '@/components/DocsSidebar'
import DocsHeadingAnchors from '@/components/DocsHeadingAnchors'

// Docs shell: FULL-WIDTH (no --maxw cap) with a sticky left rail. Content
// pages are server components — the copy must be crawlable, not hydrated in.

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="docs">
        <aside className="docs__rail">
          <p className="docs__railtitle mono">DOCS</p>
          <DocsSidebar />
        </aside>
        <main className="docs__main">{children}</main>
      </div>
      <DocsHeadingAnchors />
      <Footer />
    </>
  )
}
