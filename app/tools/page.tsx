import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import ThinkingToolsBoard from '@/components/ThinkingToolsBoard'

// The thinking tools, visualized — the reasoning layer between a message and
// a settled call (board card B4). Server shell owns SEO; the board polls
// /api/tools/stats for live aggregates.

export const metadata: Metadata = {
  title: 'The thinking tools — watch the router decide · Yeetful',
  description:
    'The reasoning tools inside the Yeetful Reason Router: which MCP answers, which endpoint runs, what gets resolved, what gets stopped — live, named, and learning from settled receipts.',
  openGraph: {
    title: 'Yeetful thinking tools',
    description:
      'Which MCP answers, which endpoint runs, what gets stopped — the router’s decisions, live and named.',
    type: 'website',
  },
}

export default function ToolsPage() {
  return (
    <>
      <main className="x-main x-main--fluid">
        <header className="hero" style={{ paddingBottom: 28 }}>
          <p className="hero__eyebrow">THE THINKING TOOLS</p>
          <h1 className="hero__h1 hero__h1--sm">
            Watch the router <em className="hero__em">decide.</em>
          </h1>
          <p className="hero__sub">
            The hard part isn&apos;t calling an MCP — it&apos;s picking the right one, building the
            request, and knowing when to stop. Those decisions are Yeetful&apos;s own tools. Here they
            are, named, live, and getting smarter from settled receipts.
          </p>
        </header>
        <ThinkingToolsBoard />
      </main>
      <Footer />
    </>
  )
}
