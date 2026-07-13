// x402 "exact" scheme over the official Celo facilitator (api.x402.celo.org).
//
// Unlike shared/x402-mock.ts's "live" mode (a self-facilitated native-CELO
// transfer we verify ourselves), this settles a real EIP-3009
// TransferWithAuthorization in USDC through Celo's own facilitator — the
// scheme the Celo Builders hackathon's Dune leaderboard actually counts
// under `x402_settlements`. Self-facilitated transfers only count toward
// generic tagged volume, not the x402-specific track.
//
// Protocol reference: https://github.com/x402-foundation/x402
// (specs/x402-specification-v1.md, specs/transports-v1/http.md)

import { getAgentAccount } from "./wallet";
import { getNetwork } from "./network";
import type { Address, Hex } from "viem";

const FACILITATOR_URL = "https://api.x402.celo.org";
const NETWORK_ID = "celo"; // x402Version 1 network identifier for Celo mainnet
const USDC_NAME = "USDC";
const USDC_VERSION = "2";

export interface X402FacilitatorConfig {
  /** Price in USD, e.g. "$0.001" */
  price: string;
  description: string;
  resource: string;
}

interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: { name: string; version: string };
}

interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

function usdToAtomicUsdc(usd: number): string {
  // USDC has 6 decimals. Round to avoid floating-point remainders like
  // 1000.0000000001 leaking into the atomic amount string.
  return Math.round(usd * 1_000_000).toString();
}

export type FacilitatorOutcome =
  | { paid: true; payer: Address; txHash: Hex; responseHeaders: Record<string, string> }
  | { paid: false; status: number; body: unknown; headers: Record<string, string> };

// Server-side: build the 402 body, then verify+settle an incoming X-PAYMENT
// header against the official facilitator.
export async function settleFacilitator(
  req: Request,
  config: X402FacilitatorConfig,
  payeeAddress: Address,
): Promise<FacilitatorOutcome> {
  const network = getNetwork();
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: NETWORK_ID,
    maxAmountRequired: usdToAtomicUsdc(parsePriceUsd(config.price)),
    resource: config.resource,
    description: config.description,
    mimeType: "application/json",
    payTo: payeeAddress,
    maxTimeoutSeconds: 60,
    asset: network.usdcToken as Address,
    extra: { name: USDC_NAME, version: USDC_VERSION },
  };

  const xPayment = req.headers.get("x-payment");
  if (!xPayment) {
    return {
      paid: false,
      status: 402,
      body: { x402Version: 1, error: "X-PAYMENT header is required", accepts: [requirements] },
      headers: {},
    };
  }

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(Buffer.from(xPayment, "base64").toString("utf-8"));
  } catch {
    return {
      paid: false,
      status: 402,
      body: { x402Version: 1, error: "malformed X-PAYMENT header", accepts: [requirements] },
      headers: {},
    };
  }

  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements }),
  });
  const verifyBody = (await verifyRes.json()) as { isValid: boolean; invalidReason?: string; payer?: Address };
  if (!verifyBody.isValid) {
    return {
      paid: false,
      status: 402,
      body: { x402Version: 1, error: verifyBody.invalidReason ?? "verification_failed", accepts: [requirements] },
      headers: {},
    };
  }

  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements }),
  });
  const settleBody = (await settleRes.json()) as {
    success: boolean;
    errorReason?: string;
    transaction: string;
    payer: Address;
  };
  if (!settleBody.success) {
    return {
      paid: false,
      status: 402,
      body: { x402Version: 1, error: settleBody.errorReason ?? "settlement_failed", accepts: [requirements] },
      headers: {},
    };
  }

  const settlementResponse = Buffer.from(
    JSON.stringify({ success: true, transaction: settleBody.transaction, network: NETWORK_ID, payer: settleBody.payer }),
  ).toString("base64");

  return {
    paid: true,
    payer: settleBody.payer,
    txHash: settleBody.transaction as Hex,
    responseHeaders: { "x-payment-response": settlementResponse },
  };
}

function parsePriceUsd(price: string): number {
  return Number(price.replace(/^\$/, ""));
}

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Buffer.from(bytes).toString("hex")}` as Hex;
}

// Client-side: pay for a 402'd request by signing an EIP-3009
// TransferWithAuthorization (USDC) via Privy and settling it through the
// official facilitator, then retry with the X-PAYMENT proof.
export async function fetchWithFacilitatorPayment(
  url: string,
  payerExternalId: string,
  options: RequestInit = {},
): Promise<Response> {
  const first = await fetch(url, options);
  if (first.status !== 402) return first;

  const body = (await first.json()) as { accepts?: PaymentRequirements[] };
  const accept = body.accepts?.[0];
  if (!accept) return first;

  const wallet = await getAgentAccount(payerExternalId);
  const network = getNetwork();
  const from = wallet.account.address;

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from,
    to: accept.payTo,
    value: accept.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + accept.maxTimeoutSeconds),
    nonce: randomNonce(),
  };

  const domain = {
    name: accept.extra.name,
    version: accept.extra.version,
    chainId: network.chainId,
    verifyingContract: accept.asset,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const signature = await wallet.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  const paymentPayload: PaymentPayload = {
    x402Version: 1,
    scheme: "exact",
    network: NETWORK_ID,
    payload: { signature, authorization },
  };
  const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  return fetch(url, {
    ...options,
    headers: { ...options.headers, "x-payment": xPayment },
  });
}
