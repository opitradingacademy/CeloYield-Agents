"use client";

import { ActivityEvent } from "@/lib/types";

interface Props {
  events: ActivityEvent[];
}

interface Counter {
  label: string;
  count: number;
  lastAt: string | null;
  color: string;
}

const TYPES = {
  poll: { label: "Polls · Consultas de precio", color: "border-zinc-700" },
  "signal-paid": { label: "x402 pay signal-agent ($0.001)", color: "border-cyan-500/40" },
  "risk-paid": { label: "x402 pay risk-manager ($0.002)", color: "border-amber-500/40" },
  quote: { label: "Quotes · Swaps propuestos", color: "border-blue-500/40" },
  skip: { label: "Skips · Decisiones de no operar", color: "border-zinc-700" },
  swap: { label: "Swaps ejecutados on-chain", color: "border-emerald-500/40" },
  error: { label: "Errors", color: "border-red-500/40" },
} as const;

export function RouterStatsPanel({ events }: Props) {
  // Filter events that come from the yield-router-agent only (skip signal/risk
  // serving events which inflate the count).
  const routerEvents = events.filter((e) => e.agent === "yield-router");

  const counters: Counter[] = (Object.keys(TYPES) as Array<keyof typeof TYPES>).map((type) => {
    const matching = routerEvents.filter((e) => e.type === type);
    return {
      label: TYPES[type].label,
      count: matching.length,
      lastAt: matching[0]?.ts ?? null,
      color: TYPES[type].color,
    };
  });

  const signalPays = routerEvents.filter((e) => e.type === "signal-paid").length;
  const riskPays = routerEvents.filter((e) => e.type === "risk-paid").length;
  const totalPaid = signalPays * 0.001 + riskPays * 0.002;

  // What is the router doing right now? Look at the most recent event.
  const latest = routerEvents[0];
  const statusLine = latest ? describeActivity(latest) : "Iniciando…";

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          yield-router-agent · live stats
        </h2>
        <span className="status-dot inline-block h-2 w-2 rounded-full bg-celo-gold" />
      </div>
      <p className="mb-4 text-sm text-zinc-400">{statusLine}</p>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {counters.slice(0, 4).map((c) => (
          <CounterCard key={c.label} counter={c} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {counters.slice(4).map((c) => (
          <CounterCard key={c.label} counter={c} />
        ))}
        <CostCard totalPaid={totalPaid} cycles={Math.min(signalPays, riskPays)} />
      </div>
    </section>
  );
}

function CounterCard({ counter }: { counter: Counter }) {
  return (
    <div className={`rounded-lg border ${counter.color} bg-zinc-950/40 p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {counter.label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-zinc-100">{counter.count}</span>
        {counter.lastAt && (
          <span className="font-mono text-[10px] text-zinc-600">
            {formatRelativeTime(counter.lastAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function CostCard({ totalPaid, cycles }: { totalPaid: number; cycles: number }) {
  return (
    <div className="rounded-lg border border-celo-gold/40 bg-celo-gold/5 p-3">
      <div className="text-[10px] uppercase tracking-wider text-celo-gold/70">
        Total paid to other agents
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-celo-gold">
          ${totalPaid.toFixed(4)}
        </span>
        <span className="font-mono text-[10px] text-zinc-600">USD · {cycles} ciclos</span>
      </div>
    </div>
  );
}

function describeActivity(event: ActivityEvent): string {
  switch (event.type) {
    case "poll":
      return "Mirando el precio en Mento V3 FPMM…";
    case "signal-paid":
      return "Pagando al signal-aggregator-agent ($0.001) para obtener cotizaciones…";
    case "risk-paid":
      return "Pagando al risk-manager-agent ($0.002) para validar la operación…";
    case "skip":
      return `Esperando una mejor oportunidad (${event.message.toLowerCase()})`;
    case "quote":
      return "Oportunidad detectada — esperando aprobación del operador…";
    case "swap":
      return "Ejecutando swap on-chain ahora mismo…";
    case "error":
      return "Algo falló — reintentando el siguiente ciclo…";
    default:
      return event.message;
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}