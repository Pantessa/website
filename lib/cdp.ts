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

/** The account that pulls from the permission (Pantessa's spender). Any on-chain
 *  account works; a CDP-managed one keeps signing server-side. */
export async function getSpenderAccount() {
  return cdp().evm.getOrCreateAccount({ name: 'yeetful-spender' })
}

let _spenderAddress: `0x${string}` | null = null

/** The spender's ADDRESS alone — bound onto DCA schedules at arm time so the
 *  signed permission names exactly one puller. Cached: getOrCreateAccount is
 *  idempotent and the address never changes. */
export async function getSpenderAddress(): Promise<`0x${string}`> {
  if (_spenderAddress) return _spenderAddress
  const account = await getSpenderAccount()
  _spenderAddress = account.address as `0x${string}`
  return _spenderAddress
}

/** Send one transaction from the CDP spender (server-side signing — no raw
 *  key in env) and return the hash. Inclusion/receipt waits are the caller's
 *  job via its own public client. */
export async function sendSpenderTx(
  tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint },
  network: SpendPermissionNetwork = spendNetwork(),
  /** CDP's X-Idempotency-Key (a UUID v4, remembered 24h): the same key with
   *  the same request returns CDP's first answer instead of sending again.
   *  The SDK's HTTP client retries dropped connections on this POST, so a
   *  send that moves money should always carry one (lib/autopilot-unwind
   *  spenderTxKey derives them per run and step). */
  opts: { idempotencyKey?: string } = {},
): Promise<`0x${string}`> {
  const c = cdp()
  const spender = await getSpenderAccount()
  const result = await c.evm.sendTransaction({
    address: spender.address as `0x${string}`,
    network,
    transaction: { to: tx.to, data: tx.data, value: tx.value ?? BigInt(0) },
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  })
  return result.transactionHash as `0x${string}`
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

/** One embedded-wallet account (the door's email + Google lanes). */
export interface CdpEndUser {
  userId: string
  /** The address the account signed up with; null for a wallet-less lane. */
  email: string | null
  /** 'email' | 'google' | … — the first authentication method on the account. */
  method: string
  name: string | null
  /** Lowercased EVM addresses (EOAs first, then smart accounts). */
  wallets: string[]
  createdAt: string
  lastAuthenticatedAt: string | null
}

/** Listing end users is a plain API-key read — it doesn't need the wallet
 *  secret that signing does. */
export function isCdpListingConfigured(): boolean {
  return Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET)
}

const END_USER_TTL_MS = 60_000
const END_USER_CAP = 2_000
let _endUsers: { at: number; users: CdpEndUser[] } | null = null

/**
 * Every embedded-wallet account in the CDP project, newest first. The email a
 * person signs up with lives at Coinbase and nowhere in our database, so this
 * is the only place an account's email and its wallet address meet. Admin
 * surfaces only. Cached for a minute; throws when CDP is unreachable so the
 * caller can say so instead of showing an empty list.
 */
export async function listCdpEndUsers(): Promise<CdpEndUser[]> {
  if (!isCdpListingConfigured()) throw new Error('CDP not configured — set CDP_API_KEY_ID and CDP_API_KEY_SECRET.')
  if (_endUsers && Date.now() - _endUsers.at < END_USER_TTL_MS) return _endUsers.users
  if (!_cdp) _cdp = new CdpClient()
  const users: CdpEndUser[] = []
  let pageToken: string | undefined
  do {
    const page = await _cdp.endUser.listEndUsers({ pageSize: 100, pageToken })
    for (const u of page.endUsers) {
      const methods = u.authenticationMethods as { type: string; email?: string; name?: string }[]
      const withEmail = methods.find((m) => m.email)
      const last = (u as { lastAuthenticatedAt?: string }).lastAuthenticatedAt
      users.push({
        userId: u.userId,
        email: withEmail?.email?.toLowerCase() ?? null,
        method: (withEmail ?? methods[0])?.type ?? 'unknown',
        name: methods.find((m) => m.name)?.name ?? null,
        wallets: [...u.evmAccounts, ...u.evmSmartAccounts].map((a) => a.toLowerCase()),
        createdAt: u.createdAt,
        lastAuthenticatedAt: last ?? null,
      })
    }
    pageToken = page.nextPageToken || undefined
  } while (pageToken && users.length < END_USER_CAP)
  users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  _endUsers = { at: Date.now(), users }
  return users
}
