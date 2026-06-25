'use client'

// Completes a CDP social (Google/Apple/X) sign-in after the OAuth redirect.
//
// signInWithOAuth() sends the browser to the provider, which redirects back to
// the app (a full page load). On return the CDP SDK finishes auth during init
// (useIsSignedIn flips true). At that point we still have to hand the embedded
// wallet to wagmi — exactly like the email flow's connectAsync — then route in.
// SIWE itself happens at the one-click dashboard gate, same as email.
//
// Guarded by a sessionStorage intent set right before the redirect, so this only
// runs when the user actually started a social sign-in (never on a normal load).
// Mounted only when cdpEnabled (it uses CDP hooks, which need CDPHooksProvider).

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useConnect } from 'wagmi'
import { CDP_CONNECTOR_ID } from '@coinbase/cdp-wagmi'
import { useIsInitialized, useIsSignedIn, useOAuthState } from '@coinbase/cdp-hooks'

export const OAUTH_INTENT_KEY = 'yf_oauth_signin'

export default function CdpOAuthReturn() {
  const router = useRouter()
  const { isInitialized } = useIsInitialized()
  const { isSignedIn } = useIsSignedIn()
  const { oauthState } = useOAuthState()
  const { isConnected } = useAccount()
  const { connectAsync, connectors } = useConnect()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    let intent: { redirectTo?: string } | null = null
    try {
      const raw = sessionStorage.getItem(OAUTH_INTENT_KEY)
      if (raw) intent = JSON.parse(raw)
    } catch {
      /* private mode / blocked storage — nothing to resume */
    }
    if (!intent) return

    // The provider bounced back with an error → clear the intent, don't loop.
    if (oauthState?.status === 'error') {
      handled.current = true
      try {
        sessionStorage.removeItem(OAUTH_INTENT_KEY)
      } catch {
        /* ignore */
      }
      return
    }

    // Wait for the SDK to finish processing the callback.
    if (!isInitialized || !isSignedIn) return

    handled.current = true
    void (async () => {
      try {
        if (!isConnected) {
          const connector = connectors.find((c) => c.id === CDP_CONNECTOR_ID)
          if (connector) await connectAsync({ connector })
        }
      } catch {
        /* connect failed — still route; the gate will re-prompt */
      } finally {
        try {
          sessionStorage.removeItem(OAUTH_INTENT_KEY)
        } catch {
          /* ignore */
        }
        router.push(intent?.redirectTo || '/dashboard')
      }
    })()
  }, [isInitialized, isSignedIn, oauthState, isConnected, connectAsync, connectors, router])

  return null
}
