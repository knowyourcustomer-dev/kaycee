/**
 * session-seal.ts — STATELESS per-session credential carrier. Server-only.
 * ========================================================================
 * Mirrors the Workspace console (workspace.knowyourcustomer.dev) so the
 * "bring your own sandbox credentials" (BYO) flow behaves identically across
 * the two surfaces. There is NO server-side session map.
 *
 * When a tester pastes their OWN sandbox clientId / clientSecret (issued by the
 * dev portal), we verify them and then seal the pair — AES-256-GCM authenticated
 * encryption — into the value of an HttpOnly session cookie. Any replica
 * (including a cold-started one) can UNSEAL the cookie with the shared
 * SESSION_SECRET and recover the creds, so the BYO session survives across
 * replicas / cold starts without a shared store.
 *
 * WHY BYO: the public demo auto-provisions a throwaway tenant, so a tester who
 * asked for sandbox access on the portal would otherwise see a DIFFERENT tenant
 * here than in the API / Console. Sealing their pasted creds into this session
 * points the sample onboarding flow at THEIR tenant — the same cases everywhere.
 *
 * SECURITY:
 *   - HttpOnly + Secure + SameSite=Lax: the browser never exposes the cookie to
 *     JS and only sends it over HTTPS.
 *   - The blob is ENCRYPTED, not just signed: the clientSecret is never readable
 *     by the browser even though the cookie lives there. Without the server's
 *     SESSION_SECRET the ciphertext is opaque.
 *   - GCM integrity: a tampered cookie fails to unseal (returns null), so a
 *     forged cookie cannot inject creds. Never throws on attacker input.
 *
 * KEY MANAGEMENT:
 *   - SESSION_SECRET (env) is the server key, run through scrypt to a 32-byte
 *     AES key. Any non-empty string works (32+ random chars recommended).
 *   - If unset, dev falls back to a fixed dev key with a one-time warning.
 *     Production MUST set it. Rotating the key invalidates live BYO sessions
 *     (testers simply re-connect) — acceptable here.
 */

import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

export interface SessionCredentials {
  clientId: string;
  clientSecret: string;
  scope: string;
}

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;
// Fixed salt: the key derives from a single long-lived server secret, not a
// per-user password, so a constant salt is fine and keeps unseal deterministic
// across replicas without storing a salt in the cookie.
const KEY_SALT = "kaycee-byo-session-v1";

const DEV_FALLBACK_SECRET = "dev-only-insecure-session-secret-change-me";

let warnedDevFallback = false;

/** Resolve the raw server secret, falling back (loudly) to a dev key. */
function serverSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length > 0) return s;
  if (!warnedDevFallback) {
    warnedDevFallback = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[session-seal] SESSION_SECRET is not set — using an INSECURE dev fallback key. " +
        "Set SESSION_SECRET in any non-dev deployment, or BYO sessions will be forgeable " +
        "and will break across key changes.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** Derive the 32-byte AES key from the server secret (cached per secret). */
let cachedKey: { secret: string; key: Buffer } | null = null;
function aesKey(): Buffer {
  const secret = serverSecret();
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = scryptSync(secret, KEY_SALT, 32);
  cachedKey = { secret, key };
  return key;
}

/**
 * Seal credentials into an opaque cookie value: base64url(iv | tag | cipher).
 * This is what we store in the session cookie and later unseal in the broker.
 */
export function sealCredentials(creds: SessionCredentials): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, aesKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(creds), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

/**
 * Unseal a cookie value back to credentials. Returns null on ANY failure
 * (missing/empty cookie, malformed blob, bad auth tag, wrong key) so callers
 * treat it exactly like "no BYO session" — never throws on attacker input.
 */
export function unsealCredentials(
  sealed: string | null | undefined,
): SessionCredentials | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, aesKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const obj = JSON.parse(dec.toString("utf8"));
    if (
      obj &&
      typeof obj.clientId === "string" &&
      typeof obj.clientSecret === "string" &&
      typeof obj.scope === "string"
    ) {
      return obj as SessionCredentials;
    }
    return null;
  } catch {
    return null;
  }
}
