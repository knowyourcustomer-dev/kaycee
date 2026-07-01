/**
 * config.ts — server-only configuration. NEVER import this from a client
 * component; it reads secrets from the environment.
 *
 * Meaningful values:
 *   SANDBOX_BASE_URL   — where the API lives (defaults to the public sandbox)
 *   SANDBOX_TOKEN_URL  — OPTIONAL override for the OAuth token endpoint. When
 *                        unset, the token URL is derived as
 *                        `${SANDBOX_BASE_URL}/connect/token` (unchanged
 *                        behaviour). Set it when the token host differs from the
 *                        API host (e.g. a second instance pointed at the live
 *                        env, where auth is on a separate host).
 *   SANDBOX_CLIENT_ID / SANDBOX_CLIENT_SECRET — optional long-lived credentials.
 *                        When BOTH are set we run in STATIC-creds mode (no
 *                        provisioning). When absent we run in SANDBOX mode and
 *                        auto-(re)provision an ephemeral tenant.
 *
 * Going to PRODUCTION is a config change, not a code change: point
 * SANDBOX_BASE_URL (and, if needed, SANDBOX_TOKEN_URL) at the live KYC API and
 * drop in a real client id + secret. The token-broker and typed client below do
 * not change.
 */

import "server-only";

const baseUrl = (process.env.SANDBOX_BASE_URL || "https://api.knowyourcustomer.dev").replace(
  /\/$/,
  "",
);

const clientId = process.env.SANDBOX_CLIENT_ID || null;
const clientSecret = process.env.SANDBOX_CLIENT_SECRET || null;

/** Run mode. "static" = fixed creds, no provisioning. "sandbox" = auto-provision. */
export type AuthMode = "static" | "sandbox";

export const config = {
  /** Base URL of the KYC API. */
  baseUrl,

  /**
   * Token endpoint. Defaults to `${baseUrl}/connect/token` unless
   * SANDBOX_TOKEN_URL overrides it (for envs where auth is on a separate host).
   */
  tokenUrl: (process.env.SANDBOX_TOKEN_URL || `${baseUrl}/connect/token`).trim(),

  /** Optional long-lived credentials (STATIC-creds mode when both present). */
  clientId,
  clientSecret,

  /** OAuth scope. The sandbox uses "PublicApi"; the live API is the same. */
  scope: process.env.SANDBOX_SCOPE || "PublicApi",

  /**
   * Auth mode: "static" when both creds are configured (no provisioning;
   * e.g. the live-env instance), otherwise "sandbox" (auto-(re)provision).
   */
  mode: (clientId && clientSecret ? "static" : "sandbox") as AuthMode,
};

export function hasStaticCredentials(): boolean {
  return config.mode === "static";
}
