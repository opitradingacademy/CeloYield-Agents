// Quick reconnaissance: list every live FPMM pool on Celo Sepolia with its token
// addresses, symbols, and a live rate. This tells us what yield sources might
// exist (LP positions in Mento = LP rewards distributed from Mento's reserve).
//
// Run with: npx tsx shared/recon-sepolia-pools.ts
import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import { formatUnits, getAddress, createPublicClient } from "viem";
import { celoSepolia } from "viem/chains";
import { http } from "viem";

const ERC20_META_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: celoSepolia,
  transport: http("https://forno.celo-sepolia.celo-testnet.org/"),
});

async function main() {
  const mento = await Mento.create(ChainId.CELO_SEPOLIA);
  const pools = await mento.pools.getPools();

  console.log(`Found ${pools.length} pools on Celo Sepolia:\n`);

  const symCache = new Map<string, { symbol: string; decimals: number }>();
  async function meta(addr: string) {
    const cached = symCache.get(addr);
    if (cached) return cached;
    const a = getAddress(addr);
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address: a, abi: ERC20_META_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: a, abi: ERC20_META_ABI, functionName: "decimals" }),
    ]);
    const out = { symbol, decimals: Number(decimals) };
    symCache.set(addr, out);
    return out;
  }

  for (const pool of pools) {
    try {
      const t0 = pool.token0;
      const t1 = pool.token1;
      const [m0, m1] = await Promise.all([meta(t0), meta(t1)]);

      const oneA = BigInt(10) ** BigInt(m0.decimals);
      const out = await mento.quotes.getAmountOut(t0, t1, oneA);
      const rate = Number(formatUnits(out, m1.decimals));

      console.log(`Pool: ${m0.symbol}/${m1.symbol}  type=${pool.poolType}  addr=${pool.poolAddr}`);
      console.log(`  ${t0} <-> ${t1}`);
      console.log(`  1 ${m0.symbol} = ${rate} ${m1.symbol}`);
      console.log();
    } catch (e: any) {
      console.log(`Pool ${pool.poolAddr} (error): ${e?.message ?? e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});