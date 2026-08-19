// AIT-225: the client-side BFF helper must never hand a non-JSON body to
// JSON.parse, and must tell the user (and their network team) something they can
// act on. On 2026-08-05 a bank's proxy / DLP layer answered a credential POST
// (on the sibling Workspace console) with an HTML block page; the old helper did `JSON.parse(text)`
// unconditionally and the screen showed
//   Unexpected token '<', "<!DOCTYPE "... is not valid JSON
// which told nobody anything.
//
// These tests import the REAL module (src/lib/bff-fetch.ts) via Node's native
// TypeScript type stripping (Node >= 22.18, the same way member-resolve.test.mjs
// does), so they exercise the shipped code, not a hand-copy of it. `fetch` is replaced per test with a stub that returns
// a real `Response`, so the guard is driven through the same headers/body API
// the browser gives it.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const {
  bff,
  BffError,
  describeBffFailure,
  describeContentType,
  isJsonContentType,
  looksLikeMarkup,
  bodyIsParseable,
} = await import("../src/lib/bff-fetch.ts");

const BLOCK_PAGE =
  '<!DOCTYPE html><html><head><title>Access Denied</title></head>' +
  "<body><h1>This request was blocked by your organisation's web filter.</h1></body></html>";

const realFetch = globalThis.fetch;
const realParse = JSON.parse;
let parseInputs;

beforeEach(() => {
  // Spy on JSON.parse for the whole test: every string it is handed is recorded,
  // so a test can prove that no markup ever reached it (not merely that the
  // outcome looked right).
  parseInputs = [];
  JSON.parse = function (text, ...rest) {
    parseInputs.push(String(text));
    return realParse.call(JSON, text, ...rest);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  JSON.parse = realParse;
});

// Builds a real `Response`. Two undici realities matter here: a string body
// makes Response ADD `content-type: text/plain;charset=UTF-8` on its own, so a
// "no content-type" reply has to be built from bytes; and a 204/205/304 must
// carry a null body.
function stubResponse(body, { status = 200, contentType } = {}) {
  const headers = {};
  if (contentType !== undefined && contentType !== null) headers["content-type"] = contentType;
  const nullBodyStatus = status === 204 || status === 205 || status === 304;
  const payload = nullBodyStatus ? null : contentType === null ? new TextEncoder().encode(body) : body;
  globalThis.fetch = async () => new Response(payload, { status, headers });
}

// Every string JSON.parse was handed since the test began; none may be markup.
// (Not asserted empty: the runtime itself may parse things while a test runs.)
function assertNoMarkupParsed() {
  const markup = parseInputs.filter((s) => s.trimStart().startsWith("<"));
  assert.deepEqual(markup, [], "JSON.parse was handed markup");
}

async function failure(path, init) {
  try {
    await bff(path, init);
  } catch (e) {
    return e;
  }
  assert.fail("bff() resolved; expected it to throw");
}

// The one property every user-facing message must have: nothing from the body,
// nothing that looks like a parser error, no em-dash.
function assertHumanMessage(msg) {
  assert.equal(typeof msg, "string");
  assert.equal(msg.includes("<"), false, "message must not contain any part of the body");
  assert.equal(msg.includes("DOCTYPE"), false);
  assert.equal(msg.includes("Unexpected token"), false);
  assert.equal(msg.includes("is not valid JSON"), false);
  assert.equal(msg.includes("—"), false, "no em-dashes in user-facing text");
}

// ---------------------------------------------------------------------------
// Case 1: non-JSON body (proxy / DLP / gateway page). The exact HASE shape.
// ---------------------------------------------------------------------------

test("HTML block page on the Connect POST: human message with status + path, body never parsed", async () => {
  stubResponse(BLOCK_PAGE, { status: 403, contentType: "text/html; charset=utf-8" });
  const e = await failure("/api/session/credentials", { method: "POST", body: JSON.stringify({ clientId: "x", clientSecret: "y" }) });
  assert.ok(e instanceof BffError, `expected BffError, got ${e?.constructor?.name}: ${e?.message}`);
  assert.equal(e.kind, "not_json");
  assert.equal(e.status, 403);
  assert.equal(e.method, "POST");
  assert.equal(e.path, "/api/session/credentials");
  assertHumanMessage(e.message);
  assert.match(e.message, /blocked or rewritten before it reached the app/);
  assert.match(e.message, /corporate proxy or content filter/);
  assert.match(e.message, /Ask your network team to allow this host, then retry/);
  assert.match(e.message, /POST \/api\/session\/credentials returned HTTP 403/);
  assert.match(e.message, /the reply was text\/html, not JSON/);
  // The guard: JSON.parse never saw the page.
  assertNoMarkupParsed();
});

test("HTML body under a forged application/json content-type is still refused, never parsed", async () => {
  stubResponse(BLOCK_PAGE, { status: 200, contentType: "application/json" });
  const e = await failure("/api/cases/123");
  assert.equal(e.kind, "not_json");
  assert.equal(e.status, 200);
  assertHumanMessage(e.message);
  assert.match(e.message, /GET \/api\/cases\/123 returned HTTP 200/);
  assert.match(e.message, /labelled application\/json but is not JSON/);
  assertNoMarkupParsed();
});

test("HTML with a 200 (SSO interstitial / captive portal) is a not_json failure, not a success", async () => {
  stubResponse("<html><body>Sign in to continue</body></html>", { status: 200, contentType: "text/html" });
  const e = await failure("/api/session");
  assert.equal(e.kind, "not_json");
  assert.match(e.message, /GET \/api\/session returned HTTP 200/);
  assertNoMarkupParsed();
});

test("empty non-JSON body on a non-OK reply (proxy 403 with nothing in it) is reported as rewritten", async () => {
  stubResponse("", { status: 403, contentType: "text/plain" });
  const e = await failure("/api/session/credentials", { method: "POST" });
  assert.equal(e.kind, "not_json");
  assert.match(e.message, /POST \/api\/session\/credentials returned HTTP 403; the reply was text\/plain, not JSON/);
});

test("no content-type at all with a non-JSON body: reported, not parsed", async () => {
  stubResponse("Service Unavailable", { status: 503, contentType: null });
  const e = await failure("/api/cases");
  assert.equal(e.kind, "not_json");
  assert.match(e.message, /the reply was no content-type, not JSON/);
  assertNoMarkupParsed();
});

test("declared JSON that does not parse (rewritten / truncated in transit) is a not_json failure, body not shown", async () => {
  stubResponse('{"connected": tru', { status: 200, contentType: "application/json" });
  const e = await failure("/api/session/credentials", { method: "POST" });
  assert.equal(e.kind, "not_json");
  assertHumanMessage(e.message);
  assert.equal(e.message.includes("connected"), false, "no fragment of the body in the message");
  assert.match(e.message, /labelled application\/json but is not JSON/);
});

test("the content-type named in the message is sanitised, never echoed raw", () => {
  assert.equal(describeContentType("text/html; charset=utf-8"), "text/html");
  assert.equal(describeContentType("Application/JSON"), "application/json");
  assert.equal(describeContentType(null), "no content-type");
  assert.equal(describeContentType(""), "no content-type");
  assert.equal(describeContentType("<script>alert(1)</script>"), "an unexpected content-type");
  assert.equal(describeContentType("text/" + "x".repeat(80)), "an unexpected content-type");
  assert.equal(describeContentType("not a media type"), "an unexpected content-type");
});

// ---------------------------------------------------------------------------
// Case 2: JSON error from the BFF. Its message is shown, as before.
// ---------------------------------------------------------------------------

test("JSON 401 from the BFF: BffError kind=bff_error, status 401, BFF detail as message (the connect-gate signal)", async () => {
  stubResponse(JSON.stringify({ error: "not_connected", detail: "Those credentials were rejected (401)." }), {
    status: 401,
    contentType: "application/json",
  });
  const e = await failure("/api/session");
  assert.ok(e instanceof BffError);
  assert.equal(e.kind, "bff_error");
  assert.equal(e.status, 401);
  assert.equal(e.message, "Those credentials were rejected (401).");
});

test("a proxy 401 HTML page is NOT the connect-gate signal: kind=not_json even though status is 401", async () => {
  stubResponse(BLOCK_PAGE, { status: 401, contentType: "text/html" });
  const e = await failure("/api/session");
  assert.ok(e instanceof BffError);
  assert.equal(e.status, 401);
  assert.equal(e.kind, "not_json");
  assertNoMarkupParsed();
});

test("JSON error envelope from the BFF: detail is the message, kind=bff_error, status carried", async () => {
  stubResponse(JSON.stringify({ error: "connect_failed", detail: "Token endpoint returned 503." }), {
    status: 502,
    contentType: "application/json; charset=utf-8",
  });
  const e = await failure("/api/session/credentials", { method: "POST" });
  assert.ok(e instanceof BffError);
  assert.equal(e.kind, "bff_error");
  assert.equal(e.status, 502);
  assert.equal(e.message, "Token endpoint returned 503.");
});

test("JSON error envelope with only `error` falls back to it; with neither, HTTP <status>", async () => {
  stubResponse(JSON.stringify({ error: "bad_request" }), { status: 400, contentType: "application/json" });
  assert.equal((await failure("/api/x")).message, "bad_request");
  stubResponse(JSON.stringify({}), { status: 500, contentType: "application/json" });
  assert.equal((await failure("/api/x")).message, "HTTP 500");
  stubResponse(JSON.stringify({ detail: { code: 7 } }), { status: 422, contentType: "application/json" });
  assert.equal((await failure("/api/x")).message, '{"code":7}');
});

test("application/problem+json counts as JSON", async () => {
  stubResponse(JSON.stringify({ detail: "Problem." }), { status: 409, contentType: "application/problem+json" });
  const e = await failure("/api/x");
  assert.equal(e.kind, "bff_error");
  assert.equal(e.message, "Problem.");
});

// ---------------------------------------------------------------------------
// Case 3: network failure. fetch() rejects; no response at all.
// ---------------------------------------------------------------------------

test("fetch rejection (offline / DNS / dropped connection): human message with method + path, status 0", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const e = await failure("/api/session/credentials", { method: "POST" });
  assert.ok(e instanceof BffError);
  assert.equal(e.kind, "network");
  assert.equal(e.status, 0);
  assertHumanMessage(e.message);
  assert.match(e.message, /Could not reach the app server: the request to POST \/api\/session\/credentials got no response/);
  assert.match(e.message, /corporate proxy or firewall may be blocking this host/);
  assert.match(e.message, /Check your network, then retry/);
  assert.equal(e.message.includes("Failed to fetch"), false, "the browser's own wording is not the message");
});

test("a body-read failure after headers arrived is also a network failure", async () => {
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("network error"));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const e = await failure("/api/cases");
  assert.equal(e.kind, "network");
});

test("a caller's own AbortError is re-thrown untouched, not relabelled as a network failure", async () => {
  globalThis.fetch = async () => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  };
  const e = await failure("/api/cases");
  assert.equal(e.name, "AbortError");
  assert.equal(e instanceof BffError, false);
});

// ---------------------------------------------------------------------------
// Success paths are unchanged.
// ---------------------------------------------------------------------------

test("JSON success returns the parsed body; empty OK body returns {}", async () => {
  stubResponse(JSON.stringify({ mode: "byo" }), { status: 200, contentType: "application/json" });
  assert.deepEqual(await bff("/api/session"), { mode: "byo" });
  stubResponse("", { status: 204, contentType: null });
  assert.deepEqual(await bff("/api/session/credentials", { method: "DELETE" }), {});
});

// ---------------------------------------------------------------------------
// The guard as a property of the response, stated once and drilled directly.
// ---------------------------------------------------------------------------

test("bodyIsParseable: JSON content-type AND not markup, nothing else", () => {
  assert.equal(bodyIsParseable("application/json", "{}"), true);
  assert.equal(bodyIsParseable("application/json; charset=utf-8", "[]"), true);
  assert.equal(bodyIsParseable("application/problem+json", "{}"), true);
  assert.equal(bodyIsParseable("text/html", "{}"), false);
  assert.equal(bodyIsParseable(null, "{}"), false);
  assert.equal(bodyIsParseable("application/json", "<!DOCTYPE html>"), false);
  assert.equal(bodyIsParseable("application/json", "  \n<html>"), false);
  assert.equal(isJsonContentType("text/json"), false);
  assert.equal(looksLikeMarkup(" <p>"), true);
  assert.equal(looksLikeMarkup('{"a":"<"}'), false);
});

test("no markup ever reaches JSON.parse across every non-JSON shape", async () => {
  const shapes = [
    [BLOCK_PAGE, { status: 403, contentType: "text/html" }],
    [BLOCK_PAGE, { status: 200, contentType: "text/html" }],
    [BLOCK_PAGE, { status: 502, contentType: "application/json" }],
    [BLOCK_PAGE, { status: 401, contentType: null }],
    ["<html>", { status: 200, contentType: "application/json; charset=utf-8" }],
    ["\n\t <!doctype html>", { status: 200, contentType: "application/json" }],
  ];
  for (const [body, opts] of shapes) {
    stubResponse(body, opts);
    const e = await failure("/api/session/credentials", { method: "POST" });
    assert.equal(e.kind, "not_json", `${JSON.stringify(opts)}: ${e.message}`);
    assertHumanMessage(e.message);
  }
  assertNoMarkupParsed();
});

test("describeBffFailure names the host when given one, otherwise 'this host'", () => {
  const withHost = describeBffFailure({ kind: "not_json", method: "post", path: "/api/session/credentials", status: 403, contentType: "text/html", host: "kaycee.example.test" });
  assert.match(withHost, /allow kaycee\.example\.test, then retry/);
  assert.match(withHost, /POST \/api\/session\/credentials returned HTTP 403/);
  const noHost = describeBffFailure({ kind: "network", method: "GET", path: "/api/cases", status: 0, host: "" });
  assert.match(noHost, /blocking this host/);
  for (const m of [withHost, noHost]) assertHumanMessage(m);
});
