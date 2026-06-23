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
    return [{ source: '/developers', destination: '/docs', permanent: true }]
  },
}

export default nextConfig
