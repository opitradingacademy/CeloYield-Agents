import { ActivityEvent } from "@/lib/types";

interface Props {
  events: ActivityEvent[];
}

const colorByType: Record<string, string> = {
  pay: "border-celo-gold/40 bg-celo-gold/5 text-celo-gold",
  quote: "border-blue-500/30 bg-blue-500/5 text-blue-300",
  swap: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  skip: "border-zinc-700 bg-zinc-950/30 text-zinc-500",
  info: "border-zinc-700 bg-zinc-950/30 text-zinc-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  poll: "border-zinc-800 bg-zinc-950/20 text-zinc-400",
  "signal-paid": "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
  "risk-paid": "border-amber-500/30 bg-amber-500/5 text-amber-300",
};

const iconByAgent: Record<string, string> = {
  "signal-aggregator": "📡",
  "risk-manager": "🛡️",
  "yield-router": "⚡",
  system: "🔧",
};

export function ActivityFeed({ events }: Props) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Activity Feed</h2>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="status-dot inline-block h-1.5 w-1.5 rounded-full bg-celo-gold" />
          live · 3s poll
        </div>
      </div>

      <div className="max-h-[40rem] space-y-1.5 overflow-y-auto">
        {events.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">
            Watching for new activity…
            <div className="mt-2 text-xs">
              (start the yield-router-agent in another terminal to see live events)
            </div>
          </div>
        ) : (
          events.map((event) => <EventRow key={event.id} event={event} />)
        )}
      </div>
    </section>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const color =
    colorByType[event.type] ?? "border-zinc-700 bg-zinc-950/30 text-zinc-300";
  const icon = iconByAgent[event.agent] ?? "🔧";

  // Pull a tx hash out of either the dedicated field or the data dict.
  const txHash = event.txHash ?? (event.data as any)?.swapHash ?? (event.data as any)?.transferHash;

  return (
    <div className={`event-row flex items-start gap-3 rounded border ${color} px-3 py-2`}>
      <span className="text-base leading-none">{icon}</span>
      <div className="flex-1">
        <div className="text-xs leading-relaxed">{event.message}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] opacity-60">
          <span>{new Date(event.ts).toLocaleTimeString()}</span>
          {txHash && (
            <a
              href={`https://celo-sepolia.blockscout.com/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline"
            >
              {String(txHash).slice(0, 10)}…
            </a>
          )}
        </div>
      </div>
    </div>
  );
}