import type { Metadata } from 'next'
import Link from 'next/link'
import CopyBlock from '@/components/CopyBlock'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import {
  ROUTABILITY_DIMENSIONS,
  ROUTABLE_MCP_CONVENTIONS,
  ROUTABLE_MCP_CLAUDE_PROMPT,
} from '@/lib/routable-mcp'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'routable-mcp')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function RoutableMcpPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> MAKE YOUR MCP ROUTABLE
      </p>
      <h1 className="docs__h1">
        Make your MCP <span className="x-grad">routable</span>
      </h1>
      <p className="docs__lead">
        Yeetful composes MCP servers into one agent. For the router to reach yours, an agent has to
        do three things with it: <strong>discover</strong> the right tool from a plain-English ask,{' '}
        <strong>construct</strong> a valid call, and — for anything signable — get back an{' '}
        <strong>unsigned payload</strong> the user’s own wallet signs. This page is the contract that
        makes all three reliable, plus a prompt you paste into Claude Code to get there.
      </p>

      <div className="docs__prose">
        <h2>What the router grades</h2>
        <p>
          <code>npm run mcp:lint</code> scores five weighted dimensions (100 total). Your{' '}
          <Link href="/servers">server page</Link> shows the live score and a “Fix it with Claude
          Code” prompt built from your actual failing checks. The five:
        </p>

        <div className="rmcp-dims">
          {ROUTABILITY_DIMENSIONS.map((d) => (
            <div key={d.key} className="rmcp-dim">
              <div className="rmcp-dim__head">
                <span className="rmcp-dim__title u-name-serif">{d.title}</span>
                <span className="rmcp-dim__weight mono">{d.weight}</span>
              </div>
              <p className="rmcp-dim__q">{d.question}</p>
              <p className="rmcp-dim__detail">{d.detail}</p>
            </div>
          ))}
        </div>

        <h2>The conventions to build to</h2>
        <p>These are the same conventions every generated upgrade prompt cites — one source of truth:</p>
        <ol className="rmcp-conv">
          {ROUTABLE_MCP_CONVENTIONS.map((c) => (
            <li key={c.title}>
              <strong>{c.title}.</strong> {c.body}
            </li>
          ))}
        </ol>

        <h2>Fix it with Claude Code</h2>
        <p>
          Paste this into Claude Code from your MCP’s repo. It audits your tools against the
          conventions above and implements the fixes. If your server is already{' '}
          <Link href="/servers">listed on Yeetful</Link>, use the panel on its server page instead —
          that prompt carries your exact failing checks and any real dead-ended visitor asks.
        </p>
        <CopyBlock text={ROUTABLE_MCP_CLAUDE_PROMPT} label="Copy prompt" />

        <h2>Starter kit</h2>
        <p>
          Building a new MCP from scratch? <code>@yeetful/mcp-kit</code> ships a clean{' '}
          <code>/mcp</code> handler and a per-IP rate limiter — the front door a free tier needs.
          Existing servers just need the conventions above; you don’t have to adopt the kit to score
          well.
        </p>
      </div>

      <div className="docs__callout">
        <p>
          Why this matters: a routable MCP doesn’t just rank higher — it{' '}
          <strong>self-heals</strong>. Every dead-ended visitor ask on an{' '}
          <Link href="/docs/embed">embedded chat</Link> feeds a suggestion that names the missing
          tool or param, and the upgrade prompt you copy is generated straight from those real asks.
        </p>
      </div>
    </>
  )
}
