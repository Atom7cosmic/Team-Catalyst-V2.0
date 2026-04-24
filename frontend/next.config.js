/** @type {import('next').NextConfig} */

const getApiUrl = () => {
  let url = process.env.NEXT_PUBLIC_API_URL || "https://laudable-warmth-production-9f2f.up.railway.app";
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, '');
};
const API_URL = getApiUrl();
const nextConfig = {
  reactStrictMode: false,

  images: {
    domains: ["localhost", "laudable-warmth-production-9f2f.up.railway.app"],
    unoptimized: true,
  },

  env: {
    NEXT_PUBLIC_API_URL: API_URL,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || "https://laudable-warmth-production-9f2f.up.railway.app",
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;