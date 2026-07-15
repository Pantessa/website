'use client'

// Type-aware Snapshot voting controls. The engine (wallet mode) hands the chat a
// `voteProposal` (id + space + type + choices); this renders the right control
// per Snapshot proposal type and, on submit, builds the canonical Vote EIP-712
// for the CONNECTED wallet (same builder the server agent uses), opens the wallet
// to sign, and relays to the sequencer. The voter signs with their own address —
// voting power is theirs.
//
//   single-choice / basic → one button per choice (click = cast)
//   approval              → multi-select chips + Cast
//   ranked-choice         → click choices in order (1,2,3…) + Cast
//   weighted / quadratic  → a weight stepper per choice + Cast

import { useState } from 'react'
import { useAccount, useSignTypedData } from 'wagmi'
import { Loader2, CheckCircle2, ExternalLink, Plus, Minus } from 'lucide-react'
import { toSignable, buildVoteTypedData, friendlyVoteError, type VoteProposal, type VoteChoice } from '@/lib/snapshot-vote'

type Mode = 'single' | 'approval' | 'ranked' | 'weighted'
function modeOf(type: string): Mode {
  if (type === 'approval') return 'approval'
  if (type === 'ranked-choice') return 'ranked'
  if (type === 'weighted' || type === 'quadratic') return 'weighted'
  return 'single' // single-choice / basic / anything else
}

export default function VoteChoiceButtons({ proposal, onSigned }: { proposal: VoteProposal; onSigned?: () => void }) {
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const [pending, setPending] = useState(false)
  const [votedSummary, setVotedSummary] = useState<string | null>(null)
  const [error, setError] = useState('')

  const mode = modeOf(proposal.type)
  // approval: set of 1-based indices · ranked: ordered 1-based indices ·
  // weighted: 1-based index → weight.
  const [selected, setSelected] = useState<number[]>([])
  const [weights, setWeights] = useState<Record<number, number>>({})

  const cast = async (choice: VoteChoice, label: string) => {
    setError('')
    if (!isConnected || !address) {
      setError('Connect your wallet first.')
      return
    }
    try {
      setPending(true)
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
      setVotedSummary(label)
      onSigned?.()
    } catch (e) {
      setError(friendlyVoteError(e))
    } finally {
      setPending(false)
    }
  }

  if (votedSummary) {
    return (
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] flex items-center gap-2 text-[12px]">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-400 font-medium">Voted {votedSummary}</span>
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

  const header = (
    <div className="text-[12px] text-[color:var(--muted)]">
      <span className="text-[color:var(--fg)] font-medium">{proposal.title}</span>
      {' · '}
      {proposal.space}
      {mode !== 'single' ? <span className="text-[color:var(--muted-2)]"> · {proposal.type}</span> : null}
    </div>
  )

  // ── single-choice / basic: one button per choice, click casts ──────────────
  if (mode === 'single') {
    return (
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
        {header}
        <div className="flex items-center gap-2 flex-wrap">
          {proposal.choices.map((label, i) => {
            const choice = i + 1
            const isSuggested = proposal.suggestedChoice === choice
            return (
              <button
                key={choice}
                onClick={() => void cast(choice, label)}
                disabled={pending}
                className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border transition-colors disabled:opacity-50 ${
                  isSuggested ? 'border-[var(--accent)] text-[color:var(--fg)]' : 'border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white'
                }`}
                title={`Sign a Snapshot vote for “${label}” with your wallet`}
              >
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Vote {label}
              </button>
            )
          })}
        </div>
        {error && <div className="text-[12px] text-red-400">{error}</div>}
      </div>
    )
  }

  // ── approval / ranked: toggle chips (ranked shows the click order) ──────────
  if (mode === 'approval' || mode === 'ranked') {
    const toggle = (choice: number) =>
      setSelected((s) => (s.includes(choice) ? s.filter((c) => c !== choice) : [...s, choice]))
    const submit = () => {
      if (selected.length === 0) { setError('Pick at least one choice.'); return }
      // approval: order doesn't matter; ranked: the click order IS the ranking.
      const labels = selected.map((c) => proposal.choices[c - 1])
      void cast(selected, mode === 'ranked' ? labels.map((l, i) => `${i + 1}. ${l}`).join(', ') : labels.join(', '))
    }
    return (
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
        {header}
        <div className="text-[11px] text-[color:var(--muted-2)]">
          {mode === 'ranked' ? 'Click choices in your preferred order.' : 'Select one or more, then cast.'}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {proposal.choices.map((label, i) => {
            const choice = i + 1
            const rank = selected.indexOf(choice)
            const on = rank >= 0
            return (
              <button
                key={choice}
                onClick={() => toggle(choice)}
                disabled={pending}
                className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border transition-colors disabled:opacity-50 ${
                  on ? 'border-[var(--accent)] text-[color:var(--fg)]' : 'border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white'
                }`}
              >
                {mode === 'ranked' && on ? <span style={{ color: 'var(--accent)' }}>{rank + 1}.</span> : null}
                {label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={submit}
            disabled={pending || selected.length === 0}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--accent)] text-[color:var(--fg)] hover:bg-[var(--accent)] hover:text-black disabled:opacity-50 transition-colors"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Cast vote{selected.length ? ` (${selected.length})` : ''}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      </div>
    )
  }

  // ── weighted / quadratic: a weight stepper per choice ──────────────────────
  const setWeight = (choice: number, delta: number) =>
    setWeights((w) => ({ ...w, [choice]: Math.max(0, (w[choice] ?? 0) + delta) }))
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const submitWeighted = () => {
    const entries = Object.entries(weights).filter(([, v]) => v > 0)
    if (entries.length === 0) { setError('Give at least one choice a weight.'); return }
    const choice: Record<string, number> = Object.fromEntries(entries)
    const label = entries.map(([c, v]) => `${proposal.choices[Number(c) - 1]} ×${v}`).join(', ')
    void cast(choice, label)
  }
  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      {header}
      <div className="text-[11px] text-[color:var(--muted-2)]">Distribute weight across choices, then cast.</div>
      <div className="space-y-1">
        {proposal.choices.map((label, i) => {
          const choice = i + 1
          const w = weights[choice] ?? 0
          return (
            <div key={choice} className="flex items-center gap-2 text-[12px]">
              <button onClick={() => setWeight(choice, -1)} disabled={pending || w === 0} className="w-6 h-6 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white disabled:opacity-40 inline-flex items-center justify-center"><Minus className="w-3 h-3" /></button>
              <span className="w-6 text-center tabular-nums" style={{ color: w > 0 ? 'var(--accent)' : 'var(--muted-2)' }}>{w}</span>
              <button onClick={() => setWeight(choice, 1)} disabled={pending} className="w-6 h-6 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white disabled:opacity-40 inline-flex items-center justify-center"><Plus className="w-3 h-3" /></button>
              <span className="text-[color:var(--fg)]">{label}</span>
              {totalWeight > 0 && w > 0 ? <span className="text-[color:var(--muted-2)]">— {Math.round((w / totalWeight) * 100)}%</span> : null}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={submitWeighted}
          disabled={pending || totalWeight === 0}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--accent)] text-[color:var(--fg)] hover:bg-[var(--accent)] hover:text-black disabled:opacity-50 transition-colors"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Cast weighted vote
        </button>
        {error && <span className="text-[12px] text-red-400">{error}</span>}
      </div>
    </div>
  )
}
