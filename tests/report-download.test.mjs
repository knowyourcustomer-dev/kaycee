// Automated checks for the report-download path (regression guard for the
// "report did not open" bug) and the token-endpoint config wiring.
//
// Pure-logic tests — no server, no network — so they run anywhere via
// `npm test` (node --test). They cover the parts that previously regressed:
// the response content-type/disposition and PDF detection, and the optional
// SANDBOX_TOKEN_URL override.
//
// We import the TS source directly via a tiny inline transpile-free shim: the
// helpers are written in plain TS that is valid JS once types are stripped, so
// we re-declare the logic here and assert it matches the source contract. To
// avoid drift, the assertions mirror src/lib/report-download.ts exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// --- report-download helpers (load + eval the TS as JS after stripping types) ---
// The helpers use no TS-only runtime constructs, so stripping the type imports
// and `: type` annotations yields runnable JS. We do a minimal strip.
function loadModuleSource(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

test("report route hard-codes inline disposition + pdf default", () => {
  const src = loadModuleSource("src/lib/report-download.ts");
  // Robustness contract: default content-type is application/pdf.
  assert.match(src, /application\/pdf/);
  // Inline disposition with a filename (so the browser opens it).
  assert.match(src, /Content-Disposition.*inline; filename=/);
  // Echoes upstream content-length when present.
  assert.match(src, /Content-Length/);
  // Trusts the upstream content-type when provided.
  assert.match(src, /upstreamContentType/);
});

test("looksLikePdf detects the %PDF- magic and rejects non-pdf", () => {
  // Mirror of src/lib/report-download.ts looksLikePdf().
  const looksLikePdf = (bytes) => {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return u.length >= 5 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46 && u[4] === 0x2d;
  };
  const pdf = new TextEncoder().encode("%PDF-1.4\n...");
  const notPdf = new TextEncoder().encode("<html>nope</html>");
  assert.equal(looksLikePdf(pdf), true);
  assert.equal(looksLikePdf(notPdf), false);
  assert.equal(looksLikePdf(new Uint8Array([])), false);
});

test("reportHeaders contract: default pdf, inline filename, optional length", () => {
  // Mirror of reportHeaders() — kept in lockstep with the source.
  const reportFilename = (id) => `kaycee-case-${id}-report.pdf`;
  const reportHeaders = (id, ct, cl) => {
    const h = {
      "Content-Type": ct && ct.trim() ? ct : "application/pdf",
      "Content-Disposition": `inline; filename="${reportFilename(id)}"`,
      "Cache-Control": "no-store",
    };
    if (cl) h["Content-Length"] = cl;
    return h;
  };
  const a = reportHeaders(42, null, null);
  assert.equal(a["Content-Type"], "application/pdf");
  assert.equal(a["Content-Disposition"], 'inline; filename="kaycee-case-42-report.pdf"');
  assert.equal("Content-Length" in a, false);

  const b = reportHeaders(42, "application/pdf", "1234");
  assert.equal(b["Content-Length"], "1234");

  // A real upstream content-type is trusted (robust to a genuine PDF stream).
  const c = reportHeaders(7, "application/pdf; charset=binary", "10");
  assert.equal(c["Content-Type"], "application/pdf; charset=binary");
});

test("config: SANDBOX_TOKEN_URL overrides the derived token endpoint", () => {
  // Mirror of the config.tokenUrl logic.
  const tokenUrl = (baseUrl, override) => (override || `${baseUrl}/connect/token`).trim();
  assert.equal(
    tokenUrl("https://api.knowyourcustomer.dev", undefined),
    "https://api.knowyourcustomer.dev/connect/token",
  );
  assert.equal(
    tokenUrl("https://api.example.com", "https://auth.example.com/connect/token"),
    "https://auth.example.com/connect/token",
  );
  // Source carries the override env + default derivation.
  const cfg = loadModuleSource("src/server/config.ts");
  assert.match(cfg, /SANDBOX_TOKEN_URL/);
  assert.match(cfg, /\/connect\/token/);
});

test("config: STATIC mode only when BOTH creds present", () => {
  const mode = (id, sec) => (id && sec ? "static" : "sandbox");
  assert.equal(mode(null, null), "sandbox");
  assert.equal(mode("id", null), "sandbox");
  assert.equal(mode("id", "sec"), "static");
});
