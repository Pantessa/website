'use client'

// Admin-only publish control, rendered on /blog and /blog/[slug] when the
// session wallet is on the blog allowlist. This is CHROME, not a gate: the
// server decides whether to render it at all, and PATCH /api/blog/<slug> —
// which re-checks the allowlist against the authenticated caller — is what
// actually authorizes the flip. Nothing here is trusted by the API.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export default function BlogAdminBar({
  slug,
  published,
  publishedAt,
  compact = false,
}: {
  slug: string
  published: boolean
  publishedAt?: string | null
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/blog/${slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ published: !published }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        // 403 here means the session wallet isn't on the allowlist — say that
        // plainly rather than leaving a button that silently does nothing.
        setError(res.status === 403 ? 'This wallet is not a blog admin.' : (body.error ?? `Failed (${res.status})`))
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error — nothing changed.')
    } finally {
      setBusy(false)
    }
  }

  const working = busy || pending

  return (
    <div className={compact ? 'blogadmin blogadmin--compact' : 'blogadmin'}>
      <span className={`blogadmin__pill mono ${published ? 'blogadmin__pill--live' : ''}`}>
        <span className="blogadmin__dot" aria-hidden="true" />
        {published ? 'LIVE' : 'DRAFT'}
      </span>

      {!compact && (
        <span className="blogadmin__note mono">
          {published
            ? publishedAt
              ? `Published ${new Date(publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} · public, indexed, in the feed`
              : 'Public, indexed, in the feed'
            : 'Only admins can see this. Not indexed, not in the feed or sitemap.'}
        </span>
      )}

      <button
        type="button"
        onClick={toggle}
        disabled={working}
        className={`blogadmin__btn ${published ? '' : 'blogadmin__btn--go'}`}
      >
        {working ? 'Working…' : published ? 'Unpublish' : 'Publish live'}
      </button>

      {error && <span className="blogadmin__err">{error}</span>}
    </div>
  )
}
