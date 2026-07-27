import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/db'
import { isBlogAdminSession } from '@/lib/blog'
import Footer from '@/components/Footer'
import BlogAdminBar from '@/components/BlogAdminBar'
import BlogCoverArt from '@/components/BlogCoverArt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

export const metadata: Metadata = {
  title: 'Blog — Yeetful',
  description:
    'Notes from the agent-payments control plane: spend-controlled x402, agent expense accounts, and what our autopilot ships.',
  alternates: { canonical: `${SITE}/blog` },
  openGraph: {
    type: 'website',
    title: 'Blog — Yeetful',
    description: 'Notes from the agent-payments control plane.',
    url: `${SITE}/blog`,
    siteName: 'Yeetful',
  },
}

async function getPosts() {
  try {
    return await prisma.blogPost.findMany({
      where: { published: true },
      orderBy: { publishedAt: 'desc' },
      select: {
        slug: true,
        title: true,
        description: true,
        coverImageUrl: true,
        coverImageAlt: true,
        tags: true,
        publishedAt: true,
      },
    })
  } catch {
    return []
  }
}

/** Unpublished posts, newest first — only ever called for a signed-in admin.
 *  Kept as a separate query so the public path can't accidentally widen: the
 *  published list above is still the only thing that feeds the page's JSON-LD
 *  and the sitemap. */
async function getDrafts() {
  try {
    return await prisma.blogPost.findMany({
      where: { published: false },
      orderBy: { updatedAt: 'desc' },
      select: { slug: true, title: true, description: true, tags: true, updatedAt: true },
    })
  } catch {
    return []
  }
}

const fmt = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export default async function BlogIndexPage() {
  const admin = await isBlogAdminSession()
  const [posts, drafts] = await Promise.all([getPosts(), admin ? getDrafts() : Promise.resolve([])])

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Yeetful Blog',
    url: `${SITE}/blog`,
    description: metadata.description,
    publisher: { '@type': 'Organization', name: 'Yeetful', url: SITE },
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE}/blog/${p.slug}`,
      datePublished: p.publishedAt?.toISOString(),
    })),
  }

  const [feat, ...rest] = posts

  return (
    <>
      <main className="x-main">
        <div className="svc blog__index">
          <header className="blog__head">
            <span className="hero__eyebrow mono">
              <span className="blog__livedot" aria-hidden="true" />
              NOTES FROM THE CONTROL PLANE
            </span>
            <h1 className="hero__h1 hero__h1--sm">Blog</h1>
            <p className="hero__sub">
              Agent expense accounts, x402 payments, and what shipped — written by the people (and
              agents) building it.
            </p>
            {/* Thin route rail under the head: one accent packet travelling the
                line, echoing the hero's settlement motif. Pure CSS. */}
            <div className="blog__rail" aria-hidden="true" />
          </header>

          {/* Admin-only: every unpublished post, with a one-click publish.
              Renders nothing for everyone else — and the API re-checks the
              allowlist on the flip, so this being visible is never authority. */}
          {admin && (
            <section className="blogdrafts">
              <div className="blogdrafts__head">
                <span className="blogdrafts__kicker mono">ADMIN · UNPUBLISHED</span>
                <span className="blogdrafts__count mono">
                  {drafts.length} draft{drafts.length === 1 ? '' : 's'}
                </span>
              </div>
              {drafts.length === 0 ? (
                <p className="blogdrafts__empty mono">
                  No drafts. Everything written is live.
                </p>
              ) : (
                <ul className="blogdrafts__list">
                  {drafts.map((d) => (
                    <li key={d.slug} className="blogdrafts__row">
                      <div className="blogdrafts__meta">
                        <Link href={`/blog/${d.slug}`} className="blogdrafts__title">
                          {d.title}
                        </Link>
                        <span className="blogdrafts__sub mono">
                          /blog/{d.slug} · edited {fmt(d.updatedAt)}
                          {d.tags.length > 0 ? ` · ${d.tags.join(', ')}` : ''}
                        </span>
                      </div>
                      <BlogAdminBar slug={d.slug} published={false} compact />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {posts.length === 0 ? (
            <p className="svc__empty">Nothing published yet. The autopilot is probably typing.</p>
          ) : (
            <>
              {/* The latest post gets the marquee treatment so the index
                  leads with something to read instead of an even grid. */}
              <Link href={`/blog/${feat.slug}`} className="blog__feature blog__rise">
                <div className="blog__featart">
                  {feat.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={feat.coverImageUrl}
                      alt={feat.coverImageAlt ?? ''}
                      className="blog__featcover"
                    />
                  ) : (
                    <BlogCoverArt slug={feat.slug} tag={feat.tags[0]} className="blog__featcover" />
                  )}
                </div>
                <div className="blog__featbody">
                  <span className="blog__featkicker mono">LATEST</span>
                  <h2 className="blog__feattitle">{feat.title}</h2>
                  <p className="blog__featdesc">{feat.description}</p>
                  <div className="blog__cardmeta mono">
                    {feat.publishedAt && (
                      <time dateTime={feat.publishedAt.toISOString()}>{fmt(feat.publishedAt)}</time>
                    )}
                    {feat.tags.map((t) => (
                      <span key={t} className="blog__tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <span className="blog__featmore">
                    Read the post <span className="blog__arrow">→</span>
                  </span>
                </div>
              </Link>

              {rest.length > 0 && (
                <div className="blog__grid">
                  {rest.map((p, i) => (
                    <article
                      key={p.slug}
                      className="blog__card blog__rise"
                      // Stagger the entrance: the feature lands first, then the
                      // grid follows row by row.
                      style={{ ['--rise-delay' as string]: `${120 + i * 70}ms` }}
                    >
                      <Link href={`/blog/${p.slug}`} className="blog__cardlink">
                        <div className="blog__cardart">
                          {p.coverImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.coverImageUrl}
                              alt={p.coverImageAlt ?? ''}
                              className="blog__cover"
                              loading="lazy"
                            />
                          ) : (
                            <BlogCoverArt slug={p.slug} tag={p.tags[0]} className="blog__cover" />
                          )}
                        </div>
                        <div className="blog__cardbody">
                          <h2 className="blog__cardtitle">{p.title}</h2>
                          <p className="blog__carddesc">{p.description}</p>
                          <div className="blog__cardmeta mono">
                            {p.publishedAt && (
                              <time dateTime={p.publishedAt.toISOString()}>
                                {fmt(p.publishedAt)}
                              </time>
                            )}
                            {p.tags.map((t) => (
                              <span key={t} className="blog__tag">
                                {t}
                              </span>
                            ))}
                          </div>
                          <span className="blog__cardmore">
                            Read <span className="blog__arrow">→</span>
                          </span>
                        </div>
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        // Trusted, server-built JSON (no user HTML can reach this string).
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  )
}
