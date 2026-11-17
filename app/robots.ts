import type { MetadataRoute } from 'next'

import { SITE_URL as SITE } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  return {
    // The share cards live under /api/og/: a crawler that obeys robots (X's card bot) must be allowed to fetch the
    // image a page names, or the link unfurls with no picture (review B1). The rest of /api/ stays disallowed.
    rules: [{ userAgent: '*', allow: ['/', '/api/og/'], disallow: ['/api/', '/chat/', '/dashboard'] }],
    sitemap: `${SITE}/sitemap.xml`,
  }
}
