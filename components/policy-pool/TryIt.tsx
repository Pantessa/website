'use client'

// /policy-pool's "Try it" strip (TRYIT lane, squad policy-pool 2026-11-02):
// the demo script's three scenes as three buttons against the VIEWER's own
// wallet on the pool's chain. Every button goes through the connect-to-act
// door (lib/use-connect-to-act — rule 6: a stranger gets the connect-only
// door, the held ask runs when a wallet lands; never a raw connect modal).
// The server door is /api/policy-pool/try; the attested artifact is walked
// by the app's own SendTxChain; the result of every action is read back
// from the ledger (/api/policy-pool/events?intentId=) — the strip never
// claims a row the ledger doesn't have.

import { useCallback, useEffect, useRef, useState } from 'react'
import { erc20Abi } from 'viem'
import { useAccount, useBalance, usePublicClient, useReadContract, useSendTransaction, useSwitchChain } from 'wagmi'
import SendTxChain from '@/components/SendTxChain'
import type { TxChainRequest } from '@/lib/transaction-layer'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { reportWalletRefusal, walletErrorWords } from '@/lib/wallet-refusal'
import type { PolicyPoolEventRow } from '@/lib/policy-pool/ledger'
import { TRY_ASKS, TRY_BLURBS, TRY_EXPECTED_KINDS, TRY_FAUCETS, tryActionForAsk, type TryAction } from '@/lib/policy-pool/try'
import { KIND_META, elide } from '@/components/policy-pool/format'

/** The pool facts the strip needs, from the server page (null = not deployed). */
export interface TryPool {
  chainId: number
  chainName: string
  hook: string
  usdc: string
  maxUsd: number
  explorer: string
  mainnet: boolean
}

/** The ledger's "open this intent" signal (PolicyPoolLive listens). */
export const PP_OPEN_INTENT_EVENT = 'pp:open-intent'

type Phase = 'idle' | 'working' | 'signing' | 'sent' | 'watching' | 'done' | 'refused' | 'error'
interface CardState {
  phase: Phase
  /** The one-line result (green for done, red for refused/error). */
  line?: string
  tone?: 'go' | 'stop'
  intentId?: string
  txHash?: string
  txUrl?: string
  chain?: TxChainRequest
  /** Ledger kinds seen for this intent so far (the walk). */
  seen?: string[]
  revert?: string | null
}

const ACTIONS: TryAction[] = ['plain', 'attested', 'overcap']
const idle = (): Record<TryAction, CardState> => ({ plain: { phase: 'idle' }, attested: { phase: 'idle' }, overcap: { phase: 'idle' } })

export default function TryIt({ pool, misconfigured }: { pool: TryPool | null; misconfigured: boolean }) {
  const { address, chain: connectedChain, isConnected, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const publicClient = usePublicClient({ chainId: pool?.chainId })
  const [cards, setCards] = useState<Record<TryAction, CardState>>(idle)
  const watchers = useRef<Record<string, number>>({})

  const patch = useCallback((a: TryAction, p: Partial<CardState>) => setCards((c) => ({ ...c, [a]: { ...c[a], ...p } })), [])

  // Balances on the pool's chain — the faucet hint when the wallet holds nothing there.
  // Read once a minute: the faucet hint needs no live tape, and the chain's
  // public RPC rate-limits a browser that polls (see lib/wallet-chains).
  const eth = useBalance({ address, chainId: pool?.chainId, query: { enabled: !!address && !!pool, staleTime: 60_000, refetchInterval: 60_000 } })
  const usdc = useReadContract({
    abi: erc20Abi,
    address: pool?.usdc as `0x${string}` | undefined,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: pool?.chainId,
    query: { enabled: !!address && !!pool, staleTime: 60_000, refetchInterval: 60_000 },
  })
  const noGas = !!address && eth.isSuccess && eth.data.value === BigInt(0)
  const noUsdc = !!address && usdc.isSuccess && (usdc.data as bigint) < BigInt(1_000_000)
  const wrongChain = !!address && !!pool && connectedChain?.id !== pool.chainId

  // Walk an intent's ledger rows until every expected kind landed (≤90s).
  const watch = useCallback(
    (a: TryAction, intentId: string, want: string[]) => {
      const started = Date.now()
      if (watchers.current[a]) window.clearTimeout(watchers.current[a])
      const tick = async () => {
        try {
          const r = await fetch(`/api/policy-pool/events?intentId=${encodeURIComponent(intentId)}`, { cache: 'no-store' })
          const j = (await r.json()) as { ok: boolean; events: PolicyPoolEventRow[] }
          if (j.ok) {
            const seen: string[] = Array.from(new Set(j.events.map((e) => String(e.kind))))
            patch(a, { seen })
            if (want.every((k) => seen.includes(k))) {
              window.dispatchEvent(new CustomEvent(PP_OPEN_INTENT_EVENT, { detail: { intentId } }))
              return
            }
          }
        } catch {
          /* poll again */
        }
        if (Date.now() - started < 90_000) watchers.current[a] = window.setTimeout(tick, 3000)
      }
      void tick()
    },
    [patch],
  )
  useEffect(() => () => Object.values(watchers.current).forEach((t) => window.clearTimeout(t)), [])

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch('/api/policy-pool/try', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, wallet: address, chainId: pool?.chainId }) })
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
    },
    [address, pool?.chainId],
  )

  const ensureChain = useCallback(async () => {
    if (!pool || connectedChain?.id === pool.chainId) return
    await switchChainAsync({ chainId: pool.chainId })
  }, [pool, connectedChain?.id, switchChainAsync])

  const report = useCallback(
    async (a: TryAction, txHash: string, intentId: string) => {
      // The receipt can trail the wallet's hash by a block or two.
      for (let i = 0; i < 20; i++) {
        const { status, json } = await post({ action: 'report', txHash, intentId })
        if (status === 404 && json.pending) {
          await new Promise((r) => setTimeout(r, 2500))
          continue
        }
        return { status, json }
      }
      return { status: 504, json: { error: 'The receipt never came back within a minute — check the explorer link.' } as Record<string, unknown> }
    },
    [post],
  )

  const runPlain = useCallback(async () => {
    const a: TryAction = 'plain'
    patch(a, { phase: 'working', line: 'Building the swap with no attestation…', tone: undefined, seen: [], txHash: undefined, txUrl: undefined })
    const { status, json } = await post({ action: 'plain' })
    if (status !== 200 || !json.ok) {
      patch(a, { phase: 'error', tone: 'stop', line: String(json.reason ?? json.error ?? `The door answered ${status}.`) })
      return
    }
    const tx = json.tx as { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number; gas: string }
    const intentId = String(json.intentId)
    const sim = json.simulated as string | null
    patch(a, { intentId, phase: 'signing', line: sim ? `Simulation says the hook reverts ${sim}() — sign it in your wallet to see the chain refuse it.` : 'Sign it in your wallet.' })
    try {
      await ensureChain()
      const hash = await sendTransactionAsync({ to: tx.to, data: tx.data, value: BigInt(tx.value || '0'), gas: BigInt(tx.gas), chainId: tx.chainId })
      const txUrl = `${pool!.explorer}${hash}`
      patch(a, { phase: 'sent', txHash: hash, txUrl, line: 'Broadcast — waiting for the chain to refuse it…' })
      try {
        await publicClient?.waitForTransactionReceipt({ hash, timeout: 90_000 })
      } catch {
        /* the report call reads the receipt itself */
      }
      const rep = await report(a, hash, intentId)
      if (rep.status === 200 && rep.json.status === 'reverted') {
        patch(a, { phase: 'watching', tone: 'stop', revert: rep.json.revert as string | null, line: `The chain reverted it: ${String(rep.json.reason)} — the hook refused a swap with no attestation.` })
        watch(a, intentId, TRY_EXPECTED_KINDS.plain)
      } else if (rep.status === 200 && rep.json.status === 'success') {
        patch(a, { phase: 'error', tone: 'stop', line: 'Unexpected: the swap went through without an attestation. The hook did not refuse it — tell the desk.' })
      } else {
        patch(a, { phase: 'error', tone: 'stop', line: String(rep.json.reason ?? rep.json.error ?? `Report failed (${rep.status}).`) })
      }
    } catch (e) {
      // The wallet (or its RPC) refused a built tx before anything went out:
      // filed as a /dashboard/failures row like every other sign button
      // (lib/wallet-refusal drops a human's own "reject"). A revert after a
      // hash is the chain's verdict, read by `report` above, never a refusal.
      const msg = e instanceof Error ? walletErrorWords(e) : 'The wallet refused.'
      reportWalletRefusal({
        wallet: address ?? undefined,
        artifact: 'tx',
        buildPath: 'native-swap-policy-pool',
        connector: connector?.id ?? connector?.name,
        chainId: connectedChain?.id,
        ask: TRY_ASKS.plain,
        detail: msg,
      })
      patch(a, { phase: 'error', tone: 'stop', line: /rejected|denied/i.test(msg) ? 'Rejected in the wallet — nothing was sent.' : msg.slice(0, 200) })
    }
  }, [patch, post, ensureChain, sendTransactionAsync, publicClient, report, watch, pool, address, connector, connectedChain?.id])

  const runAttested = useCallback(
    async (a: 'attested' | 'overcap', usd: number) => {
      patch(a, { phase: 'working', line: `Asking the desk for $${usd.toLocaleString('en-US')}…`, tone: undefined, seen: [], chain: undefined, txHash: undefined, txUrl: undefined })
      const { status, json } = await post({ action: 'attested', usd })
      const intentId = typeof json.intentId === 'string' ? json.intentId : undefined
      if (json.refused) {
        patch(a, { phase: 'refused', tone: 'stop', intentId, line: String(json.reason) })
        if (intentId && json.refused === 'policy') watch(a, intentId, TRY_EXPECTED_KINDS.overcap)
        return
      }
      if (status !== 200 || !json.ok) {
        patch(a, { phase: 'error', tone: 'stop', intentId, line: String(json.reason ?? json.error ?? `The door answered ${status}.`) })
        return
      }
      const chain = json.txChain as TxChainRequest
      patch(a, { phase: 'signing', tone: 'go', intentId, chain, line: `Guard passed · attested for ${elide(address ?? '', 6, 4)} · ${chain.steps.length === 1 ? 'one signature' : `${chain.steps.length} steps`} below.` })
      if (intentId) watch(a, intentId, ['guard_allowed', 'attested'])
    },
    [patch, post, watch, address],
  )

  const onChainDone = useCallback(
    async (a: TryAction, hash: string, intentId: string) => {
      patch(a, { phase: 'sent', txHash: hash, txUrl: `${pool!.explorer}${hash}`, line: 'Signed and mined — reading the fill from the chain…' })
      const rep = await report(a, hash, intentId)
      if (rep.status === 200 && rep.json.status === 'success') {
        const fill = rep.json.fill as { origin: string } | null
        patch(a, { phase: 'watching', tone: 'go', line: fill ? `Filled. DeskFill emitted with origin "${fill.origin}" — your wallet signed a desk-attested swap.` : 'Mined, but no DeskFill log was found in the receipt.' })
        watch(a, intentId, TRY_EXPECTED_KINDS.attested)
      } else {
        patch(a, { phase: 'error', tone: 'stop', line: String(rep.json.reason ?? rep.json.error ?? `Report failed (${rep.status}).`) })
      }
    },
    [patch, pool, report, watch],
  )

  const run = useCallback(
    (ask: string) => {
      const a = tryActionForAsk(ask)
      if (!a || !pool) return
      if (a === 'plain') void runPlain()
      else void runAttested(a, a === 'attested' ? 1 : 5000)
    },
    [pool, runPlain, runAttested],
  )
  const { act, door } = useConnectToAct({ run, redirectFor: () => '/policy-pool', resumable: true })

  const disabledWhy = !pool ? (misconfigured ? 'The pool is half-configured on this desk — the buttons wake when the env is whole.' : 'The pool is not deployed yet — the buttons wake when the hook is live.') : pool.mainnet ? 'This strip never runs on Base mainnet; it rehearses on the testnet.' : null

  return (
    <section className="pg__sec pp-sec pp-try" aria-labelledby="pp-try" data-try-strip={disabledWhy ? 'off' : 'on'}>
      <div className="pg__sec-head">
        <h2 className="pg__sec-title" id="pp-try">Try it</h2>
        <span className="pg__sec-note">{pool ? `your wallet · ${pool.chainName} · $${pool.maxUsd.toLocaleString('en-US')} cap` : 'your wallet · the pool’s chain'}</span>
      </div>
      {disabledWhy && <p className="pp-try__state" data-state="off">{disabledWhy}</p>}
      {!disabledWhy && !isConnected && <p className="pp-try__state">No wallet connected — any button opens the connect door, then runs what you pressed. Nothing is signed without you.</p>}
      {!disabledWhy && wrongChain && (
        <p className="pp-try__state" data-state="chain">
          Your wallet is on {connectedChain?.name ?? 'another chain'}; the pool is on {pool!.chainName}.{' '}
          <button type="button" className="pp-try__link" onClick={() => void switchChainAsync({ chainId: pool!.chainId }).catch(() => {})}>Switch to {pool!.chainName}</button>
          {' '}— or sign and the card switches for you.
        </p>
      )}
      {!disabledWhy && (noGas || noUsdc) && (
        <p className="pp-try__state" data-state="faucet">
          This wallet holds {noGas && noUsdc ? 'no ETH and under 1 USDC' : noGas ? 'no ETH for gas' : 'under 1 USDC'} on {pool!.chainName}. Faucets:{' '}
          {TRY_FAUCETS.map((f, i) => (
            <span key={f.href}>
              {i > 0 && ' · '}
              <a href={f.href} target="_blank" rel="noopener noreferrer">{f.name}</a>
            </span>
          ))}
          {noUsdc && !noGas && '. USDC: the Coinbase faucet dispenses it; or swap a little ETH for USDC on any Sepolia venue.'}
        </p>
      )}
      <div className="pp-try__grid">
        {ACTIONS.map((a) => {
          const c = cards[a]
          const busy = c.phase === 'working' || c.phase === 'signing' || c.phase === 'sent'
          const want = TRY_EXPECTED_KINDS[a]
          return (
            <article className="pp-try__card" key={a} data-try={a} data-phase={c.phase}>
              <h3 className="pp-try__t">{TRY_BLURBS[a].title}</h3>
              <p className="pp-try__b">{TRY_BLURBS[a].body}</p>
              <button
                type="button"
                className={`pg__btn ${a === 'attested' ? 'pg__btn--accent' : ''}`}
                data-try-button={a}
                disabled={!!disabledWhy || busy}
                aria-busy={busy || undefined}
                onClick={() => act(TRY_ASKS[a])}
              >
                {busy ? 'Working…' : c.phase === 'idle' ? TRY_BLURBS[a].title : 'Run it again'}
              </button>
              {c.line && (
                <p className="pp-try__line" data-tone={c.tone} role="status">
                  <i aria-hidden />
                  <span>{c.line}</span>
                </p>
              )}
              {c.txUrl && (
                <a className="pp-try__tx pp-mono" href={c.txUrl} target="_blank" rel="noopener noreferrer">
                  {elide(c.txHash ?? '', 10, 6)} on {pool?.chainName ?? 'the explorer'} ↗
                </a>
              )}
              {c.chain && c.intentId && (c.phase === 'signing' || c.phase === 'sent' || c.phase === 'watching' || c.phase === 'done') && (
                <div className="pp-try__chain">
                  <SendTxChain chain={c.chain} onCompleted={({ hash }) => void onChainDone(a, hash, c.intentId!)} />
                </div>
              )}
              {c.intentId && c.seen !== undefined && c.phase !== 'idle' && c.phase !== 'working' && (
                <ol className="pp-try__walk" aria-label="Ledger rows for this intent">
                  {want.map((k) => {
                    const hit = c.seen?.includes(k)
                    const m = KIND_META[k as keyof typeof KIND_META]
                    return (
                      <li key={k} data-hit={hit ? 'true' : 'false'} data-tone={m?.tone}>
                        <i aria-hidden />
                        {m?.label ?? k}
                      </li>
                    )
                  })}
                </ol>
              )}
              {c.intentId && c.seen && c.seen.length > 0 && (
                <button
                  type="button"
                  className="pp-try__link"
                  onClick={() => window.dispatchEvent(new CustomEvent(PP_OPEN_INTENT_EVENT, { detail: { intentId: c.intentId } }))}
                >
                  Open the ledger row ↓
                </button>
              )}
            </article>
          )
        })}
      </div>
      {door}
    </section>
  )
}
