"use client";

/**
 * OrgChart.tsx — renders the recursive ownership tree from
 * GET /v2/Companies/{id}/org-chart. Each node may carry `officers`,
 * `shareholders`, and `others` arrays of the SAME shape; we recurse so a
 * multi-level UBO (a shareholder that is itself a company with its own
 * shareholders) renders as visible nesting.
 *
 * Swap this component to change how ownership is visualised; the data shape is
 * defined by OrgChartNode in server/kyc-client.ts.
 */

interface Node {
  name: string;
  role: string | null;
  shares: number | null;
  effectivePercentage: number | null;
  officers?: Node[];
  shareholders?: Node[];
  others?: Node[];
  isUnresolvedAML?: boolean;
}

function childGroups(node: Node): Array<{ label: string; nodes: Node[] }> {
  const groups: Array<{ label: string; nodes: Node[] }> = [];
  if (node.shareholders?.length) groups.push({ label: "Shareholders", nodes: node.shareholders });
  if (node.officers?.length) groups.push({ label: "Officers", nodes: node.officers });
  if (node.others?.length) groups.push({ label: "Other", nodes: node.others });
  return groups;
}

function NodeView({ node, depth }: { node: Node; depth: number }) {
  const groups = childGroups(node);
  const pct =
    node.effectivePercentage != null
      ? `${node.effectivePercentage}%`
      : node.shares != null
        ? `${node.shares}% shares`
        : null;
  return (
    <div>
      <div className="org-node" style={{ borderColor: depth === 0 ? "var(--color-primary)" : undefined }}>
        <div className="nm">{node.name}</div>
        <div className="rl">
          {node.role || (depth === 0 ? "Subject" : "—")}
          {pct ? ` · ${pct}` : ""}
          {node.isUnresolvedAML ? " · ⚠ unresolved AML" : ""}
        </div>
      </div>
      {groups.length > 0 && (
        <div className="org-children">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {g.label}
              </div>
              {g.nodes.map((child, i) => (
                <div className="org-row" key={`${g.label}-${i}-${child.name}`}>
                  <NodeView node={child} depth={depth + 1} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgChart({ root }: { root: Node | null }) {
  if (!root) return <p className="muted">No org chart available.</p>;
  const maxDepth = computeDepth(root);
  return (
    <div className="org-tree">
      {maxDepth > 1 && (
        <div className="callout">
          Multi-level ownership: this structure nests {maxDepth} levels deep. The renderer
          recurses through each entity&apos;s shareholders to the ultimate beneficial owners.
        </div>
      )}
      <NodeView node={root} depth={0} />
    </div>
  );
}

function computeDepth(node: Node): number {
  const children = [
    ...(node.shareholders || []),
    ...(node.officers || []),
    ...(node.others || []),
  ];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map(computeDepth));
}
