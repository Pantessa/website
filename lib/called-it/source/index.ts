// Where posts come from (squad called-it, lane SOURCE).
//
// sourceFor() is the one place a scan source is chosen:
//   XCALLS_FAKE=1 on a server that serves the fixture → the fixture source
//   X_BEARER_TOKEN set                                  → X's own API
//   otherwise                                           → null (no scans here)
// readPostById() needs no key at all, so pasting a post works everywhere.
import { ENV, type PostRead, type XSource } from '../spec'
import { fixtureServed } from '../fixture'
import { readPostByIdWith } from './by-id'
import { FixtureSource } from './fixture'
import { XApiSource } from './x-api'

export { XApiError, XApiSource } from './x-api'
export { FixtureSource, FIXTURE_NO_SUCH_HANDLE } from './fixture'
export { refreshGone, REFRESH_MAX, REFRESH_AFTER_MS } from './refresh'

function fakeOn(): boolean {
  return process.env[ENV.fake] === '1' && fixtureServed()
}

function bearer(): string | null {
  const b = process.env[ENV.bearer]?.trim()
  return b ? b : null
}

/** The scan source for this server: the fixture under XCALLS_FAKE=1, X's API when X_BEARER_TOKEN is set, otherwise null (no scans here). */
export function sourceFor(): XSource | null {
  if (fakeOn()) return new FixtureSource()
  const b = bearer()
  return b ? new XApiSource({ bearer: b }) : null
}

/** True when sourceFor() would return a source. Safe to call from a route that only wants to word a refusal. */
export function scansAvailable(): boolean {
  return fakeOn() || bearer() !== null
}

/** One post by id over X's keyless embed endpoint. Works with no key at all. */
export async function readPostById(id: string): Promise<PostRead> {
  return readPostByIdWith(id)
}
