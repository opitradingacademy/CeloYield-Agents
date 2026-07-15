import { createPublicClient, http, formatEther, parseEther } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { getNetwork } from "./network";

// Kept in one place so oracle-agent's charge and arbitrage-agent's
// profitability math can't silently drift apart — they run as separate
// processes and would otherwise duplicate this literal.
export const ORACLE_PRICE_USD = 0.001;

// Total gas units for one yield-router swap cycle: ERC20.transfer() + FPMM.swap(),
// matching the gas_limit values executor.ts actually sends (100_000n + 300_000n).
const SWAP_GAS_UNITS = 400_000n;

let cachedCeloUsd: { price: number; fetchedAt: number } | null = null;
const CELO_PRICE_TTL_MS = 5 * 60 * 1000;

export async function getCeloUsdPrice(): Promise<number> {
  if (cachedCeloUsd && Date.now() - cachedCeloUsd.fetchedAt < CELO_PRICE_TTL_MS) {
    return cachedCeloUsd.price;
  }
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd",
    );
    const data = (await res.json()) as { celo?: { usd?: number } };
    const price = data.celo?.usd;
    if (typeof price === "number" && price > 0) {
      cachedCeloUsd = { price, fetchedAt: Date.now() };
      return price;
    }
  } catch {
    // fall through to fallback below
  }
  // CoinGecko unreachable: reuse last known-good price, else a conservative
  // guess. Callers should log when the cache is empty so this isn't silent.
  return cachedCeloUsd?.price ?? 0.6;
}

// Converts a small USD price (e.g. an x402 per-request fee) into native CELO
// wei, using the same live CELO/USD rate as the gas estimate above. Used for
// real on-chain x402 settlement — the fee is paid as a tiny CELO transfer
// rather than a mock header, so it's a genuine settled payment.
export async function usdToCeloWei(usd: number): Promise<bigint> {
  const celoUsd = await getCeloUsdPrice();
  return parseEther((usd / celoUsd).toFixed(18));
}

// Live gas cost estimate (in USD) for one full swap cycle. Replaces the old
// flat ASSUMED_GAS_COST_USD guess, which never reflected real gas price or
// CELO/USD rate and could let the router execute swaps that lose money net
// of actual gas once real capital is on mainnet.
export async function estimateGasCostUsd(): Promise<number> {
  const network = getNetwork();
  const chain = network.chainId === 42220 ? celo : celoSepolia;
  const client = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const [gasPrice, celoUsd] = await Promise.all([
    client.getGasPrice(),
    getCeloUsdPrice(),
  ]);
  const costCelo = Number(formatEther(gasPrice * SWAP_GAS_UNITS));
  return costCelo * celoUsd;
}
