import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  transpilePackages: ['@artifigenz/shared'],
  // Dev proxy: when accessing the app via an ngrok HTTPS tunnel (so Plaid OAuth
  // works against the prod env on localhost), browser API calls would otherwise
  // hit http://localhost:4000 and be blocked as mixed content. Rewriting /api/*
  // to the local API lets the frontend use relative URLs that go through ngrok.
  // Enabled only when NEXT_PUBLIC_API_URL is empty or unset.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_URL) return [];
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
