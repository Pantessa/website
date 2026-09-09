import type { MetadataRoute } from 'next'
import prisma from '@/lib/db'
import { readyPages } from '@/lib/docs'
import { HOUSE_LINKS } from '@/lib/house-links'
import { publicCreatorHandles } from '@/lib/links-board'

import { SITE_URL as SITE } from '@/lib/site-url'

// The sitemap re-renders hourly: house links retire, creator pages get
// claimed, posts publish — none of that should wait for a deploy.
export const revalidate = 3600

// Sitemap: the links-first surfaces first (the product a stranger is sent
// to), then the callable service detail pages + published posts
// (lastModified from updatedAt so crawlers re-fetch edited content).
// Until 2026-09-08 this listed the x402-era site only — /, /servers, docs,
// blog — and nothing links-first was indexed (squad gtm, L-1).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/links`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/links/embed`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/agents`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE}/roster`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE}/mosaic`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${SITE}/rebrand`, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE}/servers`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/benchmarks`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${SITE}/tools`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${SITE}/activity`, changeFrequency: 'daily', priority: 0.7 },
    // Docs come from the registry — a page flips `ready` and it's indexed.
    ...readyPages().map((p) => ({
      url: p.slug ? `${SITE}/docs/${p.slug}` : `${SITE}/docs`,
      changeFrequency: 'monthly' as const,
      priority: p.slug === '' ? 0.9 : 0.8,
    })),
    { url: `${SITE}/blog`, changeFrequency: 'weekly', priority: 0.8 },
  ]

  try {
    const [houseRows, handles, posts, callable] = await Promise.all([
      // House links (creator-less seeds) that are still LIVE — a retired
      // house ask (/i/stop-loss) must not be handed to a crawler. Creator
      // links are deliberately NOT listed: a creator's ask is theirs to
      // share, and the public board + their /l page already carry the
      // ones they chose to surface.
      prisma.intentLink.findMany({
        where: { id: { in: HOUSE_LINKS.map((h) => h.slug) }, creator: null, revoked: false },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
      // Creator pages — the SAME fenced set /links lists under "Creator
      // pages" (an opt-in public storefront, never a wallet): a handle rides
      // only while its creator holds a live link that isn't our own harness
      // or drill mint, so `harness-store` and friends never reach a crawler.
      publicCreatorHandles(),
      prisma.blogPost.findMany({
        where: { published: true },
        select: { slug: true, updatedAt: true },
      }),
      prisma.mcpServer.findMany({
        where: { callable: true, reviewStatus: 'approved' },
        select: { slug: true, updatedAt: true },
      }),
    ])
    const now = Date.now()
    for (const h of houseRows) {
      if (h.expiresAt && new Date(h.expiresAt).getTime() <= now) continue
      entries.push({ url: `${SITE}/i/${h.id}`, changeFrequency: 'weekly', priority: 0.8 })
    }
    for (const h of handles) {
      entries.push({ url: `${SITE}/l/${h.handle}`, lastModified: h.brandUpdatedAt ?? h.createdAt, changeFrequency: 'weekly', priority: 0.6 })
    }
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
