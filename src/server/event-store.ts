/**
 * event-store.ts — tiny in-memory store of received webhook events, keyed by
 * caseCommonId.
 *
 * The callback route records each delivered `{eventType, body}` payload here;
 * the browser follows a case's events via GET /api/cases/{id}/events and flips
 * the journey to "ready" when a CaseReady event arrives.
 *
 * KNOWN LIMITATION (fine for this reference app): the store is process memory.
 * It works at exactly ONE replica — behind multiple instances the webhook may
 * land on a different replica than the one the browser polls, and a restart
 * drops buffered events. That is why the journey keeps a slow direct
 * status-check safety net (see Journey.tsx): a lost delivery or cold start can
 * never wedge the flow. A production app would use a shared store (e.g. Redis)
 * or push straight to the client.
 *
 * NOTE on scoping: events are keyed by caseCommonId only, not tenant. Sandbox
 * case ids are globally unique, and the /events read surface exposes only
 * event metadata for a case id the caller already knows — acceptable for a
 * demo, called out here for honesty.
 *
 * Deliberately dependency-free so the unit tests can import it directly.
 */

/** One received webhook event, as delivered (envelope flattened). */
export interface StoredEvent {
  eventType: string;
  /** The delivery `body`: caseCommonId (string), caseName, message, extras. */
  body: Record<string, unknown>;
  /** Epoch ms when the callback received it. */
  receivedAt: number;
}

/** Keep at most this many events per case (defensive cap; a journey emits ~10). */
const MAX_EVENTS_PER_CASE = 200;
/** Forget a case's events after this long without new activity. */
const CASE_TTL_MS = 2 * 60 * 60 * 1000; // 2h

interface CaseEvents {
  events: StoredEvent[];
  lastTouched: number;
}

// Anchored on globalThis (the standard Next.js singleton pattern): route
// handlers can be bundled as separate module instances (and dev hot-reload
// re-instantiates modules), so a plain module-level Map would give the
// callback route and the events route DIFFERENT stores. One store per process.
const g = globalThis as unknown as { __kayceeEventStore?: Map<string, CaseEvents> };
const store: Map<string, CaseEvents> = (g.__kayceeEventStore ??= new Map());

/** Normalise a case id (number, "6053", "D0-D-2939") to a stable string key. */
function caseKey(id: unknown): string {
  return String(id).trim();
}

/** Drop cases that have been quiet longer than the TTL. */
function prune(now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.lastTouched > CASE_TTL_MS) store.delete(key);
  }
}

/**
 * Record a delivered webhook payload. Returns the case key it was filed under,
 * or null when the payload is not a usable `{eventType, body.caseCommonId}`
 * shape (the caller acks those with 2xx anyway — a malformed event is dropped,
 * not retried).
 */
export function recordEvent(payload: unknown, now: number = Date.now()): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { eventType?: unknown; body?: unknown };
  if (typeof p.eventType !== "string" || !p.eventType) return null;
  if (typeof p.body !== "object" || p.body === null) return null;
  const body = p.body as Record<string, unknown>;
  const ccid = body.caseCommonId;
  if (ccid === undefined || ccid === null || String(ccid).trim() === "") return null;

  prune(now);
  const key = caseKey(ccid);
  const entry = store.get(key) ?? { events: [], lastTouched: now };
  entry.events.push({ eventType: p.eventType, body, receivedAt: now });
  if (entry.events.length > MAX_EVENTS_PER_CASE) {
    entry.events.splice(0, entry.events.length - MAX_EVENTS_PER_CASE);
  }
  entry.lastTouched = now;
  store.set(key, entry);
  return key;
}

/**
 * Read a case's events from `since` (a cursor previously returned by this
 * function; 0 = from the start). Returns the new events and the next cursor so
 * the browser can poll incrementally without re-reading old events.
 */
export function eventsForCase(
  caseCommonId: unknown,
  since = 0,
): { events: StoredEvent[]; cursor: number } {
  const entry = store.get(caseKey(caseCommonId));
  if (!entry) return { events: [], cursor: since };
  const from = Math.max(0, Math.min(since, entry.events.length));
  return { events: entry.events.slice(from), cursor: entry.events.length };
}

/** True once a CaseReady event has been received for this case. */
export function caseIsReady(caseCommonId: unknown): boolean {
  const entry = store.get(caseKey(caseCommonId));
  return !!entry && entry.events.some((e) => e.eventType === "CaseReady");
}

/** Test hook: wipe the store. */
export function resetEventStore(): void {
  store.clear();
}
