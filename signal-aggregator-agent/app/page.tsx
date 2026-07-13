export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "60px auto", padding: "0 20px" }}>
      <h1>signal-aggregator-agent</h1>
      <p>
        Stateless HTTP service that aggregates live APY estimates for a Celo stablecoin
        by walking every Mento V3 FPMM pool on the current network. x402-gated:
        <strong> $0.001 per request</strong> (mock mode for development).
      </p>

      <h2>Endpoint</h2>
      <pre style={{ background: "#f4f4f4", padding: 12, borderRadius: 6 }}>
{`GET /api/apy?asset=USDC
Header: x-mock-payment: paid   (only needed while X402_MODE=mock)`}
      </pre>

      <h2>Try it</h2>
      <p>
        Without the payment header you get <code>402 Payment Required</code>. With it,
        you get back ranked Mento pools with LP fee % and projected APY (LP fee × 1%
        daily turnover × 365 — honest on Sepolia where real volume ≈ 0).
      </p>

      <h2>Health</h2>
      <p>
        Listening on port 3001. <code>curl http://localhost:3001/api/apy?asset=USDC</code>
        &nbsp;→ 402. Add the header to get JSON.
      </p>

      <h2>Stack</h2>
      <ul>
        <li>Next.js 15 App Router (route handlers in app/api/apy/route.ts)</li>
        <li>@mento-protocol/mento-sdk@3.2.8 for live on-chain pool reads</li>
        <li>Shared x402 mock in shared/x402-mock.ts</li>
      </ul>
    </main>
  );
}