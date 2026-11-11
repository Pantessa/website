// The public list of plotted handles, as /x and /x/<handle> read it (squad
// called-it, lane RECORD).
//
// The list itself is lib/called-it/store listPlotted (lane SOURCE): finished
// scans with at least one call, newest first, internal runs never listed. This
// is the one place the pages touch it, and it never throws: when the store
// does not answer (or is not built yet) the pages get an empty list and
// `failed: true`, and say so in plain words instead of showing an error.
import { getHandle, listPlotted, type PlottedRow } from '@/lib/called-it/store'
import { normalizeHandle } from '@/lib/called-it/spec'
import { SYMBOL_RE, verifiedOf } from '@/lib/called-it/record'

export interface PlottedList {
  rows: PlottedRow[]
  /** The store did not answer. The page says the list did not load; it never invents rows. */
  failed: boolean
}

/** A row the pages can link: a real handle and a real symbol, nothing else from the store is trusted as a path. */
function linkable(r: PlottedRow): boolean {
  return normalizeHandle(r.handle) === r.handle && SYMBOL_RE.test(r.symbol) && Number.isFinite(r.calls) && r.calls > 0
}

/**
 * "Verified" on a list row means what it means on a record: the account
 * itself signed in with X AND X still says the handle is that account's
 * (lib/called-it/record verifiedOf). The list's own flag only knows the first
 * half, so each listed handle's row is read once and judged by the record's
 * rule; a handle whose row cannot be read is simply not called verified.
 */
async function strictVerified(handles: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  await Promise.all(
    handles.map(async (h) => {
      try {
        if (verifiedOf(await getHandle(h))) out.add(h)
      } catch {
        /* not verified, as far as this page can say */
      }
    }),
  )
  return out
}

export async function readPlotted(opts: { limit: number; handle?: string }): Promise<PlottedList> {
  try {
    const listed = await listPlotted(opts)
    const rows = (Array.isArray(listed) ? listed : []).filter(linkable).slice(0, opts.limit)
    const verified = await strictVerified([...new Set(rows.filter((r) => r.verified).map((r) => r.handle))])
    return { rows: rows.map((r) => ({ ...r, verified: verified.has(r.handle) })), failed: false }
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
