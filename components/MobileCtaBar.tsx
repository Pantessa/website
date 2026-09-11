'use client'

// Mobile-only sticky action bar. The hero CTAs scroll away on a phone, so once
// the user is past the fold a flat, full-width primary button rises from the
// bottom edge — the "flat full-screen button as you scroll" pattern. Hidden on
// desktop (CSS) and until armed (scroll past ~60% of the first viewport).
//
// It says what the hero's primary CTA says — Open Markets — and goes where a
// fresh login lands (2026-09-11). A signed-out visitor gets the sign-in door
// on the way (SpineLink), since the markets shell sends them home otherwise.

import { useEffect, useState } from 'react'
import SpineLink from '@/components/SpineLink'

export default function MobileCtaBar() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Arm once the hero (~60% of the first viewport) has scrolled past, so the
    // bar doesn't double up with the in-hero CTAs that are still on screen.
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.6)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className={`mcta${show ? ' is-show' : ''}`} aria-hidden={!show}>
      <SpineLink href="/markets" className="btn btn--solid" tabIndex={show ? 0 : -1}>
        Open Markets
      </SpineLink>
    </div>
  )
}
