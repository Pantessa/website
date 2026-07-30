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
    return [
      { source: '/design-system', destination: '/design-system/index.html' },
      // RFC 9116 security contact. Next doesn't serve dotfolders out of
      // public/, so the file lives at public/security.txt and is rewritten
      // to its well-known path. Added 2026-07-30: a researcher or blocklist
      // maintainer evaluating a Yeetful domain should have a documented way
      // to reach us BEFORE listing it.
      { source: '/.well-known/security.txt', destination: '/security.txt' },
    ]
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
