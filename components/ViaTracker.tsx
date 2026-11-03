'use client'

// Silent share-loop tracer. Any page can be landed on with ?via=<short-id>
// (share pages append it everywhere) — this cookies the id for 30 days so
// the visitor's FIRST sign-in can stamp wallet_arrivals, wherever in the
// funnel that happens. No UI, no fetch, nothing on repeat visits without a
// fresh ?via=. The id is a one-way hash of the sharer's wallet — nothing
// about the visitor is recorded until they sign in themselves.

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const VIA_RE = /^[a-z0-9]{4,16}$/
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days — first touch wins server-side anyway

/** Cookie a via id for this browser — first touch wins: an existing cookie
 *  is never overwritten, so a later click on someone else's link can't
 *  steal an earlier referral. Returns true when it wrote. */
export function seedVia(via: string | null | undefined, pathname: string): boolean {
  if (!via || !VIA_RE.test(via)) return false
  if (document.cookie.split('; ').some((c) => c.startsWith('yf_via='))) return false
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `yf_via=${via}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
  document.cookie = `yf_via_landing=${encodeURIComponent(pathname).slice(0, 80)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
  return true
}

export default function ViaTracker() {
  const params = useSearchParams()
  const pathname = usePathname()
  const via = params.get('via')

  useEffect(() => {
    seedVia(via, pathname)
  }, [via, pathname])

  return null
}

/** A page that IS a referral door (the creator page, /l/<handle> — squad
 *  five-million, PERPS): it cookies its creator's via for every visitor, as
 *  if they had arrived on `?via=`. Same first-touch rule; no UI. */
export function ViaSeed({ via }: { via: string }) {
  const pathname = usePathname()
  useEffect(() => {
    seedVia(via, pathname)
  }, [via, pathname])
  return null
}
