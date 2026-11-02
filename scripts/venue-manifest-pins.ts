// Pins for the venue manifest (lib/venue-manifest.ts): the object is complete
// (every free-fleet slug, every native venue), every address and selector is
// well-formed, every pinned address is READ from the file its `source` names
// (never retyped), the integrity hash is stable and self-consistent, the
// `?venue=` narrowing works, and the docs page renders the same object. Pure.
// The live half (venueManifestLivePins) hits the served route + page.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/venue-manifest-pins.ts            (pure)
//   BASE=http://localhost:3000 npx tsx scripts/venue-manifest-pins.ts --live
import { existsSync, readFileSync } from 'node:fs'
import {
  MANIFEST_FLEET_SLUGS,
  NATIVE_VENUE_SLUGS,
  UNISWAP_BASE_LEGACY_PINS,
  buildVenueManifest,
  canonicalJson,
  manifestIntegrity,
  venueOf,
  type VenueManifest,
} from '../lib/venue-manifest'
import { APP_CHAINS } from '../lib/chains'
import { TREASURY_ADDRESS } from '../lib/fees'

type Check = (name: string, ok: boolean, extra?: string) => void

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const SEL_RE = /^0x[0-9a-f]{8}$/

export function venueManifestPins(check: Check): void {
  const a = buildVenueManifest({ now: new Date('2026-11-02T00:00:00Z'), commit: 'aaaaaaa' })
  const b = buildVenueManifest({ now: new Date('2026-11-03T12:34:56Z'), commit: 'bbbbbbb' })

  check('venues: the integrity hash is stable across two builds and ignores generatedAt + commit', a.integrity === b.integrity && a.generatedAt !== b.generatedAt && a.commit !== b.commit, `${a.integrity} vs ${b.integrity}`)
  check('venues: integrity is sha256 over the canonical JSON of chains · fees · invariants · signing · venues (re-derivable by anyone)', a.integrity === manifestIntegrity(a) && /^0x[0-9a-f]{64}$/.test(a.integrity))
  check('venues: canonical JSON sorts keys recursively and drops undefined, so key order in code never moves the hash',
    canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] }) === '{"a":[{"d":2}],"b":1}')

  const slugs = a.venues.map((v) => v.slug)
  const fleetNamed = MANIFEST_FLEET_SLUGS.filter((s) => a.venues.some((v) => v.mcp?.fleetSlug === s))
  check('venues: every free-fleet slug is named by a venue (uniswap-free, snapshot-free, cow-free, hyperliquid-free, opensea-free, yeetful-tool-wallet)',
    fleetNamed.length === MANIFEST_FLEET_SLUGS.length, `missing: ${MANIFEST_FLEET_SLUGS.filter((s) => !fleetNamed.includes(s)).join(', ')}`)
  check('venues: every native venue appears, slugs are unique, and the read-only wallet is the one venue that produces nothing signable',
    NATIVE_VENUE_SLUGS.every((s) => slugs.includes(s)) && new Set(slugs).size === slugs.length &&
      a.venues.filter((v) => v.produces === 'read-only').map((v) => v.slug).join() === 'wallet' &&
      a.venues.filter((v) => v.produces === 'tx-shaped').every((v) => v.operations.some((o) => o.shape !== 'read')),
    `slugs: ${slugs.join(', ')}`)

  const contracts = a.venues.flatMap((v) => v.chains.flatMap((c) => c.contracts.map((k) => ({ venue: v.slug, chainId: c.chainId, ...k }))))
  const selectors = a.venues.flatMap((v) => v.selectors.map((s) => ({ venue: v.slug, ...s })))
  check('venues: every pinned address is 0x + 40 hex and every selector is 0x + 8 lowercase hex; every chain row names a registry chain',
    contracts.length > 20 && contracts.every((k) => ADDR_RE.test(k.address)) && selectors.length > 10 && selectors.every((s) => SEL_RE.test(s.selector)) &&
      a.venues.every((v) => v.chains.every((c) => APP_CHAINS.some((ch) => ch.id === c.chainId) && c.explorerTx.length > 0)),
    `${contracts.length} contracts, ${selectors.length} selectors`)

  // NEVER RETYPED: each contract's `source` names a lib file; the address
  // literal must be in that file (case-insensitive). A row whose list an env
  // var may replace is skipped only while that env var is set.
  const retyped = contracts.filter((k) => {
    if (k.env && process.env[k.env]) return false
    const file = k.source.split('#')[0]
    if (!existsSync(file)) return true
    return !readFileSync(file, 'utf8').toLowerCase().includes(k.address.toLowerCase())
  })
  check('venues: every pinned address is read from the lib file its source names — the literal is in that file, nothing was retyped',
    retyped.length === 0, retyped.map((k) => `${k.venue}/${k.chainId} ${k.role} ← ${k.source}`).join(' | '))
  const srcFiles = new Set(selectors.map((s) => s.source.split('#')[0]).filter((f) => f.startsWith('lib/')))
  check('venues: every selector names the ABI constant it was derived from, and that constant is exported by the file it names',
    [...srcFiles].every((f) => existsSync(f)) && selectors.filter((s) => s.source.startsWith('lib/')).every((s) => {
      const [file, name] = s.source.split('#')
      const constName = name.split('.')[0].split(' ')[0]
      return readFileSync(file, 'utf8').includes(`export const ${constName}`)
    }), [...srcFiles].join(', '))

  const base = a.venues.find((v) => v.slug === 'uniswap')!.chains.find((c) => c.chainId === 8453)!
  const router = base.contracts.find((k) => k.role === 'SwapRouter02')?.address.toLowerCase()
  const quoter = base.contracts.find((k) => k.role === 'QuoterV2')?.address.toLowerCase()
  check('venues: the registry’s Base Uniswap pins equal the legacy UNI_SWAP_ROUTER_02 / UNI_QUOTER_V2 constants (one truth, two names)',
    router === UNISWAP_BASE_LEGACY_PINS.swapRouter02.toLowerCase() && quoter === UNISWAP_BASE_LEGACY_PINS.quoterV2.toLowerCase())
  check('venues: Uniswap lists every registry chain that pins a router, with the wrapped native beside it; CoW lists only chains flagged cow with an API base; Morpho lists 1 + 8453; Lido and the Robinhood inbox are Ethereum-only',
    (() => {
      const uni = a.venues.find((v) => v.slug === 'uniswap')!
      const uniIds = uni.chains.map((c) => c.chainId).sort((x, y) => x - y)
      const regIds = APP_CHAINS.filter((c) => c.uniswap || c.uniswapV4).map((c) => c.id).sort((x, y) => x - y)
      const cow = a.venues.find((v) => v.slug === 'cow')!
      const cowIds = cow.chains.map((c) => c.chainId).sort((x, y) => x - y)
      const regCow = APP_CHAINS.filter((c) => c.cow).map((c) => c.id).sort((x, y) => x - y)
      const morpho = a.venues.find((v) => v.slug === 'morpho')!.chains.map((c) => c.chainId).join()
      const lido = a.venues.find((v) => v.slug === 'lido')!.chains.map((c) => c.chainId).join()
      const rh = a.venues.find((v) => v.slug === 'robinhood-chain')!.chains.map((c) => c.chainId).join()
      return uniIds.join() === regIds.join() && uni.chains.every((c) => c.contracts.some((k) => k.role.startsWith('wrapped native'))) &&
        cowIds.join() === regCow.join() && cow.chains.every((c) => c.contracts.length === 2) && morpho === '1,8453' && lido === '1' && rh === '1,4663'
    })())
  check('venues: the Aave and Morpho op selectors ride in 0x form, one per op, straight from the guards’ pinned maps',
    a.venues.find((v) => v.slug === 'aave')!.selectors.length === 4 && a.venues.find((v) => v.slug === 'morpho')!.selectors.length === 6 &&
      a.venues.find((v) => v.slug === 'aave')!.selectors.every((s) => s.source.startsWith('lib/aave-supply.ts#AAVE_OP_SELECTORS.')))
  check('venues: the fee block is lib/fees.ts verbatim (treasury, bps) and every tx-shaped venue carries the kill switch or the planner guard in its guard list',
    a.fees.treasury === TREASURY_ADDRESS && a.fees.swapFeeBps > 0 &&
      a.venues.filter((v) => v.produces === 'tx-shaped').every((v) => v.guards.some((g) => /kill switch|guardPlannerArtifact/.test(g.function))))
  check('venues: Hyperliquid is marked UNMEASURED through custody and names the 1337 signing domain; no venue claims a drilled custody lane',
    /UNMEASURED/.test(a.venues.find((v) => v.slug === 'hyperliquid')!.custody) && a.venues.find((v) => v.slug === 'hyperliquid')!.bounds.signingDomainChainId === 1337 &&
      a.venues.every((v) => !/drilled\.$/.test(v.custody) || /not yet drilled/i.test(v.custody)) && /No institutional custody lane .* has been drilled end to end/.test(a.signing.custody))
  check('venues: ?venue= narrows to one by slug, case-insensitively; an unknown or empty slug is null',
    venueOf(a, 'CoW')?.slug === 'cow' && venueOf(a, ' lido ')?.slug === 'lido' && venueOf(a, 'nope') === null && venueOf(a, '') === null && venueOf(a, null) === null)

  // The docs page renders THIS object: it maps manifest.venues, prints the
  // integrity + commit, links the JSON and GUARDRAILS.md; the registry lists it
  // under the user door, ready; the route is CORS-open and edge-cached.
  const page = readFileSync('app/docs/venues/page.tsx', 'utf8')
  const docs = readFileSync('lib/docs.ts', 'utf8')
  const route = readFileSync('app/api/venues/manifest/route.ts', 'utf8')
  check('venues: /docs/venues maps manifest.venues into cards, prints integrity + commit + generatedAt, links /api/venues/manifest and GUARDRAILS.md, says which venues are read-only and which custody lane is unmeasured',
    page.includes('manifest.venues.map((v) =>') && page.includes('{manifest.integrity}') && page.includes("{manifest.commit ?? 'unknown") && page.includes('{manifest.generatedAt}') &&
      page.includes("'/api/venues/manifest'") && page.includes('GUARDRAILS.md') && page.includes("'read-only'") && page.includes('custody lane unmeasured') &&
      page.includes('explorerAddressUrl(c.chainId, k.address)') && page.includes('export const revalidate = 300'))
  check('venues: lib/docs.ts registers slug venues under the user door, ready, seoTitle ≤ 60 and description ≤ 160',
    (() => {
      const m = docs.match(/slug: 'venues',\s*title: '([^']+)',\s*seoTitle: '([^']+)',\s*description:\s*'((?:[^'\\]|\\.)+)',\s*ready: true,\s*door: 'user'/)
      return !!m && m[2].length <= 60 && m[3].length <= 160
    })())
  check('venues: the route is GET + OPTIONS, nodejs, CORS-open, cached five minutes at the edge, 404s an unknown ?venue= with the slug list',
    route.includes("export const runtime = 'nodejs'") && route.includes('export function OPTIONS') && route.includes("'access-control-allow-origin': '*'") &&
      route.includes('s-maxage=300') && route.includes('status: 404') && route.includes('venueOf(manifest, slug)'))
}

/** The served route + page agree with the local build. */
export async function venueManifestLivePins(check: Check, base: string): Promise<void> {
  const local = buildVenueManifest()
  const res = await fetch(`${base}/api/venues/manifest`)
  const served = (await res.json().catch(() => null)) as VenueManifest | null
  check('venues live: GET /api/venues/manifest answers 200 JSON, CORS-open, edge-cached',
    res.status === 200 && (res.headers.get('content-type') ?? '').includes('application/json') && res.headers.get('access-control-allow-origin') === '*' &&
      (res.headers.get('cache-control') ?? '').includes('s-maxage=300'), `${res.status} ${res.headers.get('cache-control')}`)
  check('venues live: the served manifest lists the same venues as the code and its integrity re-derives from its own body (self-consistent) — and matches the local build when the env agrees',
    !!served && served.venues.map((v) => v.slug).join() === local.venues.map((v) => v.slug).join() && served.integrity === manifestIntegrity(served),
    served ? `served ${served.integrity} · local ${local.integrity}${served.integrity === local.integrity ? ' (equal)' : ' (env differs: fee / router overrides)'}` : 'no body')
  const one = await fetch(`${base}/api/venues/manifest?venue=cow`)
  const oneBody = (await one.json().catch(() => null)) as VenueManifest | null
  const miss = await fetch(`${base}/api/venues/manifest?venue=nope`)
  const missBody = (await miss.json().catch(() => null)) as { venues?: string[] } | null
  check('venues live: ?venue=cow narrows to one venue inside the same envelope; ?venue=nope is a 404 that lists the slugs',
    one.status === 200 && oneBody?.venues.length === 1 && oneBody.venues[0].slug === 'cow' && oneBody.integrity === served?.integrity &&
      miss.status === 404 && Array.isArray(missBody?.venues) && missBody!.venues!.includes('cow'))
  const opt = await fetch(`${base}/api/venues/manifest`, { method: 'OPTIONS' })
  check('venues live: OPTIONS is a 204 with the CORS headers', opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*', String(opt.status))
  const page = await fetch(`${base}/docs/venues`)
  const html = await page.text()
  const missingNames = local.venues.filter((v) => !html.includes(escapeHtml(v.name)))
  check('venues live: /docs/venues renders every venue by name, the served integrity hash, the JSON link and the GUARDRAILS link',
    page.status === 200 && missingNames.length === 0 && !!served && html.includes(served.integrity) && html.includes('/api/venues/manifest') && html.includes('GUARDRAILS.md'),
    `${page.status} missing: ${missingNames.map((v) => v.name).join(' | ')}`)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

if (process.argv[1]?.endsWith('venue-manifest-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  venueManifestPins(check)
  const done = process.argv.includes('--live') ? venueManifestLivePins(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall venue manifest pins green')
    process.exit(failed ? 1 : 0)
  })
}
