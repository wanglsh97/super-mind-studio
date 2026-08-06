import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    // Agent SSE 需要穿过同源 rewrite；必须覆盖最长 1 小时的 Agent Run。
    proxyTimeout: 3_660_000,
  },
  transpilePackages: ['@supermind/sdk'],
  turbopack: {
    root: workspaceRoot,
  },
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
