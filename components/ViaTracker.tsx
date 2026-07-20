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

export default function ViaTracker() {
  const params = useSearchParams()
  const pathname = usePathname()
  const via = params.get('via')

  useEffect(() => {
    if (!via || !VIA_RE.test(via)) return
    // First touch wins: an existing cookie is never overwritten, so a later
    // click on someone else's link can't steal an earlier referral.
    if (document.cookie.split('; ').some((c) => c.startsWith('yf_via='))) return
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `yf_via=${via}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
    document.cookie = `yf_via_landing=${encodeURIComponent(pathname).slice(0, 80)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
  }, [via, pathname])

  return null
}
