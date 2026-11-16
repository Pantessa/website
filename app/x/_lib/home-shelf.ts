// The Called it shelf on the home page (2026-11-16, Nate: "add our featured
// scans to the home page (defidad, wallstreetbets, dcinvestor) and a link to
// /x"). Three records we chose, drawn as /x's own tiles.
//
// The list is hand-picked here, in one place. Each record is read through the
// same public path /x uses (lib/called-it/store listPlotted through
// readPlotted: a finished scan with at least one call, never an internal run,
// never a hidden or protected account), so a record that is not public, or not
// scanned on this database, is simply left out. Nothing is invented: the shelf
// renders what is there, in the order below, and nothing when none answer.
//
// The home is ISR (60s) and its first byte must not wait on X's image hosts or
// the candle loader: the whole read is capped at SHELF_BUDGET_MS. A miss
// leaves the shelf off that copy of the page; the next copy tries again.
import { avatarDataUri } from './avatar'
import { readSummaries, type PlotSummary } from './featured'
import { readPlotted } from './plotted'

/** The featured records, in the order the shelf shows them. A handle is lowercase, a symbol uppercase (the store's spelling). */
export const HOME_CALLED: readonly { handle: string; symbol: string }[] = [
  { handle: 'defi_dad', symbol: 'ETH' },
  { handle: 'wallstreetbets', symbol: 'NEAR' },
  { handle: 'dcinvestor', symbol: 'ETH' },
]

export const SHELF_BUDGET_MS = 3500

export interface CalledShelfData {
  summaries: PlotSummary[]
  /** The avatar each summary wears, same order (a data URI, or null for the account's initial). */
  avatars: (string | null)[]
}

export const EMPTY_SHELF: CalledShelfData = { summaries: [], avatars: [] }

async function readShelf(): Promise<CalledShelfData> {
  const lists = await Promise.all(HOME_CALLED.map((f) => readPlotted({ limit: 1, handle: f.handle, symbol: f.symbol })))
  const rows = lists.flatMap((l, i) => l.rows.filter((r) => r.handle === HOME_CALLED[i].handle && r.symbol === HOME_CALLED[i].symbol).slice(0, 1))
  if (!rows.length) return EMPTY_SHELF
  const summaries = await readSummaries(rows)
  const avatars = await Promise.all(summaries.map((s) => avatarDataUri(s.avatarUrl)))
  return { summaries, avatars }
}

/** The shelf's records, or none. Never throws, never waits past SHELF_BUDGET_MS. */
export async function readCalledShelf(): Promise<CalledShelfData> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<CalledShelfData>((resolve) => {
    timer = setTimeout(() => resolve(EMPTY_SHELF), SHELF_BUDGET_MS)
  })
  try {
    return await Promise.race([readShelf().catch(() => EMPTY_SHELF), late])
  } finally {
    clearTimeout(timer)
  }
}
