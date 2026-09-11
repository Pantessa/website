'use client'

// Completes a CDP social (Google/Apple/X) sign-in after the OAuth redirect.
//
// signInWithOAuth() sends the browser to the provider, which redirects back to
// the app (a full page load). On return the CDP SDK finishes auth during init
// (useIsSignedIn flips true). At that point we still have to hand the embedded
// wallet to wagmi — exactly like the email flow's connectAsync — then, like the
// email lane, sign in and route in: to the door's redirectTo, else the
// fresh-login landing (Markets). The sign-in is the account door's (sign in to
// keep, rule 6): the dashboard's gate needs a SIWE session, and the embedded
// wallet signs without a prompt. A connect-only door's intent
// (walletConnectOnly: /i, /chat's connect gate) stops at the connect; the
// connected embedded wallet is enough for the app shell (connect to act).
//
// Guarded by a sessionStorage intent set right before the redirect, so this only
// runs when the user actually started a social sign-in (never on a normal load).
// Mounted only when cdpEnabled (it uses CDP hooks, which need CDPHooksProvider).

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useConnect } from 'wagmi'
import { CDP_CONNECTOR_ID } from '@coinbase/cdp-wagmi'
import { useIsInitialized, useIsSignedIn, useOAuthState } from '@coinbase/cdp-hooks'
import { SIGN_IN_LANDING } from '@/lib/app-entry'
import { useSession } from '@/lib/session'

export const OAUTH_INTENT_KEY = 'yf_oauth_signin'

/** What the door leaves for the return trip. An intent written before the
 *  door carried `signIn` (a tab mid-redirect across the deploy) connects
 *  only, as it always did. */
export type OAuthIntent = { redirectTo?: string; signIn?: boolean }

export default function CdpOAuthReturn() {
  const router = useRouter()
  const { isInitialized } = useIsInitialized()
  const { isSignedIn } = useIsSignedIn()
  const { oauthState } = useOAuthState()
  const { isConnected, connector: activeConnector } = useAccount()
  const { connectAsync, connectors } = useConnect()
  const { signInOnceConnected } = useSession()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    let intent: OAuthIntent | null = null
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
      // The embedded wallet has to be the ACTIVE connection before anything
      // signs. A browser that connected MetaMask before can have it restored
      // first on this page load (isConnected alone reads true), and signing
      // in on that one would pop MetaMask's signer over a Google sign-in.
      let connected = isConnected && activeConnector?.id === CDP_CONNECTOR_ID
      try {
        if (!connected) {
          const connector = connectors.find((c) => c.id === CDP_CONNECTOR_ID)
          if (connector) {
            await connectAsync({ connector })
            connected = true
          }
        }
      } catch (err) {
        // wagmi's page-load reconnect can land the embedded wallet first, and
        // that failure means connected. Any other one still routes, unsigned.
        connected = err instanceof Error && err.name === 'ConnectorAlreadyConnectedError'
      }
      try {
        sessionStorage.removeItem(OAUTH_INTENT_KEY)
      } catch {
        /* ignore */
      }
      const target = intent?.redirectTo || SIGN_IN_LANDING
      if (connected && intent?.signIn) await signInOnceConnected(target)
      else router.push(target)
    })()
  }, [isInitialized, isSignedIn, oauthState, isConnected, activeConnector, connectAsync, connectors, signInOnceConnected, router])

  return null
}
