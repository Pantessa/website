'use client'

// "Sign vote" — turns a Snapshot vote (built by the snapshot MCP's prepare_vote
// tool, carried on Message.meta.voteRequest) into a wallet signature and relays
// it to the Snapshot sequencer. The VOTER signs with their own wallet: Snapshot
// voting power is bound to the signer's address, so the server never signs.

import { useState } from 'react'
import { useAccount, useSignTypedData } from 'wagmi'
import { Loader2, PenLine, CheckCircle2, ExternalLink } from 'lucide-react'
import { toSignable, friendlyVoteError, type VoteRequest } from '@/lib/snapshot-vote'

type Status = 'idle' | 'signing' | 'relaying' | 'done' | 'error'

export default function SignVoteButton({ vote }: { vote: VoteRequest }) {
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [receiptId, setReceiptId] = useState<string | null>(null)

  const voter = vote.typedData.message.from

  const cast = async () => {
    setError('')
    // The signer must match the voter address baked into the typed data.
    if (!isConnected || !address) {
      setError('Connect the voting wallet first.')
      return
    }
    if (address.toLowerCase() !== voter.toLowerCase()) {
      setError(`Connected wallet ${address.slice(0, 6)}… ≠ voter ${voter.slice(0, 6)}…`)
      return
    }

    try {
      setStatus('signing')
      const sig = await signTypedDataAsync(
        toSignable(vote.typedData) as Parameters<typeof signTypedDataAsync>[0],
      )

      setStatus('relaying')
      const res = await fetch('/api/snapshot/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, sig, typedData: vote.typedData }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Vote rejected.')

      const id =
        data.receipt && typeof data.receipt === 'object' && 'id' in data.receipt
          ? String((data.receipt as { id: unknown }).id)
          : null
      setReceiptId(id)
      setStatus('done')
    } catch (e) {
      setError(friendlyVoteError(e))
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] flex items-center gap-2 text-[12px]">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-400 font-medium">Vote cast</span>
        <span className="text-[color:var(--muted)] truncate">— {vote.summary}</span>
        {receiptId && (
          <a
            href={`https://snapshot.box/#/${vote.proposal.space}/proposal/${vote.proposal.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] flex-shrink-0"
          >
            view <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="text-[12px] text-[color:var(--muted)]">
        <span className="text-[color:var(--fg)] font-medium">{vote.proposal.title}</span>
        {' · '}
        {vote.proposal.space}
        {vote.choiceLabels?.length ? (
          <>
            {' — voting '}
            <span className="text-[color:var(--fg)]">{vote.choiceLabels.join(', ')}</span>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void cast()}
          disabled={status === 'signing' || status === 'relaying'}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
          title="Sign this Snapshot vote with your wallet and submit it"
        >
          {status === 'signing' || status === 'relaying' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PenLine className="w-3.5 h-3.5" />
          )}
          {status === 'signing' ? 'Confirm in your wallet…' : status === 'relaying' ? 'Submitting…' : 'Sign & cast vote'}
        </button>
        {error && <span className="text-[12px] text-red-400">{error}</span>}
      </div>
    </div>
  )
}
