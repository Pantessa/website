'use client'

// The DCA autopilot arm card — ONE signTypedData and the schedule buys
// itself each period. The copy leads with what the CONTRACT enforces (the
// wallet's own code caps the pull), because that's the whole trust story:
// arming never hands over keys, and the cap holds regardless of Pantessa.

import { useState } from 'react'
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi'
import { CheckCircle2, Loader2, PenLine, ShieldCheck } from 'lucide-react'

export interface DcaArmOfferWire {
  scheduleId: string
  network: 'base'
  spender: string
  permission: string
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: 'SpendPermission'
    message: Record<string, string | number>
  }
  enforced: { buyUsd: number; cadence: 'day' | 'week' | 'month'; buyToken: string }
}

type Status = 'idle' | 'signing' | 'arming' | 'armed' | 'error'

const CADENCE_NOUN: Record<DcaArmOfferWire['enforced']['cadence'], string> = {
  day: 'day',
  week: 'week',
  month: 'month',
}

export default function ArmDcaButton({ offer }: { offer: DcaArmOfferWire }) {
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
      setError('Connect the wallet that owns this schedule first.')
      return
    }
    if (account && address.toLowerCase() !== account.toLowerCase()) {
      setError(`Connected wallet ${address.slice(0, 6)}… ≠ schedule owner ${account.slice(0, 6)}…`)
      return
    }
    try {
      setStatus('signing')
      // The domain pins Base — same switch-then-act idiom as SignOrderButton.
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
      const res = await fetch(`/api/dca/${offer.scheduleId}/arm`, {
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
  const capLine = `$${offer.enforced.buyUsd} per ${CADENCE_NOUN[offer.enforced.cadence]} — enforced by your wallet's own contract`

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="flex items-start gap-2 text-[12px] text-[color:var(--muted)]">
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="text-[color:var(--fg)] font-medium">Autopilot cap: {capLine}</div>
          <div>Buys route through the same guardrails you sign today; {offer.enforced.buyToken} lands in your wallet. Expires in a year. Revoke on-chain or say “turn off autopilot” any time.</div>
        </div>
      </div>

      {status === 'armed' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">Autopilot armed</span>
          {enforced && <span className="text-[color:var(--muted)] truncate">— {enforced}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void arm()}
            disabled={inFlight}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
            title="Sign the one-time spending permission that arms this schedule"
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'signing' ? 'Confirm in your wallet…' : status === 'arming' ? 'Arming…' : status === 'error' ? 'Retry — sign & arm autopilot' : 'Sign & arm autopilot'}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
