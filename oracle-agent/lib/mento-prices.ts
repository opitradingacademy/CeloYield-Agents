import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import { parseUnits, formatUnits } from "viem";
import { getNetwork } from "../../shared/network";

// In-memory rolling sample; a real deployment would persist this (e.g. Redis)
// so volatility survives restarts, but for the hackathon MVP process memory is enough.
const history = new Map<string, { ts: number; rate: number }[]>();
const SAMPLE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// EURm has no live Sepolia pool (verified directly against mento.pools.getPools())
// — left out here on purpose so a typo'd pair fails loudly instead of silently
// hitting RouteNotFoundError deep inside the SDK.
function tokenFor(network: ReturnType<typeof getNetwork>, symbol: string) {
  if (symbol === "USDm") return { address: network.usdmToken, decimals: 18 };
  if (symbol === "USDC") return { address: network.usdcToken, decimals: 6 };
  throw new Error(`Unknown or untradable token symbol "${symbol}"`);
}

export async function getRecentPrices(pair: string) {
  const [base, quote] = pair.split("-");
  if (!base || !quote) {
    throw new Error(`Invalid pair "${pair}", expected "BASE-QUOTE"`);
  }

  const network = getNetwork();
  const chainId = network.chainId === 42220 ? ChainId.CELO : ChainId.CELO_SEPOLIA;
  const mento = await Mento.create(chainId);

  const tokenIn = tokenFor(network, base);
  const tokenOut = tokenFor(network, quote);

  // Quote 1 unit of tokenIn -> derive an implied rate from the amountOut.
  const oneUnit = parseUnits("1", tokenIn.decimals);
  const amountOut = await mento.quotes.getAmountOut(tokenIn.address, tokenOut.address, oneUnit);
  const rate = Number(formatUnits(amountOut, tokenOut.decimals));

  const samples = history.get(pair) ?? [];
  const now = Date.now();
  samples.push({ ts: now, rate });
  const pruned = samples.filter((s) => now - s.ts <= SAMPLE_WINDOW_MS);
  history.set(pair, pruned);

  const volatility = computeVolatility(pruned.map((s) => s.rate));

  return {
    pair,
    rate,
    volatility,
    sampleCount: pruned.length,
    windowMs: SAMPLE_WINDOW_MS,
  };
}

function computeVolatility(rates: number[]): number {
  if (rates.length < 2) return 0;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  return Math.sqrt(variance) / mean; // coefficient of variation
}
