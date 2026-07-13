// Decision logic: given a current rate for a pair, decide whether to propose
// moving capital. Returns null if no action is worthwhile; otherwise returns
// a candidate move the executor can build into a swap tx.
//
// The model is intentionally simple: if the live rate deviates from the
// expected peg (1.0 for stablecoin pairs) by more than (gas + signal-fee +
// min-profit-margin), propose a move. We trade stablecoin ↔ stablecoin, so the
// "edge" is captured by the deviation itself plus whatever LP yield comes from
// being on the better side.
import type { PairQuote } from "./apy-fetcher";

export interface MoveCandidate {
  fromToken: "USDm" | "USDC";
  toToken: "USDm" | "USDC";
  amountInUsd: number;
  expectedRate: number;
  expectedOutUsd: number;
  reason: string;
  netEdgePct: number;
}

// Costs expressed as fractions of trade size. Kept in this module so the
// yield-router can tune without touching the shared pricing.ts (which still
// owns the oracle-side fee and live gas estimate).
const SIGNAL_FEE_USD = 0.001; // pays signal-aggregator-agent per call
const RISK_FEE_USD = 0.002;   // pays risk-manager-agent per call
// MIN_NET_EDGE_PCT tunable via env var so operators can dial aggression down
// in testnet (Sepolia pools are nearly pegged, real edges are ~0.006%).
const MIN_NET_EDGE_PCT = Number(process.env.MIN_PROFIT_MARGIN ?? "0.001");

export function evaluateMove(
  current: PairQuote,
  expectedPeg: number,
  amountInUsd: number,
  gasCostUsd: number,
): MoveCandidate | null {
  const deviation = (current.rate - expectedPeg) / expectedPeg;
  // We move AGAINST the deviation: if USDm→USDC rate > 1 (USDC is "expensive"),
  // sell USDC for USDm (the "cheap" side) — i.e. trade in the direction that
  // captures the spread.
  //
  // But for yield routing, the simpler model is: if USDm is currently "above
  // peg" (1 USDm = 1.001 USDC), prefer to hold USDC (which is "cheaper" so we
  // can buy more later). If USDm is "below peg" (1 USDm = 0.999 USDC), prefer
  // to hold USDm. The router moves us toward the asset that's currently
  // undervalued.

  const costsFraction =
    (SIGNAL_FEE_USD + RISK_FEE_USD + gasCostUsd) / amountInUsd;
  const edge = Math.abs(deviation) - costsFraction;

  if (edge <= MIN_NET_EDGE_PCT) return null;

  // Direction: if rate > 1 (USDm buys more USDC than usual), USDm is "rich",
  // so we swap TO USDm (sell USDC for USDm). If rate < 1, USDm is "cheap",
  // so we swap TO USDC.
  const fromToken: "USDm" | "USDC" = current.rate > expectedPeg ? "USDC" : "USDm";
  const toToken: "USDm" | "USDC" = fromToken === "USDC" ? "USDm" : "USDC";

  const expectedRate = current.rate;
  const expectedOutUsd = amountInUsd * expectedRate;

  return {
    fromToken,
    toToken,
    amountInUsd,
    expectedRate,
    expectedOutUsd,
    reason: `Live rate ${current.rate.toFixed(6)} deviates ${(deviation * 100).toFixed(3)}% from peg ${expectedPeg}. Costs ≈ ${(costsFraction * 100).toFixed(4)}%. Net edge: ${(edge * 100).toFixed(3)}%.`,
    netEdgePct: edge,
  };
}