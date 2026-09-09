import Link from 'next/link'
import { Link2, MessageSquare, ShieldCheck } from 'lucide-react'
import { PantessaMark } from '@/components/Logo'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { LINK_RETIRED_COPY, type LinkLifecycle } from '@/lib/intent-links'

// The retired-link page (/i/<slug> for a revoked / expired / capped link).
// A stranger who was sent a money link and got Next's bare "404 | This page
// could not be found." read it as "is this broken?" — the exact moment the
// ten-strangers drill fails. The page names WHICH way the link is gone
// (server-side, from the row — never the ask itself, which a creator may
// have retracted on purpose), says the thing that matters on a money link
// (nothing ran, nothing was signed), and hands over the onward paths.
// Rendered by the page itself: a page-thrown notFound() resolves to the
// ROOT not-found on a hard navigation in Next 16, so a segment boundary
// could never carry the reason. Unknown slugs stay a true 404.

export default function LinkRetired({ state }: { state: Exclude<LinkLifecycle, 'live'> }) {
  const copy = LINK_RETIRED_COPY[state]
  const chip =
    'inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full border border-[var(--line)] bg-[var(--surf-1)] text-[13px] font-medium text-[color:var(--fg)] hover:border-[var(--accent)] transition-colors'
  return (
    <main className="relative min-h-dvh max-w-xl mx-auto px-4 py-16 flex flex-col justify-center" data-link-state={state}>
      <div className="flex items-center gap-2 mb-8">
        <PantessaMark size={15} />
        <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">Intent link · not live</span>
      </div>
      <h1
        className="text-[clamp(1.6rem,4vw,2.4rem)] leading-tight font-medium text-[color:var(--fg)] [text-wrap:balance]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {copy.title}
      </h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--muted)] max-w-md">{copy.body}</p>
      <p className="mt-3 inline-flex items-center gap-2 text-[12px] text-[color:var(--muted-2)]">
        <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--accent)]" />
        A link only ever carries a sentence — your wallet is the only thing that can sign.
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/links" className={`${chip} border-[var(--accent)]`}>
          <Link2 className="w-4 h-4" /> Browse live links
        </Link>
        <Link href="/chat" className={chip}>
          <MessageSquare className="w-4 h-4" /> Open the app
        </Link>
        <Link href={LINKS_STUDIO_HREF} className={chip}>
          Make your own link
        </Link>
      </div>
      <p className="mono text-[10.5px] uppercase tracking-widest text-[color:var(--muted-2)] mt-12 pt-4 border-t border-[var(--line)]">
        <Link href="/rebrand" className="hover:text-[color:var(--fg)] underline decoration-dotted underline-offset-2">
          Pantessa · formerly Yeetful
        </Link>
      </p>
    </main>
  )
}
