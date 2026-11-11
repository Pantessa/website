// The public list of plotted handles, as /x and /x/<handle> read it (squad
// called-it, lane RECORD).
//
// The list itself is lib/called-it/store listPlotted (lane SOURCE): finished
// scans with at least one call, newest first, internal runs never listed. This
// is the one place the pages touch it, and it never throws: when the store
// does not answer (or is not built yet) the pages get an empty list and
// `failed: true`, and say so in plain words instead of showing an error.
import { listPlotted, type PlottedRow } from '@/lib/called-it/store'
import { normalizeHandle } from '@/lib/called-it/spec'
import { SYMBOL_RE } from '@/lib/called-it/record'

export interface PlottedList {
  rows: PlottedRow[]
  /** The store did not answer. The page says the list did not load; it never invents rows. */
  failed: boolean
}

/** A row the pages can link: a real handle and a real symbol, nothing else from the store is trusted as a path. */
function linkable(r: PlottedRow): boolean {
  return normalizeHandle(r.handle) === r.handle && SYMBOL_RE.test(r.symbol) && Number.isFinite(r.calls) && r.calls > 0
}

export async function readPlotted(opts: { limit: number; handle?: string }): Promise<PlottedList> {
  try {
    const rows = await listPlotted(opts)
    return { rows: (Array.isArray(rows) ? rows : []).filter(linkable).slice(0, opts.limit), failed: false }
  } catch {
    return { rows: [], failed: true }
  }
}

/** `3 days ago` · `today` · `2 months ago`, from now. */
export function agoWords(ms: number, nowMs: number): string {
  const days = Math.floor((nowMs - ms) / 86_400_000)
  if (!Number.isFinite(days) || days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}
