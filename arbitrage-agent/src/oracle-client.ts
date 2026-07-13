import { createThirdwebClient } from "thirdweb";
import { viemAdapter } from "thirdweb/adapters/viem";
import { wrapFetchWithPayment } from "thirdweb/x402";

// NOTE: this client historically took a viem WalletClient (from Para).
// After migrating to Privy, getAgentAccount() returns a different shape —
// for the mock path it doesn't matter (no thirdweb interaction). For the
// thirdweb path, only the address matters; we read it via the input param.
// Type is widened to `unknown` to avoid forcing consumers to construct a
// viem WalletClient from a Privy wallet. If you flip X402_MODE=thirdweb,
// you'll need to wire Privy -> thirdweb's Wallet here separately.
type WalletLike = unknown;

const MODE = process.env.X402_MODE || "mock";

export function createOracleClient(walletLike: WalletLike) {
  const fetchImpl = MODE === "thirdweb" ? createThirdwebFetch(walletLike) : createMockFetch();

  return {
    async getVolatility(oracleBaseUrl: string, pair: string) {
      const url = `${oracleBaseUrl}/api/volatility?pair=${encodeURIComponent(pair)}`;
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`Oracle request failed: ${response.status}`);
      }
      return response.json() as Promise<{
        pair: string;
        rate: number;
        volatility: number;
        sampleCount: number;
      }>;
    },
  };
}

function createMockFetch() {
  return async (url: string) => {
    const first = await fetch(url);
    if (first.status !== 402) return first;
    // "Pay" by resending with the header the mock facilitator checks for —
    // no funds move, this only proves the retry-after-402 loop works.
    return fetch(url, { headers: { "x-mock-payment": "paid" } });
  };
}

function createThirdwebFetch(walletLike: WalletLike) {
  const client = createThirdwebClient({ clientId: process.env.THIRDWEB_CLIENT_ID! });
  // Cast through unknown — only used when X402_MODE=thirdweb, which we don't
  // enable in development. If you flip it on, you'll need to wire Privy ->
  // thirdweb's Wallet shape here (out of scope for the yield-router MVP).
  const wallet = viemAdapter.wallet.fromViem({ walletClient: walletLike as any });
  return wrapFetchWithPayment(fetch, client, wallet);
}
