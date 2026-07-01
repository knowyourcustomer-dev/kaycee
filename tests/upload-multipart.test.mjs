// Unit tests for the v5 document-upload fix:
//  - multipart/form-data construction carries the real file part + fields
//  - UBO -> individual-case mapping resolves by the members linkage (caseCommonId),
//    NOT the org-chart display name, and falls back when no linkage is present.
//
// Pure-logic tests (node --test, no server/network). The assertions mirror
// src/server/kyc-client.ts (buildUploadForm) and src/lib/member-resolve.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

/* ---- buildUploadForm contract (mirror of kyc-client.ts) ---- */
function buildUploadForm(args) {
  const fd = new FormData();
  fd.set("name", args.name);
  fd.set("fileCat", args.fileCat);
  fd.set("caseCommonId", String(args.caseCommonId));
  fd.set("isCompany", String(args.isCompany));
  fd.set("createNewStep", String(args.createNewStep ?? true));
  if (args.fileName) fd.set("fileName", args.fileName);
  if (args.jurisdictionSource) fd.set("jurisdictionSource", args.jurisdictionSource);
  if (args.clientAddress) fd.set("clientAddress", args.clientAddress);
  fd.set("file", args.file, args.fileName || "upload.bin");
  return fd;
}

test("multipart upload carries the real file binary + required fields", () => {
  const file = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
  const fd = buildUploadForm({
    name: "Photo ID",
    fileCat: "photoid",
    caseCommonId: 6072,
    isCompany: false,
    fileName: "photoid-good.pdf",
    file,
  });
  // The `file` part is the actual binary (a Blob/File), not a string -> this is
  // the fix for the HTTP 415 (JSON body) the live test hit.
  const part = fd.get("file");
  assert.ok(part instanceof Blob, "file part must be a Blob/File, not a string");
  assert.equal(fd.get("name"), "Photo ID");
  assert.equal(fd.get("fileCat"), "photoid");
  assert.equal(fd.get("caseCommonId"), "6072");
  assert.equal(fd.get("isCompany"), "false");
  assert.equal(fd.get("createNewStep"), "true");
  assert.equal(fd.get("fileName"), "photoid-good.pdf");
});

test("company upload sets isCompany=true", () => {
  const fd = buildUploadForm({
    name: "Board resolution",
    fileCat: "Corporate",
    caseCommonId: 6037,
    isCompany: true,
    fileName: "board-resolution-good.pdf",
    file: new Blob(["x"]),
  });
  assert.equal(fd.get("isCompany"), "true");
  assert.equal(fd.get("fileCat"), "Corporate");
});

/* ---- UBO -> individual-case mapping (mirror of member-resolve.ts) ---- */
const GROUPS = [
  "controllingEntitiesAndIndividuals",
  "shareholdersAndBeneficialOwners",
  "ultimateBeneficialOwners",
  "personsWithSignificantControl",
];
function individualMemberCases(members) {
  if (!members) return [];
  const byId = new Map();
  for (const g of GROUPS) {
    for (const entry of members[g] || []) {
      const m = entry.member;
      const ccid = m?.caseCommonId;
      if (typeof ccid === "number" && ccid > 0) {
        const name = m?.rawName || `${m?.firstName ?? ""} ${m?.lastName ?? ""}`.trim();
        if (!byId.has(ccid)) byId.set(ccid, { name: name || `Member ${ccid}`, caseCommonId: ccid });
      }
    }
  }
  return [...byId.values()];
}
function looseNameMatch(a, b) {
  const toks = (s) => new Set(s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean));
  const ta = toks(a), tb = toks(b);
  if (!ta.size || !tb.size) return false;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}
function resolveUboCases(requiredNames, members) {
  const individuals = individualMemberCases(members);
  if (individuals.length > 0) {
    return individuals.map((ind) => {
      const matched = requiredNames.find((r) => looseNameMatch(r.name, ind.name));
      return { name: ind.name, reason: matched?.reason ?? "Beneficial owner / controller.", memberCaseCommonId: ind.caseCommonId };
    });
  }
  return requiredNames.map((r) => ({ ...r, memberCaseCommonId: null }));
}

test("routes UBO to the individual member case via caseCommonId, not the display name", () => {
  // Live example: org-chart name differs from the member record name.
  const required = [{ name: "Syed Asim Hussain", reason: ">25% owner" }];
  const members = {
    controllingEntitiesAndIndividuals: [
      { role: "Director", member: { rawName: "Syed Haider Yahya Hussain", caseCommonId: 6072 } },
    ],
  };
  const resolved = resolveUboCases(required, members);
  assert.equal(resolved.length, 1);
  // Routing key is the member's caseCommonId — NOT the org-chart name.
  assert.equal(resolved[0].memberCaseCommonId, 6072);
  // Display uses the authoritative member record name.
  assert.equal(resolved[0].name, "Syed Haider Yahya Hussain");
  // The reason still attaches via loose surname overlap ("Hussain").
  assert.equal(resolved[0].reason, ">25% owner");
});

test("dedupes individuals by caseCommonId across member groups", () => {
  const members = {
    controllingEntitiesAndIndividuals: [{ member: { rawName: "A B", caseCommonId: 10 } }],
    shareholdersAndBeneficialOwners: [{ member: { rawName: "A B", caseCommonId: 10 } }],
    personsWithSignificantControl: [{ member: { rawName: "C D", caseCommonId: 11 } }],
  };
  const resolved = resolveUboCases([], members);
  assert.deepEqual(
    resolved.map((r) => r.memberCaseCommonId).sort((a, b) => a - b),
    [10, 11],
  );
});

test("falls back to company case (null) when members carry no individual case id", () => {
  // Sandbox today: member has no caseCommonId -> unresolved -> company-case fallback.
  const required = [{ name: "James Whitfield", reason: "director" }];
  const members = {
    controllingEntitiesAndIndividuals: [{ member: { rawName: "James Whitfield" } }],
  };
  const resolved = resolveUboCases(required, members);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].memberCaseCommonId, null);
  assert.equal(resolved[0].name, "James Whitfield");
});
