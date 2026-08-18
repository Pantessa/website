'use client'

// "Send transaction" — the generic renderer for `evm-tx` artifacts: a
// prebuilt on-chain transaction (Uniswap swap, transfer, mint, approve…) the
// USER broadcasts from their own wallet. The venue-agnostic sibling of
// SignOrderButton (CoW's off-chain orders): Pantessa built the calldata
// deterministically; the wallet signs and pays gas; nothing is custodied.
//
// Progress stepper: Sign → Broadcast → Confirmed, with the transaction's
// block-explorer link live from the moment a hash exists. Confirmation waits
// on the real receipt — a revert shows as failure with the same link.

import { useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi'
import { Loader2, PenLine, CheckCircle2, Circle, ExternalLink, XCircle } from 'lucide-react'
import type { EvmTxRequest } from '@/lib/transaction-layer'
import { chainById } from '@/lib/chains'
import { reportWalletRefusal, type WalletArtifact } from '@/lib/wallet-refusal'

type Status = 'idle' | 'signing' | 'broadcast' | 'confirmed' | 'reverted' | 'error'

const ORDER = ['idle', 'signing', 'broadcast', 'confirmed'] as const
const STEPS: Array<{ key: Status; label: string }> = [
  { key: 'signing', label: 'Sign' },
  { key: 'broadcast', label: 'Broadcast' },
  { key: 'confirmed', label: 'Confirmed' },
]

// Explorer + display names come from the app chain registry; the local map
// only covers non-registry chains the app can still broadcast on.
const TX_EXPLORER: Record<number, string> = {
  84532: 'https://sepolia.basescan.org/tx/',
}

export default function SendTxButton({
  tx,
  summary,
  autoFire = false,
  onConfirmed,
  refusalArtifact = 'tx',
  refusalBuildPath,
}: {
  tx: EvmTxRequest
  summary?: string
  /** Request the wallet signature on mount — SendTxChain sets this on steps
   *  after the first so popups follow each other like a sign-in flow, no
   *  button hunt between steps. The button stays as the retry surface. */
  autoFire?: boolean
  /** Fires once when the receipt lands with status success — SendTxChain
   *  advances the multi-step card on this. */
  onConfirmed?: (hash: string) => void
  /** Wallet-refusal beacon tag: 'tx' for a lone card, 'tx-chain' when this
   *  step sits inside SendTxChain (the artifact the row is filed under). */
  refusalArtifact?: WalletArtifact
  /** Build-path attribution for the refusal row (e.g. native-swap-uniswap). */
  refusalBuildPath?: string
}) {
  const { address, isConnected, connector, chain: connectedChain } = useAccount()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const chainId = tx.chainId ?? 8453
  // The receipt must be read from the chain the TX IS ON, not whatever chain
  // the wallet happened to be connected to when this rendered — an unpinned
  // client polls the wrong chain forever and the card sticks on "Waiting for
  // confirmation…" while the tx has long since confirmed.
  const publicClient = usePublicClient({ chainId })
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  // The wallet refused the network switch: the inline line names the chain
  // and the button itself becomes the "switch & retry" — never just red text.
  const [switchNeeded, setSwitchNeeded] = useState(false)

  const chainInfo = chainById(chainId)
  const explorer = chainInfo?.explorerTx ?? TX_EXPLORER[chainId] ?? 'https://basescan.org/tx/'

  const send = async () => {
    setError('')
    setSwitchNeeded(false)
    if (!isConnected || !address) {
      setError('Connect your wallet first.')
      return
    }
    let txHash: `0x${string}` | null = null
    try {
      setStatus('signing')
      // Match the wallet's network to the built transaction before signing.
      // Only when it actually differs: the same-chain path must stay a
      // zero-await straight shot (Coinbase's popup wallet breaks on popups
      // issued after extra awaits).
      if (connectedChain?.id !== chainId) {
        try {
          await switchChainAsync({ chainId })
        } catch (e) {
          // A refused/failed network switch is a wallet wall too (a wallet
          // that can't reach chain 4663, say) — log it; a plain "no" is not.
          reportWalletRefusal({
            wallet: address, artifact: refusalArtifact, buildPath: refusalBuildPath,
            connector: connector?.id ?? connector?.name, chainId: connectedChain?.id,
            ask: `${summary ?? tx.action ?? 'transaction'} (switch to ${chainInfo?.name ?? `chain ${chainId}`})`,
            detail: e instanceof Error ? e.message.split('\n')[0] : String(e),
          })
          setError(`This transaction is built for ${chainInfo?.name ?? `chain ${chainId}`} — switch the wallet to it (the button below asks again), then it signs.`)
          setSwitchNeeded(true)
          setStatus('error')
          return
        }
        // Let the wallet settle on the new network before the sign sheet
        // opens. MetaMask estimates fees + simulates DURING the popup; a
        // request racing a just-switched network (worst on custom chains
        // like Robinhood 4663) paints "fee unavailable" + "likely to fail"
        // on a perfectly good tx (2026-07-15 funding-leg false alarm).
        await new Promise((r) => setTimeout(r, 750))
      }
      txHash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: (tx.data ?? '0x') as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : undefined,
        chainId,
      })
      setHash(txHash)
      setStatus('broadcast')
      // Generous window + retries: smart-wallet bundlers (Coinbase) add
      // seconds between hash issuance and mining — the default gave up on a
      // tx that CONFIRMED moments later (2026-07-03, Nate's approve).
      if (!publicClient) {
        // No client for this chain in the wagmi config — we can't verify the
        // receipt. Say so honestly instead of painting "reverted".
        setError('Broadcast — this chain isn’t configured for receipt checks; verify on the explorer link above.')
        return
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000, retryCount: 8 })
      setStatus(receipt.status === 'success' ? 'confirmed' : 'reverted')
      if (receipt.status === 'success') onConfirmed?.(txHash)
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed.'
      if (/timed out while waiting/i.test(msg) && txHash) {
        // A wait timeout is NOT a failure — the tx is broadcast and usually
        // mines fine. Don't paint it red; keep watching in the background so
        // a multi-step chain still advances (never "re-send your message").
        setError('Still confirming — the transaction is broadcast. This card continues automatically once it lands (explorer link above).')
        setStatus('broadcast')
        const watched = txHash
        void (async () => {
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 15_000))
            try {
              const receipt = await publicClient?.getTransactionReceipt({ hash: watched })
              if (receipt) {
                setError('')
                setStatus(receipt.status === 'success' ? 'confirmed' : 'reverted')
                if (receipt.status === 'success') onConfirmed?.(watched)
                return
              }
            } catch {
              /* not mined yet — keep watching */
            }
          }
          // Don't die silently after the watch window — tell the user where
          // the truth is instead of spinning "Waiting for confirmation…".
          setError('Couldn’t verify the receipt after 10 minutes — check the explorer link above; if it shows success, the transfer landed.')
        })()
        return
      }
      // The wallet (or its RPC estimate) refused a built + guarded tx: the
      // #1 predicted stranger failure is "approve fails — USDC present, zero
      // ETH for gas", which lives only in this red text unless it's filed.
      // Fire-and-forget; human rejections are dropped inside the beacon.
      // Only pre-broadcast errors are the wallet's — a revert after a hash
      // is the chain's, and reads as 'reverted' above.
      if (!txHash) {
        reportWalletRefusal({
          wallet: address, artifact: refusalArtifact, buildPath: refusalBuildPath,
          connector: connector?.id ?? connector?.name, chainId: connectedChain?.id,
          ask: summary ?? tx.action ?? 'transaction', detail: msg,
        })
      }
      setError(
        /rejected|denied/i.test(msg)
          ? `Rejected in the wallet — nothing was sent. (If you didn’t cancel: check the wallet is on ${chainInfo?.name ?? `chain ${chainId}`}.)`
          : msg,
      )
      setStatus('error')
    }
  }

  // Auto-fire: request the signature as soon as the step mounts. Once per
  // mount (a rejection shows the Retry button, it never re-pops on its own).
  // Coinbase's popup-based wallet is excluded: a request issued outside a
  // click handler after an await gets its popup blocked and the second
  // signature dies silently (the #102 lesson) — it keeps the button.
  const autoFired = useRef(false)
  useEffect(() => {
    if (!autoFire || autoFired.current || status !== 'idle') return
    if (!isConnected || !address) return
    if (/coinbase/i.test(`${connector?.id ?? ''} ${connector?.name ?? ''}`)) return
    autoFired.current = true
    void send()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFire, isConnected, address])

  const stepState = (step: Status): 'done' | 'active' | 'pending' => {
    if (status === 'confirmed') return 'done'
    if (status === 'reverted') return step === 'confirmed' ? 'pending' : 'done'
    const cur = ORDER.indexOf(status === 'error' ? 'idle' : (status as (typeof ORDER)[number]))
    const idx = ORDER.indexOf(step as (typeof ORDER)[number])
    if (idx < cur) return 'done'
    if (idx === cur) return 'active'
    return 'pending'
  }

  const inFlight = status === 'signing' || status === 'broadcast'
  const started = status !== 'idle' && status !== 'error'

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      {started && (
        <div className="flex items-center gap-1.5 text-[11px] mono flex-wrap">
          {STEPS.map((s, i) => {
            const st = stepState(s.key)
            return (
              <span key={s.key} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[color:var(--line-2)] px-0.5">—</span>}
                {st === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--done)]" />
                ) : st === 'active' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--fg)]" />
                ) : (
                  <Circle className="w-3 h-3 text-[color:var(--line-2)]" />
                )}
                <span className={st === 'pending' ? 'text-[color:var(--muted-2)]' : 'text-[color:var(--fg)]'}>
                  {s.label}
                </span>
                {s.key === 'broadcast' && hash && st !== 'pending' && (
                  <a href={`${explorer}${hash}`} target="_blank" rel="noopener noreferrer" title="View the transaction on the block explorer"
                    className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            )
          })}
        </div>
      )}

      {status === 'confirmed' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-[color:var(--done)] flex-shrink-0" />
          <span className="text-[color:var(--done)] font-medium">Confirmed on-chain</span>
          {summary && <span className="text-[color:var(--muted)] truncate">— {summary}</span>}
        </div>
      ) : status === 'reverted' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <XCircle className="w-4 h-4 text-[color:var(--fail)] flex-shrink-0" />
          <span className="text-[color:var(--fail)] font-medium">Transaction reverted</span>
          {hash && (
            <a href={`${explorer}${hash}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)]">
              details <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void send()}
            disabled={inFlight}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
            title={`Sign and broadcast this ${tx.action ?? 'transaction'} from your wallet`}
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'signing'
              ? 'Sign in wallet…'
              : status === 'broadcast'
                ? 'Waiting for confirmation…'
                : status === 'error' && switchNeeded
                  ? `Switch to ${chainInfo?.name ?? `chain ${chainId}`} & retry`
                  : status === 'error'
                    ? `Retry — sign & send ${tx.action ?? 'transaction'}`
                    : `Sign & send ${tx.action ?? 'transaction'}`}
          </button>
          {error && <span className="text-[12px] text-[color:var(--fail)]">{error}</span>}
        </div>
      )}
    </div>
  )
}
