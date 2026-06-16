'use client'

// Inline approval switch on a service detail page — approve/deny THIS agent for
// your expense account without a trip to the dashboard. Chat deep-links here
// (/servers/<slug>#approve) when a turn is blocked for lack of approval, so the
// user can fix it in one click. Mirrors the dashboard approvals mechanism
// (GET/PUT /api/approvals); a PUT mints the default grant on first use.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import type { Approval } from '@/lib/dashboard-ui'

export default function ServerApproveToggle({
  serverId,
  serverName,
}: {
  serverId: string
  serverName: string
}) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { address, signIn, signingIn } = useSession()
  const [approved, setApproved] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Wallet/session state is client-only — avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const load = useCallback(async () => {
    const r = await fetch('/api/approvals', { cache: 'no-store' })
    if (!r.ok) return
    const list: Approval[] = await r.json()
    const row = list.find((a) => a.serverId === serverId)
    setApproved(row ? row.approved : false)
  }, [serverId])

  useEffect(() => {
    if (address) void load()
    else setApproved(null)
  }, [address, load])

  // Deep-link landing: /servers/<slug>#approve scrolls here and flashes the border.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#approve') {
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 2200)
      return () => clearTimeout(t)
    }
  }, [])

  const toggle = async () => {
    if (approved === null || busy) return
    const next = !approved
    setApproved(next)
    setBusy(true)
    try {
      const r = await fetch('/api/approvals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, approved: next }),
      })
      if (!r.ok) setApproved(!next)
    } catch {
      setApproved(!next)
    } finally {
      setBusy(false)
    }
  }

  if (!mounted) return null

  // Not connected / not signed in → a prompt that enables approving.
  const cta = !isConnected
    ? { label: 'Connect wallet to approve', onClick: () => openConnectModal?.() }
    : !address
      ? { label: signingIn ? 'Signing in…' : 'Sign in to approve', onClick: () => void signIn() }
      : null

  const sub =
    approved === null && address
      ? 'Loading…'
      : cta
        ? 'Approving allowlists this agent so your wallet can pay it in chat.'
        : approved
          ? `Approved — your expense account can pay ${serverName}.`
          : `Off — chat will refuse to pay ${serverName} until you approve it.`

  return (
    <div
      id="approve"
      ref={ref}
      className={cn(
        'mt-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 bg-[var(--surf-1)] transition-colors scroll-mt-24',
        flash ? 'border-[var(--accent)]' : 'border-[var(--line)]',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm text-white font-medium">Approve for your expense account</p>
        <p className="text-[12px] text-[color:var(--muted-2)]">{sub}</p>
      </div>
      {cta ? (
        <button className="btn btn--solid flex-shrink-0" onClick={cta.onClick}>
          {cta.label}
        </button>
      ) : (
        <button
          role="switch"
          aria-checked={!!approved}
          aria-label={`Approve ${serverName}`}
          disabled={approved === null || busy}
          onClick={toggle}
          className={cn(
            'flex-shrink-0 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50',
            approved ? 'bg-emerald-500' : 'bg-white/10',
          )}
        >
          <span
            className={cn(
              'absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all',
              approved ? 'left-[23px]' : 'left-[3px]',
            )}
          />
        </button>
      )}
    </div>
  )
}
