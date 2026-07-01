/**
 * auth.ts — the token broker. Lives ONLY on the server.
 *
 * THREE credential sources, in strict precedence order, resolved per request:
 *
 *   1. BYO (bring your own): the developer pasted THEIR sandbox clientId/secret
 *      on the connect screen; they are sealed (AES-256-GCM) into the HttpOnly
 *      session cookie (session-context.ts / session-seal.ts). When present, the
 *      sample flow runs against the DEVELOPER'S tenant, so they see the same
 *      cases they see when calling the API directly. Minted per request, NEVER
 *      cached in a module global (a process global would leak one session's
 *      token to another).
 *   2. STATIC: long-lived creds from SANDBOX_CLIENT_ID / SANDBOX_CLIENT_SECRET.
 *      No provisioning.
 *   3. DEMO auto-provision: no creds anywhere, so provision a throwaway tenant
 *      so the public no-login demo still works.
 *
 * GUARD: BYO and STATIC must NEVER auto-provision on 401/410 — they surface the
 * error (expired/invalid sandbox) so the tester re-connects. ONLY the demo path
 * provisions. This is the whole point: a BYO tester must never be silently
 * bounced onto a fresh throwaway tenant behind their back.
 *
 * The client secret NEVER leaves this process in plaintext. The browser talks
 * to our own route handlers (the BFF); the BFF attaches the bearer token here.
 * For BYO the secret lives only inside the ENCRYPTED cookie blob, which the
 * browser cannot read (HttpOnly) or decrypt.
 *
 * The module-level token/creds caches below are used ONLY by the static/demo
 * (process-single-tenant) paths — never by BYO.
 */

import "server-only";
import { config, hasStaticCredentials } from "./config";
import { currentSessionCredentials } from "./session-context";
import { sealCredentials, type SessionCredentials } from "./session-seal";

/** Thrown when a BYO session's credentials are missing / rejected / expired. */
export class NotConnectedError extends Error {
  constructor(message = "Not connected. Paste fresh sandbox credentials.") {
    super(message);
    this.name = "NotConnectedError";
  }
}

interface Credentials {
  clientId: string;
  clientSecret: string;
  scope: string;
  tenantId?: string;
  expiresAt?: string;
  ephemeral: boolean;
}

interface CachedToken {
  accessToken: string;
  /** epoch ms when we should consider the token stale and refresh it. */
  refreshAt: number;
}

// Module-level caches — STATIC/DEMO paths ONLY. BYO never touches these.
let credsPromise: Promise<Credentials> | null = null;
let cachedToken: CachedToken | null = null;

/* -------------------------------------------------------------------------
 * EXTENSION POINT — FUTURE SELF-SERVICE SIGNUP GATE
 * -------------------------------------------------------------------------
 * Today, a credential-less dev is auto-provisioned a fresh sandbox directly
 * against the OPEN `POST /sandbox/provision` endpoint (no auth, no gate). When
 * the Phase 2 click-through-agreement lands, REPLACE the provision call in
 * `provisionSandbox()` with the gated flow. Everything downstream is unchanged.
 * ------------------------------------------------------------------------- */

async function provisionSandbox(): Promise<Credentials> {
  const res = await fetch(`${config.baseUrl}/sandbox/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "kaycee-onboarding-web" }), // <-- gate goes here
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sandbox provision failed (HTTP ${res.status}): ${text}`);
  }
  const data = await res.json();
  return {
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    scope: data.scope || config.scope,
    tenantId: data.tenantId,
    expiresAt: data.expiresAt,
    ephemeral: true,
  };
}

/**
 * Non-BYO credential source: STATIC env creds, else DEMO auto-provision.
 * (BYO is resolved separately, per request, from the sealed cookie.)
 */
async function obtainCredentials(): Promise<Credentials> {
  if (hasStaticCredentials()) {
    return {
      clientId: config.clientId as string,
      clientSecret: config.clientSecret as string,
      scope: config.scope,
      ephemeral: false,
    };
  }
  return provisionSandbox();
}

/** Load static/demo credentials once and memoise the promise. */
function getCredentials(): Promise<Credentials> {
  if (!credsPromise) {
    credsPromise = obtainCredentials().catch((err) => {
      credsPromise = null; // allow retry on next call
      throw err;
    });
  }
  return credsPromise;
}

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
 *     no module cache. On 401/410 throw NotConnectedError — NEVER provision.
 *   - STATIC creds         -> module-cached token; on 401/410 throw — NEVER
 *     provision.
 *   - DEMO (no creds)      -> module-cached token; on 401/410 re-provision a
 *     fresh tenant once and retry (the only path that provisions).
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

  // 2 & 3. Static / demo — module-cached token.
  if (cachedToken && Date.now() < cachedToken.refreshAt) {
    return cachedToken.accessToken;
  }
  let creds = await getCredentials();
  let token = await mintTokenRaw(creds);

  if (!token) {
    if (hasStaticCredentials()) {
      // STATIC mode: do NOT provision. Surface a clear error.
      throw new Error(
        "Token request failed: the configured credentials were rejected (401/410). " +
          "Check SANDBOX_CLIENT_ID / SANDBOX_CLIENT_SECRET.",
      );
    }
    // DEMO mode: tenant gone/expired — re-provision and retry once.
    resetSession();
    creds = await getCredentials();
    token = await mintTokenRaw(creds);
    if (!token) {
      throw new Error("Token request failed after re-provisioning a fresh sandbox tenant.");
    }
  }

  cachedToken = token;
  return cachedToken.accessToken;
}

/**
 * Called by the API client when a downstream /v2 call reports the sandbox is
 * gone/expired (410/401-with-sandbox). Returns true only when a re-provision
 * will actually be attempted — i.e. the DEMO path. Returns false for BYO and
 * STATIC so the client does NOT retry and instead surfaces the error.
 */
export async function handleExpiredSandbox(): Promise<boolean> {
  // BYO: never provision. The tester's tenant expiring is a real, surfaced state.
  if (await currentSessionCredentials()) return false;
  if (hasStaticCredentials()) return false;
  resetSession();
  return true;
}

/** Surface non-secret session info for the UI status banner. */
export async function getSessionInfo() {
  const byo = await currentSessionCredentials();
  if (byo) {
    return {
      // clientId is not a secret; showing it lets the tester confirm WHICH
      // tenant they are connected as, without exposing the secret.
      tenantId: byo.clientId,
      ephemeral: false,
      expiresAt: null,
      baseUrl: config.baseUrl,
      mode: "byo" as const,
    };
  }
  const creds = await getCredentials();
  return {
    tenantId: creds.tenantId ?? null,
    ephemeral: creds.ephemeral,
    expiresAt: creds.expiresAt ?? null,
    baseUrl: config.baseUrl,
    mode: config.mode,
  };
}

/** Force a re-provision + re-token (DEMO path only; used if a sandbox expires). */
export function resetSession() {
  credsPromise = null;
  cachedToken = null;
}
