// BFF: POST /api/cases { rawname, iso, externalCode? } -> create the entity case.
// rawname must be exactly the name the search returned; externalCode (the
// registration number) is forwarded when present to sharpen registry matching.
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";
import { ensureSubscription } from "@/server/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { rawname, iso, externalCode } = await req.json();
  return handle(async () => {
    // WEBHOOK MODE: lazily make sure this tenant has a subscription pointing at
    // our callback BEFORE the case is created, so its CaseReady can't slip past
    // us. Idempotent (dedupes by URL) and failure-tolerant: if the subscription
    // can't be ensured (older sandbox, network), it returns false and the
    // journey completes on the polling safety net instead — never a hard error.
    await ensureSubscription();
    return kyc.createCompany(rawname, iso, externalCode);
  });
}
