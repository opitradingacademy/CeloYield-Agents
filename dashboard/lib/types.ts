// Shared types between server actions and the dashboard client components.
// These mirror the shapes returned by /api/state and /api/swap endpoints.

export interface AgentStatus {
  name: string;
  role: string;
  url: string;
  port: number;
  feePerCall: number;
  callsReceived: number;
  totalEarned: number;
  status: "running" | "stopped" | "error";
  lastActivity?: string;
}

export interface PoolSnapshot {
  pair: string;
  lpFeePercent: number;
  reserveUsd: number;
  projectedApyPct: number;
  poolAddress: string;
}

export interface RiskSnapshot {
  protocol: string;
  asset: string;
  score: number;
  flags: string[];
  tvlUsd: number | null;
}

export interface BalanceSnapshot {
  celo: string;
  usdc: string;
  usdm: string;
}

export interface DashboardState {
  agents: AgentStatus[];
  recentTransactions: RecentTransaction[];
  activityEvents: ActivityEvent[];
  walletAddress: string;
  balance: BalanceSnapshot;
  pool: PoolSnapshot | null;
  risk: RiskSnapshot | null;
  totalPaidUsd: number;
  lastUpdated: string;
}

export interface RecentTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: number;
  timestamp: string;
  method: string;
  status: number;
  isError: number;
}

export interface ActivityEvent {
  id: string;
  ts: string;
  agent: "signal-aggregator" | "risk-manager" | "yield-router" | "system";
  type: "info" | "pay" | "quote" | "swap" | "skip" | "error" | "poll" | "signal-paid" | "risk-paid";
  message: string;
  txHash?: string;
  data?: Record<string, unknown>;
}