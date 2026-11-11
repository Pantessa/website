// Takedown (review R12; squad called-it, lane FIX): a handle an admin took down,
// or one whose posts are protected, answers a named refusal on the record, the
// scan and the add, and never lists (store listPlotted). Pure.
import type { RecordResponse } from './spec'
import type { StoredHandle } from './store'

/** A handle whose record is not shown: taken down by an admin, or protected (its posts are no longer public). Null = shown. Shared by the record, the scan and the add (review R12). */
export function takenDown(handle: string, row: Pick<StoredHandle, 'hiddenAt' | 'isProtected'> | null): Extract<RecordResponse, { status: 'refused' }> | null {
  const next = [{ label: 'Plot another handle', href: '/x' }]
  if (row?.hiddenAt) return { status: 'refused', reason: `The record for @${handle} has been taken down, so it is not shown here.`, next }
  if (row?.isProtected) return { status: 'refused', reason: `@${handle}'s posts are protected, so their record is not shown. Only posts X shows to everyone can be plotted.`, next }
  return null
}
