import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'
import { buildVenueManifest, explorerAddressUrl, type ManifestVenue } from '@/lib/venue-manifest'

// /docs/venues — the printable venue manifest. The user door's proof page: a
// compliance reader at an institution gets, per venue, the pinned contracts
// per chain (with explorer links), the selectors a build may emit, the signing
// domain, the operations by shape, the guard that fences it, and the bounds —
// rendered from the SAME object GET /api/venues/manifest serves, which reads
// every value from the lib/ constants the builders and guards use. No claim on
// this page is typed by hand; the integrity hash in the footer pins the JSON.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'venues')!

// Re-render every five minutes — the manifest is pure, but the commit and the
// env-replaceable allowlists (LiFi) can move between deploys.
export const revalidate = 300

const GUARDRAILS_URL = 'https://github.com/Pantessa/website/blob/main/GUARDRAILS.md'
const MANIFEST_URL = '/api/venues/manifest'

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

const SHAPE_WORDS: Record<ManifestVenue['operations'][number]['shape'], string> = {
  read: 'read — nothing to sign',
  tx: 'one transaction',
  txChain: 'a chain of transactions (validUntil + refresh)',
  typedData: 'an EIP-712 signature',
  order: 'a signed order (settled by the venue)',
  hlAction: 'a Hyperliquid L1 action',
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function VenueCard({ v }: { v: ManifestVenue }) {
  const txShaped = v.produces === 'tx-shaped'
  const unmeasured = /UNMEASURED/.test(v.custody)
  return (
    <section className="venues__card" id={`venue-${v.slug}`}>
      <h2 className="docs__heading">{v.name}</h2>
      <div className="venues__pills">
        <span className="venues__pill">{v.kind === 'native' ? 'native builder + guard' : v.kind === 'free-mcp' ? 'free MCP' : 'native builder + free MCP'}</span>
        <span className={`venues__pill ${txShaped ? 'venues__pill--tx' : ''}`}>{txShaped ? 'tx-shaped' : 'read-only'}</span>
        {unmeasured && <span className="venues__pill venues__pill--warn">custody lane unmeasured</span>}
        {v.mcp?.fleetSlug && <span className="venues__pill">fleet · {v.mcp.fleetSlug}</span>}
        <span className="venues__pill">{v.repo.join(' · ')}</span>
      </div>

      {v.chains.some((c) => c.contracts.length > 0) && (
        <>
          <h3>Pinned contracts</h3>
          <table>
            <thead>
              <tr>
                <th>chain</th>
                <th>role</th>
                <th>address</th>
                <th>source</th>
              </tr>
            </thead>
            <tbody>
              {v.chains.flatMap((c) =>
                c.contracts.map((k, i) => {
                  const href = explorerAddressUrl(c.chainId, k.address)
                  return (
                    <tr key={`${c.chainId}-${k.role}-${i}`}>
                      <td>
                        {c.name} <span className="mono">({c.chainId})</span>
                      </td>
                      <td>{k.role}</td>
                      <td className="venues__addr">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" title={k.address}>
                            {k.address}
                          </a>
                        ) : (
                          k.address
                        )}
                      </td>
                      <td className="venues__src mono">
                        {k.source}
                        {k.env ? ` (env ${k.env} may replace)` : ''}
                      </td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </>
      )}
      {v.chains.length > 0 && v.chains.every((c) => c.contracts.length === 0) && (
        <p className="venues__note">
          Chains: {v.chains.map((c) => `${c.name} (${c.chainId})`).join(' · ')}. No contract is pinned in this repo for this venue — see the notes for why.
        </p>
      )}

      {v.selectors.length > 0 && (
        <>
          <h3>Selectors a build may emit</h3>
          <table>
            <thead>
              <tr>
                <th>selector</th>
                <th>signature</th>
                <th>derived from</th>
              </tr>
            </thead>
            <tbody>
              {v.selectors.map((s, i) => (
                <tr key={`${s.selector}-${i}`}>
                  <td className="mono">{s.selector}</td>
                  <td className="mono">{s.signature}</td>
                  <td className="venues__src mono">{s.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {v.typedData && (
        <>
          <h3>Signing domain</h3>
          <table>
            <tbody>
              <tr>
                <th>domain</th>
                <td className="mono">
                  {Object.entries(v.typedData.domain)
                    .map(([k, val]) => `${k}: ${String(val)}`)
                    .join(' · ')}
                </td>
              </tr>
              <tr>
                <th>primaryType</th>
                <td className="mono">{v.typedData.primaryType}</td>
              </tr>
              <tr>
                <th>fields</th>
                <td className="mono">{v.typedData.fields.join(', ')}</td>
              </tr>
              <tr>
                <th>source</th>
                <td className="venues__src mono">{v.typedData.source}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <h3>Operations</h3>
      <ul>
        {v.operations.map((op) => (
          <li key={op.name}>
            <strong>{op.name}</strong> <span className="venues__shape mono">{SHAPE_WORDS[op.shape]}</span>
            <br />
            {op.description}
          </li>
        ))}
      </ul>

      {v.guards.length > 0 && (
        <>
          <h3>The guard in front of the signature</h3>
          <ul>
            {v.guards.map((g) => (
              <li key={`${g.module}-${g.function}`}>
                <code>{g.module}</code> <span className="mono">{g.function}</span> refuses:
                <ul>
                  {g.refuses.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      {Object.keys(v.bounds).length > 0 && (
        <>
          <h3>Bounds</h3>
          <table>
            <tbody>
              {Object.entries(v.bounds).map(([k, val]) => (
                <tr key={k}>
                  <th className="mono">{k}</th>
                  <td className="mono">{Array.isArray(val) ? val.join(', ') : String(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {(v.policy.notes.length > 0 || v.mcp?.pinnedIn) && (
        <>
          <h3>Notes</h3>
          <ul>
            {v.policy.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {v.mcp?.pinnedIn && (
              <li>
                Pins kept in the free MCP, not this repo: <code>{v.mcp.pinnedIn}</code> (
                <a href="https://github.com/Pantessa/free-mcps" target="_blank" rel="noreferrer">
                  Pantessa/free-mcps
                </a>
                ).
              </li>
            )}
          </ul>
        </>
      )}

      <p className="venues__custody">
        <strong>Custody:</strong> {v.custody}
      </p>
    </section>
  )
}

export default function VenuesDocsPage() {
  const manifest = buildVenueManifest()
  const txShaped = manifest.venues.filter((v) => v.produces === 'tx-shaped')
  const readOnly = manifest.venues.filter((v) => v.produces === 'read-only')
  const contractCount = manifest.venues.reduce((n, v) => n + v.chains.reduce((m, c) => m + c.contracts.length, 0), 0)
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> THE VENUE MANIFEST
      </p>
      <h1 className="docs__h1">What Pantessa can build, exactly</h1>
      <p className="docs__lead">
        The model never writes calldata. Builders in this repo produce the bytes; a separate guard
        re-decodes them before anything reaches a wallet. Below are <strong>the only contracts and
        selectors a Pantessa build may emit</strong>, per venue and per chain, with the guard that
        fences each one and the bounds it enforces — read from the same constants the builders use,
        not retyped, and served as JSON at <a href={MANIFEST_URL}>{MANIFEST_URL}</a> for your own tooling to pin.
      </p>

      <div className="docs__prose venues">
        <h2>How to read this page</h2>
        <ul>
          <li>
            <strong>{txShaped.length} venues are tx-shaped</strong> (they can hand your wallet something to sign);{' '}
            <strong>{readOnly.length} {readOnly.length === 1 ? 'is' : 'are'} read-only</strong> and can never produce a signable artifact. The pill on each
            card says which.
          </li>
          <li>
            <strong>{contractCount} pinned addresses</strong> across {manifest.chains.length} chains. Each row names the constant it was read from; the
            standing harness asserts the literal is in that file. A pin that lives only in the free MCP repo is named, not copied.
          </li>
          <li>
            <strong>Selectors are derived</strong> from the builders&apos; own ABIs with viem, or imported from the guard that pins them (Aave, Morpho) —
            a build for one operation can never smuggle another operation&apos;s calldata past its guard.
          </li>
          <li>
            <strong>Custody</strong> is stated honestly per venue. As of {manifest.generatedAt.slice(0, 10)} no institutional custody lane has been drilled
            end to end; Hyperliquid perps through custody are the most friction and are marked unmeasured.
          </li>
          <li>
            This page is the human twin of the JSON. The <strong>integrity hash</strong> in the footer is sha256 over the canonical JSON of the chains,
            fees, invariants, signing and venue sections; two deploys of the same code and env agree.
          </li>
        </ul>

        <h2>Venue-neutral invariants</h2>
        <table>
          <thead>
            <tr>
              <th>invariant</th>
              <th>what it means</th>
              <th>where</th>
            </tr>
          </thead>
          <tbody>
            {manifest.invariants.map((inv) => (
              <tr key={inv.name}>
                <td>
                  <strong>{inv.name}</strong>
                </td>
                <td>{inv.detail}</td>
                <td className="venues__src mono">{inv.source}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Fees, one source</h2>
        <table>
          <tbody>
            <tr>
              <th>treasury</th>
              <td className="venues__addr mono">{manifest.fees.treasury}</td>
            </tr>
            <tr>
              <th>swap fee (organic chat)</th>
              <td className="mono">{manifest.fees.swapFeeBps} bps</td>
            </tr>
            <tr>
              <th>swap fee (intent links)</th>
              <td className="mono">
                {manifest.fees.linkSwapFeeBps} bps · {Math.round(manifest.fees.creatorSplit * 100)}% to the creator
              </td>
            </tr>
            <tr>
              <th>Hyperliquid builder fee</th>
              <td className="mono">{manifest.fees.hlBuilderFeeTenthBps} tenths of a bp</td>
            </tr>
            <tr>
              <th>cross-chain fee</th>
              <td className="mono">
                {manifest.fees.crossChainFeeBps} bps · 1Click keeps {Math.round(manifest.fees.oneClickFeeSplit * 100)}%
              </td>
            </tr>
            <tr>
              <th>source</th>
              <td className="venues__src mono">{manifest.fees.source}</td>
            </tr>
          </tbody>
        </table>

        <h2>Who signs</h2>
        <p>{manifest.signing.signer}</p>
        <ul>
          {manifest.signing.lanesProven.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p>
          <strong>Custody lanes:</strong> {manifest.signing.custody}
        </p>

        <h2>Venues</h2>
        <p className="venues__toc">
          {manifest.venues.map((v, i) => (
            <span key={v.slug}>
              {i > 0 && ' · '}
              <a href={`#venue-${v.slug}`}>{v.name}</a>
            </span>
          ))}
        </p>
        {manifest.venues.map((v) => (
          <VenueCard key={v.slug} v={v} />
        ))}

        <div className="venues__foot mono">
          <div>
            JSON: <a href={MANIFEST_URL}>{MANIFEST_URL}</a> · one venue: <a href={`${MANIFEST_URL}?venue=cow`}>{MANIFEST_URL}?venue=cow</a>
          </div>
          <div>
            Guarantees and residuals: <a href={GUARDRAILS_URL} target="_blank" rel="noreferrer">GUARDRAILS.md</a>
          </div>
          <div>commit: {manifest.commit ?? 'unknown (not a Vercel build)'}</div>
          <div>integrity: {manifest.integrity}</div>
          <div>generated: {manifest.generatedAt}</div>
        </div>
      </div>
    </>
  )
}
