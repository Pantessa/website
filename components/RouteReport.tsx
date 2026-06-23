'use client'

/** The value line under an auto-routed answer (B15): what the engine considered,
 *  picked, spent, and saved vs naive routing. Reads Message.meta.routeReport. */
function num(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined
}

export default function RouteReport({ meta }: { meta: unknown }) {
  if (!meta || typeof meta !== 'object') return null
  const r = (meta as { routeReport?: Record<string, unknown> }).routeReport
  if (!r || typeof r !== 'object') return null

  const considered = num(r.considered)
  const picked: string[] = Array.isArray(r.picked) ? (r.picked as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const spent = num(r.spentUsd) ?? 0
  const cacheSaved = num(r.cacheSavedUsd) ?? 0
  const savedVsPriciest = num(r.savedVsPriciestUsd) ?? 0
  const totalSaved = cacheSaved + savedVsPriciest

  return (
    <div className="mt-2 text-[11px] text-[color:var(--muted-2)] mono [overflow-wrap:anywhere]">
      <span style={{ color: 'var(--accent)' }}>⚙ Route</span>
      {considered != null ? ` · considered ${considered}` : ''}
      {picked.length ? ` · picked ${picked.join(', ')}` : ' · no live data needed'}
      {` · spent $${spent.toFixed(4)}`}
      {totalSaved > 0
        ? ` · saved $${totalSaved.toFixed(4)}${cacheSaved > 0 ? ` (cache $${cacheSaved.toFixed(4)})` : ''}${savedVsPriciest > 0 ? ` vs priciest` : ''}`
        : ''}
    </div>
  )
}
