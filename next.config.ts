import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // mídias públicas (áudios dos funis e criativos de anúncio) podem ser baixadas por outros sites
  async headers() {
    return [
      { source: "/funis/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
      { source: "/criativos/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
