import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Browser source maps are opt-out by default — flip on once we want client
  // stack traces in Loki and accept the bundle-size + privacy tradeoff.
  productionBrowserSourceMaps: false,
}

export default nextConfig
