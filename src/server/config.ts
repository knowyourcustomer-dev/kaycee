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
 *                        When BOTH are set we run in STATIC-creds mode: the
 *                        deployment owner has supplied their own tenant
 *                        credentials and every visitor shares that tenant.
 *                        When absent, each visitor must CONNECT with their own
 *                        sandbox credentials (BYO) before the journey unlocks.
 *                        There is NO auto-provisioning path: credentials are
 *                        issued via the developer-portal access request
 *                        (https://knowyourcustomer.com/developers/access/).
 *   APP_PUBLIC_URL     — OPTIONAL. This app's own public origin (e.g.
 *                        https://kaycee.knowyourcustomer.dev). When set, the app
 *                        consumes case events via sandbox WEBHOOKS delivered to
 *                        `${APP_PUBLIC_URL}/api/webhooks/callback`. When unset
 *                        (e.g. a local clone the sandbox cannot reach), the app
 *                        falls back to polling case status. See webhooks.ts.
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

/**
 * Env-level run mode. "static" = the deployment supplies fixed creds via env;
 * "disconnected" = no env creds, so each visitor must connect their own (BYO).
 * (BYO itself is per-request session state, not an env mode — see auth.ts.)
 */
export type AuthMode = "static" | "disconnected";

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
   * Env-level auth mode: "static" when both creds are configured (e.g. the
   * live-env instance), otherwise "disconnected" — visitors must paste their
   * own sandbox credentials before the journey unlocks. NO auto-provisioning.
   */
  mode: (clientId && clientSecret ? "static" : "disconnected") as AuthMode,

  /**
   * This app's own public origin, when reachable by the sandbox. Set => case
   * events arrive as webhooks; unset => the journey polls (see webhooks.ts).
   */
  appPublicUrl: (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "") || null,
};

export function hasStaticCredentials(): boolean {
  return config.mode === "static";
}

/** True when APP_PUBLIC_URL is set and case events should arrive as webhooks. */
export function webhookModeEnabled(): boolean {
  return config.appPublicUrl !== null;
}
