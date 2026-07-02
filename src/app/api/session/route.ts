// BFF: GET /api/session — non-secret session info + API version.
//
// This route must NEVER throw pre-connect: when there are no credentials
// anywhere (no BYO cookie, no env creds) it returns { mode: "disconnected" }
// so the UI can render the connect gate. The API version is only fetched when
// we actually have credentials to call with.
import { handle } from "@/server/bff";
import { getSessionInfo } from "@/server/auth";
import { webhookModeEnabled } from "@/server/config";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const info = await getSessionInfo();
    // `webhooks` tells the browser HOW case events arrive: true = the server
    // receives sandbox webhooks (APP_PUBLIC_URL set); false = the client polls.
    const webhooks = webhookModeEnabled();
    if (info.mode === "disconnected") {
      return { ...info, webhooks };
    }
    const version = await kyc.version();
    return { ...info, webhooks, version };
  });
}
