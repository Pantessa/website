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
// A HOME ANCHOR (`/#earn`) is a plain <a>: on the home it is a fragment jump
// on the same page (no navigation), and from /story — where the tour is shown
// too and a bare `#earn` would point at nothing — it goes to the home's board.
// A bare `#tour` stays a plain <a> at the call site.

import Link from 'next/link'
import type { AnchorHTMLAttributes, ComponentProps } from 'react'
import SpineLink from '@/components/SpineLink'
import { isHomeAnchorHref, isSignedInAppHref } from '@/lib/home-doors'

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string }

export default function LandingLink({ href, ...rest }: Props) {
  if (isHomeAnchorHref(href)) {
    // The router's own props mean nothing on a plain anchor.
    const { prefetch: _prefetch, replace: _replace, scroll: _scroll, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, locale: _locale, onNavigate: _onNavigate, ...anchor } = rest as Props & { onNavigate?: unknown }
    return <a href={href} {...(anchor as AnchorHTMLAttributes<HTMLAnchorElement>)} />
  }
  return isSignedInAppHref(href) ? <SpineLink href={href} {...rest} /> : <Link href={href} {...rest} />
}
