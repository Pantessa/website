import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'

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

export default async function BlogIndexPage() {
  const posts = await getPosts()

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

  return (
    <>
      <main className="x-main">
        <div className="svc">
          <span className="hero__eyebrow mono">NOTES FROM THE CONTROL PLANE</span>
          <h1 className="hero__h1 hero__h1--sm">Blog</h1>
          <p className="hero__sub">
            Agent expense accounts, x402 payments, and what shipped — written by the people (and
            agents) building it.
          </p>

          {posts.length === 0 ? (
            <p className="svc__empty">Nothing published yet. The autopilot is probably typing.</p>
          ) : (
            <div className="blog__grid">
              {posts.map((p) => (
                <article key={p.slug} className="blog__card">
                  <Link href={`/blog/${p.slug}`} className="blog__cardlink">
                    {p.coverImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.coverImageUrl}
                        alt={p.coverImageAlt ?? ''}
                        className="blog__cover"
                        loading="lazy"
                      />
                    )}
                    <h2 className="blog__cardtitle">{p.title}</h2>
                    <p className="blog__carddesc">{p.description}</p>
                    <div className="blog__cardmeta mono">
                      {p.publishedAt && (
                        <time dateTime={p.publishedAt.toISOString()}>
                          {p.publishedAt.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </time>
                      )}
                      {p.tags.map((t) => (
                        <span key={t} className="blog__tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  </Link>
                </article>
              ))}
            </div>
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
