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
//
// On a phone the wallet is another app (lib/sign-round-trip): one wallet
// method per tap — a network switch is its own tap, a chain's step N>1 is a
// button, never a mount-time request — and a request the visitor came back
// to without an answer gets "Open MetaMask", never a second send.

import { useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi'
import { CDP_CONNECTOR_ID } from '@coinbase/cdp-wagmi'
import { Loader2, PenLine, CheckCircle2, Circle, ExternalLink, XCircle } from 'lucide-react'
import type { EvmTxRequest } from '@/lib/transaction-layer'
import { chainById } from '@/lib/chains'
import { reportWalletRefusal, walletErrorWords, type WalletArtifact } from '@/lib/wallet-refusal'
import { SIGN_CTA_CLASS } from '@/lib/sign-cta'
import {
  autoFireAllowed,
  clearSignOutcome,
  oneMethodPerTap,
  readSignOutcome,
  reopenCopy,
  resumeCopy,
  resumeVerdict,
  signOutcomeKey,
  writeSignOutcome,
} from '@/lib/sign-round-trip'
import { useSignRoundTrip } from '@/lib/use-sign-round-trip'
import SignatureWaitOpenApp from '@/components/SignatureWaitOpenApp'

/** The outcome store. A return from the wallet app can be a full reload
 *  (LINKS, 2026-09-23), so the round trip's outcome lives here, not in
 *  React state. localStorage: it survives a tab the OS evicted. */
const outcomeStore = () => (typeof window === 'undefined' ? null : window.localStorage)

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
  ctaLabel,
  onConfirmed,
  refusalArtifact = 'tx',
  refusalBuildPath,
}: {
  tx: EvmTxRequest
  summary?: string
  /** Request the wallet signature on mount — SendTxChain sets this on steps
   *  after the first so popups follow each other like a sign-in flow, no
   *  button hunt between steps. The button stays as the retry surface.
   *  Honoured only where lib/sign-round-trip autoFireAllowed says so: never
   *  on a phone (the app launch would be dropped), never for Coinbase's
   *  popup wallet. */
  autoFire?: boolean
  /** The idle button's words when the host has better ones than
   *  "Sign & send <action>" (a chain step: "Sign step 2 of 2 — Swap"). */
  ctaLabel?: string
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
  const [note, setNote] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  // The wallet refused the network switch: the inline line names the chain
  // and the button itself becomes the "switch & retry" — never just red text.
  const [switchNeeded, setSwitchNeeded] = useState(false)
  // The round trip to the wallet app (phone): asked → in-app → returned.
  const trip = useSignRoundTrip()
  // What an EARLIER visit did with this exact transaction (signOutcomeKey):
  // signed it, or asked and never heard back. Read on mount, before this
  // card offers anything — a card re-rendered after a reload must never
  // offer a signed tx again on its own (never burn a signature).
  const outcomeKey = address ? signOutcomeKey({ wallet: address, chainId, to: tx.to, data: tx.data }) : null
  const [resume, setResume] = useState<'signed' | 'maybe-broadcast' | 'unknown' | null>(null)
  useEffect(() => {
    if (!outcomeKey) return
    const found = readSignOutcome(outcomeStore(), outcomeKey, Date.now())
    if (!found) return
    if (found.state === 'settled') {
      setResume('signed')
      return
    }
    // Asked earlier: the wallet's nonce says whether anything went out since.
    let alive = true
    const decide = (nonceNow: number | null) => {
      if (!alive) return
      const v = resumeVerdict({ outcome: found, nonceNow })
      if (v === 'fresh') clearSignOutcome(outcomeStore(), outcomeKey)
      else setResume(v)
    }
    if (!publicClient) decide(null)
    else {
      publicClient
        .getTransactionCount({ address: address as `0x${string}`, blockTag: 'pending' })
        .then((n) => decide(n))
        .catch(() => decide(null))
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey])

  const chainInfo = chainById(chainId)
  const explorer = chainInfo?.explorerTx ?? TX_EXPLORER[chainId] ?? 'https://basescan.org/tx/'
  const chainName = chainInfo?.name ?? `chain ${chainId}`

  const send = async () => {
    setError('')
    setNote('')
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
          trip.ask()
          await switchChainAsync({ chainId })
          trip.settle()
        } catch (e) {
          trip.settle()
          // A refused/failed network switch is a wallet wall too (a wallet
          // that can't reach chain 4663, say) — log it; a plain "no" is not.
          reportWalletRefusal({
            wallet: address, artifact: refusalArtifact, buildPath: refusalBuildPath,
            connector: connector?.id ?? connector?.name, chainId: connectedChain?.id,
            ask: `${summary ?? tx.action ?? 'transaction'} (switch to ${chainName})`,
            detail: walletErrorWords(e),
          })
          // An embedded (Pantessa account) wallet has no network UI: telling
          // its owner to "switch the wallet" sends them looking for a menu
          // that doesn't exist. The switch there is silent and only fails
          // when the chain isn't in lib/wallet-chains.ts — i.e. our bug.
          setError(
            connector?.id === CDP_CONNECTOR_ID
              ? `Your Pantessa account can't sign on ${chainName} yet — that's on us, not you. Retry once; if it walls again, this transaction needs a wallet like MetaMask.`
              : `This transaction is built for ${chainName} — switch the wallet to it (the button below asks again), then it signs.`,
          )
          setSwitchNeeded(connector?.id !== CDP_CONNECTOR_ID)
          setStatus('error')
          return
        }
        // On a phone the switch was a trip to the wallet app and back; the
        // signature that follows would fire with no tap behind it and the
        // browser would drop the app launch (lib/sign-round-trip). Re-arm:
        // the switch is done, the next tap signs.
        if (oneMethodPerTap(trip.platform)) {
          setStatus('idle')
          setNote(`Switched to ${chainName} — tap to sign.`)
          return
        }
        // Let the wallet settle on the new network before the sign sheet
        // opens. MetaMask estimates fees + simulates DURING the popup; a
        // request racing a just-switched network (worst on custom chains
        // like Robinhood 4663) paints "fee unavailable" + "likely to fail"
        // on a perfectly good tx (2026-07-15 funding-leg false alarm).
        await new Promise((r) => setTimeout(r, 750))
      }
      trip.ask()
      // Remember the ask BEFORE the request leaves (a reload on the way back
      // must find it), and the wallet's pending nonce beside it — read in
      // PARALLEL, never awaited ahead of the send: the same-chain path stays
      // a zero-await straight shot (Coinbase's popup-after-await rule).
      const askedAt = Date.now()
      if (outcomeKey) {
        writeSignOutcome(outcomeStore(), { v: 1, key: outcomeKey, state: 'asked', askedAt, nonceAtAsk: null })
        publicClient
          ?.getTransactionCount({ address: address as `0x${string}`, blockTag: 'pending' })
          .then((n) => {
            const cur = readSignOutcome(outcomeStore(), outcomeKey, Date.now())
            if (cur?.state === 'asked' && cur.askedAt === askedAt) writeSignOutcome(outcomeStore(), { ...cur, nonceAtAsk: n })
          })
          .catch(() => {})
      }
      try {
        txHash = await sendTransactionAsync({
          to: tx.to as `0x${string}`,
          data: (tx.data ?? '0x') as `0x${string}`,
          value: tx.value ? BigInt(tx.value) : undefined,
          chainId,
        })
      } finally {
        trip.settle()
      }
      if (outcomeKey) writeSignOutcome(outcomeStore(), { v: 1, key: outcomeKey, state: 'settled', askedAt, settledAt: Date.now(), hash: txHash })
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
      // The card shows the wallet's own words too (same helper as the beacon):
      // viem's wrapper line hid "insufficient funds for gas" behind
      // "An internal error was received." (QA r4).
      const msg = e instanceof Error ? walletErrorWords(e) : 'Transaction failed.'
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
        // Nothing went out: the remembered ask would only scare the next visit.
        if (outcomeKey) clearSignOutcome(outcomeStore(), outcomeKey)
        reportWalletRefusal({
          wallet: address, artifact: refusalArtifact, buildPath: refusalBuildPath,
          connector: connector?.id ?? connector?.name, chainId: connectedChain?.id,
          ask: summary ?? tx.action ?? 'transaction', detail: walletErrorWords(e),
        })
      }
      setError(
        /rejected|denied/i.test(msg)
          ? `Rejected in the wallet — nothing was sent. (If you didn’t cancel: check the wallet is on ${chainName}.)`
          : msg,
      )
      setStatus('error')
    }
  }

  // Auto-fire: request the signature as soon as the step mounts. Once per
  // mount (a rejection shows the Retry button, it never re-pops on its own).
  // The decision is lib/sign-round-trip autoFireAllowed: never on a phone
  // (the launch fires with no tap and the browser drops it — the visitor is
  // left on a disabled button), never for Coinbase's popup wallet (a request
  // issued outside a click handler after an await gets its popup blocked
  // and the second signature dies silently — the #102 lesson).
  const autoFired = useRef(false)
  useEffect(() => {
    if (!autoFire || autoFired.current || status !== 'idle') return
    if (!isConnected || !address) return
    if (!autoFireAllowed({ platform: trip.platform, stepIndex: 1, connectorId: connector?.id, connectorName: connector?.name })) return
    // A remembered outcome for this exact tx (an earlier visit signed it, or
    // asked and never heard back) is never auto-fired over: the resume line
    // decides, with the visitor. Read from the store — `resume` is set by
    // the effect above in the same commit and isn't visible here yet.
    if (outcomeKey && readSignOutcome(outcomeStore(), outcomeKey, Date.now())) return
    autoFired.current = true
    void send()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFire, isConnected, address, trip.platform])

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
  // The visitor came back from the wallet app and the request is still open.
  const cameBack = status === 'signing' && trip.verdict === 'offer-reopen'
  const reopen = reopenCopy(trip.reopenApp)

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
      ) : resume ? (
        // An earlier visit signed this, or asked and never heard back: say so
        // and make the re-sign an explicit choice, never the default button.
        <div className="flex items-center gap-2 flex-wrap text-[12px] text-[color:var(--muted)]" data-sign-resume={resume}>
          <span>{resumeCopy(resume).line}</span>
          <button
            type="button"
            onClick={() => {
              if (outcomeKey) clearSignOutcome(outcomeStore(), outcomeKey)
              setResume(null)
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-2)] px-3 py-1 text-[12px] font-medium text-[color:var(--fg)] [@media(hover:none)]:min-h-10 [@media(hover:none)]:px-4"
          >
            {resumeCopy(resume).cta}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void send()}
            disabled={inFlight}
            className={SIGN_CTA_CLASS}
            title={`Sign and broadcast this ${tx.action ?? 'transaction'} from your wallet`}
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'signing'
              ? 'Confirm in your wallet…'
              : status === 'broadcast'
                ? 'Waiting for confirmation…'
                : status === 'error' && switchNeeded
                  ? `Switch to ${chainName} & retry`
                  : status === 'error'
                    ? `Retry — sign & send ${tx.action ?? 'transaction'}`
                    : ctaLabel ?? `Sign & send ${tx.action ?? 'transaction'}`}
          </button>
          {/* The request is in the phone's wallet APP (CONNECT's holder has
              its link): the tap that opens it, beside the waiting button —
              never a disabled "Confirm in your wallet…" alone (#822). */}
          <SignatureWaitOpenApp waiting={status === 'signing'} />
          {note && <span className="text-[12px] text-[color:var(--muted)]">{note}</span>}
          {error && <span className="text-[12px] text-[color:var(--fail)]">{error}</span>}
          {/* Back from the app with nothing settled: the request is queued in
              the wallet, so the ONE honest control is to open the wallet
              again — a re-send here would be a second signature. */}
          {cameBack && (
            <div className="basis-full flex items-center gap-2 flex-wrap text-[12px] text-[color:var(--muted)]" data-sign-return="offer-reopen">
              <span>{reopen.line}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
