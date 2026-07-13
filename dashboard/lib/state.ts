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

import { createPublicClient, http, erc20Abi } from "viem";
import { celo } from "viem/chains";
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

// Dedicated per-agent wallets — see CLAUDE.md "All 3 agents shared one Privy
// wallet" gotcha (fixed 2026-07-13).
const SIGNAL_WALLET = "0x7318805D1E79a5A08A26214dCB99C5F07dCD578a";
const RISK_WALLET = "0x5314540B295596754BF5aEEd351C8d38dD884548";
const NATIVE_TAGGED_METHOD = "0x63656c6f"; // withAttributionTag() calldata prefix on self-facilitated native transfers

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

// Blockscout's tokenbalance endpoint reports stale ERC-20 balances for this
// wallet on Celo mainnet (confirmed: reported 0 USDC via API while a direct
// RPC balanceOf() call returned 2076324, i.e. 2.076324 USDC — the same kind
// of stale-RPC/indexer issue previously seen on Celo Sepolia, now hitting
// Blockscout's mainnet API instead). Native CELO balance via Blockscout is
// accurate, so only token balances are read via direct RPC.
const RPC_CLIENT = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

async function fetchBalance(): Promise<BalanceSnapshot> {
  try {
    const [celoRes, usdc, usdm] = await Promise.all([
      fetch(`${BLOCKSCOUT_API}?module=account&action=balance&address=${WALLET_ADDRESS}`).then((r) => r.json()),
      RPC_CLIENT.readContract({
        address: TOKEN_ADDRESSES.USDC as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [WALLET_ADDRESS as `0x${string}`],
      }),
      RPC_CLIENT.readContract({
        address: TOKEN_ADDRESSES.USDm as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [WALLET_ADDRESS as `0x${string}`],
      }),
    ]);
    return {
      celo: celoRes?.result ?? "0",
      usdc: usdc.toString(),
      usdm: usdm.toString(),
    };
  } catch {
    return { celo: "0", usdc: "0", usdm: "0" };
  }
}

// Ground-truth payment counts, read directly from chain history instead of
// the activity log. The activity log is a Redis list capped at 200 entries
// (shared/activity-log.ts LTRIM) and this dashboard only reads the most
// recent 30 of those — so any counter derived from it (calls, totalEarned,
// "Total paid to other agents") silently shrinks as older signal-paid/
// risk-paid events get evicted by newer poll/skip/quote events, even though
// the underlying payments are still real and permanent on-chain. Counting
// straight from Blockscout removes that windowing effect.
async function fetchPaymentCounts(): Promise<{ signalCalls: number; riskCalls: number }> {
  try {
    const [usdcRes, nativeRes] = await Promise.all([
      fetch(
        `${BLOCKSCOUT_API}?module=account&action=tokentx&address=${WALLET_ADDRESS}&sort=desc&page=1&offset=500`,
      ).then((r) => r.json()),
      fetch(
        `${BLOCKSCOUT_API}?module=account&action=txlist&address=${WALLET_ADDRESS}&sort=desc&page=1&offset=500`,
      ).then((r) => r.json()),
    ]);

    const usdcTxs: any[] = usdcRes?.result ?? [];
    const nativeTxs: any[] = nativeRes?.result ?? [];

    const isFromRouter = (t: any) => t.from?.toLowerCase() === WALLET_ADDRESS.toLowerCase();
    const isUsdc = (t: any) => t.contractAddress?.toLowerCase() === TOKEN_ADDRESSES.USDC.toLowerCase();
    const isTaggedNative = (t: any) => (t.input ?? "").toLowerCase().startsWith(NATIVE_TAGGED_METHOD);

    const countTo = (addr: string) =>
      usdcTxs.filter((t) => isFromRouter(t) && isUsdc(t) && t.to?.toLowerCase() === addr.toLowerCase()).length +
      nativeTxs.filter(
        (t) => isFromRouter(t) && isTaggedNative(t) && t.to?.toLowerCase() === addr.toLowerCase(),
      ).length;

    return {
      signalCalls: countTo(SIGNAL_WALLET),
      riskCalls: countTo(RISK_WALLET),
    };
  } catch {
    return { signalCalls: 0, riskCalls: 0 };
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
  const [signalStatus, riskStatus, signalQuote, riskQuote, balance, recentTransactions, paymentCounts] =
    await Promise.all([
      pingAgent(`${SIGNAL_AGENT_URL}/`),
      pingAgent(`${RISK_AGENT_URL}/`),
      fetchWithPayment(`${SIGNAL_AGENT_URL}/api/apy?asset=USDC`),
      fetchWithPayment(`${RISK_AGENT_URL}/api/assess?protocol=Mento&asset=USDC`),
      fetchBalance(),
      fetchRecentTxs(),
      fetchPaymentCounts(),
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

  // Agent status — counts of paid calls come from fetchPaymentCounts(), a
  // direct Blockscout tally of USDC (facilitator mode) and tagged native
  // CELO (live mode) transfers to each agent's wallet. Not derived from the
  // activity log: that's a Redis list capped at 200 entries and this
  // dashboard only reads the latest 30, so a log-derived count silently
  // shrinks as older signal-paid/risk-paid events get evicted — even though
  // the payments themselves are permanent on-chain.
  const { signalCalls, riskCalls } = paymentCounts;

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
    totalPaidUsd: signalCalls * 0.001 + riskCalls * 0.002,
    lastUpdated: new Date().toISOString(),
  };
}