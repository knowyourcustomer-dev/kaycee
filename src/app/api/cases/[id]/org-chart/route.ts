// BFF: GET /api/cases/{id}/org-chart -> the recursive ownership tree.
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => kyc.getOrgChart(Number(id)));
}
