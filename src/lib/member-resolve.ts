/**
 * member-resolve.ts — map each UBO/required person to the INDIVIDUAL member's
 * own case (their `caseCommonId`), so their identity document is uploaded to the
 * individual case, not the company case.
 *
 * WHY by linkage, not name: the org-chart display name can differ from the
 * member record (live example: org-chart "Syed Asim Hussain" vs member record
 * "Syed Haider Yahya Hussain", ccid 6072). So we resolve against the MEMBERS
 * response — the authoritative individual records — and read each one's
 * `member.caseCommonId`. We never trust the org-chart name to address the
 * individual case.
 *
 * INDIVIDUALS ONLY: photo-ID rows are for natural persons. A members tree also
 * carries CORPORATE members (a company shareholder — `entityName`, memberType
 * "Company") which may themselves carry a caseCommonId; those must NEVER get an
 * ID-upload row (a company has no passport — its corporate documents, like the
 * board resolution, live on the root company case). This is the "Member 6053"
 * bug: a corporate member (THE GREAT APOLLO LIMITED) slipped through on its
 * caseCommonId alone and was shown as a fake person. We filter on
 * `memberType === "Individual"` (the live/golden shape; the synthetic shape
 * uses 2) and, when memberType is absent, fall back to the record shape
 * (firstName vs entityName) plus the entity-name heuristic shared with ubo.ts.
 *
 * The members response groups people under several arrays; each entry has a
 * `member` object that, on the live contract, carries `caseCommonId` (the
 * person's own individual case). We flatten all groups and index by that id.
 */

// Explicit .ts extension so the pure lib modules are directly importable by
// the node --test suites (Node's native type stripping needs real specifiers);
// Next's bundler resolution accepts it (allowImportingTsExtensions).
import { looksLikeEntityName } from "./ubo.ts";

export interface MemberEntry {
  role?: string | null;
  caseStepId?: number;
  /** "Individual" | "Company" on the live/golden shape; 2 | 1 on the synthetic shape. */
  memberType?: string | number | null;
  member?: {
    rawName?: string;
    firstName?: string;
    lastName?: string;
    /** Present on linked-party member records instead of rawName. */
    name?: string;
    /** Present on CORPORATE members (which never get an ID-upload row). */
    entityName?: string;
    caseCommonId?: number | null;
  };
}

export interface MembersResponse {
  controllingEntitiesAndIndividuals?: MemberEntry[];
  shareholdersAndBeneficialOwners?: MemberEntry[];
  ultimateBeneficialOwners?: MemberEntry[];
  personsWithSignificantControl?: MemberEntry[];
}

export interface IndividualMember {
  name: string;
  /** The individual's OWN case id — where their ID document is uploaded. */
  caseCommonId: number;
}

const GROUPS: (keyof MembersResponse)[] = [
  "controllingEntitiesAndIndividuals",
  "shareholdersAndBeneficialOwners",
  "ultimateBeneficialOwners",
  "personsWithSignificantControl",
];

/**
 * Is this members-tree entry a NATURAL PERSON?
 *   1. Explicit memberType wins: "Individual"/2 yes; anything else declared
 *      ("Company"/1/"JointShareholder"/...) no.
 *   2. No memberType: an `entityName` marks a company; a `firstName` marks a
 *      person; otherwise fall back to the shared entity-name heuristic on the
 *      display name (same rule ubo.ts applies to org-chart nodes).
 */
export function isIndividualEntry(entry: MemberEntry): boolean {
  const mt = entry.memberType;
  if (mt !== undefined && mt !== null && mt !== "") {
    return mt === "Individual" || mt === 2;
  }
  const m = entry.member || {};
  if (m.entityName) return false;
  if (m.firstName) return true;
  const displayName = m.rawName || m.name || "";
  return displayName !== "" && !looksLikeEntityName(displayName);
}

/** Best display name for a member record; empty string when none exists. */
function memberName(entry: MemberEntry): string {
  const m = entry.member || {};
  return (
    m.rawName ||
    `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
    m.name ||
    ""
  );
}

/**
 * Flatten the members response into a deduplicated list of INDIVIDUAL member
 * cases — natural persons only (see isIndividualEntry) that carry a real
 * `caseCommonId` (i.e. an addressable individual case). Corporate members are
 * excluded regardless of caseCommonId. An individual with NO resolvable name is
 * skipped with a console warning — we never show a synthetic "Member NNNN"
 * placeholder as if it were a person. Returns at most one entry per
 * caseCommonId.
 */
export function individualMemberCases(members: MembersResponse | null | undefined): IndividualMember[] {
  if (!members) return [];
  const byId = new Map<number, IndividualMember>();
  for (const g of GROUPS) {
    for (const entry of members[g] || []) {
      if (!isIndividualEntry(entry)) continue; // corporate members: no ID row, ever
      const ccid = entry.member?.caseCommonId;
      if (typeof ccid !== "number" || ccid <= 0) continue;
      const name = memberName(entry);
      if (!name) {
        // eslint-disable-next-line no-console
        console.warn(
          `[member-resolve] individual member case ${ccid} has no resolvable name — skipping (won't invent one)`,
        );
        continue;
      }
      if (!byId.has(ccid)) byId.set(ccid, { name, caseCommonId: ccid });
    }
  }
  return [...byId.values()];
}

/**
 * Resolve the people who must verify ID to their individual member case.
 *
 * Strategy (linkage-first):
 *   - Prefer the members-derived individual cases (each carries caseCommonId).
 *     We attach the UBO reason by best-effort name correspondence ONLY for
 *     display; the ROUTING uses caseCommonId, never the name.
 *   - For required people we cannot link to an individual case (e.g. the sandbox
 *     does not yet populate member.caseCommonId), we return them with
 *     caseCommonId = null so the caller can fall back (upload to the company
 *     case) and flag that live linkage is needed.
 */
export function resolveUboCases(
  requiredNames: { name: string; reason: string }[],
  members: MembersResponse | null | undefined,
): Array<{ name: string; reason: string; memberCaseCommonId: number | null }> {
  const individuals = individualMemberCases(members);

  // If members carry individual case ids, route to THOSE (authoritative), using
  // the members list as the set of people to verify and matching reasons by a
  // loose name overlap for display only.
  if (individuals.length > 0) {
    return individuals.map((ind) => {
      const matched = requiredNames.find((r) => looseNameMatch(r.name, ind.name));
      return {
        name: ind.name,
        reason: matched?.reason ?? "Beneficial owner / controller.",
        memberCaseCommonId: ind.caseCommonId,
      };
    });
  }

  // No individual case ids available (sandbox before the linkage lands): keep
  // the org-chart-derived required people, unresolved — caller falls back to
  // the company case.
  return requiredNames.map((r) => ({ ...r, memberCaseCommonId: null }));
}

/** Loose name match for DISPLAY pairing only — never used for routing. */
function looseNameMatch(a: string, b: string): boolean {
  const toks = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .split(/\s+/)
        .filter(Boolean),
    );
  const ta = toks(a);
  const tb = toks(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // Share at least one surname-ish token.
  return shared > 0;
}
