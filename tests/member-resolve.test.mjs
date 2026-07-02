// Individuals-only member resolution (the "Member 6053" bug fix): a CORPORATE
// member of the members tree (entityName / memberType "Company") must NEVER
// become an ID-verification person, even when it carries a caseCommonId of its
// own; and a nameless individual is skipped, never shown as "Member NNNN".
//
// These tests import the REAL source (src/lib/member-resolve.ts) via Node's
// native TypeScript type stripping — no mirrored re-declaration to drift.

import { test } from "node:test";
import assert from "node:assert/strict";

const { individualMemberCases, isIndividualEntry, resolveUboCases } = await import(
  "../src/lib/member-resolve.ts"
);

/** The Ubizense HK shape that triggered the bug: THE GREAT APOLLO LIMITED is a
 *  corporate shareholder that carries its own caseCommonId (6053). */
const ubizenseMembers = {
  shareholdersAndBeneficialOwners: [
    {
      memberType: "Company",
      role: "Shareholder",
      member: { entityName: "THE GREAT APOLLO LIMITED", caseCommonId: 6053 },
    },
    {
      memberType: "Individual",
      role: "Shareholder",
      member: { rawName: "Syed Haider Yahya Hussain", caseCommonId: 6072 },
    },
  ],
};

test("corporate member with entityName + caseCommonId gets NO ID row", () => {
  const out = individualMemberCases(ubizenseMembers);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { name: "Syed Haider Yahya Hussain", caseCommonId: 6072 });
  assert.ok(
    !out.some((p) => p.caseCommonId === 6053),
    "corporate member 6053 must not appear",
  );
  assert.ok(
    !out.some((p) => /^Member \d+$/.test(p.name)),
    "no synthetic 'Member NNNN' names",
  );
});

test("explicit memberType wins over everything (both live and synthetic encodings)", () => {
  assert.equal(isIndividualEntry({ memberType: "Individual", member: {} }), true);
  assert.equal(isIndividualEntry({ memberType: 2, member: {} }), true);
  assert.equal(isIndividualEntry({ memberType: "Company", member: { rawName: "John Smith" } }), false);
  assert.equal(isIndividualEntry({ memberType: 1, member: { firstName: "John" } }), false);
  // Any other declared type (e.g. JointShareholder) is not a natural person.
  assert.equal(isIndividualEntry({ memberType: "JointShareholder", member: {} }), false);
});

test("missing memberType falls back to record shape, then the entity-name heuristic", () => {
  // entityName marks a company even without memberType.
  assert.equal(
    isIndividualEntry({ member: { entityName: "ACME HOLDINGS LIMITED", caseCommonId: 7 } }),
    false,
  );
  // firstName marks a person.
  assert.equal(isIndividualEntry({ member: { firstName: "Ada", lastName: "Lovelace" } }), true);
  // Only a display name: the shared ubo.ts suffix heuristic decides.
  assert.equal(isIndividualEntry({ member: { rawName: "GREAT WALL TRADING PTE" } }), false);
  assert.equal(isIndividualEntry({ member: { rawName: "Jane Doe" } }), true);
  // Nothing to go on at all -> not an individual.
  assert.equal(isIndividualEntry({ member: {} }), false);
});

test("individual WITHOUT any resolvable name is skipped (no invented placeholder)", () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const out = individualMemberCases({
      ultimateBeneficialOwners: [
        { memberType: "Individual", member: { caseCommonId: 9001 } }, // nameless
        { memberType: "Individual", member: { rawName: "Named Person", caseCommonId: 9002 } },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].caseCommonId, 9002);
    assert.ok(
      warnings.some((w) => w.includes("9001")),
      "skipping a nameless individual logs a console warning",
    );
  } finally {
    console.warn = origWarn;
  }
});

test("dedup across buckets and name building from firstName/lastName still work", () => {
  const out = individualMemberCases({
    controllingEntitiesAndIndividuals: [
      { memberType: "Individual", member: { firstName: "Kim", lastName: "Lee", caseCommonId: 42 } },
    ],
    ultimateBeneficialOwners: [
      { memberType: "Individual", member: { firstName: "Kim", lastName: "Lee", caseCommonId: 42 } },
    ],
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { name: "Kim Lee", caseCommonId: 42 });
});

test("resolveUboCases routes ONLY individuals; corporate members never surface", () => {
  const required = [{ name: "Syed Asim Hussain", reason: "Beneficial owner — 51.0%." }];
  const resolved = resolveUboCases(required, ubizenseMembers);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].memberCaseCommonId, 6072);
  // Display-only loose name pairing still attaches the reason.
  assert.equal(resolved[0].reason, "Beneficial owner — 51.0%.");
});

test("resolveUboCases falls back to company-case (null) when no individual linkage", () => {
  const required = [{ name: "Solo Owner", reason: "Director." }];
  const resolved = resolveUboCases(required, { shareholdersAndBeneficialOwners: [] });
  assert.deepEqual(resolved, [{ name: "Solo Owner", reason: "Director.", memberCaseCommonId: null }]);
});
