import type { MetadataRoute } from 'next'
import prisma from '@/lib/db'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

// Sitemap: static surfaces + the callable service detail pages + published
// posts (lastModified from updatedAt so crawlers re-fetch edited content).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/developers`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/blog`, changeFrequency: 'weekly', priority: 0.8 },
  ]

  try {
    const [posts, callable] = await Promise.all([
      prisma.blogPost.findMany({
        where: { published: true },
        select: { slug: true, updatedAt: true },
      }),
      prisma.mcpServer.findMany({
        where: { callable: true },
        select: { slug: true, updatedAt: true },
      }),
    ])
    for (const p of posts) {
      entries.push({
        url: `${SITE}/blog/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: 'monthly',
        priority: 0.7,
      })
    }
    for (const s of callable) {
      entries.push({
        url: `${SITE}/servers/${s.slug}`,
        lastModified: s.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.6,
      })
    }
  } catch {
    /* static entries beat a 500 */
  }
  return entries
}
