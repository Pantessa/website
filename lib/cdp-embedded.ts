import { createCDPEmbeddedWalletConnector } from '@coinbase/cdp-wagmi'
import type { Config as CdpConfig } from '@coinbase/cdp-hooks'
import { http } from 'wagmi'
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

/**
 * The embedded-wallet wagmi connector.
 *
 * `announceProvider: false` keeps it OUT of the EIP-6963 injected-wallet list,
 * so it does not show up as a duplicate "Installed" entry in the RainbowKit
 * modal. We connect it explicitly from a dedicated "Create an account" CTA via
 * `useConnect({ connector })` (card 2), not through the wallet-select modal.
 */
export const cdpEmbeddedConnector = createCDPEmbeddedWalletConnector({
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
