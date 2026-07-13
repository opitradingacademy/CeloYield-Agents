import { DashboardState } from "@/lib/types";

interface Props {
  state: DashboardState | null;
  lastError: string | null;
  walletAddress: string;
}

export function HeroSection({ state, lastError, walletAddress }: Props) {
  return (
    <header className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-8 shadow-2xl">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-celo-gold/40 bg-celo-gold/10 px-3 py-1 text-xs font-medium text-celo-gold">
            <span className="status-dot inline-block h-2 w-2 rounded-full bg-celo-gold" />
            LIVE — Celo Mainnet
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            CeloYield Agents
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-400">
            3 cooperative agents, registered on ERC-8004, paying each other via
            real x402 CELO transfers — running unattended on Celo mainnet and
            executing real Mento V3 FPMM swaps. No operator in the loop.
          </p>
          {lastError && (
            <p className="mt-2 text-xs text-red-400">Last error: {lastError}</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <ArchitectureDiagram />
      </div>
    </header>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 font-mono text-xs leading-relaxed">
      <div className="flex min-w-max items-center gap-2">
        <AgentBlock name="yield-router-agent" role="orchestrator" />
        <Arrow label="x402 pay $0.001" />
        <AgentBlock name="signal-aggregator-agent" role="APY data" />
        <Arrow label="x402 pay $0.002" />
        <AgentBlock name="risk-manager-agent" role="risk scoring" />
        <Arrow label="Privy MPC sign" />
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-center text-emerald-300">
          <div className="font-bold">Mento V3 FPMM Pool</div>
          <div className="text-[10px] text-emerald-400/70">on-chain swap</div>
        </div>
      </div>
    </div>
  );
}

function AgentBlock({ name, role }: { name: string; role: string }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-center">
      <div className="font-bold text-celo-gold">{name}</div>
      <div className="text-[10px] text-zinc-500">{role}</div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 text-zinc-500">
      <span>→</span>
      <span className="whitespace-nowrap text-[10px]">{label}</span>
    </div>
  );
}