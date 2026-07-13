// E2E test: create a Privy wallet, sign a simple value-transfer tx, broadcast
// it on Celo Sepolia, and verify the hash shows up on the explorer.
//
// This is the foundational "is Privy working for us at all?" check. If this
// passes, we know we have an MPC-free, working wallet signer that we can use
// across all 3 agents (yield-router, signal-aggregator, risk-manager).
//
// Usage:
//   export PRIVY_APP_ID=...
//   export PRIVY_APP_SECRET=...
//   npx tsx shared/test-privy-signer.ts
import { PrivyClient } from "@privy-io/node";
import { createPublicClient, http, parseEther, type Address, type Hex } from "viem";
import { celoSepolia } from "viem/chains";
import { getNetwork } from "./network";
import { getOrCreateAgentWallet } from "./wallet";

const APP_ID = process.env.PRIVY_APP_ID!;
const APP_SECRET = process.env.PRIVY_APP_SECRET!;

if (!APP_ID || !APP_SECRET) {
  console.error("Missing PRIVY_APP_ID / PRIVY_APP_SECRET");
  process.exit(1);
}

async function main() {
  const network = getNetwork();
  console.log(`Network: ${network.chainId === celoSepolia.id ? "sepolia" : "mainnet"} (chainId ${network.chainId})`);

  // 1. Create or fetch the wallet for this test agent.
  const externalId = "signer-test-v1";
  const { walletId, address } = await getOrCreateAgentWallet(externalId);
  console.log(`Wallet: ${walletId} -> ${address}`);

  const publicClient = createPublicClient({
    chain: celoSepolia,
    transport: http(network.rpcUrl),
  });

  // 2. Check current balance — we need at least a tiny amount of native CELO for gas.
  const balance = await publicClient.getBalance({ address });
  console.log(`Balance: ${balance} wei (${Number(balance) / 1e18} CELO)`);

  if (balance === 0n) {
    console.error("\n[ABORT] Wallet has no CELO for gas. Faucet:");
    console.error(`  https://faucet.celo.org/celo-sepolia`);
    console.error(`  Address to fund: ${address}`);
    process.exit(1);
  }

  // 3. Build a self-transfer of 0 CELO (just to test signing + broadcast).
  //    A real agent will replace this with a contract call (swap, deposit, etc).
  const privy = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  const nonce = await publicClient.getTransactionCount({ address });

  const txParams = {
    to: address as Address,
    data: "0x" as Hex,
    value: "0x0",
    chain_id: network.chainId,
    nonce: `0x${nonce.toString(16)}`,
    gas_limit: "0x5208", // 21000
    gas_price: `0x${parseEther("0.000000001").toString(16)}`, // 1 gwei — Sepolia is cheap
  } as const;

  console.log(`\nSending self-transfer tx...`);
  console.log(`Params:`, txParams);

  const result = await privy.wallets().ethereum().sendTransaction(walletId, {
    caip2: `eip155:${network.chainId}`,
    params: { transaction: txParams },
  });

  console.log(`\n[OK] Tx sent!`);
  console.log(`  Hash: ${result.hash}`);
  console.log(`  Explorer: https://celo-sepolia.blockscout.com/tx/${result.hash}`);

  // 4. Wait for the receipt to confirm it actually landed.
  console.log(`\nWaiting for receipt...`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: result.hash as Hex,
    timeout: 60_000,
  });

  console.log(`[OK] Confirmed in block ${receipt.blockNumber}`);
  console.log(`  Status: ${receipt.status === "success" ? "success" : "FAILED"}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);
}

main().catch((err) => {
  console.error("[FAIL]", err);
  process.exit(1);
});