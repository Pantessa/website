'use client'

// Pre-signature payment confirmation for wallet-mode chat turns. Shown after the
// server plans the x402 calls but BEFORE the wallet pops, so the user sees the
// real amount in dollars (the wallet shows it in raw USDC base units, e.g. 4000
// = $0.004, which reads alarmingly like "$4000") and gets an honest heads-up
// about the Blockaid "deceptive request" false-positive on micropayments.

import { Wallet, ShieldAlert, Check, Loader2 } from 'lucide-react'

type Payment = {
  id: string
  name: string
  /** The directory's LISTED price. */
  priceUsd: string
  /** What the SIGNATURE authorizes — the 402 challenge's amount, bounded by
   *  lib/x402 to the listing (+ tolerance) and the per-call ceiling. Render
   *  this; the listing alone once hid a challenge of any size. */
  amountUsd?: number
  /** Checksummed payee the authorization pays. */
  payTo?: string
}

const fmt = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`
const amountOf = (p: Payment) => (typeof p.amountUsd === 'number' && Number.isFinite(p.amountUsd) ? p.amountUsd : Number(p.priceUsd) || 0)
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
/** True when the signed amount sits above the listing (within the tolerance
 *  lib/x402 allows) — say so, don't hide it behind the list price. */
const aboveListing = (p: Payment) => amountOf(p) > (Number(p.priceUsd) || 0) + 1e-9

export default function PaymentConfirm({
  payments,
  onConfirm,
  onCancel,
  busy,
}: {
  payments: Payment[]
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const total = payments.reduce((s, p) => s + amountOf(p), 0)
  const baseUnits = Math.round(total * 1_000_000) // USDC has 6 decimals
  const soleRecipient = payments.length === 1 ? payments[0].payTo : undefined

  return (
    <div className="max-w-[85vw] lg:max-w-[80%] rounded-2xl rounded-tl-sm border border-[var(--line)] bg-[var(--surf-1)] p-4 space-y-3">
      <div className="flex items-center gap-2 text-[13px] text-[color:var(--muted)]">
        <Wallet className="w-4 h-4" />
        Confirm payment
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-white tabular-nums">{fmt(total)}</span>
        <span className="text-sm text-[color:var(--muted)]">USDC</span>
        <span className="text-[12px] text-[color:var(--muted-2)]">
          · {payments.length} x402 call{payments.length === 1 ? '' : 's'} · from your wallet
          {soleRecipient ? (
            <>
              {' '}· to <span className="font-mono" title={soleRecipient} data-payee={soleRecipient}>{shortAddr(soleRecipient)}</span>
            </>
          ) : null}
        </span>
      </div>
      {/* The payee IN FULL — the short form above carries the whole address
          only in a title tooltip, which no phone can open (squad gtm 2026-09-08,
          mobile round 3). Same rule as ExternalBuildNotice: every `to` readable
          before the signature. */}
      {soleRecipient ? (
        <p className="mono text-[12px] leading-snug text-[color:var(--muted)] [overflow-wrap:anywhere]" data-payee-full={soleRecipient}>
          pays <span className="text-[color:var(--fg)]">{soleRecipient}</span>
        </p>
      ) : null}

      {(payments.length > 1 || payments.some(aboveListing)) && (
        <ul className="space-y-1 text-[12px]">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 text-[color:var(--muted)]">
              <span className="truncate">
                {p.name}
                {p.payTo && !soleRecipient ? (
                  <span className="font-mono text-[color:var(--muted-2)]" title={p.payTo} data-payee={p.payTo}>
                    {' '}→ {shortAddr(p.payTo)}
                  </span>
                ) : null}
                {p.payTo && !soleRecipient ? (
                  <span className="block mono text-[11px] leading-snug text-[color:var(--muted-2)] [overflow-wrap:anywhere] whitespace-normal" data-payee-full={p.payTo}>
                    {p.payTo}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums flex-shrink-0">
                {fmt(amountOf(p))}
                {aboveListing(p) ? <span className="ml-1 text-amber-400" data-listed={p.priceUsd}>(listed {fmt(Number(p.priceUsd) || 0)})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surf-2)] p-2.5 text-[11.5px] leading-relaxed text-[color:var(--muted)]">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
        <span>
          Your wallet may flag this as a “deceptive request” — a known false-positive Blockaid shows
          for x402 micropayments. You’re authorizing exactly <span className="text-white">{fmt(total)} USDC</span>.
          The wallet shows it in raw base units (<span className="tabular-nums">{baseUnits.toLocaleString()}</span> = {fmt(total)},
          since USDC has 6 decimals) — not {baseUnits.toLocaleString()} dollars.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 max-lg:min-h-10 rounded-full bg-emerald-400 text-black hover:bg-emerald-300 disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {busy ? 'Confirming…' : `Pay ${fmt(total)} & continue`}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[13px] px-4 py-2 max-lg:min-h-10 rounded-full border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
