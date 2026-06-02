import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  // Renamed from experimental.serverComponentsExternalPackages in Next 15+.
  serverExternalPackages: ['@prisma/client', 'prisma'],
}

export default nextConfig
