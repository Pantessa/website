'use client'

// Pre-signature payment confirmation for wallet-mode chat turns. Shown after the
// server plans the x402 calls but BEFORE the wallet pops, so the user sees the
// real amount in dollars (the wallet shows it in raw USDC base units, e.g. 4000
// = $0.004, which reads alarmingly like "$4000") and gets an honest heads-up
// about the Blockaid "deceptive request" false-positive on micropayments.

import { Wallet, ShieldAlert } from 'lucide-react'

type Payment = { id: string; name: string; priceUsd: string }

const fmt = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`

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
  const total = payments.reduce((s, p) => s + (Number(p.priceUsd) || 0), 0)
  const baseUnits = Math.round(total * 1_000_000) // USDC has 6 decimals

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
        </span>
      </div>

      {payments.length > 1 && (
        <ul className="space-y-1 text-[12px]">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 text-[color:var(--muted)]">
              <span className="truncate">{p.name}</span>
              <span className="tabular-nums flex-shrink-0">{fmt(Number(p.priceUsd) || 0)}</span>
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
          className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 max-lg:min-h-10 rounded-full bg-white text-black hover:bg-zinc-200 disabled:opacity-50 transition-colors"
        >
          Pay {fmt(total)} &amp; continue
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
