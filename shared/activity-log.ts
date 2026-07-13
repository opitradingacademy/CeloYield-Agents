// Shared activity log for the 3-agent cooperative system.
//
// In production the 3 agents run on separate Vercel/Railway instances with
// no shared filesystem, so a local JSONL file can't work as the log — each
// instance would only ever see its own writes. Backed by Upstash Redis's
// REST API instead: it works identically from Vercel serverless functions
// and from the Railway background worker (plain HTTPS, no persistent TCP
// connection needed). Falls back to a local JSONL file when
// UPSTASH_REDIS_REST_URL/TOKEN aren't set, so local dev works with zero setup.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = "celoyield:activity";
const MAX_ENTRIES = 200;

function resolveLogPath(): string {
  let cwd = process.cwd();
  for (let i = 0; i < 6; i++) {
    const sharedDir = join(cwd, "shared");
    if (existsSync(sharedDir)) return join(sharedDir, ".activity.jsonl");
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

async function redisCommand(...args: (string | number)[]): Promise<any> {
  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const res = await fetch(`${REDIS_URL}/${path}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

// Append a single event. Called from any agent. Awaited where the caller is
// a serverless function that would otherwise freeze before the write lands
// (Next.js API routes); fire-and-forget is fine from the long-lived
// yield-router-agent process.
export async function logActivity(entry: Omit<ActivityLogEntry, "id" | "ts">): Promise<void> {
  const full: ActivityLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  const line = JSON.stringify(full);
  console.log("[activity-log] logActivity called, type=", entry.type, "hasUrl=", !!REDIS_URL, "hasToken=", !!REDIS_TOKEN);

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await redisCommand("lpush", REDIS_KEY, line);
      await redisCommand("ltrim", REDIS_KEY, 0, MAX_ENTRIES - 1);
      console.log("[activity-log] write ok");
    } catch (e) {
      console.log("[activity-log] logActivity Upstash write failed:", e);
    }
    return;
  }

  console.log(
    "[activity-log] UPSTASH_REDIS_REST_URL/TOKEN not set — falling back to local file",
    LOG_PATH,
  );
  try {
    appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch {
    // best-effort
  }
}

// Read the last N events, most recent first. The dashboard calls this every
// poll cycle.
export async function readRecentActivity(limit = 50): Promise<ActivityLogEntry[]> {
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const lines: string[] = (await redisCommand("lrange", REDIS_KEY, 0, limit - 1)) ?? [];
      const events: ActivityLogEntry[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line) as ActivityLogEntry);
        } catch {
          // skip malformed entries
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  try {
    if (!existsSync(LOG_PATH)) return [];
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
    return events.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

// Clear the log. Useful for demos.
export async function clearActivityLog(): Promise<void> {
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await redisCommand("del", REDIS_KEY);
    } catch {}
    return;
  }
  try {
    writeFileSync(LOG_PATH, "", "utf-8");
  } catch {}
}
