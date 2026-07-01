// BFF: POST /api/cases/{id}/close -> close the case; returns the derived decision.
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => kyc.closeCase(Number(id)));
}
