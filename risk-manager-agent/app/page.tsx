export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "60px auto", padding: "0 20px" }}>
      <h1>risk-manager-agent</h1>
      <p>
        Stateless HTTP service that scores a (protocol, asset) pair on a 0-100 safety
        scale, plus a list of flags. x402-gated: <strong>$0.002 per request</strong>.
      </p>

      <h2>Endpoint</h2>
      <pre style={{ background: "#f4f4f4", padding: 12, borderRadius: 6 }}>
{`GET /api/assess?protocol=Mento&asset=USDC
Header: x-mock-payment: paid   (only needed while X402_MODE=mock)`}
      </pre>

      <h2>Try it</h2>
      <p>
        Without the payment header you get <code>402</code>. With it, you get a JSON
        object with score, flags, tvlUsd, and reasoning.
      </p>

      <h2>Scoring</h2>
      <ul>
        <li>Base score 50 (neutral)</li>
        <li>+30 if protocol is in the audit registry</li>
        <li>+15 if audited (OpenZeppelin, Certora, Trail of Bits, etc.)</li>
        <li>−20 if protocol is unknown</li>
        <li>−20 if TVL &lt; $1,000 (slippage risk for the requested asset)</li>
        <li>−5 if TVL &lt; $100,000</li>
        <li>+5 if TVL ≥ $100,000 (healthy)</li>
        <li>Moola on Sepolia = score 0 (not deployed on testnet)</li>
      </ul>

      <h2>Stack</h2>
      <ul>
        <li>Next.js 15 App Router</li>
        <li>@mento-protocol/mento-sdk for live TVL reads on Mento</li>
        <li>Static audit table (Mento, Moola, Ubeswap) — extend in lib/risk-scorer.ts</li>
      </ul>
    </main>
  );
}