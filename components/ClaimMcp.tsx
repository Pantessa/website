'use client'

// Interactive claim control for the launchpad token panel (M6b). Lets an MCP's
// operator claim it: connect → SIWE → enter the backing GitHub repo. We show the
// exact proof file to commit; the POST verifies it (lib/mcp-claim) and binds the
// MCP to the wallet. If the viewer already owns it, offers a release.

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

export default function ClaimMcp({ slug, ownerAddress }: { slug: string; ownerAddress: string | null }) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { address, signIn, signingIn } = useSession()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const claim = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/mcp/${slug}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: repo.trim() }),
      })
      const data = (await r.json().catch(() => ({}))) as { error?: string }
      if (r.ok) {
        setDone(true)
        setTimeout(() => location.reload(), 900)
      } else {
        setError(data.error ?? 'Claim failed.')
      }
    } finally {
      setBusy(false)
    }
  }, [slug, repo])

  const release = useCallback(async () => {
    setBusy(true)
    await fetch(`/api/mcp/${slug}/claim`, { method: 'DELETE' })
    location.reload()
  }, [slug])

  if (!mounted) return null

  // Already claimed: only the owner sees a control (release); others see nothing here.
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

  // Not connected / not signed in.
  if (!isConnected) {
    return (
      <button style={btn} onClick={() => openConnectModal?.()} className="mono">
        Connect wallet to claim
      </button>
    )
  }
  if (!address) {
    return (
      <button style={btn} onClick={() => void signIn()} disabled={signingIn} className="mono">
        {signingIn ? 'Signing in…' : 'Sign in to claim'}
      </button>
    )
  }

  // Signed in: show the proof + the repo form.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mono" style={{ margin: 0, fontSize: 13, color: 'var(--smoke)' }}>
        1. In the repo that backs this MCP, commit{' '}
        <code>.well-known/yeetful-claim.txt</code> containing:
      </p>
      <code
        style={{
          display: 'block',
          background: 'var(--fog)',
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 13,
          wordBreak: 'break-all',
        }}
      >
        yeetful-claim {address}
      </code>
      <p className="mono" style={{ margin: 0, fontSize: 13, color: 'var(--smoke)' }}>
        2. Enter the repo and claim:
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/repo"
          className="mono"
          style={{
            flex: '1 1 200px',
            minWidth: 0,
            border: '1px solid var(--mist)',
            borderRadius: 10,
            padding: '9px 12px',
            background: 'var(--paper)',
            color: 'var(--ink)',
          }}
        />
        <button style={btn} onClick={() => void claim()} disabled={busy || !repo.trim()} className="mono">
          {busy ? 'Verifying…' : 'Claim'}
        </button>
      </div>
      {error && (
        <p className="mono" style={{ margin: 0, fontSize: 13, color: 'var(--error, #C0392B)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
