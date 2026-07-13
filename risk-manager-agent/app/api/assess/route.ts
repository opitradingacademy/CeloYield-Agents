import { settleMock, settleReal } from "../../../../shared/x402-mock";
import { settleFacilitator } from "../../../../shared/x402-facilitator";
import { logActivity } from "../../../../shared/activity-log";
import { getAgentAccount } from "../../../../shared/wallet";
import { assessRisk } from "../../../lib/risk-scorer";

const PRICE_USD = 0.002;
const X402_MODE = process.env.X402_MODE ?? "mock";

export async function GET(req: Request) {
  const start = Date.now();
  const payeeAddress = (await getAgentAccount("risk-manager-agent-v1")).account.address;
  const outcome =
    X402_MODE === "facilitator"
      ? await settleFacilitator(
          req,
          {
            price: `$${PRICE_USD}`,
            description: "Risk assessment for a (protocol, asset) pair (risk-manager-agent).",
            resource: `${new URL(req.url).origin}/api/assess`,
          },
          payeeAddress,
        )
      : X402_MODE === "live"
        ? await settleReal(
            req,
            {
              price: `$${PRICE_USD}`,
              description: "Risk assessment for a (protocol, asset) pair (risk-manager-agent). LIVE MODE — real CELO settles on-chain.",
            },
            payeeAddress,
          )
        : await settleMock(req, {
            price: `$${PRICE_USD}`,
            description: "Risk assessment for a (protocol, asset) pair (risk-manager-agent). MOCK MODE — no real funds move.",
          });

  if (!outcome.paid) {
    // Don't log 402s — they're routine (dashboard liveness pings, etc.)
    // and would flood the activity feed.
    return Response.json(outcome.body, { status: outcome.status, headers: outcome.headers });
  }

  const { searchParams } = new URL(req.url);
  const protocol = (searchParams.get("protocol") || "Mento").trim();
  const asset = (searchParams.get("asset") || "USDC").trim();

  if (!protocol || !asset) {
    return Response.json(
      { error: "missing ?protocol=X&asset=Y" },
      { status: 400 },
    );
  }

  const data = await assessRisk(protocol, asset);
  const ms = Date.now() - start;

  await logActivity({
    agent: "risk-manager",
    type: "info",
    message: `Served risk assessment for ${protocol}/${asset}: score ${data.score}/100 (${ms}ms, charged $0.002)`,
    data: { protocol, asset, score: data.score, ms, earnedUsd: 0.002 },
  });

  return Response.json(data, {
    headers: outcome.responseHeaders,
  });
}