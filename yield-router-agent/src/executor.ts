// Executor: takes a MoveCandidate, finds the live FPMM V3 pool for the pair,
// does the Uniswap-V2-style swap (transfer tokenIn to pool, then call
// swap(amount0Out, amount1Out, to, data) on the pool proxy). Both txs signed
// via Privy using the legacy tx format that bypasses Privy's stale-RPC balance
// check on Celo Sepolia.
//
// IMPORTANT: this replaces the previous Mento SDK `buildSwapTransaction`
// approach, which generated calldata for the V2 Router (`swapExactTokensForTokens`)
// but the V2 Router has no liquidity for V3 FPMM pools on Sepolia, so the swap
// always reverted with "Transfer failed". The real swap path for V3 FPMM is
// two separate txs: ERC20.transfer() then FPMM.swap().
import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  getAddress,
  parseGwei,
  type Address,
  type Hex,
} from "viem";
import { getAgentAccount } from "../../shared/wallet";
import { getNetwork } from "../../shared/network";
import type { MoveCandidate } from "./decision";

export interface SwapResult {
  transferHash: Hex;
  swapHash: Hex;
  expectedOutUsd: number;
}

// Minimal ABI for the FPMM V3 swap function (verified against the on-chain
// contract source via Blockscout — function signature 0x022c0d9f).
const FPMM_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount0Out", type: "uint256" },
      { name: "amount1Out", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

// Hardcoded token decimals — verified on-chain. shared/network.ts only stores
// addresses, not decimals.
const DECIMALS = { USDm: 18, USDC: 6 } as const;

function parseDecimal(value: number, decimals: number): bigint {
  const [intPart, fracPart = ""] = value.toString().split(".");
  const fracPadded = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(intPart + fracPadded);
}

// Locate the FPMM V3 pool for the (tokenIn, tokenOut) pair. We only support
// FPMM pools — Virtual (BiPoolManager) pools are not used by this agent.
async function findFpmPool(
  mento: Mento,
  tokenIn: Address,
  tokenOut: Address,
): Promise<{ poolAddr: Address; token0: Address; token1: Address }> {
  const pools = await mento.pools.getPools();
  for (const pool of pools) {
    if (pool.poolType !== "FPMM") continue;
    const matches =
      (pool.token0.toLowerCase() === tokenIn.toLowerCase() &&
        pool.token1.toLowerCase() === tokenOut.toLowerCase()) ||
      (pool.token0.toLowerCase() === tokenOut.toLowerCase() &&
        pool.token1.toLowerCase() === tokenIn.toLowerCase());
    if (!matches) continue;
    return {
      poolAddr: getAddress(pool.poolAddr),
      token0: getAddress(pool.token0),
      token1: getAddress(pool.token1),
    };
  }
  throw new Error(
    `No FPMM V3 pool found for ${tokenIn} <-> ${tokenOut}. ` +
      `Available FPMM pools: ${pools.filter((p) => p.poolType === "FPMM").length}`,
  );
}

// Read the live reserves from the pool proxy. The pool's swap() requires that
// the caller transfer tokenIn first, so we use the pool's token balanceOf() to
// know what's already in there. amount0Out/amount1Out must be STRICTLY LESS
// than reserve0/reserve1 (else "InsufficientLiquidity" revert).
async function readReserves(
  client: ReturnType<typeof createPublicClient>,
  poolAddr: Address,
  token0: Address,
  token1: Address,
): Promise<{ reserve0: bigint; reserve1: bigint; token0IsTokenIn: boolean }> {
  const [r0, r1] = await Promise.all([
    client.readContract({
      address: token0,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [poolAddr],
    }),
    client.readContract({
      address: token1,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [poolAddr],
    }),
  ]);
  return { reserve0: r0, reserve1: r1, token0IsTokenIn: true /* set by caller */ };
}

export async function executeMove(
  candidate: MoveCandidate & { skipReserveCap?: boolean },
): Promise<SwapResult> {
  const network = getNetwork();
  const mento = await Mento.create(
    network.chainId === 42220 ? ChainId.CELO : ChainId.CELO_SEPOLIA,
  );

  const ADDRESSES = {
    USDm: network.usdmToken as Address,
    USDC: network.usdcToken as Address,
  } as const;
  const tokenIn = ADDRESSES[candidate.fromToken];
  const tokenOut = ADDRESSES[candidate.toToken];
  const decimalsIn = DECIMALS[candidate.fromToken];
  const decimalsOut = DECIMALS[candidate.toToken];

  const amountIn = parseDecimal(candidate.amountInUsd, decimalsIn);

  // 1. Locate the FPMM pool for this pair
  const pool = await findFpmPool(mento, tokenIn, tokenOut);
  console.log(`[executor] found FPMM pool: ${pool.poolAddr}`);

  const publicClient = createPublicClient({
    chain: network.chainId === 42220 ? (await import("viem/chains")).celo : (await import("viem/chains")).celoSepolia,
    transport: http(network.rpcUrl),
  }) as any;

  // 2. Get a quote from the SDK (uses FPMM correctly, unlike buildSwapTransaction)
  const expectedOut = await mento.quotes.getAmountOut(tokenIn, tokenOut, amountIn);
  console.log(
    `[executor] quote: ${candidate.amountInUsd} ${candidate.fromToken} -> ${Number(expectedOut) / 10 ** decimalsOut} ${candidate.toToken}`,
  );

  // 3. Cap expectedOut to a fraction of the available reserve to avoid
  // "InsufficientLiquidity" (Sepolia pools have tiny reserves — sub-dollar).
  // We use 30% of the relevant reserve as the max; on mainnet this fraction
  // could go to 100% but here we trade off for safety. Skip via the
  // `skipReserveCap` flag (used by the dashboard button for demo swaps).
  let cappedExpectedOut = expectedOut;
  const tokenInIsToken0 = tokenIn.toLowerCase() === pool.token0.toLowerCase();
  if (!candidate.skipReserveCap) {
    try {
      const { reserve0, reserve1 } = await readReserves(
        publicClient,
        pool.poolAddr,
        pool.token0,
        pool.token1,
      );
      const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;
      const SAFETY_FRACTION = 0.3;
      const maxOut = (reserveOut * BigInt(Math.floor(SAFETY_FRACTION * 1000))) / 1000n;
      cappedExpectedOut = expectedOut > maxOut ? maxOut : expectedOut;
      if (cappedExpectedOut < expectedOut) {
        console.log(`[executor] capped expectedOut from ${expectedOut} to ${cappedExpectedOut} (pool reserve too thin)`);
      }
    } catch (e: any) {
      console.log(`[executor] readReserves failed (${e?.message?.slice(0, 60)}), using full expectedOut`);
    }
  }

  // 4. Get a wallet (yields `sendTransactionLegacy` that bypasses Privy's
  // stale-RPC balance check on Celo Sepolia).
  const wallet = await getAgentAccount("yield-router-agent-v1");
  const owner = wallet.account!.address as Address;

  // 5. Read current nonce from the public RPC (Tenderly), not Privy/forno.
  const nonce1 = BigInt(await publicClient.getTransactionCount({ address: owner }));

  // 6. Tx 1: transfer tokenIn to the pool proxy
  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [pool.poolAddr, amountIn],
  });

  console.log(`[executor] step 1: transfer ${candidate.amountInUsd} ${candidate.fromToken} to pool`);
  const transferHash = await wallet.sendTransactionLegacy({
    to: tokenIn,
    data: transferData,
    value: 0n,
    gas: 100_000n,
    gasPrice: parseGwei("5"),
    nonce: nonce1,
  });
  console.log(`[executor] transfer hash: ${transferHash}`);
  console.log(`[executor] explorer: https://celo-sepolia.blockscout.com/tx/${transferHash}`);

  // 7. Wait for the transfer to settle so the pool sees the new balance.
  // The pool's swap() checks balanceOf() vs reserve0/reserve1 to compute
  // amountIn — if we call swap before the transfer is mined, it'll think
  // amountIn = 0 and revert with "InsufficientInputAmount".
  console.log(`[executor] waiting 8s for transfer to settle...`);
  await new Promise((r) => setTimeout(r, 8000));

  // 8. Tx 2: call swap on the pool proxy
  // amount0Out / amount1Out: only the output token gets a non-zero value.
  // token0 is the lower address — match that to decide which arg to fill.
  const swapData = encodeFunctionData({
    abi: FPMM_ABI,
    functionName: "swap",
    args: [
      tokenInIsToken0 ? 0n : cappedExpectedOut,
      tokenInIsToken0 ? cappedExpectedOut : 0n,
      owner,
      "0x" as Hex,
    ],
  });

  const nonce2 = BigInt(await publicClient.getTransactionCount({ address: owner }));

  console.log(`[executor] step 2: call swap() to receive ${candidate.toToken}`);
  const swapHash = await wallet.sendTransactionLegacy({
    to: pool.poolAddr,
    data: swapData,
    value: 0n,
    gas: 300_000n,
    gasPrice: parseGwei("5"),
    nonce: nonce2,
  });
  console.log(`[executor] swap hash: ${swapHash}`);
  console.log(`[executor] explorer: https://celo-sepolia.blockscout.com/tx/${swapHash}`);

  return {
    transferHash,
    swapHash,
    expectedOutUsd: candidate.expectedOutUsd,
  };
}