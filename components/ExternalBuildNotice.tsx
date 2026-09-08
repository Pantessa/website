'use client'

// components/ExternalBuildNotice.tsx — the "built by an external tool" marker
// (SECURITY-AUDIT 2026-09-08 §A5–A6 / §E3). A signable that came out of a
// directory service through the planner (buildPath 'planner') used to wear
// the same card as a native build: the tool's summary, a sign button, and a
// header comment claiming Pantessa built the calldata. Now the card says who
// built it, shows every destination address IN FULL with the native value it
// attaches, and repeats the guard's warnings — right above the button.

import { formatEther } from 'viem'

export interface ExternalTx {
  to?: string
  value?: string
  data?: string
  chainId?: number
}

function valueLine(v?: string): string {
  try {
    const wei = BigInt(v ?? '0')
    return wei === BigInt(0) ? 'no ETH attached' : `${formatEther(wei)} ETH attached`
  } catch {
    return 'value unreadable'
  }
}

function bytesOf(data?: string): number {
  if (!data || !data.startsWith('0x')) return 0
  return Math.floor((data.length - 2) / 2)
}

export default function ExternalBuildNotice({ builtBy, warnings, txs }: { builtBy?: string | null; warnings?: string[] | null; txs: ExternalTx[] }) {
  const who = builtBy && builtBy.trim() ? builtBy.trim() : 'a directory service'
  return (
    <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[12px] leading-snug" data-external-build={who}>
      <p className="text-amber-400 font-medium">
        Built by {who} — an external tool, not Pantessa&apos;s native layer. Read every address below before you sign.
      </p>
      <ul className="mt-1 space-y-1 text-[color:var(--muted)]">
        {txs.map((t, i) => (
          <li key={i} className="mono break-all" data-external-to={t.to ?? ''}>
            {txs.length > 1 ? `Step ${i + 1}: ` : ''}sends to <span className="text-[color:var(--fg)]">{t.to ?? '(no address)'}</span>
            {typeof t.chainId === 'number' ? ` on chain ${t.chainId}` : ''} · {valueLine(t.value)} · {bytesOf(t.data)} bytes of calldata
            {t.data && t.data.length >= 10 ? ` (selector ${t.data.slice(0, 10)})` : ''}
          </li>
        ))}
      </ul>
      {warnings && warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-amber-300/90" data-guard-warnings>
          {warnings.map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
