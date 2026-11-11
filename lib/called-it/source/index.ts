// Where posts come from.
//
// CONTRACT STUB (squad called-it, 2026-11-11): lane SOURCE writes the bodies
// (source/x-api.ts, source/by-id.ts, source/fixture.ts) and keeps these three
// names. Lane JUDGE codes against them today.
import type { PostRead, XSource } from '../spec'

/** The scan source for this server: the fixture under XCALLS_FAKE=1, X's API when X_BEARER_TOKEN is set, otherwise null (no scans here). */
export function sourceFor(): XSource | null {
  return null
}

/** True when sourceFor() would return a source. Safe to call from a route that only wants to word a refusal. */
export function scansAvailable(): boolean {
  return false
}

/** One post by id over X's keyless embed endpoint. Works with no key at all. */
export async function readPostById(_id: string): Promise<PostRead> {
  return { ok: false, reason: 'unavailable' }
}
