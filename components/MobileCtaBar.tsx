'use client'

// Mobile-only sticky action bar. The hero CTAs scroll away on a phone, so once
// the user is past the fold a flat, full-width primary button rises from the
// bottom edge — the "flat full-screen button as you scroll" pattern. Hidden on
// desktop (CSS) and until armed (scroll past ~60% of the first viewport).
// State-aware, mirroring the hero: Create account → Open dashboard / Try a route.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'

export default function MobileCtaBar() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { connectAndSignIn } = useSession()
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    // Arm once the hero (~60% of the first viewport) has scrolled past, so the
    // bar doesn't double up with the in-hero CTAs that are still on screen.
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.6)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const showCreate = mounted && cdpEnabled && !isConnected

  return (
    <div className={`mcta${show ? ' is-show' : ''}`} aria-hidden={!show}>
      {showCreate ? (
        <CreateAccountButton className="btn btn--solid" label="Create an account" />
      ) : (
        <button
          className="btn btn--solid"
          tabIndex={show ? 0 : -1}
          onClick={() => (isConnected ? router.push('/dashboard') : connectAndSignIn('/dashboard'))}
        >
          {isConnected ? 'Open dashboard' : 'Try a route'}
        </button>
      )}
    </div>
  )
}
