"use client";

import { useEffect, useState } from "react";
import { DashboardState, ActivityEvent } from "@/lib/types";
import { HeroSection } from "@/components/HeroSection";
import { AgentStatusCards } from "@/components/AgentStatusCards";
import { OnChainProof } from "@/components/OnChainProof";
import { ActivityFeed } from "@/components/ActivityFeed";
import { SwapPanel } from "@/components/SwapPanel";
import { RouterStatsPanel } from "@/components/RouterStatsPanel";

const POLL_INTERVAL_MS = 3000;

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [seenLogIds, setSeenLogIds] = useState<Set<string>>(new Set());
  const [onChainEvents, setOnChainEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let prevTxHashes: Set<string> = new Set();

    async function poll() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const newState: DashboardState = await res.json();
        if (!mounted) return;

        setState(newState);
        setLoading(false);
        setLastError(null);

        // Detect new on-chain transactions not yet surfaced via the activity
        // log (dashboard-triggered swaps don't always log before the tx
        // confirms — better to show them via Blockscout diff too).
        if (prevTxHashes.size > 0) {
          const newOnChain: ActivityEvent[] = [];
          for (const tx of newState.recentTransactions) {
            if (!prevTxHashes.has(tx.hash)) {
              const isSwap = tx.method === "0x022c0d9f";
              newOnChain.push({
                id: `tx-${tx.hash}`,
                ts: new Date().toISOString(),
                agent: "yield-router",
                type: isSwap ? "swap" : "info",
                message: isSwap
                  ? `On-chain: FPMM swap in block ${tx.blockNumber}`
                  : `On-chain tx in block ${tx.blockNumber}`,
                txHash: tx.hash,
              });
            }
          }
          if (newOnChain.length > 0) {
            setOnChainEvents((prev) => [...newOnChain, ...prev].slice(0, 20));
          }
        }
        prevTxHashes = new Set(newState.recentTransactions.map((t) => t.hash));

        // Track which log entries we've already shown
        setSeenLogIds((prevSet) => {
          const next = new Set(prevSet);
          for (const ev of newState.activityEvents) next.add(ev.id);
          return next;
        });
      } catch (e: any) {
        if (!mounted) return;
        setLastError(e?.message ?? "fetch failed");
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Merge: log events that aren't in seen set + on-chain events.
  const allEvents: ActivityEvent[] = state
    ? [
        ...state.activityEvents,
        ...onChainEvents.filter((e) => !seenLogIds.has(e.id)),
      ].slice(0, 50)
    : [];

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-celo-gold border-t-transparent" />
          <p className="text-zinc-400">Connecting to agents...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HeroSection
        state={state}
        lastError={lastError}
        walletAddress={state?.walletAddress ?? ""}
      />

      <div className="mt-8">
        <RouterStatsPanel events={allEvents} />
      </div>

      <div className="mt-8">
        <ActivityFeed events={allEvents} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentStatusCards agents={state?.agents ?? []} />
        <OnChainProof
          balance={state?.balance ?? { celo: "0", usdc: "0", usdm: "0" }}
          recentTransactions={state?.recentTransactions ?? []}
          walletAddress={state?.walletAddress ?? ""}
          pool={state?.pool ?? null}
          risk={state?.risk ?? null}
        />
      </div>
    </main>
  );
}