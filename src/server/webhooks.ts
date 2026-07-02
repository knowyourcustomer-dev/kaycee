/**
 * webhooks.ts — subscription lifecycle for the sandbox's webhook feature.
 *
 * WEBHOOKS vs POLLING (both live in this codebase, deliberately):
 *   - WEBHOOK MODE (APP_PUBLIC_URL set): the recommended integration, and how
 *     the real KYC product notifies customers. We register a subscription on
 *     the CURRENT tenant (BYO or static) pointing at our own
 *     /api/webhooks/callback route; the sandbox POSTs `{eventType, body}`
 *     events there; the browser follows them via the local event store.
 *   - POLLING (APP_PUBLIC_URL unset — e.g. a local clone the sandbox cannot
 *     reach): the journey polls GET /v2/Companies/{id} for statusId. That path
 *     is kept fully working in Journey.tsx as the documented alternative.
 *
 * Sandbox webhook contract (management surface, tenant-scoped, bearer-authed):
 *   POST /sandbox/webhooks/subscriptions   body (snake_case):
 *        { url, event_types: [...], active }   -> 201, response camelCase
 *   GET  /sandbox/webhooks/subscriptions   -> [ { id, url, eventTypes, ... } ]
 * Deliveries: POST {eventType, body} to the URL; any 2xx acks; 10 retries with
 * capped backoff, then the URL is blocked for 1h and the event dropped. No
 * auth headers/signature on deliveries — hence the ?t= token in our URL (see
 * callback-token.ts).
 *
 * IMPORTANT: the sandbox does NOT prevent duplicate-URL subscriptions, so we
 * dedupe client-side — list first, create only if our exact callback URL is
 * absent. And the tenant is SHARED with the tester's other surfaces (API,
 * Workspace console): we never delete or modify subscriptions we didn't
 * create; we only ever add our own missing one.
 */

import "server-only";
import { config, webhookModeEnabled } from "./config";
import { getBearerToken, getSessionInfo } from "./auth";
import { computeCallbackToken } from "./callback-token";

/**
 * The events Kaycee subscribes to: CaseReady drives the journey's "verified"
 * flip; the others feed the internal debug stream (a nice live demo of the
 * webhook feature). The sandbox supports ten — subscribe to what you consume.
 */
export const KAYCEE_EVENT_TYPES = [
  "CaseReady",
  "DocumentUploaded",
  "AmlMatch",
  "CaseClosed",
] as const;

/** The exact callback URL we register (token included), or null when polling. */
export function callbackUrl(): string | null {
  if (!config.appPublicUrl) return null;
  return `${config.appPublicUrl}/api/webhooks/callback?t=${computeCallbackToken()}`;
}

// Per-process memo of tenants whose subscription we recently verified, so a
// burst of case creations doesn't re-list on every request. Small + TTL'd;
// losing it on restart just costs one extra GET.
const ensuredTenants = new Map<string, number>();
const ENSURE_TTL_MS = 5 * 60 * 1000;

/**
 * Idempotently make sure THIS app has a webhook subscription on the current
 * tenant (BYO cookie creds or static env creds). Called lazily when a case is
 * created in webhook mode.
 *
 * Returns true when a subscription for our callback URL exists (found or
 * created). Returns false — and logs — on ANY failure (sandbox without the
 * webhook feature, network trouble, no credentials): the caller treats false
 * as "webhooks unavailable" and the journey's polling safety net still
 * completes the flow. Webhook trouble must never break case creation.
 */
export async function ensureSubscription(): Promise<boolean> {
  const url = callbackUrl();
  if (!webhookModeEnabled() || !url) return false;

  try {
    // Identify the tenant for the memo (clientId is the stable tenant handle).
    const info = await getSessionInfo();
    if (info.mode === "disconnected") return false;
    const tenantKey = `${info.mode}:${info.tenantId ?? ""}`;
    const ensuredAt = ensuredTenants.get(tenantKey);
    const now = Date.now();
    if (ensuredAt !== undefined && now - ensuredAt < ENSURE_TTL_MS) return true;

    const token = await getBearerToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Dedupe by URL: the sandbox happily stores duplicates, so we only create
    // when our exact callback URL is not already subscribed on this tenant.
    const listRes = await fetch(`${config.baseUrl}/sandbox/webhooks/subscriptions`, {
      headers,
      cache: "no-store",
    });
    if (!listRes.ok) {
      throw new Error(`list subscriptions -> HTTP ${listRes.status}`);
    }
    const subs = (await listRes.json()) as Array<{ url?: string; active?: boolean }>;
    const existing = Array.isArray(subs) && subs.some((s) => s?.url === url);

    if (!existing) {
      const createRes = await fetch(`${config.baseUrl}/sandbox/webhooks/subscriptions`, {
        method: "POST",
        headers,
        cache: "no-store",
        // Create body is snake_case (sandbox management contract).
        body: JSON.stringify({ url, event_types: KAYCEE_EVENT_TYPES, active: true }),
      });
      if (!createRes.ok) {
        throw new Error(`create subscription -> HTTP ${createRes.status}`);
      }
    }

    ensuredTenants.set(tenantKey, now);
    return true;
  } catch (err) {
    // Fall back to polling silently (from the user's point of view): log for
    // the operator, return false, journey continues on the status-check path.
    console.warn(
      `[webhooks] could not ensure subscription — falling back to polling: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
