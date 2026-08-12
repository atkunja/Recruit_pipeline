import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `postgres`, `pdf-lib` and `googleapis` are server-only and should never be
  // bundled into the client or traced into the edge runtime.
  serverExternalPackages: ["postgres", "pdf-lib", "googleapis"],
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't double-run it and
    // slow every production build down.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Keeps server action payloads small; we never upload large files.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
