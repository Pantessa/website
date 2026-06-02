import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { payAndFetch } from './x402'

/**
 * Server-side agent wallet. Loaded once from PRIVATE_KEY and used to pay every
 * x402 call the chat makes — for both inference and data servers.
 *
 * Third-party x402 endpoints are CORS-locked, so payments must happen on the
 * server (not in the user's browser). This is the wallet that does it.
 *
 * Use a FUNDED BURNER on Base (USDC). Never a wallet holding real funds.
 */

let cachedAccount: PrivateKeyAccount | null = null

export function getAgentAccount(): PrivateKeyAccount {
  if (cachedAccount) return cachedAccount

  const key = process.env.PRIVATE_KEY?.trim()
  if (!key || key === '0xYOUR_PRIVATE_KEY_HERE') {
    throw new Error(
      'PRIVATE_KEY is not set. Add a funded Base burner wallet to .env.local to enable x402 payments.',
    )
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.')
  }

  cachedAccount = privateKeyToAccount(key as `0x${string}`)
  return cachedAccount
}

/** Whether an agent wallet is configured (used to decide demo vs live mode). */
export function hasAgentWallet(): boolean {
  const key = process.env.PRIVATE_KEY?.trim()
  return !!key && key !== '0xYOUR_PRIVATE_KEY_HERE' && /^0x[0-9a-fA-F]{64}$/.test(key)
}

/** A fetch that pays x402 challenges (v1 + v2) with the agent wallet. */
export function getPaidFetch() {
  const account = getAgentAccount()
  return (input: string, init?: RequestInit) => payAndFetch(account, input, init)
}
