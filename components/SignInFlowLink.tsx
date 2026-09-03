'use client'

// A flow-preserving CTA: renders as a plain link when the visitor is signed
// in, and as the unified sign-in modal (wallet / Google / email) when they
// are not — with redirectTo set to the link's own target, so completing
// sign-in lands the user INSIDE the flow they tapped ("Mint yours" → the
// links studio), never bounced to the landing page by the dashboard's
// signed-out redirect. The sign-in UX contract (CLAUDE.md): flow CTAs never
// open raw RainbowKit and never strand a user mid-task.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import CreateAccountButton from '@/components/CreateAccountButton'

export default function SignInFlowLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const { status, connectAndSignIn } = useSession()

  // Only a settled guest gets the sign-in door; while the session is still
  // loading (or once authed) the plain link is correct — the dashboard
  // layout waits for the session to settle before deciding anything.
  if (status === 'guest') {
    if (cdpEnabled) {
      return <CreateAccountButton className={className} label={children} redirectTo={href} />
    }
    return (
      <button type="button" className={className} onClick={() => connectAndSignIn(href)}>
        {children}
      </button>
    )
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
