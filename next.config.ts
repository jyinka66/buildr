import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // SECURITY: TypeScript build errors MUST fail the build. The previous
  // `ignoreBuildErrors: true` setting was a release-control gap that
  // allowed broken contracts and runtime defects to reach production.
  // If the build fails, fix the type errors — do not silence them.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
