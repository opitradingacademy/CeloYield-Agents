// Shared x402 implementation for inter-agent payments in the yield-router
// network. Three roles use this:
//
//   1. Signal-aggregator-agent (server) — charges $0.001 per /api/apy call
//   2. Risk-manager-agent (server) — charges $0.002 per /api/assess call
//   3. Yield-router-agent (client) — pays by settling on-chain (live) or
//      sending x-mock-payment: paid (mock)
//
// Mirrors the oracle-agent/lib/x402.ts pattern. thirdweb's hosted facilitator
// costs $99+/mo + 0.3%/tx — not worth it at hackathon scale. "live" mode below
// is a minimal self-facilitated settlement: the payer sends a real, tagged
// native-CELO transfer to the payee's own wallet and proves it with the tx
// hash; the server independently confirms the transfer on-chain before
// serving the request. Real money moves, real transactions land on-chain,
// no external facilitator needed.

import { getAgentAccount } from "./wallet";
import { getNetwork } from "./network";
import { usdToCeloWei } from "./pricing";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { celo, celoSepolia } from "viem/chains";

export type PaymentOutcome =
  | { paid: true; responseHeaders: Record<string, string> }
  | { paid: false; status: number; body: unknown; headers: Record<string, string> };

export interface X402Config {
  /** Display price, e.g. "$0.001" */
  price: string;
  /** Human-readable description shown in the 402 body */
  description: string;
}

function parsePriceUsd(price: string): number {
  return Number(price.replace(/^\$/, ""));
}

// Mock implementation: the client proves payment by sending the header
// x-mock-payment: paid. No funds move, no facilitator is contacted.
export async function settleMock(req: Request, config: X402Config): Promise<PaymentOutcome> {
  const mockPayment = req.headers.get("x-mock-payment");
  if (mockPayment !== "paid") {
    return {
      paid: false,
      status: 402,
      body: {
        x402Version: 1,
        error: "payment_required",
        accepts: [
          {
            scheme: "mock",
            price: config.price,
            description: config.description,
          },
        ],
      },
      headers: {},
    };
  }
  return { paid: true, responseHeaders: { "x-payment-mode": "mock" } };
}

// Client-side helper: fetch with auto-retry on 402. The caller doesn't have to
// know whether the server is using mock or thirdweb — both respond with the
// same x402 payment-required shape.
export async function fetchWithPayment(url: string, options: RequestInit = {}): Promise<Response> {
  const first = await fetch(url, options);
  if (first.status !== 402) return first;
  // Mock mode: send the header the mock facilitator checks for.
  // Real mode would parse the 402 body, build a payment-signature with the
  // user's wallet, and retry — but we don't need that for the yield-router MVP.
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "x-mock-payment": "paid",
    },
  });
}

// In-memory dedupe of settled tx hashes, per server process. A determined
// attacker could replay a tx across process restarts, but that's out of
// scope for a hackathon demo — this stops accidental double-serves within a
// running process.
const settledTxHashes = new Set<string>();

// Server-side: verify a real on-chain CELO transfer to `payeeAddress` covering
// the required USD price, proven by the tx hash in x-payment-tx. Polls for
// the receipt (Celo blocks land in a few seconds) rather than assuming it's
// already mined by the time the retry arrives.
export async function settleReal(
  req: Request,
  config: X402Config,
  payeeAddress: Address,
): Promise<PaymentOutcome> {
  const txHash = req.headers.get("x-payment-tx") as Hex | null;
  if (!txHash) {
    return {
      paid: false,
      status: 402,
      body: {
        x402Version: 1,
        error: "payment_required",
        accepts: [
          {
            scheme: "celo-native",
            price: config.price,
            description: config.description,
            payTo: payeeAddress,
          },
        ],
      },
      headers: {},
    };
  }

  if (settledTxHashes.has(txHash)) {
    return {
      paid: false,
      status: 402,
      body: { x402Version: 1, error: "tx_already_used" },
      headers: {},
    };
  }

  const network = getNetwork();
  const client = createPublicClient({
    chain: network.chainId === celo.id ? celo : celoSepolia,
    transport: http(network.rpcUrl),
  });

  try {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 15_000 });
    if (receipt.status !== "success") {
      return { paid: false, status: 402, body: { x402Version: 1, error: "tx_failed" }, headers: {} };
    }
    const tx = await client.getTransaction({ hash: txHash });
    const requiredWei = await usdToCeloWei(parsePriceUsd(config.price));
    if (tx.to?.toLowerCase() !== payeeAddress.toLowerCase() || tx.value < requiredWei) {
      return { paid: false, status: 402, body: { x402Version: 1, error: "insufficient_payment" }, headers: {} };
    }
    settledTxHashes.add(txHash);
    return { paid: true, responseHeaders: { "x-payment-mode": "live", "x-payment-tx": txHash } };
  } catch {
    return { paid: false, status: 402, body: { x402Version: 1, error: "tx_not_confirmed" }, headers: {} };
  }
}

// Client-side: pay for a 402'd request with a real, tagged native-CELO
// transfer from `payerExternalId`'s wallet to the server's payTo address
// (read from the 402 body), then retry with proof.
export async function fetchWithPaymentReal(
  url: string,
  payerExternalId: string,
  options: RequestInit = {},
): Promise<Response> {
  const first = await fetch(url, options);
  if (first.status !== 402) return first;

  const body = (await first.json()) as {
    accepts?: { price: string; payTo: Address }[];
  };
  const accept = body.accepts?.[0];
  if (!accept) return first;

  const wallet = await getAgentAccount(payerExternalId);
  const network = getNetwork();
  const client = createPublicClient({
    chain: network.chainId === celo.id ? celo : celoSepolia,
    transport: http(network.rpcUrl),
  });
  const nonce = await client.getTransactionCount({ address: wallet.account!.address });
  const value = await usdToCeloWei(parsePriceUsd(accept.price));

  const { parseGwei } = await import("viem");
  const txHash = await wallet.sendTransactionLegacy({
    to: accept.payTo,
    value,
    gas: 30_000n,
    gasPrice: parseGwei("5"),
    nonce: BigInt(nonce),
  });

  return fetch(url, {
    ...options,
    headers: { ...options.headers, "x-payment-tx": txHash },
  });
}