// Standalone check: counts real x402-facilitator USDC settlements from the
// yield-router wallet, independent of Dune's query refresh schedule.
// Usage: npx tsx shared/check-facilitator-settlements.ts

const ROUTER_WALLET = "0x2254256D89F17789f112335D643F52d3B043dF7E";
const SIGNAL_WALLET = "0x7318805D1E79a5A08A26214dCB99C5F07dCD578a";
const RISK_WALLET = "0x5314540B295596754BF5aEEd351C8d38dD884548";
const USDC_TOKEN = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";

async function main() {
  const url = `https://celo.blockscout.com/api?module=account&action=tokentx&address=${ROUTER_WALLET}&sort=desc&page=1&offset=100`;
  const res = await fetch(url);
  const json = (await res.json()) as { result: any[] };
  const txs = json.result ?? [];

  const settlements = txs.filter(
    (t) =>
      t.contractAddress?.toLowerCase() === USDC_TOKEN.toLowerCase() &&
      t.from.toLowerCase() === ROUTER_WALLET.toLowerCase() &&
      [SIGNAL_WALLET.toLowerCase(), RISK_WALLET.toLowerCase()].includes(t.to.toLowerCase()),
  );

  console.log(`Found ${settlements.length} facilitator USDC settlement(s) among last ${txs.length} token transfers:\n`);
  for (const s of settlements) {
    const usd = Number(s.value) / 1_000_000;
    console.log(
      `${new Date(Number(s.timeStamp) * 1000).toISOString()}  $${usd.toFixed(3)}  → ${
        s.to.toLowerCase() === SIGNAL_WALLET.toLowerCase() ? "signal-agent" : "risk-agent"
      }  tx=${s.hash}`,
    );
  }

  if (settlements.length === 0) {
    console.log("No facilitator settlements found yet in the last 100 token transfers.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
