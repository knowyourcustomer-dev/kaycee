// BFF: GET /api/session — non-secret session info + API version.
// First call triggers auto-provision (or uses static creds) via auth.ts.
import { handle } from "@/server/bff";
import { getSessionInfo } from "@/server/auth";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const [info, version] = await Promise.all([getSessionInfo(), kyc.version()]);
    return { ...info, version };
  });
}
