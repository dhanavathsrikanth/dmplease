import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "**.ngrok-free.app",
    "*.ngrok.app",
    "*.trycloudflare.com",
    "localhost",
    "127.0.0.1",
  ],
  async redirects() {
    return [
      {
        source: "/protected",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
