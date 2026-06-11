// Compact x402 receipt footnote under an assistant message — rendered from
// Message.meta.receipts (persisted by the chat client, shape produced by
// /api/chat). Pure presentational: used by the live chat (client) and the
// read-only shared page (server) alike.

export interface ChatReceipt {
  name: string
  endpoint?: string
  priceUsd?: string
  txHash?: string
  ok: boolean
  note?: string
}

/** Narrow an unknown Message.meta to its receipts array (defensive: meta is user-era JSON). */
export function receiptsOf(meta: unknown): ChatReceipt[] {
  if (!meta || typeof meta !== 'object') return []
  const raw = (meta as { receipts?: unknown }).receipts
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is ChatReceipt =>
      !!r && typeof r === 'object' && typeof (r as ChatReceipt).name === 'string',
  )
}

/** Who funded the calls ("your wallet" | "the house wallet"), when recorded. */
export function payerOf(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const p = (meta as { payer?: unknown }).payer
  return typeof p === 'string' && p.trim() ? p : null
}

export default function MessageReceipts({ meta }: { meta: unknown }) {
  const receipts = receiptsOf(meta)
  if (receipts.length === 0) return null
  const payer = payerOf(meta)
  const paid = receipts.filter((r) => r.ok)
  const total = paid.reduce((sum, r) => sum + (Number(r.priceUsd) || 0), 0)

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1">
      {/* The paid-total summary that used to be the text footer's 💸 line. */}
      {paid.length > 0 && (
        <div className="text-[11px] mono text-[color:var(--muted)]">
          💸 ${total.toFixed(total < 0.01 ? 4 : 2)} over {paid.length} x402 call
          {paid.length === 1 ? '' : 's'}
          {payer ? ` · ${payer}` : ''}
        </div>
      )}
      {receipts.map((r, i) => (
        <div
          key={`${r.name}-${i}`}
          className="flex items-center gap-2 text-[11px] mono text-[color:var(--muted-2)] min-w-0"
        >
          <span className={r.ok ? 'text-emerald-400' : 'text-amber-400'}>
            {r.ok ? '✓' : '✗'}
          </span>
          <span className="text-[color:var(--muted)] truncate">{r.name}</span>
          {r.priceUsd && <span className="flex-shrink-0">${r.priceUsd}</span>}
          {r.txHash && (
            <a
              href={`https://basescan.org/tx/${r.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] transition-colors"
              title="View settlement on Basescan"
            >
              {r.txHash.slice(0, 10)}…
            </a>
          )}
          {!r.ok && r.note && <span className="truncate">{r.note}</span>}
        </div>
      ))}
    </div>
  )
}
