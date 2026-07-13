/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the dashboard to talk to the other agent servers during dev.
  async rewrites() {
    return [
      { source: "/signal/:path*", destination: "http://localhost:3001/:path*" },
      { source: "/risk/:path*", destination: "http://localhost:3002/:path*" },
    ];
  },
  // /api/state reads shared/.agent-wallets.json via fs.readFileSync at
  // runtime — Next.js output file tracing only follows imports, so it misses
  // this file unless explicitly included (same gotcha hit deploying
  // signal/risk agents). shared/.activity.jsonl is deliberately NOT included:
  // it's a stale local dev log (Sepolia-era, 25MB, no cross-instance sync in
  // production) — shipping it would show fake "live" activity to judges.
  outputFileTracingIncludes: {
    "/api/state": ["../shared/.agent-wallets.json"],
  },
};

export default nextConfig;