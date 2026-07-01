/**
 * bff.ts — shared helpers for the route handlers (the backend-for-frontend).
 *
 * The BFF is intentionally THIN. Its only jobs: hold the secret (via auth.ts),
 * call the typed client, and translate errors into clean JSON for the browser.
 * A bank replaces this layer with their own API gateway; it is a pattern, not a
 * framework.
 */

import "server-only";
import { NextResponse } from "next/server";
import { KycApiError } from "./kyc-client";
import { resetSession, NotConnectedError } from "./auth";

/** Wrap a handler so KYC API errors become structured JSON, not stack traces. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data);
  } catch (err) {
    // BYO/static: the tester's (or configured) credentials are invalid/expired.
    // Surface 401 so the UI re-prompts — do NOT fall back to a throwaway tenant.
    if (err instanceof NotConnectedError) {
      return NextResponse.json(
        { error: "not_connected", detail: err.message },
        { status: 401 },
      );
    }
    if (err instanceof KycApiError) {
      // A 410 on the DEMO path means the ephemeral sandbox expired; reset so the
      // next call auto-provisions a fresh one. (No-op for BYO — it has no module
      // cache and handleExpiredSandbox() already refused to provision.)
      if (err.status === 410) resetSession();
      return NextResponse.json(
        { error: "KYC API error", status: err.status, detail: err.body },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "BFF error", detail: message }, { status: 500 });
  }
}
