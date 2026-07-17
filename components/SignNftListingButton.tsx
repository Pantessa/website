'use client'

// "Approve → sign → list" — turns a guardrailed OpenSea/Seaport listing
// (built by the native NFT layer, carried on Message.meta.orderRequest with
// protocol 'opensea') into a wallet signature and relays it to OpenSea via
// /api/opensea/submit. One self-advancing card: when the order needs the
// one-time conduit approval (order.prereqTx) the card sends that first,
// waits for the receipt, then offers the gasless signature — never "sign
// this, then type your message again". The server never signs; the submit
// route re-verifies the signature, payout set, and spend policy before
// relaying. SignOrderButton's marketplace twin (CoW keeps its own card).

import { useState } from 'react'
import { useAccount, usePublicClient, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { Loader2, PenLine, CheckCircle2, Circle, ExternalLink } from 'lucide-react'
import type { Eip712OrderRequest } from '@/lib/transaction-layer'

type Status = 'idle' | 'approving' | 'signing' | 'placing' | 'live' | 'error'

interface SeaportTypedData {
  domain: Record<string, unknown>
  primaryType: string
  types: Record<string, unknown>
  message: { offerer?: string } & Record<string, unknown>
}

export default function SignNftListingButton({
  order,
  summary,
  onPlaced,
}: {
  order: Eip712OrderRequest
  summary?: string
  /** Fires once the listing is live on OpenSea — the embed bridge relays it
   *  to the host page as an 'order-signed' event. */
  onPlaced?: (info: { orderUid: string | null; explorerUrl: string | null }) => void
}) {
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: order.chainId ?? 1 })
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [openseaUrl, setOpenseaUrl] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)

  // Only OpenSea listings are placeable here; other protocols render nothing
  // rather than offering a button that can't finish.
  if (order.protocol !== 'opensea') return null
  const chainId = order.chainId ?? 1
  const typedData = order.typedData as SeaportTypedData
  const offerer = typeof typedData?.message?.offerer === 'string' ? typedData.message.offerer : ''
  const needsApproval = !!order.prereqTx && !approved

  const steps: Array<{ key: string; label: string }> = [
    ...(order.prereqTx ? [{ key: 'approving', label: 'Approve' }] : []),
    { key: 'signing', label: 'Sign' },
    { key: 'placing', label: 'List' },
    { key: 'live', label: 'Live on OpenSea' },
  ]
  const orderOfStatus = ['idle', 'approving', 'signing', 'placing', 'live']

  const run = async () => {
    setError('')
    if (!isConnected || !address) {
      setError('Connect the wallet that owns this NFT first.')
      return
    }
    // The guardrails pinned the offerer = requester, so the signer must match.
    if (offerer && address.toLowerCase() !== offerer.toLowerCase()) {
      setError(`Connected wallet ${address.slice(0, 6)}… ≠ listing owner ${offerer.slice(0, 6)}…`)
      return
    }
    try {
      // The domain carries chainId — wallets refuse typed-data signatures on
      // the wrong network (and report it as "User rejected").
      await switchChainAsync({ chainId }).catch(() => {})

      if (needsApproval && order.prereqTx) {
        setStatus('approving')
        const hash = await sendTransactionAsync({
          to: order.prereqTx.to as `0x${string}`,
          data: (order.prereqTx.data ?? '0x') as `0x${string}`,
          value: BigInt(order.prereqTx.value ?? '0'),
          chainId,
        })
        await publicClient?.waitForTransactionReceipt({ hash })
        setApproved(true)
      }

      setStatus('signing')
      const signature = await signTypedDataAsync(typedData as unknown as Parameters<typeof signTypedDataAsync>[0])

      setStatus('placing')
      const res = await fetch(order.submitUrl ?? '/api/opensea/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chainId, parameters: typedData.message, signature, from: address }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Listing rejected.')
      const url = typeof data.openseaUrl === 'string' ? data.openseaUrl : null
      const orderHash = typeof data.orderHash === 'string' ? data.orderHash : null
      setOpenseaUrl(url)
      setStatus('live')
      onPlaced?.({ orderUid: orderHash, explorerUrl: url })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signing failed.'
      setError(/rejected|denied/i.test(msg) ? 'Rejected in the wallet — nothing was listed. (If you didn’t cancel: check the wallet network.)' : msg)
      setStatus('error')
    }
  }

  const stepState = (key: string): 'done' | 'active' | 'pending' => {
    if (status === 'live') return 'done'
    if (key === 'approving' && approved) return 'done'
    const cur = orderOfStatus.indexOf(status === 'error' ? 'idle' : status)
    const idx = orderOfStatus.indexOf(key)
    if (idx < cur) return 'done'
    if (idx === cur) return 'active'
    return 'pending'
  }

  const inFlight = status === 'approving' || status === 'signing' || status === 'placing'
  const started = status !== 'idle' && status !== 'error'

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      {started && (
        <div className="flex items-center gap-1.5 text-[11px] mono flex-wrap">
          {steps.map((s, i) => {
            const st = stepState(s.key)
            return (
              <span key={s.key} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[color:var(--line-2)] px-0.5">—</span>}
                {st === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : st === 'active' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--fg)]" />
                ) : (
                  <Circle className="w-3 h-3 text-[color:var(--line-2)]" />
                )}
                <span className={st === 'pending' ? 'text-[color:var(--muted-2)]' : 'text-[color:var(--fg)]'}>{s.label}</span>
                {s.key === 'live' && openseaUrl && st === 'done' && (
                  <a href={openseaUrl} target="_blank" rel="noopener noreferrer" title="View the listing on OpenSea"
                    className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            )
          })}
        </div>
      )}

      {status === 'live' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">Listing is live on OpenSea</span>
          {summary && <span className="text-[color:var(--muted)] truncate">— {summary}</span>}
          {openseaUrl && (
            <a href={openseaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void run()}
            disabled={inFlight}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
            title={needsApproval ? 'Approve OpenSea once for this collection, then sign the gasless listing' : 'Sign this listing with your wallet — gasless; it only executes if a buyer pays full price'}
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'approving'
              ? 'Approving in wallet…'
              : status === 'signing'
                ? 'Sign in wallet…'
                : status === 'placing'
                  ? 'Placing listing…'
                  : status === 'error'
                    ? 'Retry — sign & list'
                    : needsApproval
                      ? 'Approve & list on OpenSea'
                      : 'Sign & list on OpenSea'}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
