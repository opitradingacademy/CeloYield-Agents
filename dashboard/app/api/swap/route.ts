// Triggers a real Mento V3 FPMM swap via Privy-signed transactions.
// Called from the dashboard's "Run Swap" button. The actual swap logic lives
// in yield-router-agent/src/executor.ts — we spawn it as a child process so
// the dashboard server stays independent from the yield-router-agent runtime.
//
// The child process loads the repo-root .env via tsx's --env-file flag.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

// Loads the repo-root .env so PRIVY_APP_ID, PRIVY_APP_SECRET, NETWORK, etc.
// are available in the child process that runs the swap executor.
function loadEnv(): NodeJS.ProcessEnv {
  const envPath = join(process.cwd(), "..", ".env");
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) env[key] = val;
  }
  return env;
}

function findTsx(): string {
  const candidates = [
    join(process.cwd(), "..", "node_modules", ".bin", "tsx.cmd"),
    join(process.cwd(), "..", "node_modules", ".bin", "tsx"),
    "tsx",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "tsx";
}

export async function POST() {
  const tsxBin = findTsx();
  const cwd = join(process.cwd(), "..", "yield-router-agent");

  // Write the script into the yield-router-agent dir so its relative import
  // (./src/executor) resolves. Temp dirs can't resolve workspace packages.
  const scriptPath = join(cwd, "_dashboard-swap.ts");
  const script = `import { executeMove } from "./src/executor";
async function main() {
  try {
    const r = await executeMove({
      fromToken: "USDC",
      toToken: "USDm",
      amountInUsd: 1,
      expectedRate: 1.000063,
      expectedOutUsd: 0.999537,
      reason: "dashboard-triggered",
      netEdgePct: 0.001,
      skipReserveCap: true,
    } as any);
    console.log("RESULT:" + JSON.stringify({ transferHash: r.transferHash, swapHash: r.swapHash, expectedOutUsd: r.expectedOutUsd }));
  } catch (e: any) {
    console.error("ERROR:" + (e?.message ?? String(e)));
    process.exit(1);
  }
}
main();
`;
  writeFileSync(scriptPath, script);

  try {
    const stdout = execFileSync(tsxBin, [scriptPath], {
      cwd,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...loadEnv(), NODE_ENV: process.env.NODE_ENV || "development" },
      shell: process.platform === "win32",
    }).toString();
    console.log("[dashboard /api/swap] stdout:", stdout);

    const match = stdout.match(/RESULT:(.+)/);
    if (match) {
      return Response.json({ ok: true, ...JSON.parse(match[1]) });
    }
    return Response.json({ ok: false, error: "no RESULT line in output", stdout });
  } catch (e: any) {
    const stdout = e?.stdout?.toString?.() ?? "";
    const stderr = e?.stderr?.toString?.() ?? "";
    console.log("[dashboard /api/swap] error stdout:", stdout);
    console.log("[dashboard /api/swap] error stderr:", stderr);
    const errMatch = stdout.match(/ERROR:(.+)/);
    return Response.json(
      {
        ok: false,
        error: errMatch ? errMatch[1].trim() : e?.message ?? String(e),
        stdout,
        stderr,
      },
      { status: 500 },
    );
  } finally {
    try {
      rmSync(scriptPath, { force: true });
    } catch {}
  }
}