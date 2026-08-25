'use client'

// The rail's Team tab — THE ROSTER (R1 skeleton): the wallet's mandate
// slots as staff rows. Post a mandate SENTENCE (validated live against the
// four executor grammars — lib/roster's parseMandate, the same module the
// server runs), hire an agent into it with ONE personal_sign consent, fire
// it with one. Connect-to-act (rule 6): seeing and staffing your roster
// needs a connected wallet, never SIWE; the consent signature is the gate.
//
// The consent text is NEVER composed here: the API mints nonce + expiry and
// returns the exact bytes to sign (security CONTRACTS v1 §1) — this
// component just shows them and asks the wallet.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { Loader2, Plus, UserX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MANDATE_KIND_LABELS, ROSTER_DEFAULT_CAP_USD, type MandateKind } from '@/lib/roster-client'

type Preview = { kind: MandateKind; mandateText: string; summary: string } | { problem: string }

interface Slot {
  id: string
  walletAddress: string
  mandateText: string
  mandateKind: MandateKind
  agentKeyHash: string | null
  capUsd: number
  status: 'pending' | 'hired' | 'benched' | 'fired'
  createdAt: string
}

const STATUS_TONES: Record<Slot['status'], string> = {
  pending: 'text-[color:var(--muted-2)]',
  hired: 'text-[color:var(--done)]',
  benched: 'text-amber-400',
  fired: 'text-[color:var(--muted-2)] line-through',
}

export default function TeamRailTab() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Composer state.
  const [mandate, setMandate] = useState('')
  const [posting, setPosting] = useState(false)
  // Per-slot hire input + in-flight flags.
  const [hireHash, setHireHash] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  // Live validation runs SERVER-SIDE (the grammar chain is server-only —
  // the client never forks the parser): debounced preview POSTs, nothing
  // written. The last response wins; stale ones are dropped by sequence.
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewSeq = useRef(0)
  useEffect(() => {
    const text = mandate.trim()
    if (text.length < 8) {
      setPreview(null)
      return
    }
    const seq = ++previewSeq.current
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/roster', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mandate: text, preview: true }),
        })
        const data = (await res.json()) as { preview?: Preview; error?: string }
        if (previewSeq.current !== seq) return
        setPreview(data.preview ?? (data.error ? { problem: data.error } : null))
      } catch {
        if (previewSeq.current === seq) setPreview(null)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [mandate])

  const refresh = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const res = await fetch(`/api/roster?wallet=${address}`)
      const data = (await res.json()) as { slots?: Slot[]; error?: string }
      if (res.ok && data.slots) setSlots(data.slots)
    } catch {
      /* fail-soft — the empty state stands in */
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const post = async () => {
    if (!address || posting) return
    setPosting(true)
    setError(null)
    try {
      const res = await fetch('/api/roster', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, mandate }),
      })
      const data = (await res.json()) as { slot?: Slot; error?: string }
      if (!res.ok || !data.slot) throw new Error(data.error ?? 'Could not post the slot.')
      // Drafts are private to the owner server-side; keep this one visible
      // in-session so it can be hired right here.
      setSlots((s) => [data.slot!, ...s])
      setMandate('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPosting(false)
    }
  }

  const hire = async (slot: Slot) => {
    if (!address || busy) return
    const agentKeyHash = (hireHash[slot.id] ?? '').trim().toLowerCase()
    setBusy(slot.id)
    setError(null)
    try {
      // Step 1 — the server mints nonce + expiry and returns the exact bytes.
      const mint = await fetch('/api/roster/hire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: slot.id, wallet: address, agentKeyHash }),
      })
      const minted = (await mint.json()) as { consentText?: string; error?: string }
      if (!mint.ok || !minted.consentText) throw new Error(minted.error ?? 'Could not start the hire.')
      // Step 2 — one personal_sign, then the server recovers + flips the slot.
      const signature = await signMessageAsync({ message: minted.consentText })
      const res = await fetch('/api/roster/hire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: slot.id, wallet: address, signature }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Hire failed.')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const fire = async (slot: Slot) => {
    if (!address || busy) return
    setBusy(slot.id)
    setError(null)
    try {
      const mint = await fetch('/api/roster/fire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: slot.id, wallet: address }),
      })
      const minted = (await mint.json()) as { consentText?: string; slot?: Slot; deleted?: boolean; error?: string }
      if (!mint.ok) throw new Error(minted.error ?? 'Could not start the fire.')
      // A SIWE session (or a pending draft) resolves in one step.
      if (minted.slot || minted.deleted) {
        await refresh()
        return
      }
      if (!minted.consentText) throw new Error('Could not start the fire.')
      const signature = await signMessageAsync({ message: minted.consentText })
      const res = await fetch('/api/roster/fire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: slot.id, wallet: address, signature }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Fire failed.')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!address) {
    return (
      <div className="flex-1 px-3 py-6">
        <p className="text-xs text-[color:var(--muted-2)]">
          Connect your wallet to build its staff — mandate slots live on the wallet, not an account.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-2">
      {/* ── The mandate composer ── */}
      <div className="px-1 pt-1 space-y-1.5">
        <textarea
          value={mandate}
          onChange={(e) => setMandate(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder={'A mandate is one sentence — e.g. "buy $25 of ETH weekly"'}
          className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-2.5 py-2 text-xs text-white placeholder:text-[color:var(--muted-2)] focus:outline-none focus:border-[var(--line-2)]"
        />
        {preview && (
          <p className={cn('text-[10px] leading-relaxed px-0.5', 'problem' in preview ? 'text-amber-400' : 'text-[color:var(--done)]')}>
            {'problem' in preview ? preview.problem : `${MANDATE_KIND_LABELS[preview.kind]} — ${preview.summary}`}
          </p>
        )}
        <button
          onClick={post}
          disabled={posting || !preview || 'problem' in (preview ?? {})}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line-2)] px-2 py-2 text-[11px] font-medium text-[color:var(--muted)] hover:text-white hover:border-[var(--muted-2)] hover:bg-white/[0.03] transition-colors disabled:opacity-50"
        >
          {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />}
          Post a mandate slot · ${ROSTER_DEFAULT_CAP_USD} cap
        </button>
      </div>

      {error && <p className="px-1.5 text-[10px] leading-relaxed text-[color:var(--fail)]">{error}</p>}

      {/* ── Slot rows ── */}
      {loading && slots.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-[color:var(--muted-2)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your staff…
        </div>
      )}
      {!loading && slots.length === 0 && (
        <p className="px-1.5 py-4 text-xs text-[color:var(--muted-2)]">Your wallet has no staff yet.</p>
      )}
      {slots.map((slot) => (
        <div key={slot.id} className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-2.5 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-black/30 border border-[var(--line)] text-[color:var(--accent)]">
              {MANDATE_KIND_LABELS[slot.mandateKind] ?? slot.mandateKind}
            </span>
            <span className={cn('mono text-[10px] flex-1 text-right', STATUS_TONES[slot.status])}>{slot.status}</span>
          </div>
          <p className="text-xs text-white leading-snug">{slot.mandateText}</p>
          <p className="mono text-[10px] text-[color:var(--muted-2)]">
            {slot.agentKeyHash ? `agent ${slot.agentKeyHash.slice(0, 8)}…` : 'unhired'} · ${slot.capUsd} cap
          </p>
          {slot.status === 'pending' && (
            <div className="flex items-center gap-1.5">
              <input
                value={hireHash[slot.id] ?? ''}
                onChange={(e) => setHireHash((h) => ({ ...h, [slot.id]: e.target.value }))}
                placeholder="agent handle (16 hex, see /agents)"
                className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-black/30 px-2 py-1 text-[10px] mono text-white placeholder:text-[color:var(--muted-2)] focus:outline-none"
              />
              <button
                onClick={() => hire(slot)}
                disabled={busy === slot.id || !/^[0-9a-f]{16}$/i.test((hireHash[slot.id] ?? '').trim())}
                className="rounded-lg bg-[var(--surf-2)] border border-[var(--line-2)] px-2.5 py-1 text-[10px] font-semibold text-white hover:border-[var(--accent)] transition-colors disabled:opacity-50"
              >
                {busy === slot.id ? 'Signing…' : 'Hire'}
              </button>
            </div>
          )}
          {(slot.status === 'hired' || slot.status === 'benched') && (
            <button
              onClick={() => fire(slot)}
              disabled={busy === slot.id}
              className="flex items-center gap-1 text-[10px] font-medium text-[color:var(--muted)] hover:text-[color:var(--fail)] transition-colors disabled:opacity-50"
            >
              <UserX className="w-3 h-3" />
              {busy === slot.id ? 'Firing…' : 'Fire'}
            </button>
          )}
        </div>
      ))}

      <p className="px-1.5 pt-1 text-[10px] leading-relaxed text-[color:var(--muted-2)] border-t border-[var(--line)]">
        Agents you hire can only PROPOSE guarded transactions for their mandate — every move still needs this wallet&apos;s signature. Firing is instant; there is nothing to withdraw.
      </p>
    </div>
  )
}
