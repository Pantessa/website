// ─────────────────────────────────────────────────────────────────────────
//  EIP-712 typed data for spend-grant terms.
//
//  A wallet signature over this struct turns a SIWE-session grant into a
//  portable, wallet-attested authorization artifact — the precursor to an
//  on-chain Coinbase Spend Permission. The server builds the message from the
//  STORED grant row (never from client input), so a signature can only ever
//  attest to the terms the server is actually enforcing.
//
//  USD amounts are micros (1e6 per dollar) because EIP-712 has no decimals —
//  same convention as USDC's 6-decimal atomic units. totalUsd omitted on the
//  grant signs as 0 (= "no lifetime cap"). Expiry is unix seconds.
// ─────────────────────────────────────────────────────────────────────────

export const GRANT_DOMAIN = {
  name: 'Yeetful Spend Grant',
  version: '1',
  chainId: 8453, // Base
} as const

export const GRANT_TYPES = {
  SpendGrant: [
    { name: 'grantId', type: 'string' },
    { name: 'owner', type: 'address' },
    { name: 'allow', type: 'string[]' },
    { name: 'perCallUsdMicros', type: 'uint256' },
    { name: 'perDayUsdMicros', type: 'uint256' },
    { name: 'totalUsdMicros', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const

export function usdToMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 1e6))
}

export interface GrantTerms {
  id: string
  ownerAddress: string
  allow: string[]
  perCallUsd: number
  perDayUsd: number
  totalUsd: number | null
  expiresAt: Date
}

/** The exact payload a wallet signs (and the server verifies) for a grant. */
export function grantTypedData(grant: GrantTerms) {
  return {
    domain: GRANT_DOMAIN,
    types: GRANT_TYPES,
    primaryType: 'SpendGrant' as const,
    message: {
      grantId: grant.id,
      owner: grant.ownerAddress.toLowerCase() as `0x${string}`,
      // Sorted so the signature is insensitive to allowlist ordering.
      allow: [...grant.allow].map((h) => h.toLowerCase()).sort(),
      perCallUsdMicros: usdToMicros(grant.perCallUsd),
      perDayUsdMicros: usdToMicros(grant.perDayUsd),
      totalUsdMicros: grant.totalUsd == null ? BigInt(0) : usdToMicros(grant.totalUsd),
      expiresAt: BigInt(Math.floor(grant.expiresAt.getTime() / 1000)),
    },
  }
}

/** JSON-safe version of grantTypedData (bigints → strings) for API responses. */
export function grantTypedDataJson(grant: GrantTerms) {
  const td = grantTypedData(grant)
  return {
    ...td,
    message: Object.fromEntries(
      Object.entries(td.message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
    ),
  }
}
