/**
 * ubo.ts — work out WHICH PEOPLE need to upload an identity document, from the
 * org-chart tree returned by GET /v2/Companies/{id}/org-chart.
 *
 * Bank rule implemented here (matches the account-opening spec):
 *   1. Every INDIVIDUAL with effective ownership > 25% must verify ID.
 *   2. If NO individual reaches 25%, fall back to: the company's DIRECTORS
 *      plus the single largest-control individual (highest effective %).
 *   3. Deduplicate by name — a person appearing several times is asked once.
 *
 * The tree nests (a corporate shareholder carries its own shareholders), so we
 * walk it recursively and look at individuals wherever they appear.
 */

export interface OrgNode {
  name: string;
  role: string | null;
  shares: number | null;
  effectivePercentage: number | null;
  officers?: OrgNode[];
  shareholders?: OrgNode[];
  others?: OrgNode[];
}

export interface RequiredPerson {
  name: string;
  reason: string; // why we're asking them (shown to the customer)
}

const OWNERSHIP_THRESHOLD = 25;

// A name that looks like a company, not a person (so we don't ask a company for
// a passport). Conservative substring check on common entity suffixes.
const ENTITY_SUFFIX = /\b(LIMITED|LTD|LLP|PLC|INC|GMBH|GROUP|HOLDINGS|CO|COMPANY|PTE|PRIVATE)\b/i;

function isIndividual(n: OrgNode): boolean {
  // Treat explicit corporate roles / entity-suffixed names as non-individuals.
  if (n.role && /significantcontrol/i.test(n.role) && ENTITY_SUFFIX.test(n.name)) return false;
  return !ENTITY_SUFFIX.test(n.name);
}

function walk(node: OrgNode, out: OrgNode[]) {
  out.push(node);
  for (const grp of [node.shareholders, node.officers, node.others]) {
    for (const child of grp || []) walk(child, out);
  }
}

/** Effective ownership for a node, treating null as 0. */
function eff(n: OrgNode): number {
  return n.effectivePercentage ?? n.shares ?? 0;
}

function isDirector(n: OrgNode): boolean {
  return /director/i.test(n.role || "");
}

/**
 * Compute the deduplicated list of people who must verify ID, with the reason.
 * `root` is the org-chart root (the subject company).
 */
export function requiredVerificationPeople(root: OrgNode | null): RequiredPerson[] {
  if (!root) return [];
  const all: OrgNode[] = [];
  // Don't include the root subject company itself.
  for (const grp of [root.shareholders, root.officers, root.others]) {
    for (const child of grp || []) walk(child, all);
  }

  const individuals = all.filter(isIndividual);

  // Highest effective % per individual name (a name can appear several times).
  const bestEff = new Map<string, number>();
  for (const p of individuals) {
    const cur = bestEff.get(p.name) ?? 0;
    bestEff.set(p.name, Math.max(cur, eff(p)));
  }

  // Rule 1: individuals over the threshold.
  const overThreshold = [...bestEff.entries()].filter(([, pct]) => pct > OWNERSHIP_THRESHOLD);
  if (overThreshold.length > 0) {
    return overThreshold
      .sort((a, b) => b[1] - a[1])
      .map(([name, pct]) => ({
        name,
        reason: `Beneficial owner — ${pct.toFixed(1)}% effective ownership (over 25%).`,
      }));
  }

  // Rule 2 (fallback): directors + the single largest-control individual.
  const out = new Map<string, RequiredPerson>();
  for (const p of individuals.filter(isDirector)) {
    if (!out.has(p.name)) out.set(p.name, { name: p.name, reason: "Director." });
  }
  // Single largest-control individual by effective %.
  const largest = [...bestEff.entries()].sort((a, b) => b[1] - a[1])[0];
  if (largest && largest[1] > 0) {
    const [name, pct] = largest;
    const existing = out.get(name);
    const reason = `Largest individual shareholder — ${pct.toFixed(1)}% effective ownership.`;
    if (existing) existing.reason = `${existing.reason} ${reason}`;
    else out.set(name, { name, reason });
  }
  return [...out.values()];
}
