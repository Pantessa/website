import { createCDPEmbeddedWalletConnector } from '@coinbase/cdp-wagmi'
import type { Config as CdpConfig } from '@coinbase/cdp-hooks'
import { http, type CreateConnectorFn } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'

/**
 * Coinbase CDP Embedded (non-custodial) Wallet — the "create an account" path.
 *
 * Lets a newcomer with no extension create a wallet with just an email + OTP.
 * The whole point is that once connected it's a *normal wagmi account*, so the
 * rest of the app (SIWE sign-in, x402 EIP-712 signing, spend grants) treats it
 * exactly like MetaMask — none of that code is connector-aware.
 *
 * The project ID is a public identifier, exposed to the browser. Set
 * NEXT_PUBLIC_CDP_PROJECT_ID (mirrors the server-side CDP_WALLET_PROJECT_ID) and
 * allowlist the domain in the CDP portal. When the var is absent the connector
 * is omitted and the rest of the app is unaffected — same defensive pattern as
 * the WalletConnect (`wcEnabled`) guard in lib/wagmi.ts.
 */
export const cdpProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? ''
export const cdpEnabled = cdpProjectId.length > 0

/**
 * EOA, not a smart account. x402 settles via an EIP-3009
 * `TransferWithAuthorization` signature, and the codebase deliberately pins
 * every wallet to the EOA flow (see `coinbaseWallet.preference = 'eoaOnly'` in
 * lib/wagmi.ts) so each signature stays in-page — a smart-account popup after an
 * `await` is no longer a user gesture and breaks the 2nd signature in a paid turn.
 */
export const cdpConfig: CdpConfig = {
  projectId: cdpProjectId,
  ethereum: { createOnLogin: 'eoa' },
}

const baseCdpConnector = createCDPEmbeddedWalletConnector({
  cdpConfig,
  providerConfig: {
    chains: [base, baseSepolia],
    transports: {
      [base.id]: http(),
      [baseSepolia.id]: http(),
    },
    announceProvider: false,
  },
})

/**
 * The embedded-wallet wagmi connector — driven ONLY by our "Sign in / create
 * account" CTA via `useConnect({ connector })`, never the wallet-select modal.
 *
 * RainbowKit auto-lists ANY wagmi connector it sees as an EIP-6963 wallet when
 * it has a `name` + `uid` + a `data:image` icon (its `isEIP6963Connector`
 * check). The CDP connector matches all three, so despite `announceProvider:
 * false` it leaked into the Connect Wallet modal as a "CDP" tile — clicking it
 * hung forever waiting on a browser-extension popup that never comes. Stripping
 * the connector's `icon` drops it below that bar, so RainbowKit no longer treats
 * it as a wallet. Our flow finds it by `id` (`cdp-embedded-wallet`), not icon,
 * so nothing we rely on changes.
 */
export const cdpEmbeddedConnector: CreateConnectorFn = (config) => {
  const connector = baseCdpConnector(config)
  try {
    delete (connector as unknown as { icon?: string }).icon
  } catch {
    /* icon non-configurable — harmless, fall through */
  }
  return connector
}
