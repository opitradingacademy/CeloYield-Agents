import { BalanceSnapshot, PoolSnapshot, RecentTransaction, RiskSnapshot } from "@/lib/types";

interface Props {
  balance: BalanceSnapshot;
  recentTransactions: RecentTransaction[];
  walletAddress: string;
  pool: PoolSnapshot | null;
  risk: RiskSnapshot | null;
}

export function OnChainProof({ balance, recentTransactions, walletAddress, pool, risk }: Props) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">On-Chain Proof</h2>
        <a
          href={`https://celo.blockscout.com/address/${walletAddress}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-celo-gold/70 hover:text-celo-gold"
        >
          view on Blockscout →
        </a>
      </div>

      <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">wallet</div>
        <code className="break-all font-mono text-xs text-zinc-300">{walletAddress}</code>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <BalanceCell label="CELO" wei={balance.celo} decimals={18} />
          <BalanceCell label="USDC" wei={balance.usdc} decimals={6} />
          <BalanceCell label="USDm" wei={balance.usdm} decimals={18} />
        </div>
      </div>

      {pool && (
        <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">live pool snapshot</div>
          <div className="flex items-center justify-between">
            <code className="font-mono text-sm text-zinc-200">{pool.pair}</code>
            <code className="font-mono text-xs text-celo-gold">{pool.projectedApyPct.toFixed(3)}% APY</code>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            LP fee {pool.lpFeePercent}% · reserve ${pool.reserveUsd.toFixed(2)}
          </div>
        </div>
      )}

      {risk && (
        <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">live risk assessment</div>
          <div className="flex items-center justify-between">
            <code className="font-mono text-sm text-zinc-200">
              {risk.protocol}/{risk.asset}
            </code>
            <RiskScoreBadge score={risk.score} />
          </div>
          {risk.flags.length > 0 && (
            <div className="mt-2 space-y-1">
              {risk.flags.slice(0, 3).map((flag, i) => (
                <div key={i} className="text-[11px] text-zinc-500">
                  • {flag}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">recent on-chain activity</div>
        <div className="space-y-1.5">
          {recentTransactions.slice(0, 6).map((tx) => (
            <TxRow key={tx.hash} tx={tx} />
          ))}
        </div>
      </div>
    </section>
  );
}

function BalanceCell({ label, wei, decimals }: { label: string; wei: string; decimals: number }) {
  const value = Number(BigInt(wei || "0")) / 10 ** decimals;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="font-mono text-sm text-zinc-200">{value.toFixed(4)}</div>
    </div>
  );
}

function RiskScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div className={`font-mono text-lg font-bold ${color}`}>
      {score}<span className="text-xs text-zinc-600">/100</span>
    </div>
  );
}

function TxRow({ tx }: { tx: RecentTransaction }) {
  const isSwap = tx.method === "0x022c0d9f";
  const isTransfer = tx.method === "0xa9059cbb";
  const isApprove = tx.method === "0x095ea7b3";
  const isRegister = tx.method === "0xf2c298be";

  const label = isSwap
    ? "FPMM swap"
    : isTransfer
    ? "ERC20 transfer"
    : isApprove
    ? "ERC20 approve"
    : isRegister
    ? "ERC-8004 register"
    : tx.method;

  const ok = tx.status === 1 && tx.isError === 0;

  return (
    <a
      href={`https://celo.blockscout.com/tx/${tx.hash}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/30 px-2 py-1.5 hover:border-zinc-700"
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className="text-[11px] text-zinc-400">{label}</span>
      </div>
      <code className="font-mono text-[11px] text-zinc-500">
        {tx.hash.slice(0, 8)}…{tx.hash.slice(-4)}
      </code>
    </a>
  );
}