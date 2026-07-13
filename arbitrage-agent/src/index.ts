import { Mento, ChainId, deadlineFromMinutes } from "@mento-protocol/mento-sdk";
import { parseUnits, formatUnits } from "viem";
import { getNetwork } from "../../shared/network";
import { ORACLE_PRICE_USD, ASSUMED_GAS_COST_USD } from "../../shared/pricing";
import { createOracleClient } from "./oracle-client";
import { getAgentAccount } from "../../shared/wallet";

const ORACLE_URL = process.env.ORACLE_URL || "http://localhost:3000";
// EURm has no live Sepolia pool (verified against mento.pools.getPools()) —
// USDm-USDC is the pair with confirmed liquidity on testnet.
const PAIR = "USDm-USDC";
const VOLATILITY_THRESHOLD = 0.003; // skip trading if the oracle reports high volatility
const CYCLE_MS = 10_000;
const TRADE_AMOUNT_USDM = process.env.TRADE_AMOUNT_USDM || "10";
const SLIPPAGE_TOLERANCE = 0.5; // percent
// Both tokens in this pair are ~1:1 pegged stablecoins, so any deviation the
// live quote shows above this margin (net of gas + the oracle's own fee) is
// treated as capturable. This is deliberately conservative for an MVP.
const MIN_PROFIT_MARGIN = 0.001;

type Wallet = Awaited<ReturnType<typeof getAgentAccount>>;

async function runCycle(
  oracle: ReturnType<typeof createOracleClient>,
  mento: Mento,
  network: ReturnType<typeof getNetwork>,
  wallet: Wallet,
) {
  // 1. Pay the oracle agent for a fresh volatility read (x402 microtransaction).
  const { rate, volatility } = await oracle.getVolatility(ORACLE_URL, PAIR);
  console.log(`[oracle] ${PAIR} rate=${rate} volatility=${volatility}`);

  if (volatility > VOLATILITY_THRESHOLD) {
    console.log("[skip] volatility too high, sitting this cycle out");
    return;
  }

  // 2. Compare against a live on-chain quote to find a deviation worth capturing.
  const tradeAmountIn = parseUnits(TRADE_AMOUNT_USDM, 18); // USDm is 18 decimals, USDC is 6
  const amountOut = await mento.quotes.getAmountOut(network.usdmToken, network.usdcToken, tradeAmountIn);
  const liveRate = Number(formatUnits(amountOut, 6));
  const deviation = Math.abs(liveRate - rate) / rate;

  console.log(`[quote] live=${liveRate} deviation=${deviation}`);

  // 3. Only execute if the deviation clears gas + the oracle's own fee, expressed
  // as a fraction of this cycle's trade size, plus a minimum profit margin.
  const tradeAmountUsd = Number(TRADE_AMOUNT_USDM); // USDm ~= USD
  const costFraction = (ASSUMED_GAS_COST_USD + ORACLE_PRICE_USD) / tradeAmountUsd;
  const netMargin = deviation - costFraction;

  if (netMargin <= MIN_PROFIT_MARGIN) {
    console.log(
      `[skip] deviation=${deviation.toFixed(6)} net of costs (${costFraction.toFixed(6)}) ` +
        `doesn't clear margin ${MIN_PROFIT_MARGIN}`,
    );
    return;
  }

  console.log(`[trade] net margin ${netMargin.toFixed(6)} clears threshold — executing swap`);

  const owner = wallet.account!.address;
  const { approval, swap } = await mento.swap.buildSwapTransaction(
    network.usdmToken,
    network.usdcToken,
    tradeAmountIn,
    owner,
    owner,
    { slippageTolerance: SLIPPAGE_TOLERANCE, deadline: deadlineFromMinutes(5) },
  );

  if (approval) {
    const approvalHash = await wallet.sendTransaction({
      to: approval.to as `0x${string}`,
      data: approval.data as `0x${string}`,
      value: BigInt(approval.value),
    });
    console.log(`[tx] approval sent: ${approvalHash}`);
  }

  const swapHash = await wallet.sendTransaction({
    to: swap.params.to as `0x${string}`,
    data: swap.params.data as `0x${string}`,
    value: BigInt(swap.params.value),
  });
  console.log(`[tx] swap sent: ${swapHash}`);
}

async function main() {
  const network = getNetwork();
  const chainId = network.chainId === 42220 ? ChainId.CELO : ChainId.CELO_SEPOLIA;
  const mento = await Mento.create(chainId);

  const walletClient = await getAgentAccount("arbitrage-agent-v1");
  const oracle = createOracleClient(walletClient);

  console.log(`Arbitrage agent running on ${network.chainId === 42220 ? "mainnet" : "sepolia"}`);

  setInterval(() => {
    runCycle(oracle, mento, network, walletClient).catch((err) => console.error("[cycle error]", err));
  }, CYCLE_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
