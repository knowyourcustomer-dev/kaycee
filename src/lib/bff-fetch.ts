/**
 * bff-fetch.ts: tiny client-side helper that talks to OUR BFF (not the
 * sandbox). The browser never holds a credential or talks to the KYC API
 * directly; every call here hits /api/* on this same Next.js server.
 *
 * Every failure is thrown as a BffError whose `message` is meant for the
 * screen (every caller renders `e.message` in an error box), whose `status`
 * lets the UI tell "not connected" (a BFF 401, kind "bff_error") from other
 * failures, and whose `kind` says which of three things went wrong:
 *
 *   "network"   fetch() itself rejected: offline, DNS, TLS, or a proxy that
 *               dropped the connection. No response arrived at all.
 *   "not_json"  a response arrived but it is not the JSON our BFF sends: a
 *               corporate proxy / DLP / SSL-inspection block page, a gateway
 *               error page, an SSO interstitial. Every BFF route this helper
 *               is used for answers JSON on every branch (binary report and
 *               document downloads go through their own fetch, not this one),
 *               so a non-JSON body was put there by something between the
 *               browser and this server. The
 *               message says so, with the HTTP status and the request path, so
 *               the user's own network team can act on it. The body itself is
 *               NEVER parsed, thrown, or shown: the old code did
 *               `JSON.parse(text)` unconditionally and surfaced
 *               `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
 *               which told nobody anything (AIT-225).
 *   "bff_error" the BFF answered with its JSON error envelope; its `detail` /
 *               `error` is the message, exactly as before.
 */

export type BffFailureKind = "network" | "not_json" | "bff_error";

export class BffError extends Error {
  readonly kind: BffFailureKind;
  /** HTTP status of the response, or 0 when no response arrived. */
  readonly status: number;
  readonly method: string;
  readonly path: string;
  // Plain field assignments (not TS parameter properties) so the module stays
  // erasable-syntax and the tests can import it under Node's type stripping.
  constructor(message: string, kind: BffFailureKind, status: number, method: string, path: string) {
    super(message);
    this.name = "BffError";
    this.kind = kind;
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

/** True when the response declares a JSON media type (application/json, application/problem+json, ...). */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const media = contentType.split(";")[0].trim().toLowerCase();
  return media === "application/json" || media.endsWith("+json");
}

/**
 * True when the body reads as markup rather than JSON. JSON can never begin
 * with "<", so this is a total test on the one thing that matters: an HTML
 * block page is refused here even if the thing that injected it kept (or
 * forged) a JSON content-type header.
 */
export function looksLikeMarkup(text: string): boolean {
  return text.trimStart().startsWith("<");
}

/**
 * The media type of a content-type header, reduced to something safe to put in
 * a message (the header may have been written by whatever rewrote the
 * response). Only a conservative subset of the HTTP token alphabet is echoed
 * (letters, digits and `! # $ & ^ _ . + -`, one slash, at most 60 chars);
 * a media type outside that subset, even a syntactically valid one, is
 * described generically rather than echoed.
 */
export function describeContentType(contentType: string | null | undefined): string {
  if (!contentType) return "no content-type";
  const media = contentType.split(";")[0].trim().toLowerCase();
  if (!media) return "no content-type";
  if (media.length > 60 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(media)) {
    return "an unexpected content-type";
  }
  return media;
}

/** The hostname the page is served from, when running in a browser; "" in tests / SSR. */
function pageHost(): string {
  const loc = (globalThis as { location?: { host?: string } }).location;
  return typeof loc?.host === "string" ? loc.host : "";
}

export interface BffFailureInput {
  kind: BffFailureKind;
  method: string;
  path: string;
  /** 0 when no response arrived; for kind "network" a non-zero status means headers arrived but the body could not be read. */
  status: number;
  /** Raw content-type header of the response, if any. */
  contentType?: string | null;
  /** Message carried by a JSON error envelope (bff_error only). */
  detail?: string;
  /** Hostname to name in the "allow this host" advice; defaults to the page's own host. */
  host?: string;
}

/**
 * The human message for a failed BFF call. Pure, so tests pin the exact wording
 * per case. Plain English, no em-dashes, never any part of a response body.
 */
export function describeBffFailure(input: BffFailureInput): string {
  const where = `${input.method.toUpperCase()} ${input.path}`;
  const host = input.host ?? pageHost();
  const hostPhrase = host ? host : "this host";
  switch (input.kind) {
    case "network": {
      const what =
        input.status > 0
          ? `the reply to ${where} (HTTP ${input.status}) was cut off before it could be read`
          : `the request to ${where} got no response`;
      return (
        `Could not reach the app server: ${what}. ` +
        `Your connection may be down, or a corporate proxy or firewall may be blocking ${hostPhrase}. ` +
        `Check your network, then retry.`
      );
    }
    case "not_json": {
      const ct = describeContentType(input.contentType);
      const claimedJson = isJsonContentType(input.contentType);
      const shape = claimedJson
        ? // The header claimed JSON; name it only when it is safe to echo.
          `the reply was labelled ${ct === "an unexpected content-type" ? "as JSON" : ct} but is not JSON`
        : `the reply was ${ct}, not JSON`;
      return (
        `The response was blocked or rewritten before it reached the app, usually by a corporate proxy ` +
        `or content filter. Ask your network team to allow ${hostPhrase}, then retry. ` +
        `(${where} returned HTTP ${input.status}; ${shape}.)`
      );
    }
    case "bff_error":
      return input.detail && input.detail.length > 0 ? input.detail : `HTTP ${input.status}`;
  }
}

/**
 * Decide, from the response's declared type and body shape alone, whether the
 * body may be handed to JSON.parse. This is the guard AIT-225 exists for: it is
 * a property of the response, and everything the screen shows is downstream of it.
 */
export function bodyIsParseable(contentType: string | null | undefined, text: string): boolean {
  return isJsonContentType(contentType) && !looksLikeMarkup(text);
}

export async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch (e) {
    // A caller's own AbortController is not a network failure; let it through untouched.
    if (e instanceof Error && e.name === "AbortError") throw e;
    // No response at all.
    throw new BffError(describeBffFailure({ kind: "network", method, path, status: 0 }), "network", 0, method, path);
  }
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    // Headers arrived, the body did not: still a network failure, but the
    // status is known and is kept for the diagnosis.
    throw new BffError(
      describeBffFailure({ kind: "network", method, path, status: res.status }),
      "network",
      res.status,
      method,
      path,
    );
  }
  const contentType = res.headers.get("content-type");

  // An OK reply with no body (204-style) is the empty object, as before.
  if (res.ok && text.length === 0) return {} as T;

  // Anything that is not declared JSON, or that reads as markup, never reaches
  // JSON.parse and is never echoed. On a non-OK reply this also covers an empty
  // non-JSON body (a proxy 403 with nothing in it).
  if (!bodyIsParseable(contentType, text)) {
    throw new BffError(
      describeBffFailure({ kind: "not_json", method, path, status: res.status, contentType }),
      "not_json",
      res.status,
      method,
      path,
    );
  }

  let data: unknown;
  try {
    data = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    // Declared JSON, not markup, still unparseable: rewritten in transit or a
    // truncated body. Same advice, same rule: the body is not shown.
    throw new BffError(
      describeBffFailure({ kind: "not_json", method, path, status: res.status, contentType }),
      "not_json",
      res.status,
      method,
      path,
    );
  }

  if (!res.ok) {
    const env = (data ?? {}) as { error?: unknown; detail?: unknown };
    // First truthy of detail / error, as before; anything non-string is stringified.
    const raw = env.detail || env.error;
    const detail = !raw ? undefined : typeof raw === "string" ? raw : JSON.stringify(raw);
    throw new BffError(
      describeBffFailure({ kind: "bff_error", method, path, status: res.status, detail }),
      "bff_error",
      res.status,
      method,
      path,
    );
  }
  return data as T;
}
