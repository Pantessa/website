'use client'

// Dashboard · Overview — "Fund your account". A freshly-created embedded
// wallet (and any connected wallet) starts with 0 USDC, so its expense account
// can't pay an x402 call yet. This surfaces the live USDC-on-Base balance, a
// low-balance nudge, and the two ways to add funds: receive (QR + address) or
// buy with a card. The grant's daily cap draws against this balance.
//
// The buy path used to be a bare link to pay.coinbase.com. Two things were
// wrong with it by 2026-09-04: the provider (we moved to Stripe), and the fact
// that it had quietly stopped working — Coinbase has required a session token
// since 2025-07-31, so the tokenless URL 302s to a generic /landing page
// carrying neither the user's address nor an amount. It now goes through our
// own on-ramp door, which signs a consent naming this wallet and mints a
// session locked to it.
//
// USDC here, not the ETH the chat's fund chip buys: this card exists to top up
// the balance x402 settles in, and the account it funds is already live rather
// than empty-and-gasless.

import { useState } from 'react'
import { useAccount, useReadContract, useSignMessage } from 'wagmi'
import { base } from 'wagmi/chains'
import { erc20Abi, formatUnits } from 'viem'
import { QRCodeSVG } from 'qrcode.react'
import { Card } from '@/lib/dashboard-ui'
import { Copy, Check, ArrowUpRight, AlertTriangle, Loader2 } from 'lucide-react'
import { startOnrampSession } from '@/lib/onramp-client'

// Native USDC on Base (6 decimals) — the token x402 settles in.
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const LOW_BALANCE_USD = 1
/** Opening amount for the card purchase. A SUGGESTION, not a cap — Stripe's
 *  checkout lets the user change it — so it only has to be a sensible first
 *  number for topping up an expense account, not a computed plan. */
const TOPUP_PRESET_USD = 25

export default function FundAccountCard() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [copied, setCopied] = useState(false)
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  const { data: raw, isLoading } = useReadContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: !!address, refetchInterval: 30_000 },
  })

  if (!isConnected || !address) return null

  const usdc = raw != null ? Number(formatUnits(raw, 6)) : null
  const low = usdc != null && usdc < LOW_BALANCE_USD

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the address is shown for manual copy */
    }
  }

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Fund your account</p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            USDC on Base — what your agent spends per call. Your daily cap draws against this balance.
          </p>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight text-white tabular-nums">
              {usdc == null ? (isLoading ? '—' : '0.00') : usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-sm text-[color:var(--muted)]">USDC</span>
          </div>

          {low && (
            <p className="mt-2 text-xs text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {usdc === 0 ? 'No balance yet' : 'Low balance'} — add USDC on Base so your agent can pay for calls.
            </p>
          )}

          {/* Receive address — send USDC on Base here to fund the account. */}
          <p className="mt-4 text-xs font-medium text-[color:var(--muted)]">Your Base address</p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <code className="mono text-xs text-zinc-200 break-all bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
              {address}
            </code>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white transition-colors"
              title="Copy address"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Called synchronously off the click — startOnrampSession opens the
              tab as its first statement, and a popup opened after an await is
              no longer a user gesture. */}
          <button
            onClick={async () => {
              if (!address || buying) return
              setBuyError(null)
              setBuying(true)
              const res = await startOnrampSession({
                address,
                fund: { presetFiatUsd: TOPUP_PRESET_USD, asset: 'USDC', network: 'base' },
                signMessage: signMessageAsync,
              })
              setBuying(false)
              if (!res.ok) setBuyError(res.error)
            }}
            disabled={buying}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
          >
            {buying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Buy USDC with card or bank
            {buying ? null : <ArrowUpRight className="w-3.5 h-3.5" />}
          </button>
          {/* The address + QR above always work, so a closed or region-blocked
              on-ramp costs the user nothing but this line. */}
          {buyError && <div className="mt-1.5 text-[11px] text-[color:var(--sell)]">{buyError}</div>}
        </div>

        {/* Scan to send from a phone wallet. */}
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-xl bg-white p-2.5">
            <QRCodeSVG value={address} size={104} bgColor="#ffffff" fgColor="#000000" level="M" />
          </div>
          <span className="text-[11px] text-[color:var(--muted-2)]">Scan to send on Base</span>
        </div>
      </div>
    </Card>
  )
}
