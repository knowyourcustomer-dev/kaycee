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
 * The members response groups people under several arrays; each entry has a
 * `member` object that, on the live contract, carries `caseCommonId` (the
 * person's own individual case). We flatten all groups and index by that id.
 */

export interface MemberEntry {
  role?: string | null;
  caseStepId?: number;
  member?: {
    rawName?: string;
    firstName?: string;
    lastName?: string;
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
 * Flatten the members response into a deduplicated list of INDIVIDUAL member
 * cases — only those that carry a real `caseCommonId` (i.e. an addressable
 * individual case). Returns at most one entry per caseCommonId.
 */
export function individualMemberCases(members: MembersResponse | null | undefined): IndividualMember[] {
  if (!members) return [];
  const byId = new Map<number, IndividualMember>();
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

  // No individual case ids available (sandbox today): keep the org-chart-derived
  // required people, unresolved — caller falls back to the company case.
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
