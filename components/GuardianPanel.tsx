'use client'

// Guardian panel — the whole autonomy-without-custody surface in one place:
// approve the agent delegation (one EIP-712 signature; the venue bars agent
// keys from withdrawing), arm stop-loss / take-profit policies on live
// positions, and watch the receipt trail the cron sweep writes.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChainId, useSignTypedData } from 'wagmi'
import { ShieldCheck, ShieldOff, Pause, Play, Trash2 } from 'lucide-react'

interface Delegation {
  id: string
  agentAddress: string
  hlChain: string
  status: string
  approvedAt: string | null
  expiresAt: string
}

interface Policy {
  id: string
  coin: string
  side: string
  kind: string
  triggerMode: string
  triggerValue: number
  status: string
  lastChecked: string | null
  runs?: Run[]
}

interface Run {
  id: string
  action: string
  reason: string
  valueUsd: number | null
  createdAt: string
}

interface Position {
  coin: string
  side: 'long' | 'short'
  szi: number
  entryPx: number
  markPx: number | null
  positionValueUsd: number
  unrealizedPnl: number
  leverage: number
  liquidationPx: number | null
}

interface GuardianState {
  delegation: Delegation | null
  policies: Policy[]
  runs: Run[]
  testnet: boolean
}

const box = 'rounded-xl border border-[color:var(--border,rgba(128,128,128,0.25))] p-4'
const label = 'mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]'
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border,rgba(128,128,128,0.3))] px-3 py-1.5 text-[13px] font-medium hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed'
const input =
  'w-full rounded-lg border border-[color:var(--border,rgba(128,128,128,0.3))] bg-transparent px-2.5 py-1.5 text-[13px]'

function statusChip(status: string) {
  const tone =
    status === 'active'
      ? 'border-emerald-500/40 text-emerald-500'
      : status === 'done' || status === 'triggered'
        ? 'border-sky-500/40 text-sky-500'
        : status === 'error'
          ? 'border-red-500/40 text-red-500'
          : 'border-[color:var(--border,rgba(128,128,128,0.3))] text-[color:var(--muted-2)]'
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{status}</span>
}

export default function GuardianPanel() {
  const chainId = useChainId()
  const { signTypedDataAsync } = useSignTypedData()
  const [state, setState] = useState<GuardianState | null>(null)
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Policy form
  const [coin, setCoin] = useState('')
  const [kind, setKind] = useState<'stop_loss' | 'take_profit'>('stop_loss')
  const [mode, setMode] = useState<'price_move_pct' | 'price'>('price_move_pct')
  const [value, setValue] = useState('10')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guardian', { cache: 'no-store' })
      if (res.status === 401) {
        setState(null)
        setError('Sign in with your wallet to use the guardian.')
        return
      }
      if (!res.ok) throw new Error('load failed')
      setState((await res.json()) as GuardianState)
      setError('')
    } catch {
      setError('Could not load guardian state.')
    }
  }, [])

  const loadPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/guardian/positions', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { positions: Position[] }
      setPositions(data.positions)
      if (data.positions.length && !data.positions.some((p) => p.coin === coin)) setCoin(data.positions[0].coin)
    } catch {
      /* positions stay null; the form explains */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
    void loadPositions()
  }, [load, loadPositions])

  const delegationLive = state?.delegation?.status === 'active' && new Date(state.delegation.expiresAt) > new Date()

  const approve = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await fetch('/api/guardian/delegation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signatureChainId: chainId }),
      })
      if (!created.ok) throw new Error((await created.json()).error || 'Could not start the delegation.')
      const { id, typedData } = (await created.json()) as { id: string; typedData: { domain: object; types: object; primaryType: string; message: Record<string, unknown> } }
      // uint64 nonce must go to the wallet as a BigInt.
      const message = { ...typedData.message, nonce: BigInt(typedData.message.nonce as number) }
      const signature = await signTypedDataAsync({ ...typedData, message } as Parameters<typeof signTypedDataAsync>[0])
      const activated = await fetch('/api/guardian/delegation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, signature }),
      })
      if (!activated.ok) throw new Error((await activated.json()).error || 'The venue rejected the approval.')
      setNotice('Guardian agent approved — it can trade this account, never withdraw from it.')
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(/rejected|denied/i.test(msg) ? 'Signature request declined.' : msg || 'Approval failed.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    setError('')
    try {
      await fetch('/api/guardian/delegation', { method: 'DELETE' })
      setNotice('Delegation revoked — the guardian is standing down and all policies are paused.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const arm = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/guardian/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coin, kind, triggerMode: mode, triggerValue: Number(value) }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not arm the policy.')
      setNotice(`Armed: ${kind.replace('_', '-')} on ${coin}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not arm the policy.')
    } finally {
      setBusy(false)
    }
  }

  const setPolicyStatus = async (id: string, status: 'active' | 'paused') => {
    await fetch(`/api/guardian/policies/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await load()
  }

  const retirePolicy = async (id: string) => {
    await fetch(`/api/guardian/policies/${id}`, { method: 'DELETE' })
    await load()
  }

  const selected = useMemo(() => positions?.find((p) => p.coin === coin) ?? null, [positions, coin])

  if (!state && error) return <p className="text-[13px] text-[color:var(--muted-2)]">{error}</p>
  if (!state) return <p className="text-[13px] text-[color:var(--muted-2)]">Loading…</p>

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {state.testnet && (
        <p className="text-[12px] rounded-lg border border-amber-500/40 text-amber-500 px-3 py-2">
          Running against Hyperliquid <strong>Testnet</strong> (HL_GUARDIAN_TESTNET).
        </p>
      )}

      {/* ── Delegation ── */}
      <section className={box}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className={label}>Agent delegation</h2>
            {delegationLive && state.delegation ? (
              <p className="text-[13px] mt-1">
                <ShieldCheck className="inline w-4 h-4 mr-1 text-emerald-500" aria-hidden />
                Active — agent <span className="mono">{state.delegation.agentAddress.slice(0, 10)}…</span> can{' '}
                <strong>trade</strong> this account (withdrawals stay wallet-only, enforced by Hyperliquid). Expires{' '}
                {new Date(state.delegation.expiresAt).toLocaleDateString()}.
              </p>
            ) : (
              <p className="text-[13px] mt-1 text-[color:var(--muted-2)]">
                One signature approves a Pantessa-held agent key on your Hyperliquid account. The key can close
                positions under your policies — it can <strong>never withdraw</strong>. Revocable here (or in the HL
                app) any time; expires automatically after 90 days.
              </p>
            )}
          </div>
          {delegationLive ? (
            <button className={btn} onClick={revoke} disabled={busy}>
              <ShieldOff className="w-4 h-4" aria-hidden /> Revoke
            </button>
          ) : (
            <button className={btn} onClick={approve} disabled={busy}>
              <ShieldCheck className="w-4 h-4" aria-hidden /> {busy ? 'Waiting for wallet…' : 'Approve guardian agent'}
            </button>
          )}
        </div>
      </section>

      {/* ── Arm a policy ── */}
      <section className={box}>
        <h2 className={label}>Arm a policy</h2>
        {positions === null ? (
          <p className="text-[13px] mt-2 text-[color:var(--muted-2)]">Reading your Hyperliquid positions…</p>
        ) : positions.length === 0 ? (
          <p className="text-[13px] mt-2 text-[color:var(--muted-2)]">No open perp positions on this account — nothing to guard.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div>
                <label className={label} htmlFor="g-coin">Position</label>
                <select id="g-coin" className={input} value={coin} onChange={(e) => setCoin(e.target.value)}>
                  {positions.map((p) => (
                    <option key={p.coin} value={p.coin}>
                      {p.coin} {p.side} {p.leverage}x
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="g-kind">Kind</label>
                <select id="g-kind" className={input} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="stop_loss">Stop loss</option>
                  <option value="take_profit">Take profit</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="g-mode">Trigger</label>
                <select id="g-mode" className={input} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="price_move_pct">% from entry</option>
                  <option value="price">Absolute price</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="g-value">{mode === 'price_move_pct' ? 'Percent' : 'Price'}</label>
                <input id="g-value" className={input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
            </div>
            {selected && (
              <p className="text-[12px] mt-2 text-[color:var(--muted-2)]">
                {selected.coin} {selected.side} · entry {selected.entryPx} · mark {selected.markPx ?? '—'} · uPnL $
                {selected.unrealizedPnl.toFixed(2)}
                {selected.liquidationPx != null && <> · liq {selected.liquidationPx}</>}
              </p>
            )}
            <button className={`${btn} mt-3`} onClick={arm} disabled={busy || !delegationLive} title={delegationLive ? '' : 'Approve the guardian agent first'}>
              Arm policy
            </button>
          </>
        )}
      </section>

      {/* ── Armed policies ── */}
      {state.policies.length > 0 && (
        <section className={box}>
          <h2 className={label}>Policies</h2>
          <ul className="mt-2 divide-y divide-[color:var(--border,rgba(128,128,128,0.15))]">
            {state.policies.map((p) => (
              <li key={p.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[13px]">
                  <span className="font-medium">
                    {p.coin} {p.side}
                  </span>{' '}
                  · {p.kind.replace('_', ' ')} at {p.triggerMode === 'price' ? `px ${p.triggerValue}` : `${p.triggerValue}% from entry`}
                  <span className="ml-2">{statusChip(p.status)}</span>
                  {p.lastChecked && (
                    <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">checked {new Date(p.lastChecked).toLocaleTimeString()}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {p.status === 'active' && (
                    <button className={btn} onClick={() => setPolicyStatus(p.id, 'paused')} title="Pause">
                      <Pause className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  )}
                  {(p.status === 'paused' || p.status === 'error') && (
                    <button className={btn} onClick={() => setPolicyStatus(p.id, 'active')} title="Resume">
                      <Play className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  )}
                  {p.status !== 'triggered' && (
                    <button className={btn} onClick={() => retirePolicy(p.id)} title="Retire (receipts are kept)">
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Receipts ── */}
      {state.runs.length > 0 && (
        <section className={box}>
          <h2 className={label}>Guardian activity</h2>
          <ul className="mt-2 divide-y divide-[color:var(--border,rgba(128,128,128,0.15))]">
            {state.runs.map((r) => (
              <li key={r.id} className="py-2 text-[12.5px]">
                <span className="mono text-[11px] text-[color:var(--muted-2)] mr-2">{new Date(r.createdAt).toLocaleString()}</span>
                {statusChip(r.action)}
                {r.valueUsd != null && <span className="ml-2 font-medium">${r.valueUsd.toFixed(2)}</span>}
                <div className="text-[color:var(--muted-2)] mt-0.5">{r.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(error || notice) && <p className={`text-[13px] ${error ? 'text-red-500' : 'text-emerald-500'}`}>{error || notice}</p>}
    </div>
  )
}
