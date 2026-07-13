import { settleX402Payment } from "../../../lib/x402";
import { getRecentPrices } from "../../../lib/mento-prices";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pair = searchParams.get("pair"); // e.g. "USDm-EURm"

  if (!pair) {
    return Response.json({ error: "missing ?pair=BASE-QUOTE" }, { status: 400 });
  }

  const outcome = await settleX402Payment(req);

  if (!outcome.paid) {
    return Response.json(outcome.body, { status: outcome.status, headers: outcome.headers });
  }

  const volatility = await getRecentPrices(pair);
  return Response.json(volatility, { headers: outcome.responseHeaders });
}
