// Shared activity log for the 3-agent cooperative system.
//
// Each agent writes events to a JSONL file at shared/.activity.jsonl. The
// dashboard polls this file every 3s and surfaces the events in the live
// Activity Feed. This is a low-fi substitute for a proper event bus — fine
// for a hackathon demo where all 3 agents + the dashboard run on the same host.

import { appendFileSync, existsSync, readFileSync, statSync, openSync, readSync, closeSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { existsSync as exists } from "node:fs";

function resolveLogPath(): string {
  // Walk up from cwd until we find a `shared/` directory (not the file —
  // it might not exist yet on first run). The shared/ dir is the canonical
  // marker that we're inside the celo-agentic-payments workspace.
  let cwd = process.cwd();
  for (let i = 0; i < 6; i++) {
    const sharedDir = join(cwd, "shared");
    if (exists(sharedDir)) return join(sharedDir, ".activity.jsonl");
    const parent = dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  return join(process.cwd(), "shared", ".activity.jsonl");
}

const LOG_PATH = resolveLogPath();

export interface ActivityLogEntry {
  id: string;
  ts: string;
  agent: "yield-router" | "signal-aggregator" | "risk-manager" | "system";
  type: "poll" | "signal-paid" | "risk-paid" | "quote" | "swap" | "skip" | "error" | "info";
  message: string;
  data?: Record<string, unknown>;
}

// Append a single event. Called from any agent.
export function logActivity(entry: Omit<ActivityLogEntry, "id" | "ts">) {
  const full: ActivityLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // best-effort
  }
}

// Read the last N events. The dashboard calls this every poll cycle.
// We read the file once and parse line-by-line — for hackathon scale this
// is plenty fast (even at 100 events/sec this is <1ms).
export function readRecentActivity(limit = 50): ActivityLogEntry[] {
  try {
    if (!exists(LOG_PATH)) return [];
    const content = readFileSync(LOG_PATH, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const events: ActivityLogEntry[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as ActivityLogEntry);
      } catch {
        // skip malformed lines (partial writes during agent activity)
      }
    }
    // Return most recent first, capped at limit
    return events.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

// Clear the log. Useful for demos.
export function clearActivityLog() {
  try {
    writeFileSync(LOG_PATH, "", "utf-8");
  } catch {}
}