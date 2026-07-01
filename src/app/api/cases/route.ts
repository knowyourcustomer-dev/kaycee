// BFF: POST /api/cases { rawname, iso, externalCode? } -> create the entity case.
// rawname must be exactly the name the search returned; externalCode (the
// registration number) is forwarded when present to sharpen registry matching.
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { rawname, iso, externalCode } = await req.json();
  return handle(() => kyc.createCompany(rawname, iso, externalCode));
}
