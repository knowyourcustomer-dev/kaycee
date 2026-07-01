/**
 * session-context.ts — read the current request's BYO session from the HttpOnly
 * cookie. Server-only. Kept tiny and separate so the connect route and the auth
 * broker share one definition of "which BYO session am I".
 *
 * The cookie holds the SEALED credential blob (see session-seal.ts). Because all
 * BFF routes are dynamic (per-request) and run on the server, the broker reads
 * this cookie via next/headers rather than threading a session token through the
 * KYC client — so the KYC API client contract stays unchanged.
 */

import "server-only";
import { cookies } from "next/headers";
import { unsealCredentials, type SessionCredentials } from "./session-seal";

/** Name of the HttpOnly cookie that carries the sealed BYO credential blob. */
export const SESSION_COOKIE = "kaycee_byo_sid";

/** Read the raw sealed cookie value (or null if the tester has not connected). */
export async function currentSessionSeal(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Unseal and return the BYO credentials for this request, or null if there is
 * no valid BYO session (no cookie, tampered, or wrong key). The secret never
 * leaves the server.
 */
export async function currentSessionCredentials(): Promise<SessionCredentials | null> {
  return unsealCredentials(await currentSessionSeal());
}
