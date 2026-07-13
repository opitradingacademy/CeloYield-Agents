// Inspect live APY for being an LP in a Mento V3 FPMM pool on Celo Sepolia.
//
// LP APY on Mento V3 comes from:
//   1. Swap fees (LP fee portion, collected on every trade)
//   2. Liquidity strategy rebalancing incentives (paid to allowlisted strategies
//      that rebalance pools when they go out of band — typically keeper bots)
//
// For an LP, (1) is the realistic, predictable source. (2) goes to the
// strategy contract, not directly to LPs, unless the LP is also running a strategy.
//
// This script shows pool fees and reserves so we can estimate APY from fees.
import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import { createPublicClient, http, formatUnits } from "viem";
import { celoSepolia } from "viem/chains";

const client = createPublicClient({
  chain: celoSepolia,
  transport: http("https://forno.celo-sepolia.celo-testnet.org/"),
});

async function main() {
  const mento = await Mento.create(ChainId.CELO_SEPOLIA);
  const pools = await mento.pools.getPools();

  console.log(`Mento V3 Sepolia pool APY estimate (from swap fees only):\n`);

  for (const pool of pools) {
    try {
      const details = await mento.pools.getPoolDetails(pool.poolAddr);
      if (details.poolType !== "FPMM") continue;

      const lpFeeBps = Number(details.fees.lpFeeBps);
      const lpFeePct = lpFeeBps / 100; // bps → percent
      const r0 = Number(formatUnits(details.reserve0, 18));
      const r1 = Number(formatUnits(details.reserve1, 6)); // USDC = 6 decimals
      const tvlUsd = r0 + r1; // assumes both ≈ 1 USD

      // Without volume data, APY estimate is "if pool turned over X times per
      // day at the LP fee". Print volume-not-applicable + per-1%-daily-turnover
      // APY projection so the user can multiply by realistic turnover.
      const apyPer1PctDailyTurnover = lpFeePct * 0.01 * 365; // 1% of TVL/day * 365d

      console.log(`Pool: ${pool.token0.slice(0, 8)}…/${pool.token1.slice(0, 8)}…`);
      console.log(`  LP fee: ${details.fees.lpFeePercent}% per swap`);
      console.log(`  Reserves (raw): ${details.reserve0} / ${details.reserve1}`);
      console.log(`  TVL (rough USD): $${tvlUsd.toFixed(2)}`);
      console.log(
        `  APY projection: ~${apyPer1PctDailyTurnover.toFixed(3)}% APY per 1% daily volume/TVL turnover`,
      );
      console.log(
        `  (Real APY depends on actual swap volume — Sepolia testnet has ~0 swap volume, so APY ≈ 0%)`,
      );
      console.log();
    } catch (e: any) {
      console.log(`Pool ${pool.poolAddr}: ${e?.message ?? e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});