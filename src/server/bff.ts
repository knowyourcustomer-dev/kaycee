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
import { NotConnectedError } from "./auth";

/** Wrap a handler so KYC API errors become structured JSON, not stack traces. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data);
  } catch (err) {
    // No usable credentials (or they expired): surface 401 so the UI shows the
    // connect screen — there is NO auto-provisioned fallback tenant.
    if (err instanceof NotConnectedError) {
      return NextResponse.json(
        { error: "not_connected", detail: err.message },
        { status: 401 },
      );
    }
    if (err instanceof KycApiError) {
      return NextResponse.json(
        { error: "KYC API error", status: err.status, detail: err.body },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "BFF error", detail: message }, { status: 500 });
  }
}
