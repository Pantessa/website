'use client'

// A card door's read of what this visitor can buy (lib/onramp-client
// fetchOnrampOffer, one read per page load shared by every door on the page).

import { useEffect, useState } from 'react'
import type { OnrampOffer } from '@/lib/onramp'
import { fetchOnrampOffer } from '@/lib/onramp-client'

/** undefined while the read is out (or before `active`), null when it failed,
 *  else the offer. */
export function useOnrampOffer(active: boolean): OnrampOffer | null | undefined {
  const [offer, setOffer] = useState<OnrampOffer | null | undefined>(undefined)
  useEffect(() => {
    if (!active) return
    let live = true
    void fetchOnrampOffer().then((o) => {
      if (live) setOffer(o)
    })
    return () => {
      live = false
    }
  }, [active])
  return offer
}
