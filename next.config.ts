import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  // Renamed from experimental.serverComponentsExternalPackages in Next 15+.
  serverExternalPackages: ['@prisma/client', 'prisma'],
  // /developers folded into /docs (the grand entry). Permanent redirect keeps
  // any inbound/external links alive.
  async redirects() {
    return [
      { source: '/developers', destination: '/docs', permanent: true },
      // Leaderboard was renamed to Benchmarks (adds the first-party tool
      // benchmarks section). Keep inbound/external links alive.
      { source: '/leaderboard', destination: '/benchmarks', permanent: true },
      // The links studio moved INTO the app (2026-09-03, Nate): the chat
      // surface's LINKS tab IS the link center — mint, funnel, earnings, and
      // the creator page in the place the work already happens. Minting used
      // to exist on both surfaces and the dashboard one won every CTA by
      // default. Links already posted to the world keep working, and Next
      // carries the query string (the ?ask= / ?mcps= mint handoff) through a
      // redirect automatically. It lives HERE, not as a page calling
      // redirect(): /dashboard/links sits under a CLIENT layout that renders
      // nothing until the wallet gate settles, so a server redirect() in that
      // slot never reaches the browser — verified, it 200s.
      { source: '/dashboard/links', destination: '/chat?tab=links', permanent: false },
    ]
  },
  // Design system lives as static files in public/design-system/. Next doesn't
  // auto-resolve a directory index, so serve the overview at the clean URL.
  async rewrites() {
    return [{ source: '/design-system', destination: '/design-system/index.html' }]
  },
  // /embed is the embeddable chat — third-party sites iframe it (embed
  // contract v1, see /docs/embed). frame-ancestors * allows any parent for
  // THIS path only; we deliberately never set X-Frame-Options anywhere.
  async headers() {
    return [
      {
        source: '/embed',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
    ]
  },
}

export default nextConfig
