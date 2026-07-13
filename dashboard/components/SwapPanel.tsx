"use client";

import { useState } from "react";

interface Props {
  walletAddress: string;
}

export function SwapPanel({ walletAddress }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function triggerSwap() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/swap", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "swap failed");
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setError(e?.message ?? "network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-celo-gold/30 bg-zinc-950/60 p-4">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-celo-gold/70">
        Manual override · Dispara un swap on-chain
      </div>
      <p className="text-xs text-zinc-400">
        Real Mento V3 FPMM swap (1 USDC → USDm) signed by Privy MPC. Two on-chain
        transactions: ERC20 transfer + FPMM.swap(). Resultado verificable en Blockscout.
      </p>

      <button
        onClick={triggerSwap}
        disabled={loading}
        className="mt-3 w-full rounded-lg border border-celo-gold bg-celo-gold px-4 py-3 font-semibold text-celo-black transition-all hover:bg-celo-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-celo-black border-t-transparent" />
            Sending tx...
          </span>
        ) : (
          "Run Swap (1 USDC → USDm)"
        )}
      </button>

      {result && (
        <div className="mt-3 space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
          <div className="font-semibold text-emerald-300">Swap submitted</div>
          {result.transferHash && (
            <a
              href={`https://celo-sepolia.blockscout.com/tx/${result.transferHash}`}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-emerald-200/70 hover:text-emerald-200"
            >
              transfer: {result.transferHash}
            </a>
          )}
          {result.swapHash && (
            <a
              href={`https://celo-sepolia.blockscout.com/tx/${result.swapHash}`}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-emerald-200/70 hover:text-emerald-200"
            >
              swap: {result.swapHash}
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          <div className="font-semibold">Failed</div>
          <div className="mt-1 break-words">{error}</div>
        </div>
      )}
    </div>
  );
}