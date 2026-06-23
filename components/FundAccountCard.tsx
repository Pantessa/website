'use client'

// Dashboard · Overview — "Fund your account". A freshly-created embedded
// wallet (and any connected wallet) starts with 0 USDC, so its expense account
// can't pay an x402 call yet. This surfaces the live USDC-on-Base balance, a
// low-balance nudge, and the two ways to add funds: receive (QR + address) or
// buy on Coinbase. The grant's daily cap draws against this balance.

import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { base } from 'wagmi/chains'
import { erc20Abi, formatUnits } from 'viem'
import { QRCodeSVG } from 'qrcode.react'
import { Card } from '@/lib/dashboard-ui'
import { Copy, Check, ArrowUpRight, AlertTriangle } from 'lucide-react'

// Native USDC on Base (6 decimals) — the token x402 settles in.
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const LOW_BALANCE_USD = 1

export default function FundAccountCard() {
  const { address, isConnected } = useAccount()
  const [copied, setCopied] = useState(false)

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

          <a
            href="https://pay.coinbase.com/buy/select-asset?defaultAsset=USDC&defaultNetwork=base"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Buy USDC on Coinbase <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
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
