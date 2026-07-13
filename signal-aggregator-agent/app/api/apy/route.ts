import { settleMock, settleReal } from "../../../../shared/x402-mock";
import { logActivity } from "../../../../shared/activity-log";
import { getAgentAccount } from "../../../../shared/wallet";
import { aggregateApyForAsset } from "../../../lib/aggregator";

const PRICE_USD = 0.001;
const LIVE = process.env.X402_MODE === "live";

export async function GET(req: Request) {
  const start = Date.now();
  const outcome = LIVE
    ? await settleReal(
        req,
        {
          price: `$${PRICE_USD}`,
          description: "Aggregated APY estimate for a Celo stablecoin (signal-aggregator-agent). LIVE MODE — real CELO settles on-chain.",
        },
        (await getAgentAccount("signal-aggregator-agent-v1")).account.address,
      )
    : await settleMock(req, {
        price: `$${PRICE_USD}`,
        description: "Aggregated APY estimate for a Celo stablecoin (signal-aggregator-agent). MOCK MODE — no real funds move.",
      });

  if (!outcome.paid) {
    // Don't log 402s — they're routine (dashboard liveness pings, etc.)
    // and would flood the activity feed.
    return Response.json(outcome.body, { status: outcome.status, headers: outcome.headers });
  }

  const { searchParams } = new URL(req.url);
  const asset = (searchParams.get("asset") || "USDC").toUpperCase();

  const data = await aggregateApyForAsset(asset);
  const ms = Date.now() - start;

  await logActivity({
    agent: "signal-aggregator",
    type: "info",
    message: `Served APY snapshot for ${asset}: ${data.observations.length} pools scanned, best = ${data.bestPool?.pairLabel ?? "none"} (${ms}ms, charged $0.001)`,
    data: { asset, poolCount: data.observations.length, ms, earnedUsd: 0.001 },
  });

  return Response.json(data, {
    headers: outcome.responseHeaders,
  });
}