import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsCrumbs, DocsNext, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SWAP_FEE_PCT, feePctLabel } from '@/lib/fees'
import { SITE_CARD } from '@/lib/og-defaults'
import { buildVenueManifest, explorerAddressUrl, type ManifestVenue } from '@/lib/venue-manifest'

// /docs/venues: the last page in SAFETY. A plain summary and a short venue
// table first (what each venue does, on which chains), then the full
// reference per venue: the pinned contracts per chain (with explorer links),
// the selectors a build may emit, the signing domain, the operations, the
// guard in front of the signature, and the bounds. Everything below the
// summary is rendered from the SAME object GET /api/venues/manifest serves,
// which reads every value from the lib/ constants the builders and guards
// use; the integrity hash in the footer pins the JSON. The only hand-written
// words are PLAIN (one line per venue slug), and a venue the map does not
// know falls back to its own operation names, so the table cannot go stale.

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
  read: 'read, nothing to sign',
  tx: 'one transaction',
  txChain: 'a chain of transactions (validUntil + refresh)',
  typedData: 'an EIP-712 signature',
  order: 'a signed order (settled by the venue)',
  hlAction: 'a Hyperliquid L1 action',
}

// One plain line per venue for the summary table. Words only: the chains
// beside them come from the manifest. A slug missing here falls back to the
// venue's own operation names.
const PLAIN: Record<string, { does: string; where?: string }> = {
  uniswap: { does: 'Swap tokens, including tokenized stocks on Robinhood Chain' },
  cow: { does: 'Swap with a signed order that solvers fill' },
  aave: { does: 'Lend, borrow, repay and withdraw', where: 'Read live from Aave’s own market list' },
  morpho: { does: 'Lend, borrow, repay and withdraw' },
  lido: { does: 'Stake ETH' },
  hyperliquid: { does: 'Trade perpetual futures; deposit USDC from Arbitrum', where: 'Hyperliquid, deposits from Arbitrum' },
  'near-intents': { does: 'Swap from one chain to another' },
  lifi: { does: 'Finish a stock swap when Uniswap has no pool; move your money between chains to fund a trade' },
  opensea: { does: 'Buy, list and send NFTs' },
  snapshot: { does: 'Vote on governance proposals. No money moves', where: 'Off-chain' },
  'robinhood-chain': { does: 'Bridge ETH to and from Robinhood Chain' },
  transfers: { does: 'Send tokens to an address you name' },
  wallet: { does: 'Read balances and history. Nothing to sign', where: 'Every app chain' },
}

function plainOf(v: ManifestVenue): { does: string; where: string } {
  const p = PLAIN[v.slug]
  const does = p?.does ?? v.operations.filter((o) => o.shape !== 'read').map((o) => o.name).join(' · ')
  const where = p?.where ?? (v.chains.length ? v.chains.map((c) => c.name).join(', ') : 'No chain pinned')
  return { does, where }
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
          Chains: {v.chains.map((c) => `${c.name} (${c.chainId})`).join(' · ')}. No contract is pinned in this repo for this venue. The notes say why.
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
      <DocsCrumbs slug="venues" />
      <h1 className="docs__h1">Venues and checks: what you can be asked to sign</h1>
      <p className="docs__lead">
        Every venue, chain and contract a Pantessa build can use, read straight from the code. The same list is
        served as JSON at <a href={MANIFEST_URL}>{MANIFEST_URL}</a>.
      </p>

      <DocsSummary>
        <li>
          {txShaped.length} venues can hand your wallet something to sign. {readOnly.length}{' '}
          {readOnly.length === 1 ? 'only reads' : 'only read'}.
        </li>
        <li>
          {contractCount} contract addresses across {manifest.chains.length} chains are pinned in code, each with
          the file it comes from.
        </li>
        <li>A guard checks each build against these pins before your wallet sees it. If a check fails, nothing is offered.</li>
        <li>Fees come from one file. A normal swap costs {SWAP_FEE_PCT}.</li>
      </DocsSummary>

      <div className="docs__prose venues">
        <h2>Venues at a glance</h2>
        <table>
          <thead>
            <tr>
              <th>venue</th>
              <th>what you can do</th>
              <th>where</th>
            </tr>
          </thead>
          <tbody>
            {manifest.venues.map((v) => {
              const p = plainOf(v)
              return (
                <tr key={v.slug}>
                  <td>
                    <a href={`#venue-${v.slug}`}>{v.name}</a>
                  </td>
                  <td>{p.does}</td>
                  <td>{p.where}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p>
          How a build is made and checked, in plain words, is on <Link href="/docs/trust">Why you can sign what
          Pantessa builds</Link>.
        </p>

        <h2>Rules every venue follows</h2>
        <table>
          <thead>
            <tr>
              <th>rule</th>
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
              <th>normal swap</th>
              <td className="mono">
                {manifest.fees.swapFeeBps} bps ({feePctLabel(manifest.fees.swapFeeBps)})
              </td>
            </tr>
            <tr>
              <th>swap through a creator&apos;s link</th>
              <td className="mono">
                {manifest.fees.linkSwapFeeBps} bps ({feePctLabel(manifest.fees.linkSwapFeeBps)}) · {Math.round(manifest.fees.creatorSplit * 100)}% to the link&apos;s creator
              </td>
            </tr>
            <tr>
              <th>swap across chains</th>
              <td className="mono">
                {manifest.fees.crossChainFeeBps} bps · 1Click keeps {Math.round(manifest.fees.oneClickFeeSplit * 100)}%
              </td>
            </tr>
            <tr>
              <th>Hyperliquid builder fee (perp orders)</th>
              <td className="mono">
                {manifest.fees.hlBuilderFeeTenthBps} tenths of a bp ({feePctLabel(manifest.fees.hlBuilderFeeTenthBps / 10)})
              </td>
            </tr>
            <tr>
              <th>treasury</th>
              <td className="venues__addr mono">{manifest.fees.treasury}</td>
            </tr>
            <tr>
              <th>source</th>
              <td className="venues__src mono">{manifest.fees.source}</td>
            </tr>
          </tbody>
        </table>

        <h2>Who signs</h2>
        <p>{manifest.signing.signer}</p>
        <p>Signing paths in use:</p>
        <ul>
          {manifest.signing.lanesProven.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p>
          <strong>Custody lanes:</strong> {manifest.signing.custody}
        </p>

        <h2>Each venue in detail</h2>
        <p>
          Each card names the constant every address was read from; the standing harness checks the literal is in
          that file. A pin that lives only in the free MCP repo is named, not copied. Selectors are derived from
          the builders&apos; own ABIs, or imported from the guard that pins them (Aave, Morpho), so a build for one
          operation cannot carry another operation&apos;s calldata past its guard.
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
        <p className="venues__note">
          The integrity hash is sha256 over the canonical JSON of the chains, fees, rules, signing and venue sections,
          so two deploys of the same code and env agree.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/trust', desc: 'How every trade is built, checked and signed.' },
          { href: '/docs/guardian', desc: 'A stop or take-profit that watches your Hyperliquid position.' },
          { href: '/docs/desk', desc: 'For developers: the Pantessa desk over MCP.' },
        ]}
      />
    </>
  )
}
