// Recovers the local external_id -> wallet.id mapping by listing all wallets
// in the Privy app and matching external_id. Run only if shared/.agent-wallets.json
// is lost — otherwise the normal getAgentAccount() path handles wallet creation.
//
// Usage: npx tsx shared/recover-wallets.ts
import { PrivyClient } from "@privy-io/node";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP_ID = process.env.PRIVY_APP_ID!;
const APP_SECRET = process.env.PRIVY_APP_SECRET!;

if (!APP_ID || !APP_SECRET) {
  console.error("Missing PRIVY_APP_ID / PRIVY_APP_SECRET");
  process.exit(1);
}

const privy = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
const WALLET_MAP_FILE = join(process.cwd(), "shared", ".agent-wallets.json");

const existing = existsSync(WALLET_MAP_FILE)
  ? (JSON.parse(readFileSync(WALLET_MAP_FILE, "utf-8")) as Record<string, unknown>)
  : {};

async function main() {
  const recovered: Record<string, { walletId: string; address: string; createdAt: string }> = {};

  let cursor: string | undefined;
  let totalScanned = 0;

  do {
    const page = await privy.wallets().list({ cursor, limit: 100 });
    for (const w of page.data) {
      totalScanned++;
      if (w.external_id && !existing[w.external_id]) {
        recovered[w.external_id] = {
          walletId: w.id,
          address: w.address,
          createdAt: new Date().toISOString(),
        };
        console.log(`Recovered: ${w.external_id} -> ${w.address}`);
      }
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);

  writeFileSync(WALLET_MAP_FILE, JSON.stringify({ ...existing, ...recovered }, null, 2));
  console.log(`Done. Scanned ${totalScanned} wallets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});