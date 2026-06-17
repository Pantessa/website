// The CDP boundary for backing a grant on-chain (Spend Permissions, slice 2).
// Isolated so the rest of the app never imports @coinbase/cdp-sdk directly and
// the route degrades cleanly when CDP isn't provisioned. Pure caps math lives
// in lib/spend-permission.ts; this file is the only place that talks to CDP.
import { CdpClient } from '@coinbase/cdp-sdk'
import {
  grantToSpendPermission,
  type GrantTerms,
  type SpendPermissionNetwork,
} from './spend-permission'

let _cdp: CdpClient | null = null

/** Creating/using a Spend Permission needs the **wallet secret** (POST/sign
 *  auth) on top of the API key — the api-key id/secret alone cannot sign. */
export function isCdpConfigured(): boolean {
  return Boolean(
    process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET,
  )
}

function cdp(): CdpClient {
  if (!isCdpConfigured()) {
    throw new Error('CDP not configured — set CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET.')
  }
  // CdpClient reads the three env vars itself.
  if (!_cdp) _cdp = new CdpClient()
  return _cdp
}

/** Default network for new permissions. `base-sepolia` (testnet, faucet-funded)
 *  until a mainnet Smart Account is funded; flip with `CDP_SPEND_NETWORK=base`. */
export function spendNetwork(): SpendPermissionNetwork {
  return process.env.CDP_SPEND_NETWORK === 'base' ? 'base' : 'base-sepolia'
}

/** The CDP Smart Account that holds the expense-account funds (the grantor).
 *  `getOrCreate` is idempotent; `enableSpendPermissions` registers the on-chain
 *  SpendPermissionManager as an owner so it can later move funds. */
export async function getExpenseSmartAccount() {
  const c = cdp()
  const owner = await c.evm.getOrCreateAccount({ name: 'yeetful-expense-owner' })
  return c.evm.getOrCreateSmartAccount({
    name: 'yeetful-expense-account',
    owner,
    enableSpendPermissions: true,
  })
}

/** The account that pulls from the permission (Yeetful's spender). Any on-chain
 *  account works; a CDP-managed one keeps signing server-side. */
export async function getSpenderAccount() {
  return cdp().evm.getOrCreateAccount({ name: 'yeetful-spender' })
}

export interface CreatedPermission {
  id: string
  network: SpendPermissionNetwork
  account: string
  spender: string
  allowanceAtomic: string
}

/** Create an on-chain Spend Permission mirroring a grant's per-day cap. Gas is
 *  sponsored by the CDP paymaster. Returns a stable id (userOp/tx hash) to
 *  persist on the grant. */
export async function createGrantSpendPermission(
  grant: GrantTerms,
  network: SpendPermissionNetwork = spendNetwork(),
): Promise<CreatedPermission> {
  const c = cdp()
  const [smart, spender] = await Promise.all([getExpenseSmartAccount(), getSpenderAccount()])
  const params = grantToSpendPermission(grant, {
    account: smart.address as `0x${string}`,
    spender: spender.address as `0x${string}`,
  })

  // Gas: CDP sponsors the user-op on the supported networks (verified on
  // base-sepolia). If a mainnet deployment needs an explicit paymaster, set it
  // on the smart account / via CDP portal config — createSpendPermission's
  // typed options don't take one here.
  const result = (await c.evm.createSpendPermission({
    network,
    spendPermission: {
      account: params.account,
      spender: params.spender,
      token: 'usdc',
      allowance: params.allowance,
      periodInDays: params.periodInDays,
      start: params.start,
      end: params.end,
    },
  })) as unknown as Record<string, unknown>

  // createSpendPermission returns a user operation; capture whatever hash it
  // surfaces, defensively (SDK shape varies across minors).
  const id = String(
    result.userOpHash ?? result.transactionHash ?? result.id ?? result.hash ?? '',
  )
  if (!id) throw new Error('createSpendPermission returned no id/hash')

  return {
    id,
    network,
    account: params.account,
    spender: params.spender,
    allowanceAtomic: params.allowance.toString(),
  }
}
