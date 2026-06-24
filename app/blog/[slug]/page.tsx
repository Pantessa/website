import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'
import BlogChart from '@/components/BlogChart'

// A ```chart fenced block renders as an inline SVG chart (BlogChart) instead of
// a code block. Everything else stays default — raw HTML is still escaped.
const mdComponents: Components = {
  pre(props) {
    const child = Array.isArray(props.children) ? props.children[0] : props.children
    const cls =
      (child && typeof child === 'object' && 'props' in child
        ? ((child as { props?: { className?: string } }).props?.className ?? '')
        : '') || ''
    if (cls.includes('language-chart')) {
      const raw = String((child as { props?: { children?: unknown } }).props?.children ?? '')
      return <BlogChart raw={raw} />
    }
    return <pre>{props.children}</pre>
  },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

type Params = { params: Promise<{ slug: string }> }

async function getPost(slug: string) {
  try {
    const post = await prisma.blogPost.findUnique({ where: { slug } })
    return post?.published ? post : null // drafts are 404 — existence undisclosed
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: 'Not found — Yeetful' }
  const url = `${SITE}/blog/${post.slug}`
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
  const post = await getPost(slug)
  if (!post) notFound()

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

          <header>
            <h1 className="blog__title">{post.title}</h1>
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
              {post.tags.map((t) => (
                <span key={t} className="blog__tag">
                  {t}
                </span>
              ))}
            </div>
          </header>

          {post.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.coverImageUrl}
              alt={post.coverImageAlt ?? ''}
              className="blog__cover blog__cover--hero"
            />
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  )
}
