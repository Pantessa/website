'use client'

// "Sign grant" — wallet-signs the expense account's terms (EIP-712) so the
// grant becomes a portable, wallet-attested authorization (the precursor to a
// Coinbase Spend Permission). Self-contained: fetches the server-built typed
// data + signed flag from /api/grants/[id]/signature, signs with the
// connected wallet, PUTs the result. The server voids signatures whenever
// terms change (cap edits, approval toggles) — `refreshKey` makes this
// component re-check after such actions and nudge a re-sign.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSignTypedData } from 'wagmi'
import { Loader2, PenLine, ShieldCheck } from 'lucide-react'

/** JSON-safe typed data as served by GET /api/grants/[id]/signature. */
export interface GrantTypedDataJson {
  domain: { name: string; version: string; chainId: number }
  types: Record<string, { name: string; type: string }[]>
  primaryType: 'SpendGrant'
  message: Record<string, string | string[]>
}

/**
 * Convert the JSON payload (bigints serialized as strings) back into the
 * exact shape `signTypedData` hashes — uint256 fields become BigInt. Pure,
 * exported for script verification.
 */
export function toSignable(td: GrantTypedDataJson) {
  const uint256 = new Set(
    (td.types.SpendGrant ?? []).filter((f) => f.type === 'uint256').map((f) => f.name),
  )
  return {
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: Object.fromEntries(
      Object.entries(td.message).map(([k, v]) => [
        k,
        uint256.has(k) && typeof v === 'string' ? BigInt(v) : v,
      ]),
    ),
  }
}

export default function SignGrantButton({
  grantId,
  refreshKey,
}: {
  grantId: string
  /** Bump after actions that may void the signature (e.g. approval toggles). */
  refreshKey?: unknown
}) {
  const { signTypedDataAsync } = useSignTypedData()
  const [typedData, setTypedData] = useState<GrantTypedDataJson | null>(null)
  const [signed, setSigned] = useState<boolean | null>(null)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')
  // True once a signature has been observed and later voided (terms changed).
  const wasSigned = useRef(false)
  const [voided, setVoided] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/grants/${grantId}/signature`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { typedData: GrantTypedDataJson; signed: boolean }
      setTypedData(data.typedData)
      setSigned(data.signed)
      if (data.signed) {
        wasSigned.current = true
        setVoided(false)
      } else if (wasSigned.current) {
        setVoided(true)
      }
    } catch {
      /* leave state as-is; button simply won't render */
    }
  }, [grantId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const sign = async () => {
    if (!typedData) return
    setSigning(true)
    setError('')
    try {
      // wagmi/viem accept the converted payload directly.
      const signature = await signTypedDataAsync(
        toSignable(typedData) as Parameters<typeof signTypedDataAsync>[0],
      )
      const res = await fetch(`/api/grants/${grantId}/signature`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signature }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Signature rejected.')
      setSigned(true)
      wasSigned.current = true
      setVoided(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(/rejected|denied/i.test(msg) ? 'Signature request declined.' : msg || 'Signing failed.')
    } finally {
      setSigning(false)
    }
  }

  if (signed === null) return null // still loading or not signed in

  if (signed) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border border-emerald-500/40 text-emerald-400"
        title="The grant terms carry a valid EIP-712 wallet signature"
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        Signed
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      {voided && (
        <span className="text-[11px] text-amber-400/90">terms changed — re-sign</span>
      )}
      <button
        onClick={() => void sign()}
        disabled={signing || !typedData}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 max-lg:min-h-10 max-lg:px-3.5 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
        title="Wallet-sign your caps + allowlist (EIP-712) — makes the grant a portable, attested authorization"
      >
        {signing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
        {voided ? 'Re-sign grant' : 'Sign grant'}
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </span>
  )
}
