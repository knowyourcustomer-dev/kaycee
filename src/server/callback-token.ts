/**
 * callback-token.ts — shared-secret token for the webhook callback URL.
 *
 * Sandbox webhook deliveries carry NO auth headers or signature (parity with
 * the real product), so the callback route cannot authenticate the sender from
 * the request itself. Instead we embed a token in the URL we REGISTER with the
 * sandbox (`/api/webhooks/callback?t=<token>`): only parties who saw the
 * registered URL (the sandbox, and us) know it, so events presenting the right
 * token are accepted and everything else is rejected. The token is an HMAC of a
 * fixed context string under SESSION_SECRET — deterministic across replicas and
 * restarts (same property session-seal.ts relies on), and never stored.
 *
 * Server-side module. Deliberately dependency-free (node:crypto only) so the
 * unit tests can import it directly.
 */

import { createHmac, timingSafeEqual } from "crypto";

/** Context string for the HMAC — versioned so a future scheme can rotate. */
const TOKEN_CONTEXT = "kaycee-webhook-callback-v1";

/**
 * Dev fallback key — MUST match session-seal.ts so the two secret consumers
 * degrade identically in dev. Production sets SESSION_SECRET.
 */
const DEV_FALLBACK_SECRET = "dev-only-insecure-session-secret-change-me";

/** Compute the callback token (hex HMAC-SHA256). `secret` overrides for tests. */
export function computeCallbackToken(secret?: string): string {
  const s = secret || process.env.SESSION_SECRET || DEV_FALLBACK_SECRET;
  return createHmac("sha256", s).update(TOKEN_CONTEXT).digest("hex");
}

/**
 * Constant-time check of a presented `t` query value against the expected
 * token. Returns false for missing/empty/wrong-length input — never throws.
 */
export function callbackTokenMatches(
  presented: string | null | undefined,
  secret?: string,
): boolean {
  if (!presented) return false;
  const a = Buffer.from(String(presented), "utf8");
  const b = Buffer.from(computeCallbackToken(secret), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
