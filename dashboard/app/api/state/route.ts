import { buildDashboardState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const state = await buildDashboardState();
  return Response.json(state);
}