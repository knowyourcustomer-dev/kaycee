/**
 * report-failure.mjs — how the report route explains an upstream failure.
 *
 * Plain ESM (not TS) on purpose: the route imports it through Next (allowJs)
 * and tests/report-download.test.mjs imports the SAME module under `node --test`
 * on Node 20+, so the assertions run against the real function rather than a
 * hand-kept mirror.
 *
 * Contract: the browser gets a short, human-readable `detail` plus the upstream
 * HTTP status. The upstream BODY is never echoed as-is. Kaycee sits behind the
 * sandbox's gateway, and a tester's own corporate proxy may sit in front of
 * Kaycee; either can answer with an HTML error page (a gateway timeout, a
 * proxy block page). Wrapping that HTML inside a JSON envelope is what a
 * tester saw on 2026-08-18, and it reads as if the app is broken. The only
 * upstream text passed through is a plain-text `message` from the API's own
 * JSON error envelope, and only for 4xx.
 */

/** Shown while the case is still building (the API answers 409). */
export const NOT_READY_MESSAGE = "The report is not ready yet — the case is still building.";

/** Shown for any upstream 5xx, and for a non-PDF body on an otherwise OK reply. */
export const RETRY_MESSAGE = "The report could not be retrieved right now. Please try again in a moment.";

/** Longest upstream message we will relay to the browser. */
export const MAX_RELAYED_MESSAGE = 300;

/** True when `text` reads as an HTML/XML document rather than data. */
export function looksLikeHtml(text) {
  const t = String(text ?? "").trimStart().toLowerCase();
  return t.startsWith("<");
}

/**
 * Extract a relayable plain-text `message` from an API JSON error envelope
 * (`{"statusCode":..,"message":"..","apiErrors":[..]}`). Returns null for
 * anything that is not JSON, has no string message, or contains markup.
 */
export function relayableMessage(body) {
  let parsed;
  try {
    parsed = JSON.parse(String(body ?? ""));
  } catch {
    return null;
  }
  const message = parsed && typeof parsed === "object" ? parsed.message : null;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || /[<>]/.test(trimmed)) return null;
  // Final length never exceeds MAX_RELAYED_MESSAGE, ellipsis included.
  return trimmed.length > MAX_RELAYED_MESSAGE ? `${trimmed.slice(0, MAX_RELAYED_MESSAGE - 1)}…` : trimmed;
}

/**
 * Describe an upstream non-2xx for the browser.
 * @param {number} status upstream HTTP status
 * @param {string} body upstream body text (any content type)
 * @returns {{ status: number, detail: string }}
 */
export function describeReportFailure(status, body) {
  if (status === 409) return { status, detail: NOT_READY_MESSAGE };
  if (status >= 500) return { status, detail: RETRY_MESSAGE };
  const relayed = looksLikeHtml(body) ? null : relayableMessage(body);
  return {
    status,
    detail: relayed ?? `The report request was rejected by the API (HTTP ${status}). Please try again in a moment.`,
  };
}
