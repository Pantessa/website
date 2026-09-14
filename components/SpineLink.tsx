'use client'

// A link INTO the signed-in app (/chat and its deep links, /wallet, the
// dashboard) from a page outside it. The app sends a signed-out visitor home
// (AppSpine, lib/app-entry), so for them a plain link would bounce straight
// back to the page they clicked it on. Here it opens the unified sign-in door
// instead (rule 6: CreateAccountButton's modal when cdpEnabled,
// connectAndSignIn otherwise) and lands them at the link's own target once
// they're in. Everyone else — signed in, or a connected wallet — gets the
// plain link. So does everyone for a public app page: /markets and
// /t/<symbol> need no wallet to look at (lib/app-entry isPublicAppPath,
// 2026-09-14), so the nav's Markets tab and a symbol row just go there.
//
// It stays an <a> either way: the same styling, the same server HTML
// (crawlers and the harness read a real href), and a modified click (new
// tab, new window) keeps meaning what it says. Only a plain click by a
// settled signed-out visitor is intercepted; a caller's own onClick runs
// first and can still cancel the navigation itself.

import Link from 'next/link'
import { useState, type ComponentProps, type MouseEvent } from 'react'
import { useSession } from '@/lib/session'
import { isPublicAppPath } from '@/lib/app-entry'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { CreateAccountModal } from '@/components/CreateAccountButton'

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string }

export default function SpineLink({ href, onClick: onClickProp, ...rest }: Props) {
  const { signedOut, connectAndSignIn } = useSession()
  const [doorOpen, setDoorOpen] = useState(false)

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClickProp?.(e)
    if (e.defaultPrevented || !signedOut || isPublicAppPath(href)) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (cdpEnabled) setDoorOpen(true)
    else connectAndSignIn(href)
  }

  return (
    <>
      <Link href={href} {...rest} onClick={onClick} />
      {doorOpen && <CreateAccountModal onClose={() => setDoorOpen(false)} redirectTo={href} />}
    </>
  )
}
