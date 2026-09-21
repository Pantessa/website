'use client'

// The Private switch on a cross-chain sign card (NEAR Confidential Intents).
//
// It is a switch, but it does not flip state: a private swap needs a fresh
// quote and a fresh one-time deposit address, so each press SENDS the amend
// sentence the chat's own grammar reads ("make it private", "make it public",
// "deliver it to 0x…" — lib/cross-chain-swap parseCrossChainFollowUp). One
// code path for the switch and a typed ask; the rebuilt card replaces this
// one, guard-verified like any other.
//
// The copy is deliberately plain about the limit: the deposit and the payout
// are both public transfers, so private mode only means something when the
// payout lands at an address that isn't linked to the paying wallet. Turning
// the switch on therefore opens ONE optional field, and nothing else.
//
// `live` is false on every card but the newest — an old card's pending swap
// is gone, so its switch reads as a label and sends nothing.

import { useState } from 'react'
import { EyeOff, ArrowRight } from 'lucide-react'
import { checkRecipient, type SwapPrivacy } from '@/lib/cross-chain-swap'

export function swapPrivacyOf(meta: unknown): SwapPrivacy | null {
  const p = (meta as { txRequest?: { privacy?: unknown } } | null | undefined)?.txRequest?.privacy
  if (!p || typeof p !== 'object') return null
  const d = p as Record<string, unknown>
  if (typeof d.confidential !== 'boolean') return null
  return {
    confidential: d.confidential,
    ...(typeof d.recipient === 'string' && /^0x[0-9a-fA-F]{40}$/.test(d.recipient) ? { recipient: d.recipient } : {}),
    canDeliverElsewhere: d.canDeliverElsewhere === true,
  }
}

export default function PrivateSwapToggle({
  privacy,
  live,
  disabled,
  onSend,
}: {
  privacy: SwapPrivacy
  live: boolean
  disabled?: boolean
  onSend: (ask: string) => void
}) {
  const [address, setAddress] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const on = privacy.confidential
  const locked = !live || disabled

  const deliver = () => {
    const checked = checkRecipient(address.trim())
    if (!checked.ok) return setProblem(checked.problem)
    setProblem(null)
    onSend(`deliver it to ${checked.address}`)
  }

  return (
    <div
      data-private-swap={on ? 'on' : 'off'}
      className={`mb-2 rounded-lg border px-3 py-2 ${on ? 'border-[var(--accent)] tint-bg-accent-6' : 'border-[var(--line)] bg-[var(--surf-1)]'}`}
    >
      <div className="flex items-center gap-2.5">
        <EyeOff className={`h-4 w-4 shrink-0 ${on ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)]'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium leading-tight text-[color:var(--fg)]">Private mode</div>
          <div className="text-[11px] leading-snug text-[color:var(--muted)]">
            {on ? 'The route between your deposit and the payout stays off the public record.' : 'Keep the route between your deposit and the payout off the public record. Same price, same single signature.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Private mode"
          disabled={locked}
          onClick={() => onSend(on ? 'make it public' : 'make it private')}
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line-2)] bg-[var(--surf-2)]'}`}
        >
          <span className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-[var(--bg)] transition-[left] ${on ? 'left-[18px]' : 'left-[2px] bg-[var(--muted)]'}`} />
        </button>
      </div>

      {on && privacy.recipient && (
        <p className="mt-2 text-[11px] leading-snug text-[color:var(--muted)] [overflow-wrap:anywhere]">
          Delivering to <span className="font-mono text-[color:var(--fg)]">{privacy.recipient}</span>.{' '}
          {live && !disabled && (
            <button type="button" className="underline underline-offset-2 hover:text-[color:var(--fg)]" onClick={() => onSend('deliver it back to my wallet')}>
              Deliver to my wallet instead
            </button>
          )}
        </p>
      )}

      {on && !privacy.recipient && (
        <div className="mt-2">
          <p className="text-[11px] leading-snug text-[color:var(--muted)]">
            Your deposit and the payout are still public transfers, and right now both touch this wallet, so they are easy to match. For real privacy, deliver to an address that isn&apos;t linked to this one.
          </p>
          {privacy.canDeliverElsewhere && live && (
            <form
              className="mt-1.5 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                deliver()
              }}
            >
              <input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value)
                  if (problem) setProblem(null)
                }}
                placeholder="Deliver to a different address (0x…), optional"
                spellCheck={false}
                autoComplete="off"
                disabled={disabled}
                aria-label="Delivery address"
                className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[color:var(--fg)] placeholder:font-sans placeholder:text-[color:var(--muted-2)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={disabled || !address.trim()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--line-2)] px-2 py-1.5 text-[11px] text-[color:var(--fg)] hover:border-[var(--accent)] disabled:opacity-40"
              >
                Rebuild <ArrowRight className="h-3 w-3" />
              </button>
            </form>
          )}
          {problem && <p className="mt-1 text-[11px] leading-snug text-amber-400">{problem}</p>}
        </div>
      )}
    </div>
  )
}
