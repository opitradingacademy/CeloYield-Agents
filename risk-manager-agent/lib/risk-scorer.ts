// Risk scorer: given a (protocol, asset) pair, return a 0-100 safety score
// plus a list of flags. Stateless — every call recomputes from on-chain truth
// (current TVL, recent pool activity) plus a small static "audit status" table.
//
// This is intentionally simple. Real risk management would pull:
//   - Historical exploit database (Rekt News, De.Fi)
//   - On-chain audit verification (e.g. from celo security registry)
//   - Governance / multisig composition
//   - Insurance fund size (Nexus Mutual, etc.)
// For a hackathon MVP, a coarse score from live TVL + a few static audit flags
// is enough to demonstrate the agent-cooperation pattern.
import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import { formatUnits, getAddress, createPublicClient, http, defineChain } from "viem";

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

interface RiskAssessment {
  protocol: string;
  asset: string;
  score: number; // 0 = do not touch, 100 = safe
  flags: string[];
  tvlUsd: number | null;
  reasoning: string;
  timestamp: number;
}

// Audit status table — known Celo protocols with verified audit info.
// Unknown protocols get a neutral score with a warning flag.
const KNOWN_PROTOCOLS: Record<string, { audited: boolean; auditBy?: string; launchYear?: number }> = {
  Mento: {
    audited: true,
    auditBy: "OpenZeppelin, Certora",
    launchYear: 2023,
  },
  Moola: {
    audited: true,
    auditBy: "OpenZeppelin, Trail of Bits (Aave v2 ancestry)",
    launchYear: 2021,
  },
  Ubeswap: {
    audited: true,
    auditBy: "OpenZeppelin",
    launchYear: 2021,
  },
};

const ERC20_META_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export async function assessRisk(protocol: string, asset: string): Promise<RiskAssessment> {
  const normalizedProtocol = protocol.charAt(0).toUpperCase() + protocol.slice(1).toLowerCase();
  const known = KNOWN_PROTOCOLS[normalizedProtocol];
  const flags: string[] = [];
  let score = 50; // neutral baseline

  // Protocol-level scoring
  if (!known) {
    flags.push("UNKNOWN_PROTOCOL: not in audit registry, treat with caution");
    score -= 20;
  } else {
    score += 30;
    if (known.audited) {
      score += 15;
      flags.push(`AUDITED by ${known.auditBy}`);
    }
    if (known.launchYear && known.launchYear >= 2023) {
      flags.push(`YOUNG_PROTOCOL: launched ${known.launchYear} — limited battle-testing`);
    }
  }

  // On-chain TVL proxy: sum reserves across all Mento pools that include this
  // asset. Only meaningful for "Mento" protocol; for others, TVL is unknown.
  let tvlUsd: number | null = null;
  if (normalizedProtocol === "Mento") {
    try {
      const network = getNetworkFromEnv();
      const mento = await Mento.create(
        network.chainId === celoChain.id ? ChainId.CELO : ChainId.CELO_SEPOLIA,
      );
      const publicClient = createPublicClient({
        chain: network.chainId === celoChain.id ? celoChain : celoSepoliaChain,
        transport: http(network.rpcUrl),
      }) as any;

      const pools = await mento.pools.getPools();
      let total = 0;
      for (const pool of pools) {
        try {
          const details = await mento.pools.getPoolDetails(pool.poolAddr);
          if (details.poolType !== "FPMM") continue;
          const [s0, s1] = await Promise.all([
            publicClient.readContract({
              address: getAddress(pool.token0),
              abi: ERC20_META_ABI,
              functionName: "symbol",
            }),
            publicClient.readContract({
              address: getAddress(pool.token1),
              abi: ERC20_META_ABI,
              functionName: "symbol",
            }),
          ]);
          if (s0 !== asset && s1 !== asset) continue;
          const d0 = await publicClient.readContract({
            address: getAddress(pool.token0),
            abi: ERC20_META_ABI,
            functionName: "decimals",
          });
          const d1 = await publicClient.readContract({
            address: getAddress(pool.token1),
            abi: ERC20_META_ABI,
            functionName: "decimals",
          });
          const r0 = Number(formatUnits(details.reserve0, Number(d0)));
          const r1 = Number(formatUnits(details.reserve1, Number(d1)));
          total += r0 + r1; // both ≈ 1 USD for stables
        } catch {
          // skip
        }
      }
      tvlUsd = total;
      if (total < 1000) {
        flags.push(`LOW_TVL: only $${total.toFixed(2)} of ${asset} across Mento pools — slippage risk`);
        score -= 20;
      } else if (total < 100000) {
        flags.push(`MODERATE_TVL: $${total.toFixed(0)} of ${asset} — OK for small trades`);
        score -= 5;
      } else {
        flags.push(`HEALTHY_TVL: $${total.toFixed(0)} of ${asset}`);
        score += 5;
      }
    } catch {
      flags.push("TVL_QUERY_FAILED: could not read on-chain reserves");
      score -= 10;
    }
  } else if (normalizedProtocol === "Moola") {
    flags.push("MOOLA_NOT_ON_SEPOLIA: only mainnet, Moola Market absent from testnet");
    if (process.env.NETWORK === "sepolia" || !process.env.NETWORK) {
      score = 0; // can't use Moola on Sepolia
    }
  } else {
    flags.push("TVL_UNKNOWN: only Mento pools are scanned in this MVP");
  }

  // Clamp to [0, 100]
  score = Math.max(0, Math.min(100, score));

  const reasoning =
    score >= 80
      ? "Looks safe for the requested asset. Audited, healthy TVL."
      : score >= 50
      ? "Acceptable risk. Review flags before sizing the position."
      : "High risk. Multiple red flags or unknown protocol. Avoid or size very small.";

  return {
    protocol: normalizedProtocol,
    asset: asset.toUpperCase(),
    score,
    flags,
    tvlUsd,
    reasoning,
    timestamp: Date.now(),
  };
}

function getNetworkFromEnv() {
  const name = process.env.NETWORK || "sepolia";
  if (name === "mainnet") {
    return {
      chainId: celoChain.id,
      rpcUrl: "https://forno.celo.org",
    };
  }
  return {
    chainId: celoSepoliaChain.id,
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org/",
  };
}