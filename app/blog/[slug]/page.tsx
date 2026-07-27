import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import prisma from '@/lib/db'
import { isBlogAdminSession } from '@/lib/blog'
import Footer from '@/components/Footer'
import BlogAdminBar from '@/components/BlogAdminBar'
import BlogChart from '@/components/BlogChart'
import BlogCoverArt from '@/components/BlogCoverArt'
import BlogFigure from '@/components/BlogFigure'
import BlogViews from '@/components/BlogViews'

// A ```chart fenced block renders as an inline SVG chart (BlogChart) and a
// ```figure block as an inline SVG diagram (BlogFigure), instead of code
// blocks. Everything else stays default — raw HTML is still escaped.
const mdComponents: Components = {
  pre(props) {
    const child = Array.isArray(props.children) ? props.children[0] : props.children
    const cls =
      (child && typeof child === 'object' && 'props' in child
        ? ((child as { props?: { className?: string } }).props?.className ?? '')
        : '') || ''
    const raw = () => String((child as { props?: { children?: unknown } }).props?.children ?? '')
    if (cls.includes('language-chart')) return <BlogChart raw={raw()} />
    if (cls.includes('language-figure')) return <BlogFigure raw={raw()} />
    return <pre>{props.children}</pre>
  },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

type Params = { params: Promise<{ slug: string }> }

/** A post the caller may see, plus whether they may administer it. Drafts stay
 *  404 for everyone but a signed-in admin — an unpublished post's existence is
 *  still undisclosed to the public. */
async function getPost(slug: string) {
  try {
    const post = await prisma.blogPost.findUnique({ where: { slug } })
    if (!post) return null
    const admin = await isBlogAdminSession()
    if (!post.published && !admin) return null
    return { post, admin }
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const found = await getPost(slug)
  if (!found) return { title: 'Not found — Yeetful' }
  const { post } = found
  const url = `${SITE}/blog/${post.slug}`
  // A draft an admin is previewing must never leak into search: no canonical,
  // no OG, and an explicit noindex. Only published posts carry SEO metadata.
  if (!post.published) {
    return {
      title: `[DRAFT] ${post.title} — Yeetful Blog`,
      robots: { index: false, follow: false, nocache: true },
    }
  }
  return {
    title: `${post.title} — Yeetful Blog`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url,
      siteName: 'Yeetful',
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      tags: post.tags,
      ...(post.coverImageUrl ? { images: [{ url: post.coverImageUrl, alt: post.coverImageAlt ?? post.title }] } : {}),
    },
    twitter: {
      card: post.coverImageUrl ? 'summary_large_image' : 'summary',
      title: post.title,
      description: post.description,
    },
  }
}

export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params
  const found = await getPost(slug)
  if (!found) notFound()
  const { post, admin } = found

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    url: `${SITE}/blog/${post.slug}`,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Organization', name: 'Yeetful', url: SITE },
    publisher: { '@type': 'Organization', name: 'Yeetful', url: SITE },
    keywords: post.tags.join(', '),
    ...(post.coverImageUrl ? { image: post.coverImageUrl } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}/blog/${post.slug}` },
  }

  return (
    <>
      <main className="x-main">
        <article className="svc blog__post">
          <Link href="/blog" className="svc__back mono">
            <ArrowLeft width={14} height={14} />
            Blog
          </Link>

          {admin && (
            <BlogAdminBar
              slug={post.slug}
              published={post.published}
              publishedAt={post.publishedAt?.toISOString() ?? null}
            />
          )}

          <header className="blog__posthead">
            <span className="blog__postkicker mono">NOTES FROM THE CONTROL PLANE</span>
            <h1 className="blog__title">{post.title}</h1>
            {post.description && <p className="blog__lede">{post.description}</p>}
            <div className="blog__cardmeta mono">
              {post.publishedAt && (
                <time dateTime={post.publishedAt.toISOString()}>
                  {post.publishedAt.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
              )}
              <BlogViews slug={post.slug} initial={post.views} />
              {post.tags.map((t) => (
                <span key={t} className="blog__tag">
                  {t}
                </span>
              ))}
            </div>
          </header>

          {/* The head: an uploaded cover when there is one, otherwise the same
              generated route art the post wears on /blog — so every post has a
              moving head instead of a bare wall of type. */}
          {post.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.coverImageUrl}
              alt={post.coverImageAlt ?? ''}
              className="blog__cover blog__cover--hero"
            />
          ) : (
            <div className="blog__coverart blog__cover--hero">
              <BlogCoverArt slug={post.slug} tag={post.tags[0]} className="blog__coverart-svg" />
            </div>
          )}

          {/* react-markdown escapes raw HTML by default (no rehype-raw) — the
              constitution's XSS line. GFM for tables/strikethrough/autolinks. */}
          <div className="blog__body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {post.content}
            </ReactMarkdown>
          </div>
        </article>
      </main>
      <Footer />
      {/* Structured data is a publication claim — drafts don't make one. */}
      {post.published && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  )
}
