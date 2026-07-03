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
    ]
  },
  // Design system lives as static files in public/design-system/. Next doesn't
  // auto-resolve a directory index, so serve the overview at the clean URL.
  async rewrites() {
    return [{ source: '/design-system', destination: '/design-system/index.html' }]
  },
}

export default nextConfig
