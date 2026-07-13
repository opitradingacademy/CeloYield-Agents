import { AgentStatus } from "@/lib/types";

interface Props {
  agents: AgentStatus[];
}

export function AgentStatusCards({ agents }: Props) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agents</h2>
        <span className="text-xs text-zinc-500">x402-gated micro-services</span>
      </div>
      <div className="space-y-3">
        {agents.map((agent) => (
          <AgentCard key={agent.name} agent={agent} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent }: { agent: AgentStatus }) {
  const isRunning = agent.status === "running";
  const statusColor = isRunning ? "bg-emerald-500" : "bg-red-500";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${statusColor} status-dot`} />
            <code className="font-mono text-sm font-bold text-celo-gold">{agent.name}</code>
          </div>
          <div className="mt-1 text-xs text-zinc-500">{agent.role}</div>
        </div>
        <div className="text-right text-xs">
          <div className="text-zinc-400">port {agent.port}</div>
          <a
            href={agent.url}
            target="_blank"
            rel="noreferrer"
            className="text-celo-gold/60 hover:text-celo-gold"
          >
            {agent.url}
          </a>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <Metric label="fee/call" value={`$${agent.feePerCall.toFixed(3)}`} />
        <Metric label="calls" value={agent.callsReceived.toString()} />
        <Metric
          label="earned"
          value={`$${agent.totalEarned.toFixed(4)}`}
          highlight
        />
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className={`font-mono text-sm ${highlight ? "text-celo-gold" : "text-zinc-200"}`}>
        {value}
      </div>
    </div>
  );
}