// Yield router agent — main loop.
//
// Polls the live USDm ↔ USDC rate on Mento every CYCLE_MS, calls the
// signal-aggregator-agent (paid via x402 mock, $0.001) for an APY snapshot,
// and the risk-manager-agent ($0.002) for a safety score on the target
// protocol+asset. If the deviation clears costs (signal fee + risk fee + gas)
// plus a minimum edge, and the risk score is acceptable, propose a move.
//
// Every step writes to shared/.activity.jsonl so the dashboard's Activity
// Feed can show the agents working in real time. The local decisions.log
// keeps a verbose audit trail (every line + tx hash) for offline debugging.
import * as readline from "node:readline";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ApyFetcher } from "./apy-fetcher";
import { evaluateMove, type MoveCandidate } from "./decision";
import { executeMove, type SwapResult } from "./executor";
import { fetchWithPayment, fetchWithPaymentReal } from "../../shared/x402-mock";
import { fetchWithFacilitatorPayment } from "../../shared/x402-facilitator";

const X402_MODE = process.env.X402_MODE ?? "mock";
const YIELD_ROUTER_WALLET_ID = "yield-router-agent-v1";

async function pay(url: string): Promise<Response> {
  if (X402_MODE === "facilitator") return fetchWithFacilitatorPayment(url, YIELD_ROUTER_WALLET_ID);
  if (X402_MODE === "live") return fetchWithPaymentReal(url, YIELD_ROUTER_WALLET_ID);
  return fetchWithPayment(url);
}
import { logActivity } from "../../shared/activity-log";
import { getNetwork } from "../../shared/network";
import { estimateGasCostUsd } from "../../shared/pricing";
import type { Address } from "viem";

const CYCLE_MS = Number(process.env.YIELD_CYCLE_MS ?? "10000");
const TRADE_AMOUNT_USD = Number(process.env.TRADE_AMOUNT_USDM ?? "10");
const EXPECTED_PEG = 1.0;
const SIGNAL_AGENT_URL =
  process.env.SIGNAL_AGENT_URL || "http://localhost:3001";
const RISK_AGENT_URL =
  process.env.RISK_AGENT_URL || "http://localhost:3002";
const MIN_RISK_SCORE = Number(process.env.MIN_RISK_SCORE ?? "60");
const AUTO_APPROVE = process.env.AUTO_APPROVE === "true";

const LOG_FILE = join(process.cwd(), "yield-router-agent", "decisions.log");

function log(line: string) {
  const ts = new Date().toISOString();
  const fullLine = `[${ts}] ${line}\n`;
  process.stdout.write(fullLine);
  try {
    appendFileSync(LOG_FILE, fullLine);
  } catch {
    // best-effort
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

interface SignalResponse {
  asset: string;
  bestPool: { pairLabel: string; lpFeePct: number; projectedApyPct: number } | null;
  observations: unknown[];
}

interface RiskResponse {
  score: number;
  flags: string[];
  reasoning: string;
}

async function callSignalAgent(asset: string): Promise<SignalResponse | null> {
  const start = Date.now();
  try {
    const res = await pay(`${SIGNAL_AGENT_URL}/api/apy?asset=${encodeURIComponent(asset)}`);
    const ms = Date.now() - start;
    if (!res.ok) {
      logActivity({ agent: "yield-router", type: "error", message: `signal-agent HTTP ${res.status} (${ms}ms)` });
      return null;
    }
    const data = (await res.json()) as SignalResponse;
    const pair = data.bestPool?.pairLabel ?? "none";
    const apy = data.bestPool?.projectedApyPct?.toFixed(3) ?? "0";
    logActivity({
      agent: "yield-router",
      type: "signal-paid",
      message: `Paid signal-aggregator-agent $0.001 → ${pair} @ ${apy}% projected APY (${ms}ms)`,
      data: { ms, pair, apy, fee: 0.001 },
    });
    return data;
  } catch (e: any) {
    logActivity({ agent: "yield-router", type: "error", message: `signal-agent unreachable: ${e?.message ?? e}` });
    return null;
  }
}

async function callRiskAgent(protocol: string, asset: string): Promise<RiskResponse | null> {
  const start = Date.now();
  try {
    const res = await pay(
      `${RISK_AGENT_URL}/api/assess?protocol=${encodeURIComponent(protocol)}&asset=${encodeURIComponent(asset)}`,
    );
    const ms = Date.now() - start;
    if (!res.ok) {
      logActivity({ agent: "yield-router", type: "error", message: `risk-agent HTTP ${res.status} (${ms}ms)` });
      return null;
    }
    const data = (await res.json()) as RiskResponse;
    logActivity({
      agent: "yield-router",
      type: "risk-paid",
      message: `Paid risk-manager-agent $0.002 → ${protocol}/${asset} scored ${data.score}/100 (${ms}ms)`,
      data: { ms, score: data.score, protocol, asset, fee: 0.002 },
    });
    return data;
  } catch (e: any) {
    logActivity({ agent: "yield-router", type: "error", message: `risk-agent unreachable: ${e?.message ?? e}` });
    return null;
  }
}

async function runCycle(fetcher: ApyFetcher) {
  const network = getNetwork();
  const USDm = network.usdmToken as Address;
  const USDC = network.usdcToken as Address;

  // 1. Live quote from Mento (local, free)
  const quote = await fetcher.fetchQuote(USDm, USDC, 18, 6);
  const volatility = fetcher.rollingVolatility(quote.pair);
  log(`[poll] USDm/USDC rate=${quote.rate.toFixed(6)} volatility=${volatility.toFixed(6)}`);
  logActivity({
    agent: "yield-router",
    type: "poll",
    message: `Polled Mento: 1 USDm = ${quote.rate.toFixed(6)} USDC (volatility ${(volatility * 100).toFixed(4)}%)`,
    data: { rate: quote.rate, volatility },
  });

  // 2. Pre-decision: ask signal-agent for context (x402 mock, $0.001)
  log(`[x402] calling signal-aggregator-agent for USDC APY snapshot...`);
  const signal = await callSignalAgent("USDC");

  // 3. Pre-decision: ask risk-agent about Mento+USDC (x402 mock, $0.002)
  log(`[x402] calling risk-manager-agent for Mento+USDC assessment...`);
  const risk = await callRiskAgent("Mento", "USDC");

  if (risk && risk.score < MIN_RISK_SCORE) {
    logActivity({
      agent: "yield-router",
      type: "skip",
      message: `Skipping cycle — risk score ${risk.score} below threshold ${MIN_RISK_SCORE}`,
      data: { score: risk.score, threshold: MIN_RISK_SCORE },
    });
    return;
  }

  // 4. Local decision: is the rate deviation worth the costs + edge?
  // Gas cost is a live estimate (real gas price × real CELO/USD rate) —
  // a flat guess here could approve swaps that lose money net of actual gas.
  const gasCostUsd = await estimateGasCostUsd();
  const candidate = evaluateMove(quote, EXPECTED_PEG, TRADE_AMOUNT_USD, gasCostUsd);
  if (!candidate) {
    const deviation = Math.abs(quote.rate - 1.0) * 100;
    logActivity({
      agent: "yield-router",
      type: "skip",
      message: `No profitable move (deviation ${deviation.toFixed(4)}% < costs incl. $${gasCostUsd.toFixed(4)} gas + min edge)`,
      data: { deviation: quote.rate - 1.0, gasCostUsd, minEdge: 0.001 },
    });
    return;
  }

  log(`[proposal] ${candidate.reason}`);
  log(
    `[proposal] Move: swap ${candidate.amountInUsd} ${candidate.fromToken} → ${candidate.toToken} (expect ≈${candidate.expectedOutUsd.toFixed(4)} ${candidate.toToken})`,
  );
  logActivity({
    agent: "yield-router",
    type: "quote",
    message: `PROPOSAL: swap ${candidate.amountInUsd} ${candidate.fromToken} → ${candidate.toToken} (edge ${(candidate.netEdgePct * 100).toFixed(3)}%)`,
    data: { from: candidate.fromToken, to: candidate.toToken, edge: candidate.netEdgePct },
  });

  // 5. Operator approval
  let approved = AUTO_APPROVE;
  if (!AUTO_APPROVE) {
    const answer = await prompt(`Approve? (go/skip): `);
    approved = answer === "go" || answer === "y" || answer === "yes";
  } else {
    logActivity({
      agent: "yield-router",
      type: "info",
      message: `AUTO_APPROVE=true — proceeding without confirmation`,
    });
  }

  if (!approved) {
    log(`[skip] operator declined`);
    logActivity({ agent: "yield-router", type: "skip", message: "Operator declined proposal" });
    return;
  }

  // 6. Execute: build tx, sign via Privy, broadcast
  log(`[execute] building and signing tx via Privy…`);
  logActivity({ agent: "yield-router", type: "info", message: "Executing swap via Privy MPC…" });
  try {
    const result = await executeMove(candidate);
    log(`[ok] swap executed: transfer=${result.transferHash} swap=${result.swapHash}`);
    logActivity({
      agent: "yield-router",
      type: "swap",
      message: `Swap executed: ${candidate.amountInUsd} ${candidate.fromToken} → ${result.expectedOutUsd.toFixed(4)} ${candidate.toToken}`,
      data: {
        transferHash: result.transferHash,
        swapHash: result.swapHash,
        expectedOutUsd: result.expectedOutUsd,
      },
    });
  } catch (e: any) {
    log(`[error] ${e?.message ?? e}`);
    logActivity({
      agent: "yield-router",
      type: "error",
      message: `Swap failed: ${e?.message?.slice(0, 100) ?? e}`,
    });
  }
}

async function main() {
  const fetcher = new ApyFetcher();
  const network = getNetwork();
  log(
    `[start] yield-router-agent on chainId=${network.chainId} tradeAmount=${TRADE_AMOUNT_USD}USD cycleMs=${CYCLE_MS}`,
  );
  log(`[start] signal=${SIGNAL_AGENT_URL} risk=${RISK_AGENT_URL} minRisk=${MIN_RISK_SCORE}`);
  logActivity({
    agent: "yield-router",
    type: "info",
    message: `yield-router-agent started (chainId=${network.chainId}, cycleMs=${CYCLE_MS}, AUTO_APPROVE=${AUTO_APPROVE})`,
  });

  await runCycle(fetcher).catch((e) => {
    log(`[cycle error] ${e?.message ?? e}`);
    logActivity({ agent: "yield-router", type: "error", message: `cycle error: ${e?.message ?? e}` });
  });
  setInterval(() => {
    runCycle(fetcher).catch((e) => {
      log(`[cycle error] ${e?.message ?? e}`);
      logActivity({ agent: "yield-router", type: "error", message: `cycle error: ${e?.message ?? e}` });
    });
  }, CYCLE_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});