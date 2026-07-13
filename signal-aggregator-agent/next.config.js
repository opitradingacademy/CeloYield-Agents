/** @type {import('next').NextConfig} */
const nextConfig = {
  // shared/.agent-wallets.json is read via fs.readFileSync at runtime (not a
  // static import), so Next.js's file tracing misses it by default and the
  // Vercel serverless bundle ships without it — the wallet map then looks
  // empty at request time, and the code tries to re-create an agent wallet
  // whose external_id already exists on Privy, which 500s.
  outputFileTracingIncludes: {
    "/api/apy": ["../shared/.agent-wallets.json"],
  },
};

module.exports = nextConfig;
