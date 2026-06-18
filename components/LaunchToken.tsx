'use client'

// The Launch button on a claimed MCP's token panel (x402-launch). Shown only to
// the claimed owner. Their wallet calls factory.launch on the launchpad chain;
// when it confirms, we POST /api/mcp/[slug]/launch, which reads the factory's
// on-chain registry and links the token to the directory. No indexer.

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { useSession } from '@/lib/session'
import { FACTORY_ABI, LAUNCH_CHAIN, LAUNCH_FACTORY } from '@/lib/launch-contracts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
const note = { margin: 0, fontSize: 13, color: 'var(--smoke)' } as const

type Phase = 'idle' | 'signing' | 'launching' | 'linking' | 'done'

export default function LaunchToken({
  slug,
  name,
  defaultSymbol,
  ownerAddress,
}: {
  slug: string
  name: string
  defaultSymbol: string
  ownerAddress: string
}) {
  const { address: wallet } = useAccount()
  const { address: session } = useSession()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [tokenName, setTokenName] = useState(name)
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const label: Record<Phase, string> = {
    idle: 'Launch token',
    signing: 'Confirm in wallet…',
    launching: 'Launching on-chain…',
    linking: 'Linking…',
    done: 'Launched ✓',
  }

  const launch = useCallback(async () => {
    if (!wallet) return
    setError(null)
    const sym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) || defaultSymbol
    const nm = tokenName.trim().slice(0, 64) || name
    try {
      await switchChainAsync({ chainId: LAUNCH_CHAIN.id }).catch(() => {})
      setPhase('signing')
      await writeContractAsync({
        address: LAUNCH_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'launch',
        args: [slug, nm, sym, wallet],
        chainId: LAUNCH_CHAIN.id,
      })

      // Poll our endpoint, which reads the factory's on-chain registry; it
      // succeeds once the launch tx mines. No receipt-wait, no indexer.
      setPhase('launching')
      let linked = false
      for (let i = 0; i < 20 && !linked; i++) {
        await sleep(3000)
        const r = await fetch(`/api/mcp/${slug}/launch`, { method: 'POST' })
        if (r.ok) linked = true
        else if (r.status !== 400) {
          const d = (await r.json().catch(() => ({}))) as { error?: string }
          throw new Error(d.error ?? 'Could not link the launched token.')
        }
      }
      if (!linked) throw new Error('Launch is taking longer than expected — refresh in a moment.')
      setPhase('done')
      setTimeout(() => location.reload(), 900)
    } catch (e) {
      setPhase('idle')
      const msg = e instanceof Error ? e.message : 'Launch failed.'
      setError(/rejected|denied|User /i.test(msg) ? 'Cancelled.' : msg)
    }
  }, [wallet, slug, name, tokenName, symbol, defaultSymbol, switchChainAsync, writeContractAsync])

  // Only the claimed owner can launch (and only once connected as that wallet).
  if (!mounted) return null
  if (!session || session !== ownerAddress.toLowerCase()) {
    return <p style={note}>Sign in as the owner to launch this MCP&apos;s token.</p>
  }

  const busy = phase === 'signing' || phase === 'launching' || phase === 'linking'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={note}>
        Launch this MCP&apos;s token on the bonding curve — your wallet signs it, and from then on
        stakers earn a cut of every paid call.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="mono" style={{ ...note, display: 'flex', alignItems: 'center', gap: 6 }}>
          name
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            maxLength={64}
            disabled={busy}
            className="mono"
            style={{
              width: 200,
              border: '1px solid var(--mist)',
              borderRadius: 8,
              padding: '6px 9px',
              background: 'var(--paper)',
              color: 'var(--ink)',
            }}
          />
        </label>
        <label className="mono" style={{ ...note, display: 'flex', alignItems: 'center', gap: 6 }}>
          ticker
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            maxLength={11}
            disabled={busy}
            className="mono"
            style={{
              width: 110,
              border: '1px solid var(--mist)',
              borderRadius: 8,
              padding: '6px 9px',
              background: 'var(--paper)',
              color: 'var(--ink)',
            }}
          />
        </label>
        <button style={btn} onClick={() => void launch()} disabled={busy || phase === 'done'} className="mono">
          {label[phase]}
        </button>
      </div>
      {error && <p className="mono" style={{ ...note, color: 'var(--error, #C0392B)' }}>{error}</p>}
    </div>
  )
}
