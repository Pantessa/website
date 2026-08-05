import type { MetadataRoute } from 'next'

import { SITE_URL as SITE } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/chat/', '/dashboard'] }],
    sitemap: `${SITE}/sitemap.xml`,
  }
}
