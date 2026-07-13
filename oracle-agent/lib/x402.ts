import { createThirdwebClient } from "thirdweb";
import { celo, celoSepoliaTestnet } from "thirdweb/chains";
import { settlePayment, facilitator } from "thirdweb/x402";
import { getNetwork } from "../../shared/network";
import { ORACLE_PRICE_USD } from "../../shared/pricing";

const PRICE = `$${ORACLE_PRICE_USD}`;

export type PaymentOutcome =
  | { paid: true; responseHeaders: Record<string, string> }
  | { paid: false; status: number; body: unknown; headers: Record<string, string> };

// Two interchangeable implementations, picked via X402_MODE:
//
// - "thirdweb" (default): real settlement through thirdweb's hosted facilitator.
//   Costs money — their pricing page lists no free tier, lowest plan is
//   $99/mo plus a 0.3% fee per x402 transaction. Only use this once real
//   payment flows need to be demoed/tested with real funds.
// - "mock": a fake facilitator for local dev. It accepts a specific header
//   as "proof of payment" instead of verifying anything on-chain. This lets
//   the 402 -> pay -> 200 loop be exercised end-to-end for free, with zero
//   external services. NEVER use this once real money is meant to move.
export async function settleX402Payment(req: Request): Promise<PaymentOutcome> {
  const mode = process.env.X402_MODE || "mock";
  return mode === "thirdweb" ? settleWithThirdweb(req) : settleMock(req);
}

async function settleMock(req: Request): Promise<PaymentOutcome> {
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
            price: PRICE,
            description: "Rolling volatility reading for a Mento stablecoin pair (MOCK MODE — no real funds move)",
          },
        ],
      },
      headers: {},
    };
  }

  return { paid: true, responseHeaders: { "x-payment-mode": "mock" } };
}

async function settleWithThirdweb(req: Request): Promise<PaymentOutcome> {
  const network = getNetwork();
  const paymentData = req.headers.get("payment-signature") || req.headers.get("x-payment");

  const client = createThirdwebClient({ secretKey: process.env.THIRDWEB_SECRET_KEY! });
  const thirdwebFacilitator = facilitator({
    client,
    serverWalletAddress: process.env.ORACLE_WALLET_ADDRESS!,
  });

  const result = await settlePayment({
    resourceUrl: req.url,
    method: "GET",
    paymentData,
    payTo: process.env.ORACLE_WALLET_ADDRESS!,
    network: network.chainId === celo.id ? celo : celoSepoliaTestnet,
    price: PRICE,
    facilitator: thirdwebFacilitator,
    routeConfig: {
      description: "Rolling volatility reading for a Mento stablecoin pair",
    },
  });

  if (result.status !== 200) {
    return { paid: false, status: result.status, body: result.responseBody, headers: result.responseHeaders };
  }

  return { paid: true, responseHeaders: result.responseHeaders };
}
