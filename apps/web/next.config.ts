import type { NextConfig } from 'next'

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/$/, '')

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@supermind/sdk'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
