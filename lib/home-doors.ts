// WHICH DOOR A LANDING LINK IS (squad landing, 2026-11-10; coordinator).
//
// components/SpineLink is "a link INTO the signed-in app": for a signed-out
// visitor it opens the unified sign-in door on ANY href that is not a public
// app page (lib/app-entry isPublicAppPath). That is right for /wallet and
// wrong for the site's plain pages: a stranger who taps "Read the docs" or
// "Pricing" on the landing must simply go there, not be asked to sign in
// (lane HERO measured it: /docs, /docs/*, /pricing, /story and /links all
// opened the door).
//
// So the landing's links go through ONE component
// (components/home/LandingLink) and this rule decides: only a page of the
// SIGNED-IN app gets a SpineLink; everything else — a public app page, a
// docs page, pricing, the story, the public links board — is a plain link.
import { isPublicAppPath } from '@/lib/app-entry'

/** First path segments that belong to the signed-in app (the spine's gated surfaces). */
const SIGNED_IN_APP = /^\/(wallet|dashboard|chat|inbox)(\/|$)/

/** Does this href lead into the signed-in app (so a signed-out visitor needs the door)? */
export function isSignedInAppHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false
  if (isPublicAppPath(href)) return false
  return SIGNED_IN_APP.test(href.split(/[?#]/)[0])
}
