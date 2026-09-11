'use client'

// "Follow" on a public list (MARKETS/WATCH): signed in → POST
// /api/watchlists/fork copies it into your lists with fork_of set; a guest
// gets the unified sign-in door (rule 6) landing back on this page.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'

export default function FollowListButton({ slug, owner }: { slug: string; owner: string }) {
  const { status, address } = useSession()
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  if (status === 'loading') return <span className="wl__btn" aria-hidden style={{ opacity: 0.5 }}>Follow</span>
  if (status !== 'authed' || !address) {
    return <CreateAccountButton className="wl__btn wl__btn--accent" label="Sign in to follow" redirectTo={`/lists/${slug}`} />
  }
  if (address === owner.toLowerCase()) return <span className="wl__muted mono">your list</span>
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="wl__btn wl__btn--accent"
        disabled={state === 'busy' || state === 'done'}
        onClick={async () => {
          setState('busy')
          try {
            const res = await fetch('/api/watchlists/fork', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) })
            const j = (await res.json()) as { error?: string }
            if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
            setState('done')
            router.refresh()
          } catch (e) {
            setError((e as Error).message)
            setState('error')
          }
        }}
      >
        {state === 'done' ? 'Following — it’s in your lists' : state === 'busy' ? 'Copying…' : 'Follow'}
      </button>
      {state === 'error' && error && <span className="wl__err">{error}</span>}
    </span>
  )
}
