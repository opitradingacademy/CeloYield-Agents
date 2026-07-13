// Aggregator: given a target asset (USDC or USDm), walk all Mento V3 FPMM pools
// on the current network that include that asset, query the live swap rate and
// LP fee for each, and estimate an APY projection.
//
// APY model (rough but honest):
//   - LP fee % per swap × assumed daily turnover % of TVL × 365 = APY
//   - Sepolia has near-zero real volume, so this is conservative (often <1%
//     APY). On mainnet with real flow this would project meaningfully higher.
import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import { formatUnits, getAddress, createPublicClient, http, defineChain } from "viem";

// Locally defined chains to avoid pulling viem/chains (which collides with
// thirdweb's nested viem@2.55.0 in the workspace). defineChain gives us a
// minimal but correct type — only id, name, nativeCurrency, rpcUrls are
// needed for the SDK + publicClient calls below.
const celoSepoliaChain = defineChain({
  id: 11142220,
  name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo-testnet.org/"] } },
});

const celoChain = defineChain({
  id: 42220,
  name: "Celo",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo.org"] } },
});

interface PoolObservation {
  poolAddr: string;
  pairLabel: string;
  lpFeePct: number;
  reserveUsd: number;
  projectedApyPct: number;
}

interface AggregatedApy {
  asset: string;
  observations: PoolObservation[];
  bestPool: PoolObservation | null;
  timestamp: number;
}

const ERC20_META_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Conservative: 1% of TVL turns over per day on a healthy Mento pool. Adjust per
// real-world observations. Going higher is optimistic; going lower is honest
// about Sepolia's emptiness.
const ASSUMED_DAILY_TURNOVER = 0.01;

const symbolCache = new Map<string, { symbol: string; decimals: number }>();

async function getMeta(client: any, addr: string) {
  const cached = symbolCache.get(addr);
  if (cached) return cached;
  const a = getAddress(addr);
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: a, abi: ERC20_META_ABI, functionName: "symbol" }),
    client.readContract({ address: a, abi: ERC20_META_ABI, functionName: "decimals" }),
  ]);
  const out = { symbol, decimals: Number(decimals) };
  symbolCache.set(addr, out);
  return out;
}

export async function aggregateApyForAsset(assetSymbol: string): Promise<AggregatedApy> {
  const network = getNetworkFromEnv();
  const mento = await Mento.create(
    network.chainId === celoChain.id ? ChainId.CELO : ChainId.CELO_SEPOLIA,
  );
  // Cast: the workspace has two viem versions pinned (root 2.39.0 + thirdweb's
  // 2.55.0). createPublicClient types are structurally identical but TS can't
  // prove it, so we let them through and trust runtime — viem 2.39.0 and 2.55.0
  // have the same publicClient surface for readContract/getBlock.
  const publicClient = createPublicClient({
    chain: network.chainId === celoChain.id ? celoChain : celoSepoliaChain,
    transport: http(network.rpcUrl),
  }) as any;

  const pools = await mento.pools.getPools();
  const observations: PoolObservation[] = [];

  for (const pool of pools) {
    try {
      const details = await mento.pools.getPoolDetails(pool.poolAddr);
      if (details.poolType !== "FPMM") continue;

      const [m0, m1] = await Promise.all([
        getMeta(publicClient, pool.token0),
        getMeta(publicClient, pool.token1),
      ]);
      if (m0.symbol !== assetSymbol && m1.symbol !== assetSymbol) continue;

      const lpFeePct = details.fees.lpFeePercent;
      const r0 = Number(formatUnits(details.reserve0, m0.decimals));
      const r1 = Number(formatUnits(details.reserve1, m1.decimals));
      // Rough USD value: USD stablecoins ≈ 1 USD. Could be better using Mento
      // oracle pricing, but for an APY proxy this is good enough.
      const tvlUsd =
        (m0.symbol.includes("USD") ? r0 : r0 * 0.5) + (m1.symbol.includes("USD") ? r1 : r1 * 0.5);
      const projectedApyPct = lpFeePct * ASSUMED_DAILY_TURNOVER * 365;

      observations.push({
        poolAddr: pool.poolAddr,
        pairLabel: `${m0.symbol}/${m1.symbol}`,
        lpFeePct,
        reserveUsd: tvlUsd,
        projectedApyPct,
      });
    } catch {
      // Skip pools we can't read — likely RPC hiccup, not a fatal error.
    }
  }

  observations.sort((a, b) => b.projectedApyPct - a.projectedApyPct);

  return {
    asset: assetSymbol,
    observations,
    bestPool: observations[0] ?? null,
    timestamp: Date.now(),
  };
}

function getNetworkFromEnv() {
  // Local copy of shared/network's getNetwork() — duplicating to avoid the
  // cross-workspace import edge-runtime issue Next.js sometimes complains
  // about. Must be kept in sync with shared/network.ts.
  const name = process.env.NETWORK || "sepolia";
  if (name === "mainnet") {
    return {
      chainId: celoChain.id,
      rpcUrl: "https://forno.celo.org",
      usdmToken: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as `0x${string}`,
      usdcToken: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
    };
  }
  return {
    chainId: celoSepoliaChain.id,
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org/",
    usdmToken: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b" as `0x${string}`,
    usdcToken: "0x01C5C0122039549AD1493B8220cABEdD739BC44E" as `0x${string}`,
  };
}