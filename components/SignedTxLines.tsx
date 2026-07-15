// Read-only signed-transaction footnote for a shared assistant message —
// rendered from Message.meta.signed, the durable record the live chat writes
// back after a wallet-signed artifact (single tx or tx chain) confirms
// on-chain. Jobs carry their own richer log (SharedJobLog); this covers the
// plain in-chat sign surfaces. Server-renderable: no hooks.

import { ExternalLink } from 'lucide-react'
import { chainById } from '@/lib/chains'

export interface SignedTx {
  hash: string
  chainId: number
  title?: string
  at?: string
}

/** Narrow an unknown Message.meta to its signed-tx array (meta is user-era JSON). */
export function signedTxsOf(meta: unknown): SignedTx[] {
  if (!meta || typeof meta !== 'object') return []
  const raw = (meta as { signed?: unknown }).signed
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (t): t is SignedTx =>
      !!t && typeof t === 'object' && typeof (t as SignedTx).hash === 'string' && typeof (t as SignedTx).chainId === 'number',
  )
}

export default function SignedTxLines({ meta }: { meta: unknown }) {
  const txs = signedTxsOf(meta)
  if (txs.length === 0) return null
  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1">
      <div className="text-[11px] mono text-[color:var(--muted)]">
        ✍️ Signed &amp; settled on-chain — {txs.length} transaction{txs.length === 1 ? '' : 's'}
      </div>
      {txs.map((tx) => {
        const chain = chainById(tx.chainId)
        return (
          <div key={tx.hash} className="flex items-center gap-1.5 text-[11px] mono text-[color:var(--muted-2)] min-w-0">
            <span className="text-emerald-400 flex-shrink-0">✓</span>
            {tx.title && <span className="text-[color:var(--muted)] truncate">{tx.title}</span>}
            <a
              href={`${chain?.explorerTx ?? 'https://basescan.org/tx/'}${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] transition-colors"
              title={`View on ${chain?.name ?? 'the block explorer'}`}
            >
              {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
              <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
            {chain && <span className="flex-shrink-0">{chain.name}</span>}
          </div>
        )
      })}
    </div>
  )
}
