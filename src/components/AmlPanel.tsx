"use client";

/**
 * AmlPanel.tsx — World-Check (LSEG) screening result from
 * GET /v2/Companies/{id}/amlchecks.
 *
 * Per the account-opening spec this surfaces ONLY the World-Check provider and
 * HIDES the LexisNexis branch (the sandbox returns both arrays; we read only
 * `worldChecks`). Screening is automatic — no user action. Read-only.
 */

interface AmlResponse {
  worldChecks?: unknown[];
  lexisNexisChecks?: unknown[]; // present in the response but intentionally NOT shown
}

export default function AmlPanel({ aml }: { aml: AmlResponse | null }) {
  if (!aml) return <p className="muted">Screening pending…</p>;
  const wc = aml.worldChecks || [];
  const clean = wc.length === 0;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`badge ${clean ? "ready" : "danger"}`}>
          {clean ? "World-Check: no matches" : `World-Check: ${wc.length} potential match(es)`}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Automatic screening (LSEG World-Check). No action required.
        </span>
      </div>

      {clean ? (
        <p className="muted" style={{ fontSize: 13 }}>
          No sanctions, PEP, or adverse-media matches were returned for the company or its
          associated parties.
        </p>
      ) : (
        <table>
          <tbody>
            {wc.map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{summarise(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function summarise(row: unknown): string {
  if (row && typeof row === "object") {
    const o = row as Record<string, unknown>;
    const name = o.name || o.fullName || o.matchedName || o.lastName;
    const cat = o.category || o.matchType || o.type;
    const parts = [name, cat].filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  return JSON.stringify(row);
}
