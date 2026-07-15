'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, Loader2, ShieldAlert, ShieldX } from 'lucide-react'
import SendTxChain from '@/components/SendTxChain'
import { txChainOf, type TxChainRequest } from '@/lib/transaction-layer'
import { chainById } from '@/lib/chains'

/**
 * App Mode swap panel: a structured face on the native swap layer. The panel
 * only COLLECTS intent (tokens + amount) — POST /api/panels/swap runs the
 * same builders + guardrails as chat and returns the same txChain artifact,
 * which renders through the standard SendTxChain card. No client-side
 * quoting, no calldata, no second build path.
 *
 * Motion: the quote line cross-fades when a re-quote lands (a real data
 * transition); the in-flight state is the only spinner. Nothing idles.
 */

/** Suggestion chips per chain — free text still allowed; the server resolves
 *  symbols against the live token list and errors honestly. */
const SUGGESTED: Record<number, string[]> = {
  8453: ['ETH', 'USDC', 'WETH', 'CBBTC'],
  1: ['ETH', 'USDC', 'WETH', 'USDT'],
  42161: ['ETH', 'USDC', 'ARB', 'WETH'],
  4663: ['ETH', 'USDG', 'AAPL', 'NVDA', 'TSLA', 'HOOD'],
}

type QuoteState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'quoted'; summary: string; expectedOut: string | null; minReceived: string | null; warns: string[]; buildPath: string; txChain: TxChainRequest }
  | { phase: 'blocked'; kind: 'policy' | 'execution'; reasons: string }
  | { phase: 'error'; message: string }

export default function SwapPanel({
  address,
  chainId,
}: {
  address: string
  /** The chain picker's selection (null = default Base). */
  chainId: number | null
}) {
  const cid = chainId ?? 8453
  const chain = chainById(cid)
  const reduced = useReducedMotion()
  const [sellToken, setSellToken] = useState('')
  const [buyToken, setBuyToken] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<QuoteState>({ phase: 'idle' })
  const [reviewing, setReviewing] = useState(false)
  const [settled, setSettled] = useState<string | null>(null)
  const seq = useRef(0)

  const suggestions = SUGGESTED[cid] ?? SUGGESTED[8453]
  const valid = !!sellToken.trim() && !!buyToken.trim() && /^[0-9]+(\.[0-9]+)?$/.test(amount.trim()) && Number(amount) > 0

  // Debounced live quote — every edit re-arms; only the latest response wins.
  useEffect(() => {
    setReviewing(false)
    setSettled(null)
    if (!valid) {
      setQuote({ phase: 'idle' })
      return
    }
    const mySeq = ++seq.current
    setQuote({ phase: 'loading' })
    const t = setTimeout(() => {
      fetch('/api/panels/swap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: address, chainId: cid, sellToken: sellToken.trim(), buyToken: buyToken.trim(), amountHuman: amount.trim() }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (seq.current !== mySeq) return
          if (data.ok) {
            const parsed = txChainOf({ txChain: data.txChain })
            if (!parsed) {
              setQuote({ phase: 'error', message: 'The build came back malformed — nothing to sign.' })
              return
            }
            setQuote({
              phase: 'quoted',
              summary: String(data.summary ?? ''),
              expectedOut: data.expectedOut ?? null,
              minReceived: data.minReceived ?? null,
              warns: Array.isArray(data.warns) ? data.warns : [],
              buildPath: String(data.buildPath ?? ''),
              txChain: parsed,
            })
          } else if (data.blocked) {
            setQuote({ phase: 'blocked', kind: data.blockKind === 'execution' ? 'execution' : 'policy', reasons: String(data.reasons ?? 'a safety check failed') })
          } else {
            setQuote({ phase: 'error', message: String(data.error ?? 'quote failed') })
          }
        })
        .catch(() => {
          if (seq.current === mySeq) setQuote({ phase: 'error', message: 'Network hiccup — try again.' })
        })
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, cid, sellToken, buyToken, amount])

  const flip = () => {
    setSellToken(buyToken)
    setBuyToken(sellToken)
  }

  const tokenField = (label: string, value: string, set: (v: string) => void, listId: string) => (
    <label className="flex-1 min-w-0">
      <span className="mono block text-[9px] uppercase tracking-wider text-[color:var(--muted-2)]">{label}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value.toUpperCase())}
        list={listId}
        placeholder={label === 'Sell' ? suggestions[0] : suggestions[1]}
        className="mt-0.5 w-full rounded-lg border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm font-medium text-white outline-none transition-colors placeholder:text-[color:var(--muted-2)] focus:border-[var(--line-2)]"
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  )

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-end gap-2">
        {tokenField('Sell', sellToken, setSellToken, `swap-sell-${cid}`)}
        <button
          type="button"
          onClick={flip}
          aria-label="Flip tokens"
          title="Flip"
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-[var(--line)] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:text-white"
        >
          <ArrowDown className="h-3.5 w-3.5 rotate-[-90deg]" />
        </button>
        {tokenField('Buy', buyToken, setBuyToken, `swap-buy-${cid}`)}
      </div>
      <label className="mt-2 block">
        <span className="mono block text-[9px] uppercase tracking-wider text-[color:var(--muted-2)]">Amount ({sellToken || 'sell token'})</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.0"
          className="mt-0.5 w-full rounded-lg border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm font-medium text-white outline-none transition-colors placeholder:text-[color:var(--muted-2)] focus:border-[var(--line-2)]"
        />
      </label>

      {/* Quote area — states swap instantly, the incoming state animates in.
          No exit animations: AnimatePresence exit-gating stalls wherever rAF
          is starved (hidden tabs, headless verification). */}
      <div className="mt-3 flex-1">
        <AnimatePresence initial={false}>
          {quote.phase === 'loading' && (
            <motion.div
              key="loading"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-xs text-[color:var(--muted)]"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Quoting on {chain?.name ?? 'Base'}…
            </motion.div>
          )}
          {quote.phase === 'quoted' && (
            <motion.div
              key={`q-${quote.summary}`}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {quote.expectedOut && (
                <div className="mb-1">
                  <span className="text-2xl font-semibold tracking-tight text-white">~{quote.expectedOut}</span>
                  <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">{buyToken} expected</span>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-[color:var(--muted)]">{quote.summary}</p>
              {quote.warns.map((w) => (
                <p key={w} className="mt-1 flex items-start gap-1 text-[11px] text-amber-400">
                  <ShieldAlert className="mt-0.5 h-3 w-3 flex-shrink-0" /> {w}
                </p>
              ))}
              {!reviewing && !settled && (
                <button
                  type="button"
                  onClick={() => setReviewing(true)}
                  className="mt-3 w-full rounded-lg border border-[color:var(--accent)]/50 bg-[color:var(--accent)]/10 px-3 py-2 text-xs font-semibold text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent)]/20"
                >
                  Review &amp; sign
                </button>
              )}
              {reviewing && (
                <div className="mt-3">
                  <SendTxChain
                    chain={quote.txChain}
                    onCompleted={({ hash }) => setSettled(hash)}
                  />
                </div>
              )}
              {settled && (
                <motion.p
                  initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-2 text-[11px] text-[color:var(--accent)]"
                >
                  ✓ Settled on-chain — every step confirmed.
                </motion.p>
              )}
            </motion.div>
          )}
          {quote.phase === 'blocked' && (
            <motion.div
              key="blocked"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-red-400"
            >
              <ShieldX className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {quote.kind === 'policy' ? 'Refused by your guardrails: ' : ''}
                {quote.reasons}
              </span>
            </motion.div>
          )}
          {quote.phase === 'error' && (
            <motion.p
              key="error"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[11px] text-[color:var(--muted)]"
            >
              {quote.message}
            </motion.p>
          )}
          {quote.phase === 'idle' && (
            <motion.p
              key="idle"
              initial={false}
              animate={{ opacity: 1 }}
              className="text-[11px] leading-relaxed text-[color:var(--muted)]"
            >
              Pick two tokens and an amount — the quote, guardrails and built
              transaction come from the same layer chat uses.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
