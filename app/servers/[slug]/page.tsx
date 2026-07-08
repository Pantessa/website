import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, TrendingUp } from 'lucide-react'
import prisma from '@/lib/db'
import BrandIcon from '@/components/BrandIcon'
import Footer from '@/components/Footer'
import ServerApproveToggle from '@/components/ServerApproveToggle'
import TokenPanel from '@/components/TokenPanel'
import Description from '@/components/Description'
import ReputationPanel from '@/components/ReputationPanel'
import RoutabilityPanel from '@/components/RoutabilityPanel'
import EndpointFeatureStar from '@/components/EndpointFeatureStar'
import DeleteServerButton from '@/components/DeleteServerButton'
import { getTokenPanel } from '@/lib/launch-token'
import { computeReputation, recentPings } from '@/lib/reputation'
import type { RoutabilityReport } from '@/lib/mcp-lint-report'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/** Shape of one agentic.market param schema entry (mcp_endpoints.parameters). */
interface EndpointParam {
  group?: string
  name?: string
  type?: string
  description?: string
  example?: string
  required?: boolean
  enumValues?: string[]
  default?: string
}

async function getServer(slug: string) {
  try {
    return await prisma.mcpServer.findUnique({
      where: { slug },
      // Featured ("start here") endpoints lead the list — the page mirrors the
      // planner-menu order so what you read is what the router sees.
      include: { endpoints: { orderBy: [{ featured: 'desc' }, { position: 'asc' }] } },
    })
  } catch {
    return null // DB unavailable → 404 rather than a crash
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const server = await getServer(slug)
  if (!server) return { title: 'Service not found — Yeetful' }
  return {
    title: server.gated === false ? `${server.name} — free MCP on Yeetful` : `${server.name} — x402 agent on Yeetful`,
    description: server.description,
  }
}

/** "$0.001" or "$0.001 – $10.00" for upto schemes; null when unpriced.
 * Explicitly-free tools (priceUsd '0') show no chip — the FREE badge in the
 * header already says it. */
function priceLabel(ep: { priceUsd: string | null; maxPriceUsd: string | null; scheme: string | null }) {
  if (!ep.priceUsd || Number(ep.priceUsd) === 0) return null
  const min = `$${ep.priceUsd}`
  if (ep.scheme === 'upto' && ep.maxPriceUsd) return `${min} – $${ep.maxPriceUsd}`
  return min
}

// ── Cost at volume ──────────────────────────────────────────────────────────
// Per-call pricing compounds fast in agent loops — surface the implied daily
// cost honestly instead of letting "$0.01/call" read as negligible.

/** Amber once a sustained rate implies at least this much per day. */
const VOLUME_WARN_PER_DAY_USD = 500

function fmtUsd(n: number): string {
  if (n >= 100) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${n.toFixed(2)}`
}

/**
 * Implied daily cost at a sustained calls/minute rate, from the per-call price.
 * Returns the label + whether it crosses the warning threshold.
 */
function costAtVolume(priceUsd: string, perMinute: number): { perDay: number; label: string } {
  const perDay = Number(priceUsd) * perMinute * 60 * 24
  return { perDay, label: fmtUsd(perDay) }
}

/** Path + query of an endpoint URL (host shown separately per provider). */
function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export default async function ServiceDetailPage({ params }: Params) {
  const { slug } = await params
  const server = await getServer(slug)
  if (!server) notFound()

  const paramsOf = (ep: { parameters: unknown }): EndpointParam[] =>
    Array.isArray(ep.parameters) ? (ep.parameters as EndpointParam[]) : []

  const panel = await getTokenPanel({
    slug: server.slug,
    tokenAddress: server.tokenAddress,
    stakingAddress: server.stakingAddress,
  })
  // Launched tokens get the pump.fun-style split (sticky trade rail top-right);
  // unlaunched ones stay a simple single column.
  const launched = panel.state === 'launched' && !!panel.token

  // Reputation: multi-dimension score + recent-call timeline + the viewer's rating.
  const [repMap, pings, viewerAddr] = await Promise.all([
    computeReputation([{ slug: server.slug, name: server.name, category: server.category, priceUsd: server.priceUsd }]),
    recentPings(server.name),
    getSessionAddress(),
  ])
  const rep = repMap.get(server.slug)!
  const yourRating = viewerAddr
    ? (await prisma.mcpRating.findUnique({
        where: { serviceSlug_ownerAddress: { serviceSlug: server.slug, ownerAddress: viewerAddr.toLowerCase() } },
        select: { rating: true },
      }))?.rating ?? null
    : null
  const ratingInitial = { average: rep.ratingAvg, count: rep.ratingCount, yourRating }
  // Admins curate the featured ("start here") endpoints inline on the tool list.
  const canCurate = isAdminAddress(viewerAddr)

  const header = (
    <header className="svc__head">
            <div className="svc__tile">
              {/* BrandIcon reads id/slug/name/iconSlug — narrow to the store type's shape. */}
              <BrandIcon
                server={{
                  id: server.id,
                  slug: server.slug,
                  name: server.name,
                  description: server.description,
                  category: server.category,
                  websiteUrl: server.websiteUrl,
                  color: server.color,
                  iconSlug: server.iconSlug,
                }}
                size={34}
              />
            </div>
            <div className="svc__title">
              <h1 className="svc__name">{server.name}</h1>
              <div className="svc__meta">
                <span className="badge badge--dir mono">{server.category}</span>
                {server.gated === false ? (
                  <span
                    className="badge badge--price mono"
                    style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    title="No payment gate — free MCP, rate-limited"
                  >
                    FREE
                  </span>
                ) : (
                  server.priceUsd && <span className="badge badge--price mono">from ${server.priceUsd}/call</span>
                )}
                {server.callable || server.gated === false ? (
                  // Free rows are planner-driven — they route in chat the
                  // moment they're selected, same promise as hand-wired rows.
                  <span className="badge badge--live" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                    <span className="badge__dot" style={{ background: 'var(--accent)' }} />
                    {server.callable ? 'Callable in chat' : 'Routes in chat'}
                  </span>
                ) : (
                  <span className="badge badge--dir mono">Listed</span>
                )}
                {server.networks.map((n) => (
                  <span key={n} className="badge badge--dir mono">
                    {n}
                  </span>
                ))}
              </div>
            </div>
            <div className="svc__headlinks">
              {(server.callable || server.gated === false) && (
                <Link className="svc__ext svc__ext--accent" href={`/chat?try=${server.slug}`}>
                  Try in chat
                  <ExternalLink width={13} height={13} />
                </Link>
              )}
              {server.websiteUrl && (
                <a
                  className="svc__ext"
                  href={server.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  See Info
                  <ExternalLink width={13} height={13} />
                </a>
              )}
            </div>
    </header>
  )

  const endpoints = (
    <div className="svc__section svc__eps">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">{server.gated === false ? 'Tools' : 'x402 endpoints'}</h2>
              <span className="svc__count mono">{server.endpoints.length}</span>
              {canCurate && (
                <span className="svc__curate mono">
                  admin · star the “start here” endpoints — the router and new-account quick view lead with them
                </span>
              )}
            </div>

            {server.endpoints.length === 0 ? (
              <p className="svc__empty">
                No published endpoint surface for this service yet — pricing above is from its
                directory listing.
              </p>
            ) : (
              <ul className="eps">
                {server.endpoints.map((ep) => {
                  const eparams = paramsOf(ep)
                  const price = priceLabel(ep)
                  return (
                    <li key={ep.id} className="ep">
                      <div className="ep__line">
                        <span className={`ep__method mono ep__method--${ep.method.toLowerCase()}`}>
                          {ep.method}
                        </span>
                        <span className="ep__path mono" title={ep.url}>
                          {pathOf(ep.url)}
                        </span>
                        <EndpointFeatureStar
                          slug={server.slug}
                          endpointId={ep.id}
                          initial={ep.featured}
                          canCurate={canCurate}
                        />
                        {price && <span className="ep__price mono">{price}</span>}
                      </div>
                      <div className="ep__sub">
                        {ep.provider && <span className="ep__provider">via {ep.provider}</span>}
                        <span className="ep__host mono">{hostOf(ep.url)}</span>
                        {ep.scheme === 'upto' && <span className="ep__scheme mono">metered</span>}
                      </div>
                      {ep.priceUsd && Number(ep.priceUsd) > 0 && (() => {
                        const perMin = costAtVolume(ep.priceUsd, 1)
                        const perSec = costAtVolume(ep.priceUsd, 60)
                        const from = ep.scheme === 'upto' ? 'from ' : ''
                        return (
                          <p className="ep__volume mono">
                            <span className="ep__volumelbl">
                              <TrendingUp className="ep__volumeicon" aria-hidden /> at volume
                            </span>
                            <span className={perMin.perDay >= VOLUME_WARN_PER_DAY_USD ? 'ep__volume--warn' : ''}>
                              ≈ {from}{perMin.label}/day @ 1 call/min
                            </span>
                            <span className="ep__volumesep">·</span>
                            <span className={perSec.perDay >= VOLUME_WARN_PER_DAY_USD ? 'ep__volume--warn' : ''}>
                              ≈ {from}{perSec.label}/day @ 1 call/sec
                            </span>
                          </p>
                        )
                      })()}
                      {ep.description && <p className="ep__desc">{ep.description}</p>}
                      {eparams.length > 0 && (
                        <details className="ep__params">
                          <summary className="mono">
                            {eparams.length} parameter{eparams.length === 1 ? '' : 's'}
                          </summary>
                          <ul className="ep__paramlist">
                            {eparams.map((p, i) => (
                              <li key={`${p.name ?? 'param'}-${i}`} className="ep__param">
                                <div className="ep__paramline">
                                  <span className="ep__paramname mono">{p.name}</span>
                                  {p.type && <span className="ep__paramtype mono">{p.type}</span>}
                                  {p.group && <span className="ep__paramgroup mono">{p.group}</span>}
                                  {p.required && <span className="ep__paramreq mono">required</span>}
                                </div>
                                {p.description && <p className="ep__paramdesc">{p.description}</p>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
    </div>
  )

  // Launched: pump.fun-style split (TokenPanel emits the lead/detail/rail areas).
  const launchedBody = (
    <>
      {header}
      <ServerApproveToggle serverId={server.id} serverName={server.name} />
      <Description text={server.description} />
      <ReputationPanel rep={rep} pings={pings} rating={ratingInitial} slug={server.slug} />
      <RoutabilityPanel slug={server.slug} initial={server.routability as unknown as RoutabilityReport | null} />
      <TokenPanel panel={panel} slug={server.slug} name={server.name} />
      {endpoints}
    </>
  )

  // Not launched: a contained two-column grid — service info + reputation +
  // performance in the main column, the "own a piece" CTA in a sticky rail,
  // endpoints full width below.
  const infoBody = (
    <div className="svc__split2">
      <div className="svc__main">
        {header}
        <ServerApproveToggle serverId={server.id} serverName={server.name} />
        <Description text={server.description} />
        <ReputationPanel rep={rep} pings={pings} rating={ratingInitial} slug={server.slug} />
        <RoutabilityPanel slug={server.slug} initial={server.routability as unknown as RoutabilityReport | null} />
      </div>
      <aside className="svc__rail">
        <TokenPanel panel={panel} slug={server.slug} name={server.name} />
      </aside>
      {endpoints}
    </div>
  )

  return (
    <>
      <main className={launched ? 'x-main x-main--fluid' : 'x-main'}>
        <div className="svc">
          <Link href="/servers" className="svc__back mono">
            <ArrowLeft width={14} height={14} />
            Directory
          </Link>
          {launched ? <div className="svc__split">{launchedBody}</div> : infoBody}
          <DeleteServerButton slug={server.slug} name={server.name} />
        </div>
      </main>
      <Footer />
    </>
  )
}
