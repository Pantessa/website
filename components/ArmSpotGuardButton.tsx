'use client'

// The Spot Guardian arm card — ONE signTypedData and the protection goes
// live. The copy leads with what the CONTRACT enforces: a one-shot
// permission for exactly the protected amount, capped by the wallet's own
// SpendPermissionManager regardless of Pantessa. Mirrors ArmDcaButton.

import { useState } from 'react'
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi'
import { CheckCircle2, Loader2, PenLine, ShieldCheck } from 'lucide-react'

export interface SpotGuardArmOfferWire {
  policyId: string
  network: 'base'
  spender: string
  permission: string
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: 'SpendPermission'
    message: Record<string, string | number>
  }
  enforced: { tokenSymbol: string; amountHuman: string; triggerLabel: string }
}

type Status = 'idle' | 'signing' | 'arming' | 'armed' | 'error'

export default function ArmSpotGuardButton({ offer }: { offer: SpotGuardArmOfferWire }) {
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [enforced, setEnforced] = useState<string | null>(null)

  const account = String(offer.typedData.message.account ?? '')

  const arm = async () => {
    setError('')
    if (!isConnected || !address) {
      setError('Connect the wallet that owns this protection first.')
      return
    }
    if (account && address.toLowerCase() !== account.toLowerCase()) {
      setError(`Connected wallet ${address.slice(0, 6)}… ≠ protection owner ${account.slice(0, 6)}…`)
      return
    }
    try {
      setStatus('signing')
      await switchChainAsync({ chainId: offer.typedData.domain.chainId }).catch(() => {})
      const m = offer.typedData.message
      const signature = await signTypedDataAsync({
        domain: {
          name: offer.typedData.domain.name,
          version: offer.typedData.domain.version,
          chainId: offer.typedData.domain.chainId,
          verifyingContract: offer.typedData.domain.verifyingContract as `0x${string}`,
        },
        types: offer.typedData.types,
        primaryType: offer.typedData.primaryType,
        message: {
          account: m.account as `0x${string}`,
          spender: m.spender as `0x${string}`,
          token: m.token as `0x${string}`,
          allowance: BigInt(String(m.allowance)),
          period: Number(m.period),
          start: Number(m.start),
          end: Number(m.end),
          salt: BigInt(String(m.salt)),
          extraData: m.extraData as `0x${string}`,
        },
      })
      setStatus('arming')
      const res = await fetch(`/api/spot-guard/${offer.policyId}/arm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, permission: offer.permission, signature }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Arming failed.')
      setEnforced(typeof data.enforced === 'string' ? data.enforced : null)
      setStatus('armed')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signing failed.'
      setError(/rejected|denied/i.test(msg) ? 'Signature rejected in the wallet — nothing was armed.' : msg)
      setStatus('error')
    }
  }

  const inFlight = status === 'signing' || status === 'arming'

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="flex items-start gap-2 text-[12px] text-[color:var(--muted)]">
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="text-[color:var(--fg)] font-medium">
            One-shot cap: {offer.enforced.amountHuman} {offer.enforced.tokenSymbol}, {offer.enforced.triggerLabel} — enforced by your wallet&rsquo;s own contract
          </div>
          <div>
            Watched every minute. If it fires, the sale routes through the same guardrails as every Pantessa swap and the USDC lands in
            your wallet. Nothing can pull more than the amount you sign, ever. Cancel in chat or revoke on-chain any time.
          </div>
        </div>
      </div>

      {status === 'armed' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">Protection armed</span>
          {enforced && <span className="text-[color:var(--muted)] truncate">— {enforced}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void arm()}
            disabled={inFlight}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
            title="Sign the one-shot spending permission that arms this protection"
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'signing' ? 'Confirm in your wallet…' : status === 'arming' ? 'Arming…' : status === 'error' ? 'Retry — sign & arm protection' : 'Sign & arm protection'}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
