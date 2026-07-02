// Webhook consumption plumbing: the callback URL token (deliveries carry no
// auth headers, so the token in the registered URL is the only authentication)
// and the in-memory event store the browser follows to flip the journey on
// CaseReady.
//
// These tests import the REAL source via Node's native TypeScript type
// stripping — no mirrored re-declaration to drift.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { computeCallbackToken, callbackTokenMatches } = await import(
  "../src/server/callback-token.ts"
);
const { recordEvent, eventsForCase, caseIsReady, resetEventStore } = await import(
  "../src/server/event-store.ts"
);

/* ---- callback token ---- */

test("token is deterministic per secret and validates in constant-time compare", () => {
  const t = computeCallbackToken("secret-a");
  assert.equal(t, computeCallbackToken("secret-a"), "same secret -> same token");
  assert.match(t, /^[0-9a-f]{64}$/, "hex HMAC-SHA256");
  assert.equal(callbackTokenMatches(t, "secret-a"), true);
});

test("wrong, missing, truncated, or cross-secret tokens are rejected", () => {
  const t = computeCallbackToken("secret-a");
  assert.equal(callbackTokenMatches(t, "secret-b"), false, "different secret");
  assert.equal(callbackTokenMatches(null, "secret-a"), false);
  assert.equal(callbackTokenMatches(undefined, "secret-a"), false);
  assert.equal(callbackTokenMatches("", "secret-a"), false);
  assert.equal(callbackTokenMatches(t.slice(0, -2), "secret-a"), false, "truncated");
  assert.equal(callbackTokenMatches(t + "00", "secret-a"), false, "padded");
  assert.equal(callbackTokenMatches("not-a-token", "secret-a"), false);
});

/* ---- event store: readiness flip ---- */

/** A delivery payload exactly as the sandbox POSTs it: {eventType, body},
 *  body.caseCommonId a STRING. */
const caseReady = {
  eventType: "CaseReady",
  body: {
    caseType: 1,
    caseCommonId: "6037",
    caseName: "Ubizense Limited",
    message: "Case 'Ubizense Limited' is ready.",
    caseProperties: {},
  },
};

beforeEach(() => resetEventStore());

test("CaseReady flips readiness for that case only", () => {
  assert.equal(caseIsReady("6037"), false);
  recordEvent({ eventType: "CaseCreated", body: { caseCommonId: "6037", caseName: "U" } });
  assert.equal(caseIsReady("6037"), false, "CaseCreated alone is not ready");
  recordEvent(caseReady);
  assert.equal(caseIsReady("6037"), true);
  assert.equal(caseIsReady("9999"), false, "other cases unaffected");
});

test("numeric and string case ids address the same bucket (body carries a string)", () => {
  recordEvent(caseReady);
  assert.equal(caseIsReady(6037), true, "browser-side numeric id resolves");
  assert.equal(eventsForCase(6037).events.length, 1);
});

test("cursor-based incremental read returns only new events", () => {
  recordEvent({ eventType: "CaseCreated", body: { caseCommonId: "6037" } });
  const first = eventsForCase("6037", 0);
  assert.equal(first.events.length, 1);
  assert.equal(first.cursor, 1);

  const nothingNew = eventsForCase("6037", first.cursor);
  assert.equal(nothingNew.events.length, 0);
  assert.equal(nothingNew.cursor, 1);

  recordEvent(caseReady);
  const next = eventsForCase("6037", first.cursor);
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].eventType, "CaseReady");
  assert.equal(next.cursor, 2);
});

test("malformed payloads are rejected (returned null) and never stored", () => {
  assert.equal(recordEvent(null), null);
  assert.equal(recordEvent("CaseReady"), null);
  assert.equal(recordEvent({ eventType: "CaseReady" }), null, "no body");
  assert.equal(recordEvent({ body: { caseCommonId: "1" } }), null, "no eventType");
  assert.equal(recordEvent({ eventType: "CaseReady", body: {} }), null, "no caseCommonId");
  assert.equal(eventsForCase("1").events.length, 0);
});

test("per-case cap keeps the newest events", () => {
  for (let i = 0; i < 250; i++) {
    recordEvent({ eventType: "DocumentUploaded", body: { caseCommonId: "7", seq: i } });
  }
  const { events } = eventsForCase("7");
  assert.equal(events.length, 200, "capped at 200");
  assert.equal(events[events.length - 1].body.seq, 249, "newest retained");
});

test("quiet cases are pruned after the TTL on the next write", () => {
  const t0 = 1_000_000;
  recordEvent(caseReady, t0);
  // A write for another case 3h later prunes the stale bucket.
  recordEvent({ eventType: "CaseCreated", body: { caseCommonId: "8" } }, t0 + 3 * 60 * 60 * 1000);
  assert.equal(caseIsReady("6037"), false, "stale case forgotten");
  assert.equal(eventsForCase("8").events.length, 1);
});
