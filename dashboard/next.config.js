/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the dashboard to talk to the other agent servers during dev.
  async rewrites() {
    return [
      { source: "/signal/:path*", destination: "http://localhost:3001/:path*" },
      { source: "/risk/:path*", destination: "http://localhost:3002/:path*" },
    ];
  },
};

export default nextConfig;