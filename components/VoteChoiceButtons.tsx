'use client'

// Per-choice Snapshot voting buttons. The engine (wallet mode) hands the chat a
// `voteProposal` (id + space + choices); this renders one button per choice. On
// click it builds the canonical Vote EIP-712 for the CONNECTED wallet (same
// builder the server agent uses), opens the wallet to sign, and relays to the
// sequencer. The voter signs with their own address — voting power is theirs.

import { useState } from 'react'
import { useAccount, useSignTypedData } from 'wagmi'
import { Loader2, CheckCircle2, ExternalLink } from 'lucide-react'
import { toSignable, buildVoteTypedData, friendlyVoteError, type VoteProposal } from '@/lib/snapshot-vote'

export default function VoteChoiceButtons({ proposal }: { proposal: VoteProposal }) {
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const [pending, setPending] = useState<number | null>(null)
  const [votedLabel, setVotedLabel] = useState<string | null>(null)
  const [error, setError] = useState('')

  const cast = async (choice: number) => {
    setError('')
    if (!isConnected || !address) {
      setError('Connect your wallet first.')
      return
    }
    try {
      setPending(choice)
      // Build right before signing so the timestamp is fresh (Snapshot rejects stale).
      const td = buildVoteTypedData({ from: address, space: proposal.space, proposalId: proposal.id, choice })
      const sig = await signTypedDataAsync(toSignable(td) as Parameters<typeof signTypedDataAsync>[0])
      const res = await fetch('/api/snapshot/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, sig, typedData: td }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Vote rejected.')
      setVotedLabel(proposal.choices[choice - 1])
    } catch (e) {
      setError(friendlyVoteError(e))
    } finally {
      setPending(null)
    }
  }

  if (votedLabel) {
    return (
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] flex items-center gap-2 text-[12px]">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-400 font-medium">Voted {votedLabel}</span>
        <span className="text-[color:var(--muted)] truncate">— {proposal.title}</span>
        <a
          href={`https://snapshot.box/#/${proposal.space}/proposal/${proposal.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] flex-shrink-0"
        >
          view <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    )
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="text-[12px] text-[color:var(--muted)]">
        <span className="text-[color:var(--fg)] font-medium">{proposal.title}</span>
        {' · '}
        {proposal.space}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {proposal.choices.map((label, i) => {
          const choice = i + 1
          const isSuggested = proposal.suggestedChoice === choice
          return (
            <button
              key={choice}
              onClick={() => void cast(choice)}
              disabled={pending !== null}
              className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border transition-colors disabled:opacity-50 ${
                isSuggested
                  ? 'border-[var(--accent)] text-[color:var(--fg)]'
                  : 'border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white'
              }`}
              title={`Sign a Snapshot vote for “${label}” with your wallet`}
            >
              {pending === choice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Vote {label}
            </button>
          )
        })}
      </div>
      {error && <div className="text-[12px] text-red-400">{error}</div>}
    </div>
  )
}
