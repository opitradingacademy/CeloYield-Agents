// Builds the dashboard's snapshot of the system. Polls the signal-agent and
// risk-agent for live data (via x402 mock payment from this server), reads
// the wallet's balance from Blockscout (Sepolia RPCs are unreliable — see
// shared/network.ts note), and pulls recent tx history from Blockscout's API.
//
// Also reads the shared activity log (shared/.activity.jsonl) so the live
// Activity Feed shows what each agent is doing between polls.
//
// Polling happens on a 3-second cadence from the client; this function runs
// per request, no internal caching.

import { AgentStatus, BalanceSnapshot, DashboardState, PoolSnapshot, RecentTransaction, RiskSnapshot, ActivityEvent } from "./types";
import { readRecentActivity } from "../../shared/activity-log";

const SIGNAL_AGENT_URL = process.env.SIGNAL_AGENT_URL || "https://celoyield-signal.vercel.app";
const RISK_AGENT_URL = process.env.RISK_AGENT_URL || "https://celoyield-risk.vercel.app";
const WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS || "0x2254256D89F17789f112335D643F52d3B043dF7E";
export const BLOCKSCOUT_API = "https://celo.blockscout.com/api";
export const EXPLORER_BASE = "https://celo.blockscout.com";

// Mainnet token addresses — see shared/network.ts NETWORKS.mainnet.
const TOKEN_ADDRESSES = {
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
} as const;

async function fetchWithPayment(url: string): Promise<any | null> {
  // First call → 402 → retry with mock payment header (matches shared/x402-mock).
  const res1 = await fetch(url, { cache: "no-store" });
  if (res1.status === 402) {
    const res2 = await fetch(url, {
      cache: "no-store",
      headers: { "x-mock-payment": "paid" },
    });
    if (!res2.ok) return null;
    return res2.json();
  }
  if (!res1.ok) return null;
  return res1.json();
}

async function pingAgent(url: string): Promise<"running" | "stopped"> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? "running" : "stopped";
  } catch {
    return "stopped";
  }
}

async function fetchBalance(): Promise<BalanceSnapshot> {
  try {
    const [celoRes, usdcRes, usdmRes] = await Promise.all([
      fetch(`${BLOCKSCOUT_API}?module=account&action=balance&address=${WALLET_ADDRESS}`).then((r) => r.json()),
      fetch(`${BLOCKSCOUT_API}?module=account&action=tokenbalance&contractaddress=${TOKEN_ADDRESSES.USDC}&address=${WALLET_ADDRESS}`).then((r) => r.json()),
      fetch(`${BLOCKSCOUT_API}?module=account&action=tokenbalance&contractaddress=${TOKEN_ADDRESSES.USDm}&address=${WALLET_ADDRESS}`).then((r) => r.json()),
    ]);
    return {
      celo: celoRes?.result ?? "0",
      usdc: usdcRes?.result ?? "0",
      usdm: usdmRes?.result ?? "0",
    };
  } catch {
    return { celo: "0", usdc: "0", usdm: "0" };
  }
}

async function fetchRecentTxs(): Promise<RecentTransaction[]> {
  try {
    const res = await fetch(
      `${BLOCKSCOUT_API}?module=account&action=txlist&address=${WALLET_ADDRESS}&sort=desc&page=1&offset=8`,
    );
    const data = await res.json();
    return (data?.result ?? []).slice(0, 8).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      blockNumber: Number(tx.blockNumber),
      timestamp: tx.timeStamp,
      method: tx.input?.slice(0, 10) ?? "0x",
      status: Number(tx.txreceipt_status ?? 0),
      isError: Number(tx.isError ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function buildDashboardState(): Promise<DashboardState> {
  // Ping agents in parallel for liveness
  const [signalStatus, riskStatus, signalQuote, riskQuote, balance, recentTransactions] =
    await Promise.all([
      pingAgent(`${SIGNAL_AGENT_URL}/`),
      pingAgent(`${RISK_AGENT_URL}/`),
      fetchWithPayment(`${SIGNAL_AGENT_URL}/api/apy?asset=USDC`),
      fetchWithPayment(`${RISK_AGENT_URL}/api/assess?protocol=Mento&asset=USDC`),
      fetchBalance(),
      fetchRecentTxs(),
    ]);

  // Read the activity log (up to 30 most recent events) so the live feed
  // shows what each agent did since the dashboard last polled.
  const activityEvents = await readRecentActivity(30);

  const pool: PoolSnapshot | null = signalQuote?.bestPool
    ? {
        pair: signalQuote.bestPool.pairLabel,
        lpFeePercent: signalQuote.bestPool.lpFeePercent,
        reserveUsd: signalQuote.bestPool.reserveUsd,
        projectedApyPct: signalQuote.bestPool.projectedApyPct,
        poolAddress: signalQuote.bestPool.poolAddr,
      }
    : null;

  const risk: RiskSnapshot | null = riskQuote
    ? {
        protocol: riskQuote.protocol,
        asset: riskQuote.asset,
        score: riskQuote.score,
        flags: riskQuote.flags ?? [],
        tvlUsd: riskQuote.tvlUsd,
      }
    : null;

  // Agent status — counts of paid calls come from the tx list (approvals +
  // transfers in the wallet's history that targeted the agents). For a quick
  // MVP we estimate from on-chain activity rather than tracking a DB.
  const signalCalls = recentTransactions.filter(
    (tx) => tx.method === "0xa9059cbb" || tx.method === "0x095ea7b3",
  ).length; // rough proxy
  const riskCalls = 0;

  const agents: AgentStatus[] = [
    {
      name: "yield-router-agent",
      role: "Orchestrator (Railway background worker)",
      url: "",
      port: 0,
      feePerCall: 0,
      callsReceived: 0,
      totalEarned: 0,
      status: "running",
    },
    {
      name: "signal-aggregator-agent",
      role: "Mento V3 APY aggregator",
      url: SIGNAL_AGENT_URL,
      port: 3001,
      feePerCall: 0.001,
      callsReceived: signalCalls,
      totalEarned: signalCalls * 0.001,
      status: signalStatus,
    },
    {
      name: "risk-manager-agent",
      role: "Protocol risk scorer",
      url: RISK_AGENT_URL,
      port: 3002,
      feePerCall: 0.002,
      callsReceived: riskCalls,
      totalEarned: riskCalls * 0.002,
      status: riskStatus,
    },
  ];

  return {
    agents,
    recentTransactions,
    activityEvents,
    walletAddress: WALLET_ADDRESS,
    balance,
    pool,
    risk,
    lastUpdated: new Date().toISOString(),
  };
}