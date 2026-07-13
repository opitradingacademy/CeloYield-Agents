import { registerAgent } from "./register-agent";
import { getAgentAccount } from "./wallet";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Registers the 3 cooperative agents (yield-router, signal, risk) on the
// ERC-8004 Identity Registry on Celo Sepolia. Each agent's wallet is reused
// from the .agent-wallets.json cache so registration signs with the same
// address the agent actually uses at runtime.
//
// Run once: tsx shared/register-both.ts
// Note: between each registration there's a 30s wait for the previous tx
// to be mined. Without the wait, subsequent txs can collide on nonce.

function makeLogoDataUri(): string {
  const svg = readFileSync(join(process.cwd(), "shared", "agent-logo.svg"), "utf-8");
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const logo = makeLogoDataUri();
  const wallet = await getAgentAccount("signal-aggregator-agent-v1");

  // 1. signal-aggregator-agent
  console.log("\n[1/3] registering signal-aggregator-agent...");
  const signalTx = await registerAgent(
    {
      name: "signal-aggregator-agent",
      description:
        "Mento V3 FPMM APY aggregator. x402-gated $0.001/req.",
      image: logo,
      services: [
        {
          name: "x402",
          endpoint: "http://localhost:3001/api/apy",
          version: "1.0",
        },
      ],
      supportedTrust: ["reputation"],
    },
    wallet,
  );
  console.log(`  tx: ${signalTx.txHash}`);

  console.log("Waiting 30s for tx to be mined...");
  await sleep(30_000);

  // 2. risk-manager-agent
  console.log("\n[2/3] registering risk-manager-agent...");
  const riskTx = await registerAgent(
    {
      name: "risk-manager-agent",
      description:
        "Protocol risk scorer for Celo DeFi. x402-gated $0.002/req.",
      image: logo,
      services: [
        {
          name: "x402",
          endpoint: "http://localhost:3002/api/assess",
          version: "1.0",
        },
      ],
      supportedTrust: ["reputation"],
    },
    wallet,
  );
  console.log(`  tx: ${riskTx.txHash}`);

  console.log("Waiting 30s for tx to be mined...");
  await sleep(30_000);

  // 3. yield-router-agent
  console.log("\n[3/3] registering yield-router-agent...");
  const routerTx = await registerAgent(
    {
      name: "yield-router-agent",
      description:
        "Celo Mento V3 yield router. Pays signal + risk via x402, signs swaps via Privy MPC.",
      image: logo,
      services: [
        {
          name: "x402",
          endpoint: "http://localhost:3000/api/proposals",
          version: "1.0",
        },
      ],
      supportedTrust: ["reputation"],
    },
    wallet,
  );
  console.log(`  tx: ${routerTx.txHash}`);

  console.log("\nAll 3 agents registered. Verify on https://8004scan.io (Sepolia).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});