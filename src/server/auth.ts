/**
 * auth.ts — the token broker. Lives ONLY on the server.
 *
 * TWO credential sources, in strict precedence order, resolved per request:
 *
 *   1. BYO (bring your own): the tester pasted THEIR sandbox clientId/secret on
 *      the connect screen; they are sealed (AES-256-GCM) into the HttpOnly
 *      session cookie (session-context.ts / session-seal.ts). When present, the
 *      sample flow runs against the TESTER'S tenant — the same cases they see in
 *      the API and the Workspace Console. Minted per request, NEVER cached in a
 *      module global (a process global would leak one tester's token to another).
 *   2. STATIC: long-lived creds from SANDBOX_CLIENT_ID / SANDBOX_CLIENT_SECRET —
 *      the deployment owner's OWN credentials in the environment (e.g. the
 *      live-env instance, or a self-hosted clone). No provisioning.
 *
 * With NEITHER, the session is DISCONNECTED: every API-touching call throws
 * NotConnectedError and the UI shows the connect screen. There is NO
 * auto-provisioning fallback — users obtain credentials through the
 * developer-portal access request (https://knowyourcustomer.com/developers/access/)
 * and paste them into the app (or set them in the env for a private deployment).
 *
 * The client secret NEVER leaves this process in plaintext. The browser talks
 * to our own route handlers (the BFF); the BFF attaches the bearer token here.
 * For BYO the secret lives only inside the ENCRYPTED cookie blob, which the
 * browser cannot read (HttpOnly) or decrypt.
 *
 * The module-level token cache below is used ONLY by the static
 * (process-single-tenant) path — never by BYO.
 */

import "server-only";
import { config, hasStaticCredentials } from "./config";
import { currentSessionCredentials } from "./session-context";
import { sealCredentials, type SessionCredentials } from "./session-seal";

/** Thrown when there are no usable credentials for this request. */
export class NotConnectedError extends Error {
  constructor(message = "Not connected. Paste fresh sandbox credentials.") {
    super(message);
    this.name = "NotConnectedError";
  }
}

interface CachedToken {
  accessToken: string;
  /** epoch ms when we should consider the token stale and refresh it. */
  refreshAt: number;
}

// Module-level token cache — STATIC path ONLY. BYO never touches this.
let cachedToken: CachedToken | null = null;

/** Low-level token exchange. Returns null on auth failure (401/403/410). */
async function mintTokenRaw(creds: {
  clientId: string;
  clientSecret: string;
  scope: string;
}): Promise<CachedToken | null> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: creds.scope,
  });
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403 || res.status === 410) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (HTTP ${res.status}): ${text}`);
  }
  const data = await res.json();
  const expiresIn = Number(data.expires_in) || 600;
  // Refresh 60s before actual expiry so calls never race a dead token.
  const refreshAt = Date.now() + Math.max(30, expiresIn - 60) * 1000;
  return { accessToken: data.access_token, refreshAt };
}

/* -------------------------------------------------------------------------
 * BYO connect flow
 * ------------------------------------------------------------------------- */

/**
 * Verify a pasted credential pair by minting a token; on success seal it into a
 * session-cookie value and return it. Throws NotConnectedError if the creds are
 * rejected (401/410) so the connect screen can show a clean message. The secret
 * is consumed here and sealed — it is never returned to the browser in the
 * clear.
 */
export async function connect(
  clientId: string,
  clientSecret: string,
): Promise<{ sessionSeal: string }> {
  const creds: SessionCredentials = {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    scope: config.scope,
  };
  const token = await mintTokenRaw(creds);
  if (!token) {
    throw new NotConnectedError(
      "Those credentials were rejected (401/410). Check the clientId/secret from the dev portal — sandbox credentials expire after 48h.",
    );
  }
  return { sessionSeal: sealCredentials(creds) };
}

/* -------------------------------------------------------------------------
 * Per-request bearer token
 * ------------------------------------------------------------------------- */

/**
 * Return a valid bearer token for THIS request.
 *
 *   - BYO session present  -> mint from the sealed cookie creds, per request,
 *     no module cache. On 401/410 throw NotConnectedError — the tester
 *     re-connects with fresh credentials.
 *   - STATIC creds         -> module-cached token; on 401/410 throw a clear
 *     config error.
 *   - Neither              -> throw NotConnectedError. NEVER provision.
 */
export async function getBearerToken(): Promise<string> {
  // 1. BYO — the tester's own tenant. Stateless: mint per request.
  const byo = await currentSessionCredentials();
  if (byo) {
    const token = await mintTokenRaw(byo);
    if (!token) {
      throw new NotConnectedError(
        "Your sandbox credentials are no longer valid (they may have expired after 48h). Paste fresh credentials from the dev portal.",
      );
    }
    return token.accessToken;
  }

  // 2. Static — the deployment's own env credentials, module-cached token.
  if (!hasStaticCredentials()) {
    throw new NotConnectedError(
      "Not connected. Request sandbox access at https://knowyourcustomer.com/developers/access/ and paste your client ID and secret to start.",
    );
  }
  if (cachedToken && Date.now() < cachedToken.refreshAt) {
    return cachedToken.accessToken;
  }
  const token = await mintTokenRaw({
    clientId: config.clientId as string,
    clientSecret: config.clientSecret as string,
    scope: config.scope,
  });
  if (!token) {
    // STATIC mode: do NOT provision. Surface a clear error.
    throw new Error(
      "Token request failed: the configured credentials were rejected (401/410). " +
        "Check SANDBOX_CLIENT_ID / SANDBOX_CLIENT_SECRET.",
    );
  }
  cachedToken = token;
  return cachedToken.accessToken;
}

/** Surface non-secret session info for the UI status banner / connect gate. */
export async function getSessionInfo() {
  const byo = await currentSessionCredentials();
  if (byo) {
    return {
      // clientId is not a secret; showing it lets the tester confirm WHICH
      // tenant they are connected as, without exposing the secret.
      tenantId: byo.clientId,
      expiresAt: null,
      baseUrl: config.baseUrl,
      mode: "byo" as const,
    };
  }
  if (hasStaticCredentials()) {
    return {
      tenantId: config.clientId,
      expiresAt: null,
      baseUrl: config.baseUrl,
      mode: "static" as const,
    };
  }
  // No credentials anywhere: the UI gates the journey behind the connect
  // screen. This function MUST NOT throw pre-connect — GET /api/session uses it
  // to render the gate itself.
  return {
    tenantId: null,
    expiresAt: null,
    baseUrl: config.baseUrl,
    mode: "disconnected" as const,
  };
}
