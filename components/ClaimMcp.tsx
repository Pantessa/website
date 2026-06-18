'use client'

// Interactive claim control for the launchpad token panel (M6b, payTo-anchored).
// Claiming proves you operate the MCP by signing in with the wallet the MCP is
// PAID TO — its x402 payTo, read from its own endpoint. So the whole flow is:
// connect that wallet → sign in → Claim. If the viewer already owns it, offers
// a release.

import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useSession } from '@/lib/session'

const btn = {
  background: 'var(--accent)',
  color: 'var(--ink)',
  border: 'none',
  borderRadius: 12,
  padding: '9px 16px',
  fontWeight: 600,
  cursor: 'pointer',
  width: 'max-content',
} as const

const ghost = { ...btn, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--mist)' } as const
const note = { margin: 0, fontSize: 13, color: 'var(--smoke)' } as const

export default function ClaimMcp({ slug, ownerAddress }: { slug: string; ownerAddress: string | null }) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { address, signIn, signingIn } = useSession()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [requiredWallet, setRequiredWallet] = useState<string | null | undefined>(undefined) // undefined = loading
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Once signed in (and unclaimed), find which wallet this MCP is paid to.
  useEffect(() => {
    if (ownerAddress || !address) return
    let live = true
    fetch(`/api/mcp/${slug}/claim`)
      .then((r) => r.json())
      .then((d) => {
        if (live) setRequiredWallet(d.requiredWallet ?? null)
      })
      .catch(() => live && setRequiredWallet(null))
    return () => {
      live = false
    }
  }, [slug, address, ownerAddress])

  const claim = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/mcp/${slug}/claim`, { method: 'POST' })
      const data = (await r.json().catch(() => ({}))) as { error?: string; requiredWallet?: string }
      if (r.ok) {
        setDone(true)
        setTimeout(() => location.reload(), 900)
      } else {
        setError(data.error ?? 'Claim failed.')
        if (data.requiredWallet) setRequiredWallet(data.requiredWallet)
      }
    } finally {
      setBusy(false)
    }
  }, [slug])

  const release = useCallback(async () => {
    setBusy(true)
    await fetch(`/api/mcp/${slug}/claim`, { method: 'DELETE' })
    location.reload()
  }, [slug])

  if (!mounted) return null

  // Already claimed: only the owner sees a control (release).
  if (ownerAddress) {
    if (address && address === ownerAddress.toLowerCase()) {
      return (
        <button style={ghost} onClick={release} disabled={busy} className="mono">
          {busy ? 'Releasing…' : 'Release claim'}
        </button>
      )
    }
    return null
  }

  if (done) return <p style={{ margin: 0, color: 'var(--accent)' }}>Claimed ✓</p>

  if (!isConnected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={note}>Claim by signing in with the wallet this MCP is paid to.</p>
        <button style={btn} onClick={() => openConnectModal?.()} className="mono">
          Connect wallet to claim
        </button>
      </div>
    )
  }
  if (!address) {
    return (
      <button style={btn} onClick={() => void signIn()} disabled={signingIn} className="mono">
        {signingIn ? 'Signing in…' : 'Sign in to claim'}
      </button>
    )
  }

  // Signed in.
  if (requiredWallet === undefined) return <p style={note}>Checking the MCP&apos;s payee…</p>
  if (requiredWallet === null) {
    return <p style={note}>This MCP can&apos;t be self-verified — it needs admin verification. Contact Yeetful.</p>
  }

  const matches = address === requiredWallet.toLowerCase()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p className="mono" style={{ ...note, wordBreak: 'break-all' }}>
        Paid to {requiredWallet}
      </p>
      {matches ? (
        <button style={btn} onClick={() => void claim()} disabled={busy} className="mono">
          {busy ? 'Claiming…' : 'Claim this MCP'}
        </button>
      ) : (
        <p style={note}>Switch to that wallet (it&apos;s the one this MCP is paid to), then claim.</p>
      )}
      {error && <p className="mono" style={{ ...note, color: 'var(--error, #C0392B)' }}>{error}</p>}
    </div>
  )
}
