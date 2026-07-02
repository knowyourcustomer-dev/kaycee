// Disconnected-session gating: with no credentials anywhere the app must gate
// the journey behind the connect screen — and the auto-provisioning path must
// stay dead.
//
// auth.ts / the session route / Journey.tsx are Next-server/client modules
// (server-only, next/headers, JSX) that node --test cannot import, so — in the
// established style of report-download.test.mjs — these are SOURCE-CONTRACT
// tests: they assert on the actual source text so a regression that
// reintroduces provisioning or drops the gate fails loudly here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(root, rel), "utf8");

test("auth.ts has NO auto-provisioning path", () => {
  const auth = src("src/server/auth.ts");
  assert.doesNotMatch(auth, /provisionSandbox/, "provisionSandbox must stay deleted");
  assert.doesNotMatch(auth, /\/sandbox\/provision/, "no call to the provision endpoint");
  assert.doesNotMatch(auth, /handleExpiredSandbox/, "no demo re-provision hook");
  // The no-creds path throws NotConnectedError instead of provisioning.
  assert.match(auth, /NotConnectedError/);
  assert.match(auth, /hasStaticCredentials\(\)/);
});

test("nothing in the app calls the provision endpoint or the demo retry", () => {
  for (const rel of [
    "src/server/kyc-client.ts",
    "src/server/bff.ts",
    "src/server/config.ts",
    "src/app/api/session/route.ts",
    "src/app/api/cases/[id]/report/route.ts",
  ]) {
    const s = src(rel);
    assert.doesNotMatch(s, /\/sandbox\/provision/, `${rel} must not call the provision endpoint`);
    assert.doesNotMatch(s, /provisionSandbox/, `${rel} must not reference the provision fn`);
    assert.doesNotMatch(s, /handleExpiredSandbox/, `${rel} must not retry via re-provision`);
  }
});

test("config exposes only static|disconnected env modes (no 'sandbox' demo mode)", () => {
  const config = src("src/server/config.ts");
  assert.match(config, /"static" \| "disconnected"/);
  assert.doesNotMatch(config, /AuthMode = "static" \| "sandbox"/);
  const types = src("src/lib/api-types.ts");
  assert.match(types, /"byo" \| "static" \| "disconnected"/);
  assert.doesNotMatch(types, /"sandbox"/, "the demo mode string is gone from the contract");
});

test("GET /api/session cannot throw pre-connect: disconnected short-circuits before any API call", () => {
  const route = src("src/app/api/session/route.ts");
  const disconnectedReturn = route.indexOf('info.mode === "disconnected"');
  const versionCall = route.indexOf("kyc.version()");
  assert.ok(disconnectedReturn > -1, "session route handles the disconnected mode");
  assert.ok(versionCall > -1, "session route still reports the API version when connected");
  assert.ok(
    disconnectedReturn < versionCall,
    "the disconnected return must come BEFORE the version call (which needs a token)",
  );
});

test("Journey gates the flow: disconnected renders the connect screen, not the journey", () => {
  const journey = src("src/components/Journey.tsx");
  // The gate: an early return on disconnected mode rendering ConnectSandbox.
  const gate = journey.indexOf('session.mode === "disconnected"');
  assert.ok(gate > -1, "Journey checks for the disconnected mode");
  const gateBlock = journey.slice(gate, gate + 600);
  assert.match(gateBlock, /ConnectSandbox/, "disconnected branch renders the connect screen");
  // Users without credentials are pointed at the dev-portal access request.
  assert.match(journey, /knowyourcustomer\.com\/developers\/access/);
  // The public-demo affordances are gone.
  assert.doesNotMatch(journey, /Public demo sandbox/);
  assert.doesNotMatch(journey, /ephemeral/i);
});

test("polling is kept in source as the documented alternative to webhooks", () => {
  const journey = src("src/components/Journey.tsx");
  assert.match(journey, /POLLING MODE/i, "polling documented as the alternative");
  assert.match(journey, /session\?\.webhooks/, "webhook mode selected from the session flag");
  assert.match(journey, /CaseReady/, "readiness flips on the CaseReady webhook event");
  assert.match(journey, /safety net/i, "slow direct status check kept as the safety net");
});
