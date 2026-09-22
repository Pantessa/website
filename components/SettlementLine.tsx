// The one line a cross-chain swap card owes the user AFTER the signature:
// what the venue actually did with the deposit. Pure render, no hooks — the
// live chat drives it from components/XchainSettlement, the share page
// renders the persisted outcome (message meta.settlement) with the same
// words. See lib/xchain-settlement.ts for why this exists.

import { ExternalLink } from 'lucide-react'
import { chainByKey } from '@/lib/chains'
import { settlementCopy, type SettlementOutcome, type XchainDeposit } from '@/lib/xchain-settlement'

const TONE: Record<'ok' | 'warn' | 'muted', string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  muted: 'text-[color:var(--muted-2)]',
}

const MARK: Record<'ok' | 'warn' | 'muted', string> = { ok: '✓', warn: '↩', muted: '⋯' }

export default function SettlementLine({
  outcome,
  dep,
  watching = false,
}: {
  outcome: SettlementOutcome
  dep: XchainDeposit
  /** The live card is still polling — say so instead of looking stalled. */
  watching?: boolean
}) {
  const copy = settlementCopy(outcome, dep)
  const chainName = outcome.txChain ? (chainByKey(outcome.txChain)?.name ?? outcome.txChain) : null
  return (
    <div className="mt-2 pt-1.5 border-t border-[var(--line)] space-y-1" data-settlement={outcome.status}>
      {/* items-start, not center: the headline wraps to two lines on a
          phone and a vertically centred mark floats away from its first line. */}
      <div className={`flex items-start gap-1.5 text-[11px] mono ${TONE[copy.tone]}`}>
        <span aria-hidden className="flex-shrink-0">
          {MARK[copy.tone]}
        </span>
        <span className="[overflow-wrap:anywhere]">{copy.line}</span>
        {watching && !outcome.terminal && (
          <span className="flex-shrink-0 text-[color:var(--muted-2)]" title="Watching the venue for this swap's outcome">
            · watching
          </span>
        )}
      </div>
      {copy.detail && (
        <p className="text-[11px] leading-snug text-[color:var(--muted-2)] [overflow-wrap:anywhere]">{copy.detail}</p>
      )}
      {outcome.txHash && (
        <div className="flex items-center gap-1.5 text-[11px] mono text-[color:var(--muted-2)] min-w-0">
          <span className="text-[color:var(--muted)] flex-shrink-0">{copy.txLabel ?? 'refund'}</span>
          {outcome.txUrl ? (
            <a
              href={outcome.txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] transition-colors"
              title={chainName ? `View on ${chainName}` : 'View the transaction'}
            >
              {outcome.txHash.slice(0, 10)}…{outcome.txHash.slice(-6)}
              <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
          ) : (
            <span className="flex-shrink-0">
              {outcome.txHash.slice(0, 10)}…{outcome.txHash.slice(-6)}
            </span>
          )}
          {chainName && <span className="flex-shrink-0">{chainName}</span>}
        </div>
      )}
    </div>
  )
}
