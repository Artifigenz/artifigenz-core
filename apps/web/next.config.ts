import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  transpilePackages: ['@artifigenz/shared'],
};

export default nextConfig;
