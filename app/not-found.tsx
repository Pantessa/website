import Link from 'next/link'
import { PantessaMark } from '@/components/Logo'

// The site-wide 404. Without this file Next renders its own unstyled
// "404 | This page could not be found." — no nav, no brand, no way on —
// which on a money product reads as "is this broken?". Retired intent
// links never reach here — /i/[slug] renders LinkRetired with the reason
// itself; this page is for slugs and routes that never existed.

export const metadata = { title: 'Page not found · Pantessa', robots: { index: false, follow: false } }

export default function NotFound() {
  const chip =
    'inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full border border-[var(--line)] bg-[var(--surf-1)] text-[13px] font-medium text-[color:var(--fg)] hover:border-[var(--accent)] transition-colors'
  return (
    <main className="x-main">
      <div className="max-w-xl mx-auto px-4 py-24">
        <div className="flex items-center gap-2 mb-8">
          <PantessaMark size={15} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">404 · not found</span>
        </div>
        <h1
          className="text-[clamp(1.6rem,4vw,2.4rem)] leading-tight font-medium text-[color:var(--fg)] [text-wrap:balance]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          There’s nothing at this address.
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--muted)] max-w-md">
          The page may have moved, or the link you followed is missing a character. Nothing ran and nothing was
          signed by opening it.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/" className={`${chip} border-[var(--accent)]`}>
            Home
          </Link>
          <Link href="/chat" className={chip}>
            Open the app
          </Link>
          <Link href="/links" className={chip}>
            Intent links
          </Link>
          <Link href="/docs" className={chip}>
            Docs
          </Link>
        </div>
      </div>
    </main>
  )
}
