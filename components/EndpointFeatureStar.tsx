'use client'

// The featured ("start here") marker on a service's endpoint list. Every
// visitor sees the chip on flagged endpoints; admins get the interactive
// toggle that PATCHes /api/servers/[slug]/featured. The flag is a routing
// signal: the endpoint planner floats featured endpoints as starting hints,
// and the connect-time quick view pings them first for a new account.

import { useState } from 'react'
import { Star } from 'lucide-react'

export default function EndpointFeatureStar({
  slug,
  endpointId,
  initial,
  canCurate,
}: {
  slug: string
  endpointId: string
  initial: boolean
  canCurate: boolean
}) {
  const [featured, setFeatured] = useState(initial)
  const [busy, setBusy] = useState(false)

  if (!canCurate) {
    if (!featured) return null
    return (
      <span className="ep__star ep__star--on mono" title="The owner flagged this as the best entry point — the router starts here and new accounts ping it first">
        <Star className="ep__staricon" aria-hidden fill="currentColor" />
        start here
      </span>
    )
  }

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    const next = !featured
    setFeatured(next) // optimistic — revert on failure
    try {
      const res = await fetch(`/api/servers/${slug}/featured`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpointId, featured: next }),
      })
      if (!res.ok) setFeatured(!next)
    } catch {
      setFeatured(!next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={featured}
      className={`ep__star ep__star--btn mono${featured ? ' ep__star--on' : ''}`}
      title={
        featured
          ? 'Featured — the router starts here and new accounts ping it first. Click to unflag.'
          : 'Flag as a "start here" endpoint — the router prefers it when an ask is broad, and new accounts ping it first.'
      }
    >
      <Star className="ep__staricon" aria-hidden fill={featured ? 'currentColor' : 'none'} />
      {featured ? 'start here' : 'feature'}
    </button>
  )
}
