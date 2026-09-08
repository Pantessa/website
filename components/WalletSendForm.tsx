'use client'

// The Wallet panel's Send door — pick what you hold, say how much and to
// whom, review the guarded build, sign it with the wallet you're already
// connected with.
//
// Why a form and not "type it in the chat": a Pantessa (CDP embedded)
// wallet has no extension, so this panel IS its wallet UI, and a wallet
// without a Send button isn't one. The chain and token pickers are fed by
// the balances the panel just read — you can only send what you hold,
// from where it is — and the build is the chat's own guarded transfer
// (POST /api/wallet/send → lib/transfer-exec). The signature goes through
// SendTxButton, the same card every built transaction in the product uses,
// so the switch-chain / CDP / refusal-beacon behaviour is inherited, not
// re-implemented.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { AlertTriangle, CheckCircle2, ChevronLeft, Fuel, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import SendTxButton from '@/components/SendTxButton'
import SpendPolicyFix, { type PolicyBlockInfo } from '@/components/SpendPolicyFix'
import { getChainMark } from '@/components/chain-marks'
import { chainById } from '@/lib/chains'
import type { EvmTxRequest } from '@/lib/transaction-layer'
import type { GuardrailReport } from '@/lib/tx-guardrails'
import type { WalletChainView } from '@/lib/wallet-view'
import { cn } from '@/lib/utils'

type Built = {
  summary: string
  note: string
  guardrails: GuardrailReport & { policyBlock?: PolicyBlockInfo }
  blocked: boolean
  refusal?: string
  tx?: EvmTxRequest
}

const fmtBal = (s: string) => {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n === 0) return '0'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return n.toPrecision(3).replace(/\.?0+$/, '')
}

/** One first-party beacon per panel mount — the same funnel row the chat's
 *  transfer lane writes (tx-built → signed on /dashboard/embeds), so a
 *  panel send counts as money moved exactly like a typed one. */
function useSendSession() {
  const ref = useRef<string | null>(null)
  if (!ref.current) ref.current = `wallet-panel-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  return ref.current
}
function beacon(body: Record<string, unknown>) {
  void fetch('/api/embed/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstParty: true, page: typeof window !== 'undefined' ? window.location.href : undefined, ...body }),
  }).catch(() => {})
}

export default function WalletSendForm({
  address,
  chains,
  onSent,
  onBack,
}: {
  address: `0x${string}`
  /** The panel's per-chain read — only chains with holdings are offered. */
  chains: WalletChainView[]
  /** The receipt landed: the panel re-reads balances and shows the row. */
  onSent?: (info: { hash: string; chainId: number; summary: string }) => void
  onBack: () => void
}) {
  const { chain: connectedChain } = useAccount()
  const sessionId = useSendSession()
  const funded = useMemo(() => chains.filter((c) => c.holdings.length > 0), [chains])
  const [chainId, setChainId] = useState<number>(() => {
    const here = funded.find((c) => c.id === connectedChain?.id)
    return (here ?? funded[0])?.id ?? 8453
  })
  const chainView = funded.find((c) => c.id === chainId) ?? null
  const [tokenKey, setTokenKey] = useState<string>('')
  const holding = chainView?.holdings.find((h) => `${h.symbol}-${h.address}` === tokenKey) ?? chainView?.holdings[0] ?? null
  const [amount, setAmount] = useState('')
  const [all, setAll] = useState(false)
  const [to, setTo] = useState('')
  const [phase, setPhase] = useState<'form' | 'building' | 'review' | 'sent'>('form')
  const [problem, setProblem] = useState<{ text: string; field?: string } | null>(null)
  const [built, setBuilt] = useState<Built | null>(null)
  const [sent, setSent] = useState<{ hash: string; summary: string } | null>(null)

  // Switching chains resets the token to that chain's richest holding.
  useEffect(() => {
    setTokenKey('')
    setAmount('')
    setAll(false)
    setBuilt(null)
    setPhase('form')
  }, [chainId])

  const noGas = chainView?.gas === 'none' && holding && !holding.native
  const usdHint = useMemo(() => {
    if (!holding?.priceUsd) return null
    const n = all ? Number(holding.balance) : Number(amount)
    if (!Number.isFinite(n) || n <= 0) return null
    return n * holding.priceUsd
  }, [holding, amount, all])

  const review = async () => {
    if (!chainView || !holding) return
    setProblem(null)
    setBuilt(null)
    setPhase('building')
    try {
      const res = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: address,
          chainId: chainView.id,
          // Identity by contract, never by ticker (a ticker can be squatted
          // on another chain; the holding's address is what we read).
          token: holding.native ? 'ETH' : holding.address,
          amount: all ? 'all' : amount.trim(),
          to: to.trim(),
        }),
      })
      const data = (await res.json()) as Built & { problem?: string; field?: string }
      if (!res.ok || data.problem) {
        setProblem({ text: data.problem ?? `Couldn't build the send (${res.status}).`, field: data.field })
        setPhase('form')
        return
      }
      setBuilt(data)
      setPhase('review')
      if (!data.blocked) {
        beacon({ sessionId, walletAddress: address, outcome: 'tx-built', artifact: 'tx', chain: chainView.key, chainId: chainView.id, valueUsd: data.guardrails.valueUsd ?? undefined, buildPath: 'native-transfer' })
      }
    } catch (e) {
      setProblem({ text: e instanceof Error ? e.message : 'Could not reach the builder.' })
      setPhase('form')
    }
  }

  const chainInfo = chainById(chainId)

  if (funded.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-3 text-[12px] text-[color:var(--muted)]">
        Nothing to send yet — this wallet holds nothing on any chain. Add funds with a card or receive from another wallet first.
      </div>
    )
  }

  if (phase === 'sent' && sent) {
    return (
      <div className="rounded-xl border border-[color:var(--accent)]/50 bg-[color:var(--accent)]/[0.06] px-3.5 py-3 space-y-2">
        <div className="flex items-center gap-2 text-[12.5px]">
          <CheckCircle2 className="w-4 h-4 text-[color:var(--done)] flex-shrink-0" />
          <span className="font-medium text-[color:var(--fg)]">Sent.</span>
          <span className="text-[color:var(--muted)] truncate">{sent.summary}</span>
        </div>
        <div className="flex items-center gap-3 text-[11.5px]">
          {chainInfo && (
            <a href={`${chainInfo.explorerTx}${sent.hash}`} target="_blank" rel="noreferrer" className="text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)]">
              view on the explorer
            </a>
          )}
          <button type="button" onClick={() => { setSent(null); setBuilt(null); setAmount(''); setAll(false); setTo(''); setPhase('form') }} className="text-[color:var(--muted)] hover:text-[color:var(--fg)]">
            send another
          </button>
          <button type="button" onClick={onBack} className="text-[color:var(--muted)] hover:text-[color:var(--fg)]">
            done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-3 space-y-3" data-wallet-send>
      {/* Chain */}
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mb-1.5">From</div>
        <div className="flex flex-wrap gap-1.5">
          {funded.map((c) => {
            const Mark = getChainMark(c.key)
            const on = c.id === chainId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChainId(c.id)}
                disabled={phase !== 'form'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-60',
                  on ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--fg)]' : 'border-[var(--line)] text-[color:var(--muted)] hover:border-[var(--line-2)]',
                )}
              >
                {Mark ? <Mark size={14} /> : <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />}
                {c.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Token */}
      {chainView && (
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mb-1.5">Token</div>
          <div className="flex flex-wrap gap-1.5">
            {chainView.holdings.map((h) => {
              const key = `${h.symbol}-${h.address}`
              const on = holding ? `${holding.symbol}-${holding.address}` === key : false
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setTokenKey(key); setAll(false); setAmount(''); setBuilt(null); setPhase('form') }}
                  disabled={phase === 'building'}
                  className={cn(
                    'inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-60',
                    on ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--fg)]' : 'border-[var(--line)] text-[color:var(--muted)] hover:border-[var(--line-2)]',
                  )}
                  title={h.native ? 'Native ETH — also this chain’s gas' : h.address}
                >
                  <span className="font-medium">{h.symbol}</span>
                  <span className="mono text-[11px] opacity-80">{fmtBal(h.balance)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {noGas && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11.5px]">
          <Fuel className="w-3.5 h-3.5 mt-0.5 text-amber-400 flex-shrink-0" />
          <span className="text-[color:var(--fg)]">
            {chainView?.name} holds {holding?.symbol} but no ETH for gas — this send can be built, but the wallet can&rsquo;t pay to broadcast it until a little ETH lands here.
          </span>
        </div>
      )}

      {/* Amount + recipient */}
      {phase !== 'review' && (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,160px)_1fr] gap-2">
          <label className="block">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">Amount</span>
            <span className="mt-1 flex items-center rounded-lg border border-[var(--line)] bg-[var(--bg)] focus-within:border-[var(--line-2)]">
              <input
                type="text"
                inputMode="decimal"
                value={all ? fmtBal(holding?.balance ?? '0') : amount}
                onChange={(e) => { setAll(false); setAmount(e.target.value.replace(/[^\d.]/g, '')) }}
                placeholder="0.0"
                aria-label="Amount"
                aria-invalid={problem?.field === 'amount' || undefined}
                disabled={phase === 'building'}
                className={cn('min-w-0 flex-1 bg-transparent px-2.5 py-1.5 mono text-[13px] text-[color:var(--fg)] outline-none placeholder:text-[color:var(--muted-2)]', all && 'text-[color:var(--muted)]')}
              />
              <span className="pr-1.5 text-[11px] text-[color:var(--muted)]">{holding?.symbol}</span>
              <button
                type="button"
                onClick={() => { setAll(true); setAmount('') }}
                disabled={phase === 'building'}
                title={holding?.native ? 'Everything minus a small gas reserve the send itself needs' : 'Your whole balance'}
                className={cn('mr-1 rounded-md border px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-wide transition-colors', all ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[var(--line)] text-[color:var(--muted)] hover:text-[color:var(--fg)]')}
              >
                max
              </button>
            </span>
            <span className="mt-1 block text-[10.5px] text-[color:var(--muted-2)] min-h-[14px]">
              {usdHint != null ? `≈ $${usdHint.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : all && holding?.native ? 'minus the gas reserve' : ''}
            </span>
          </label>
          <label className="block">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">To</span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="0x… or name.eth"
              aria-label="Recipient"
              aria-invalid={problem?.field === 'to' || undefined}
              autoComplete="off"
              spellCheck={false}
              disabled={phase === 'building'}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 mono text-[13px] text-[color:var(--fg)] outline-none focus:border-[var(--line-2)] placeholder:text-[color:var(--muted-2)]"
            />
            <span className="mt-1 block text-[10.5px] text-[color:var(--muted-2)]">same address on every chain · transfers are irreversible</span>
          </label>
        </div>
      )}

      {problem && (
        <div className="flex items-start gap-2 text-[11.5px] text-[color:var(--sell)]">
          <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{problem.text}</span>
        </div>
      )}

      {phase !== 'review' && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void review()}
            disabled={phase === 'building' || !holding || !to.trim() || (!all && !(Number(amount) > 0))}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] text-black px-4 py-1.5 text-[12.5px] font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {phase === 'building' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {phase === 'building' ? 'Checking…' : 'Review send'}
          </button>
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)]">
            <ChevronLeft className="w-3.5 h-3.5" /> back
          </button>
        </div>
      )}

      {/* Review — the guarded build, then the sign card. */}
      {phase === 'review' && built && chainView && (
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-[color:var(--fg)] [overflow-wrap:anywhere]">{built.summary}</div>
          <div className="text-[11.5px] text-[color:var(--muted)]">{built.note}</div>
          <ul className="space-y-1">
            {built.guardrails.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[11.5px]">
                {c.ok ? (
                  c.level === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400 flex-shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[color:var(--done)] flex-shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 mt-0.5 text-[color:var(--fail)] flex-shrink-0" />
                )}
                {/* Guard notes quote full addresses — they must wrap at 375px. */}
                <span className={cn('min-w-0 [overflow-wrap:anywhere]', c.ok ? 'text-[color:var(--muted)]' : 'text-[color:var(--fg)]')}>{c.note}</span>
              </li>
            ))}
          </ul>
          {built.blocked ? (
            <>
              {/* The failed check is already on the list above in red — the
                  refusal is that same note, so say only what it means. */}
              <div className="text-[12px] text-[color:var(--fail)]">Not offered — nothing was built. Change the amount or the recipient and review again.</div>
              {built.guardrails.policyBlock && <SpendPolicyFix block={built.guardrails.policyBlock} onFixed={() => void review()} retryLabel="Review again" />}
            </>
          ) : built.tx ? (
            <SendTxButton
              tx={built.tx}
              summary={built.summary}
              refusalArtifact="tx"
              refusalBuildPath="native-transfer"
              onConfirmed={(hash) => {
                beacon({
                  sessionId,
                  walletAddress: address,
                  outcome: 'signed',
                  artifact: 'tx',
                  chain: chainView.key,
                  chainId: chainView.id,
                  txUrl: chainInfo ? `${chainInfo.explorerTx}${hash}` : undefined,
                  valueUsd: built.guardrails.valueUsd ?? undefined,
                  buildPath: 'native-transfer',
                })
                setSent({ hash, summary: built.summary })
                setPhase('sent')
                onSent?.({ hash, chainId: chainView.id, summary: built.summary })
              }}
            />
          ) : null}
          <button type="button" onClick={() => { setBuilt(null); setPhase('form') }} className="inline-flex items-center gap-1 text-[11.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)]">
            <ChevronLeft className="w-3.5 h-3.5" /> change something
          </button>
        </div>
      )}
    </div>
  )
}
