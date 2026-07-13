import { PrivyClient } from "@privy-io/node";
import { http, createPublicClient, type WalletClient, type Hex, type Address } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { toDataSuffix } from "@celo/attribution-tags";
import { getNetwork } from "./network";

// Celo Builders hackathon attribution tag (agentic-payments-defai). Appended
// to every outbound tx's calldata as an ERC-8021 suffix so the Dune
// leaderboard credits x402 payments + on-chain volume to this project.
// Invisible to the called contract — pure calldata suffix.
//
// Confirmed 2026-07-13: this tag already has credited volume on the public
// Dune leaderboard (dune.com/celo/agentic-payments-defai-hackathon), so it
// must stay as-is. It belongs to a celobuilders.xyz submission registered
// under a different Google account than the one used to reconnect this
// session — that account needs to re-authenticate to regain control of the
// actual submission, rather than rotating the tag.
const ATTRIBUTION_TAG = "celo_baf40ede1a50";

function withAttributionTag(data?: Hex): Hex {
  const suffix = toDataSuffix(ATTRIBUTION_TAG); // 0x-prefixed ERC-8021 suffix bytes
  const base = data ?? "0x";
  return (base + suffix.slice(2)) as Hex;
}

// Migrated from @getpara/server-sdk to @privy-io/node on 2026-07-10.
//
// Why: Para MPC signing failed consistently with "invalid character '<' looking
// for beginning of value" — an HTML-instead-of-JSON response from Para's MPC
// coordination layer. Diagnosed in README.md "KNOWN BLOCKER" section; next step
// was Para support, but instead of waiting we pivoted to Privy which gives us:
//   - 50,000 free signatures/month on the Developer plan (vs Para's broken signer)
//   - Server-side signing API that mirrors what we did with Para (we hand it
//     the transaction, it returns the signed hash and broadcasts)
//   - The private key never leaves Privy's HSMs — same security thesis as Para
//
// API shape we use:
//   1. `privy.wallets().create({ chain_type: 'ethereum', external_id })` to create
//      one wallet per agent. external_id is a URL-safe stable string (max 64 chars)
//      that we choose — equivalent to Para's `pregenId.customId`. Write-once.
//   2. We persist the mapping `external_id -> wallet.id` in a local JSON file
//      (shared/.agent-wallets.json) so we don't have to list all wallets every
//      boot. Privy's API has no native external_id lookup.
//   3. `privy.wallets().ethereum().sendTransaction(walletId, {...})` to sign+
//      broadcast a tx. Privy handles the gas estimation and signing in one call.
//   4. `privy.wallets().ethereum().signMessage(walletId, {...})` to EIP-191 sign.

const APP_ID = process.env.PRIVY_APP_ID!;
const APP_SECRET = process.env.PRIVY_APP_SECRET!;

if (!APP_ID || !APP_SECRET) {
  throw new Error(
    "Missing PRIVY_APP_ID / PRIVY_APP_SECRET. Get them from https://dashboard.privy.io/.",
  );
}

const privy = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });

const NETWORK = getNetwork();
const CHAIN = NETWORK.chainId === celo.id ? celo : celoSepolia;

const PUBLIC_CLIENT = createPublicClient({
  chain: CHAIN,
  transport: http(NETWORK.rpcUrl),
});

// Local mapping of external_id (stable string per agent) -> wallet.id (Privy's UUID).
// Privy's `external_id` is write-once at creation; we still need the wallet.id
// for every subsequent API call, so we cache it. If this file is lost, recreate
// it with `npx tsx shared/recover-wallets.ts`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Walk up from process.cwd() to find the workspace's shared/.agent-wallets.json.
// Stable across cwd variations (root, agent dir, dashboard).
function findWalletMapPath(): string {
  let cwd = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(cwd, "shared", ".agent-wallets.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  return join(process.cwd(), "shared", ".agent-wallets.json");
}

const WALLET_MAP_FILE = findWalletMapPath();

type WalletMap = Record<string, { walletId: string; address: Address; createdAt: string }>;

function loadWalletMap(): WalletMap {
  if (!existsSync(WALLET_MAP_FILE)) return {};
  try {
    return JSON.parse(readFileSync(WALLET_MAP_FILE, "utf-8")) as WalletMap;
  } catch {
    return {};
  }
}

function saveWalletMap(map: WalletMap): void {
  writeFileSync(WALLET_MAP_FILE, JSON.stringify(map, null, 2));
}

export async function getOrCreateAgentWallet(externalId: string): Promise<{
  walletId: string;
  address: Address;
}> {
  const map = loadWalletMap();
  if (map[externalId]) {
    return { walletId: map[externalId].walletId, address: map[externalId].address };
  }

  const wallet = await privy.wallets().create({
    chain_type: "ethereum",
    external_id: externalId,
  });

  // Privy's Wallet object has an `address` field directly (not nested under `accounts`
  // for chain_type=ethereum) — verified against resources/wallets/wallets.d.ts.
  const address = wallet.address as Address;
  const walletId = wallet.id;

  map[externalId] = { walletId, address, createdAt: new Date().toISOString() };
  saveWalletMap(map);

  return { walletId, address };
}

// Build a viem WalletClient-like interface that signs via Privy.
// Same return type as the old Para-based implementation, so existing consumers
// (oracle-agent, arbitrage-agent) keep working without code changes — they just
// need `account.address` and `sendTransaction({ to, data, value })`.
//
// Two sendTransaction paths are exposed:
//   - sendTransaction(): auto-builds an EIP-1559 tx from viem-style args.
//     Works on most chains but Privy's pre-flight balance check uses the
//     bundled forno RPC, which reports stale state on Celo Sepolia — so this
//     path rejects txs even when the wallet has funds.
//   - sendTransactionLegacy(): builds a legacy (type-0) tx with all values
//     as hex strings. Privy accepts this format and broadcasts via Tenderly,
//     bypassing the stale-RPC balance check. Use this for Celo Sepolia.
export async function getAgentAccount(externalId: string) {
  const { walletId, address } = await getOrCreateAgentWallet(externalId);

  return {
    account: { address },
    // EIP-1559 path — works on chains with reliable Privy RPC (mainnet, etc).
    async sendTransaction(args: {
      to: Address;
      data?: Hex;
      value?: bigint;
      gas?: bigint;
    }): Promise<Hex> {
      const result = await privy.wallets().ethereum().sendTransaction(walletId, {
        caip2: `eip155:${NETWORK.chainId}`,
        params: {
          transaction: {
            to: args.to,
            data: withAttributionTag(args.data),
            value: args.value ? `0x${args.value.toString(16)}` : "0x0",
            chain_id: NETWORK.chainId,
          },
        },
      });
      return result.hash as Hex;
    },
    // Legacy (type-0) tx path — required for Celo Sepolia because Privy's
    // forno RPC reports stale state and rejects EIP-1559 txs that need a
    // priority fee >= 1. Legacy tx format avoids that requirement entirely.
    async sendTransactionLegacy(args: {
      to: Address;
      data?: Hex;
      value?: bigint;
      gas?: bigint;
      gasPrice?: bigint;
      nonce?: bigint;
    }): Promise<Hex> {
      const result = await privy.wallets().ethereum().sendTransaction(walletId, {
        caip2: `eip155:${NETWORK.chainId}`,
        params: {
          transaction: {
            chain_id: NETWORK.chainId,
            nonce: args.nonce !== undefined ? `0x${args.nonce.toString(16)}` : "0x0",
            to: args.to,
            data: withAttributionTag(args.data),
            value: args.value ? `0x${args.value.toString(16)}` : "0x0",
            gas_limit: args.gas ? `0x${args.gas.toString(16)}` : "0x5208",
            gas_price: args.gasPrice
              ? `0x${args.gasPrice.toString(16)}`
              : "0x174876e800", // 1 gwei default — bump with gasPrice arg
          },
        },
      });
      return result.hash as Hex;
    },
    async signMessage(message: string): Promise<Hex> {
      const result = await privy.wallets().ethereum().signMessage(walletId, {
        message,
      });
      return result.signature as Hex;
    },
    // EIP-712 signing — used for the x402 "exact" scheme's EIP-3009
    // TransferWithAuthorization (gasless USDC payment authorization),
    // required to settle through the official Celo x402 facilitator.
    async signTypedData(input: {
      domain: Record<string, unknown>;
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> {
      const result = await privy.wallets().ethereum().signTypedData(walletId, {
        params: {
          typed_data: {
            domain: input.domain,
            types: input.types,
            primary_type: input.primaryType,
            message: input.message,
          },
        },
      });
      return result.signature as Hex;
    },
  };
}

// Export the public client + Privy client for direct use by agents that want to
// skip the wallet-client abstraction (e.g., querying on-chain state).
export { PUBLIC_CLIENT, privy, CHAIN, NETWORK };

// For tests and ops scripts that need to look up an existing wallet without creating.
export async function lookupAgentWallet(externalId: string) {
  const map = loadWalletMap();
  return map[externalId] ?? null;
}