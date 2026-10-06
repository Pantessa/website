'use client'

// The site-wide error boundary. Without this file a render that throws (a
// database blip on a server-rendered page, a client exception in one widget)
// shows the framework's bare "This page couldn't load" / "Application error"
// screen: no brand, no reason, no way on, which on a money product reads as
// "is this safe?". This page says what is true (the page failed, nothing ran,
// nothing was signed), offers the retry, and keeps the public doors open.
//
// It renders inside the root layout, so the theme and fonts are in place.
// The copy lives in lib/fetch-words (pinned: no stack, no status code).

import { useEffect } from 'react'
import Link from 'next/link'
import { PantessaMark } from '@/components/Logo'
import { PAGE_ERROR_COPY } from '@/lib/fetch-words'

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The browser console keeps the diagnosis; the page never prints it.
    console.error('[page error]', error)
  }, [error])
  const chip =
    'inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full border border-solid bg-[var(--surf-1)] text-[13px] font-medium text-[color:var(--fg)] hover:border-[var(--accent)] transition-colors'
  return (
    <main className="x-main">
      <div className="max-w-xl mx-auto px-4 max-sm:px-0 py-24 max-sm:py-14">
        <div className="flex items-center gap-2 mb-8">
          <PantessaMark size={15} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">{PAGE_ERROR_COPY.eyebrow}</span>
        </div>
        <h1
          className="text-[clamp(1.6rem,4vw,2.4rem)] leading-tight font-medium text-[color:var(--fg)] [text-wrap:balance]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {PAGE_ERROR_COPY.title}
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--muted)] max-w-md">{PAGE_ERROR_COPY.body}</p>
        {error.digest ? (
          <p className="mt-3 mono text-[11px] text-[color:var(--muted-2)]">
            {PAGE_ERROR_COPY.refLabel} {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-2">
          <button type="button" onClick={() => reset()} className={`${chip} border-[var(--accent)] tint-bg-accent-10`}>
            {PAGE_ERROR_COPY.retry}
          </button>
          <Link href="/" className={`${chip} border-[var(--line)]`}>
            Home
          </Link>
          <Link href="/docs" className={`${chip} border-[var(--line)]`}>
            Docs
          </Link>
        </div>
      </div>
    </main>
  )
}
