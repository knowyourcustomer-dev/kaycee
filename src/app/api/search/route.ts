// BFF: POST /api/search { query, iso } -> company search results.
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { query, iso } = await req.json();
  return handle(() => kyc.searchCompanies(query, iso));
}
