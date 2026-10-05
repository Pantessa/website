'use client'

// The last boundary: the root layout itself threw, so nothing of the site is
// on screen (no stylesheet, no theme script). Plain inline styles, the same
// words as app/error.tsx, a retry and a way home.

import { PAGE_ERROR_COPY } from '@/lib/fetch-words'

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#000', color: '#f4f4f5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <main style={{ maxWidth: 560, margin: '0 auto', padding: '96px 16px' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>pantessa · {PAGE_ERROR_COPY.eyebrow}</p>
          <h1 style={{ fontSize: 30, lineHeight: 1.2, fontWeight: 500, margin: '24px 0 0' }}>{PAGE_ERROR_COPY.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.75, marginTop: 16 }}>{PAGE_ERROR_COPY.body}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 32 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, border: '1px solid #34e0a1', background: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer' }}
            >
              {PAGE_ERROR_COPY.retry}
            </button>
            {/* A full navigation on purpose: the app shell is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, border: '1px solid #3f3f46', color: 'inherit', fontSize: 13, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
