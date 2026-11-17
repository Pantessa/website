// Is the Advanced chart available in THIS build, and does this visitor want it?
//
// The library is licensed and never in this repository (lib/tv/types). A
// build that has it gets the files copied into `public/charting_library/`
// by `scripts/tv-library.mjs` before `next build`, and next.config stamps
// the version it found into NEXT_PUBLIC_TV_LIBRARY. No files → the stamp is
// empty → every chart is the built-in one, exactly as before. Pure, pinned.

/** The library version this build ships, or '' when it ships none. */
export const TV_LIBRARY_VERSION: string = process.env.NEXT_PUBLIC_TV_LIBRARY ?? ''

/** Where the library's files are served from (same origin, trailing slash). */
export const TV_LIBRARY_PATH = '/charting_library/'

/** Does this build ship the library? */
export function advancedChartsBuilt(version: string = TV_LIBRARY_VERSION): boolean {
  return /^\d+\.\d+/.test(version)
}

/** The visitor's own choice of engine, kept on this browser. */
export const ENGINE_PREF_KEY = 'pantessa.chart.engine'
export type EnginePref = 'advanced' | 'classic'

export function parseEnginePref(raw: string | null | undefined): EnginePref | null {
  return raw === 'advanced' || raw === 'classic' ? raw : null
}

/**
 * Which engine a chart opens on. The Advanced chart when the build has it,
 * unless the visitor chose the classic one, the URL asks for it
 * (`?chart=classic`, a link that always works), the library failed to load
 * in this tab, or the page opens on a view only the classic chart draws
 * (`?view=depth|tape|heat|battlefield`).
 */
export function engineFor(input: { built: boolean; pref: EnginePref | null; search: string; failed: boolean }): EnginePref {
  if (!input.built || input.failed) return 'classic'
  const params = new URLSearchParams(input.search)
  const asked = parseEnginePref(params.get('chart'))
  if (asked) return asked
  const view = params.get('view')
  if (view === 'depth' || view === 'tape' || view === 'heat' || view === 'battlefield') return 'classic'
  return input.pref ?? 'advanced'
}
