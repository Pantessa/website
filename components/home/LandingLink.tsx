'use client'

// THE LANDING'S ONE LINK (squad landing, 2026-11-10; coordinator-owned).
// Every link the landing writes — the tour's doors, the trust section's, the
// closing doors' — is this component. It is a SpineLink (the unified sign-in
// door aimed at its own target, standing rule 6) ONLY when the href leads
// into the signed-in app (lib/home-doors isSignedInAppHref: /wallet, the
// dashboard, an open chat). Everything else is a plain link: a public app
// page (a chart, the chat, the community), a docs page, pricing, the story.
// A stranger who taps "Read the docs" goes to the docs.
//
// On-page anchors (`#earn`, `#tour`) are plain <a> at the call site, not this.

import Link from 'next/link'
import type { ComponentProps } from 'react'
import SpineLink from '@/components/SpineLink'
import { isSignedInAppHref } from '@/lib/home-doors'

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string }

export default function LandingLink({ href, ...rest }: Props) {
  return isSignedInAppHref(href) ? <SpineLink href={href} {...rest} /> : <Link href={href} {...rest} />
}
