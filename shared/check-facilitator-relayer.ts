// Standalone check for whether Celo's official x402 facilitator relayer
// wallet has enough gas to settle payments again. Run manually, not part of
// any agent's runtime loop.
//
// Usage:
//   npx tsx shared/check-facilitator-relayer.ts            # single check
//   npx tsx shared/check-facilitator-relayer.ts --watch     # poll every 60s until funded
import { createPublicClient, http, formatEther } from "viem";
import { celo } from "viem/chains";

const RELAYER_ADDRESS = "0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48" as const;
// One settle tx cost ~0.042 CELO when we last measured it (2026-07-13).
// Require a small safety margin so a single check doesn't flicker green
// right as the balance crosses the bare minimum.
const MIN_BALANCE_WEI = 100_000_000_000_000_000n; // 0.1 CELO
const POLL_INTERVAL_MS = 60_000;

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

async function checkOnce(): Promise<boolean> {
  const balance = await client.getBalance({ address: RELAYER_ADDRESS });
  const funded = balance >= MIN_BALANCE_WEI;
  const ts = new Date().toISOString();
  console.log(
    `[${ts}] relayer balance: ${formatEther(balance)} CELO — ${funded ? "FUNDED ✅" : "still empty ❌"}`,
  );
  return funded;
}

async function main() {
  const watch = process.argv.includes("--watch");

  if (!watch) {
    await checkOnce();
    return;
  }

  console.log(`Watching ${RELAYER_ADDRESS} every ${POLL_INTERVAL_MS / 1000}s (Ctrl+C to stop)...`);
  while (true) {
    const funded = await checkOnce();
    if (funded) {
      console.log("\nRelayer is funded — flip X402_MODE=facilitator in Vercel (signal, risk) and Railway (router), then redeploy.");
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
