"use client";

/**
 * Journey.tsx — Kaycee Bank SME corporate account-opening journey
 * (CUSTOMER-FACING). A new business customer opens an account for their company.
 *
 * Phases:
 *   1 IDENTIFY   find the company (POST /api/search; substring or exact name)
 *   2 CONFIRM    acknowledge the entity -> create the case (POST /api/cases)
 *   3 DETAILS    while the case builds, collect the bank questionnaire and
 *                attach it to the case as a note (POST /api/cases/{id}/note)
 *   4 VERIFYING  poll to ready; developer-view debug stream shows raw calls + states
 *   5 DOCUMENTS  ID upload per >25% owner (or directors + largest), + a board
 *                resolution; deterministic prevalidation (good/forged/expired)
 *   6 SCREENING  automatic World-Check (LSEG) result, read-only
 *   7 DONE       bank-typical closing; auto-close; the customer message FOLLOWS
 *                the sandbox-derived decision; report in developer view
 *
 * DEVELOPER VIEW (default ON, toggle to OFF): a demo affordance, NOT real auth.
 * It reveals the raw API debug stream (phase 4) and the close-report download
 * (phase 7). Turn it off to see the customer-facing journey on its own.
 *
 * The sandbox client secret stays server-side (BFF); the browser only calls
 * /api/* on this same server.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { bff } from "@/lib/bff-fetch";
import {
  COUNTRIES,
  SAMPLE_COMPANIES,
  SOURCE_OF_FUNDS,
  TX_COUNT_BANDS,
  TX_AMOUNT_BANDS,
  type SessionInfo,
  type Questionnaire,
} from "@/lib/api-types";
import { requiredVerificationPeople } from "@/lib/ubo";
import { resolveUboCases } from "@/lib/member-resolve";
import { statusLabel } from "@/lib/status";

/** A person to verify, resolved to their individual member case when available. */
type ResolvedPerson = { name: string; reason: string; memberCaseCommonId: number | null };
import { brand } from "@/lib/brand";
import OrgChart from "./OrgChart";
import AmlPanel from "./AmlPanel";

const STATUS_READY = 3;
const PHASES = ["Identify", "Confirm", "Your details", "Verifying", "Documents", "Screening", "Done"] as const;

type DebugLine = { t: string; text: string };

export default function Journey() {
  const [internalView, setInternalView] = useState(true);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<(SessionInfo & { version?: string }) | null>(null);

  // debug stream (developer view)
  const [debug, setDebug] = useState<DebugLine[]>([]);
  const log = useCallback((text: string) => {
    setDebug((d) => [...d, { t: new Date().toISOString().slice(11, 19), text }]);
  }, []);

  // phase 1: identify
  const [query, setQuery] = useState("");
  const [iso, setIso] = useState("GB");
  const [results, setResults] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<any | null>(null);

  // phase 2/4: case
  const [caseId, setCaseId] = useState<number | null>(null);
  const [common, setCommon] = useState<any | null>(null);
  const polling = useRef(false);

  // phase 3: questionnaire
  const [q, setQ] = useState<Questionnaire>({
    authorisingName: "",
    authorisingEmail: "",
    sourceOfFunds: SOURCE_OF_FUNDS[0],
    txCount: TX_COUNT_BANDS[0],
    txAmount: TX_AMOUNT_BANDS[0],
    countriesOfOperation: "",
  });
  const [noteSaved, setNoteSaved] = useState(false);

  // phase 5: documents
  const [orgChart, setOrgChart] = useState<any | null>(null);
  const [aml, setAml] = useState<any | null>(null);
  const [people, setPeople] = useState<ResolvedPerson[]>([]);
  const [docState, setDocState] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [resolutionState, setResolutionState] = useState<{ ok: boolean; msg: string } | null>(null);

  // phase 7
  const [decision, setDecision] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  // connect / session
  const loadSession = useCallback(() => {
    return bff<SessionInfo & { version?: string }>("/api/session")
      .then((s) => {
        setSession(s);
        const where =
          s.mode === "byo"
            ? `your sandbox (${s.tenantId})`
            : s.ephemeral
              ? "ephemeral demo tenant"
              : "static creds";
        log(`session ready · API ${s.version} · ${where}`);
        return s;
      })
      .catch(fail);
  }, [log]);

  useEffect(() => {
    loadSession().then(() => setPhase(0));
  }, [loadSession]);

  // BYO ("bring your own") credentials: paste your own sandbox client id/secret
  // so the whole journey runs against YOUR tenant, showing the same cases you
  // see when you call the API directly. The secret is posted once to our BFF,
  // sealed server-side into an HttpOnly cookie, and never held in browser state.
  const [showConnect, setShowConnect] = useState(false);
  const connectSandbox = useCallback(
    async (clientId: string, clientSecret: string) => {
      setError(null);
      await bff("/api/session/credentials", {
        method: "POST",
        body: JSON.stringify({ clientId, clientSecret }),
      });
      setShowConnect(false);
      await loadSession();
      log(`connected to your sandbox tenant`);
    },
    [loadSession, log],
  );
  const disconnectSandbox = useCallback(async () => {
    setError(null);
    await bff("/api/session/credentials", { method: "DELETE" });
    await loadSession();
    log(`disconnected — using the public demo sandbox`);
  }, [loadSession, log]);

  // ---- phase 1: search -----------------------------------------------------
  const doSearch = useCallback(async () => {
    setError(null);
    setResults(null);
    setBusy("search");
    log(`POST /v2/Companies/search { query:"${query}", codeiso31662:"${iso}" }`);
    try {
      const r = await bff<{ companySearch: { results: any[] } }>("/api/search", {
        method: "POST",
        body: JSON.stringify({ query, iso }),
      });
      const res = r.companySearch.results;
      log(`search -> ${res.length} result(s)`);
      setResults(res);
      // No match: stay on this phase (do not advance).
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [query, iso, log]);

  // ---- phase 2: confirm + create ------------------------------------------
  const confirmEntity = useCallback(
    async (company: any) => {
      setError(null);
      setPicked(company);
      setBusy("create");
      // Forward the exact name AND the registration number from the chosen
      // search result. externalCode is optional — include it only when present
      // (KYC API User Guide §3.2: name must match the search; reg number, where
      // available, sharpens registry matching).
      const externalCode = company.externalCode || undefined;
      log(
        `POST /v2/Companies { rawname:"${company.rawname}", codeiso31662:"${iso}"` +
          (externalCode ? `, externalCode:"${externalCode}"` : "") +
          " }",
      );
      try {
        const r = await bff<any>("/api/cases", {
          method: "POST",
          body: JSON.stringify({ rawname: company.rawname, iso, externalCode }),
        });
        const c = r.caseDetail.details.common;
        setCaseId(c.caseCommonId);
        setCommon(c);
        log(`case ${c.caseCommonId} created · statusId=${statusLabel(c.statusId, c)} — building`);
        setPhase(2); // collect details while it builds
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [iso, log],
  );

  // ---- phase 4: poll to ready (starts once we leave phase 3) --------------
  const startPolling = useCallback(() => {
    if (caseId == null || polling.current) return;
    polling.current = true;
    setPhase(3);
    const tick = async () => {
      try {
        const r = await bff<any>(`/api/cases/${caseId}`);
        const c = r.caseDetail.details.common;
        setCommon(c);
        log(`GET /v2/Companies/${caseId} -> statusId=${statusLabel(c.statusId, c)} · ${c.complete}%`);
        if (c.statusId === STATUS_READY) {
          await loadReady();
          return;
        }
      } catch (e) {
        fail(e);
        return;
      }
      setTimeout(tick, 3000);
    };
    tick();
  }, [caseId, log]);

  const loadReady = useCallback(async () => {
    if (caseId == null) return;
    log(`case ${caseId} READY — attaching questionnaire, loading structure & screening`);
    // The questionnaire note can only attach once the case has built its steps,
    // so we collect it during the wait (phase 3) and post it here, once ready.
    const note = [
      "ACCOUNT-OPENING QUESTIONNAIRE",
      `Authorising person: ${q.authorisingName} <${q.authorisingEmail}>`,
      `Source of funds: ${q.sourceOfFunds}`,
      `Estimated transactions/month: ${q.txCount}`,
      `Estimated monthly amount: ${q.txAmount}`,
      `Countries of operation: ${q.countriesOfOperation}`,
    ].join("\n");
    try {
      log(`POST /v2/CaseStepNotes/${caseId}/{stepId} (questionnaire)`);
      await bff<any>(`/api/cases/${caseId}/note`, { method: "POST", body: JSON.stringify({ note }) });
      setNoteSaved(true);
      log(`questionnaire attached to case ${caseId}`);
    } catch (e) {
      // Non-fatal: surface but continue the journey.
      log(`note attach failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const [oc, a, members] = await Promise.all([
      bff<any>(`/api/cases/${caseId}/org-chart`),
      bff<any>(`/api/cases/${caseId}/aml`),
      bff<any>(`/api/cases/${caseId}/members`),
    ]);
    setOrgChart(oc);
    setAml(a);
    // Determine WHO must verify (>25% owners, else directors + largest) from the
    // org chart, then RESOLVE each to their individual member case via the
    // members linkage (not the display name). When member.caseCommonId is
    // present (live), the ID doc routes to the individual case; otherwise we
    // fall back to the company case (sandbox before the linkage lands).
    const required = requiredVerificationPeople(oc);
    const resolved = resolveUboCases(required, members);
    setPeople(resolved);
    log(
      `required ID checks: ${resolved.length} — ` +
        resolved
          .map((p) => `${p.name}${p.memberCaseCommonId ? ` (indiv case ${p.memberCaseCommonId})` : " (no individual case — company-case fallback)"}`)
          .join(", "),
    );
    setPhase(4);
  }, [caseId, q, log]);

  // submit questionnaire -> keep it in state, begin verifying. The note is
  // attached once the case is ready (steps don't exist while it's still building).
  const submitDetails = useCallback(() => {
    if (caseId == null) return;
    setError(null);
    log("questionnaire captured — verifying company (note attaches once ready)");
    startPolling();
  }, [caseId, log, startPolling]);

  // ---- phase 5: document uploads (multipart, real file bytes) -------------
  // Posts a real file as multipart/form-data to the given BFF endpoint and
  // surfaces prevalidationMessages (empty == accepted).
  const doUpload = useCallback(
    async (
      key: string,
      endpoint: string,
      args: { name: string; fileCat: string; fileName: string; file: Blob },
    ) => {
      setError(null);
      setBusy(`up-${key}`);
      const fd = new FormData();
      fd.set("name", args.name);
      fd.set("fileCat", args.fileCat);
      fd.set("fileName", args.fileName);
      fd.set("file", args.file, args.fileName);
      log(`POST ${endpoint} (multipart) name="${args.name}" fileCat=${args.fileCat} file=${args.fileName}`);
      try {
        // NOTE: no Content-Type header — the browser sets the multipart boundary.
        const res = await fetch(endpoint, { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
        const msgs = data.prevalidationMessages || [];
        const ok = msgs.length === 0; // empty prevalidationMessages == accepted
        const msg = ok ? "Accepted." : msgs.map((m: any) => m.value).join(" ");
        log(`upload ${args.fileName} -> ${ok ? "ACCEPTED" : "REJECTED: " + msg}`);
        return { ok, msg };
      } catch (e) {
        fail(e);
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      } finally {
        setBusy(null);
      }
    },
    [log],
  );

  const uploadPersonId = useCallback(
    async (person: ResolvedPerson, outcome: "good" | "forged" | "expired", file?: File) => {
      // Route to the INDIVIDUAL's own case when resolved; else fall back to the
      // company case (sandbox before member.caseCommonId is populated).
      const endpoint =
        person.memberCaseCommonId != null
          ? `/api/individuals/${person.memberCaseCommonId}/documents/upload`
          : `/api/cases/${caseId}/documents/upload`;
      const blob = file ?? makePlaceholderPdf();
      const fileName = file ? withOutcome(file.name, outcome) : `photoid-${slug(person.name)}-${outcome}.pdf`;
      const res = await doUpload(person.name, endpoint, {
        name: `Identity document — ${person.name}`,
        fileCat: "photoid",
        fileName,
        file: blob,
      });
      if (res) setDocState((s) => ({ ...s, [person.name]: res }));
    },
    [caseId, doUpload],
  );

  const uploadResolution = useCallback(
    async (outcome: "good" | "forged" | "expired", file?: File) => {
      const blob = file ?? makePlaceholderPdf();
      const fileName = file ? withOutcome(file.name, outcome) : `board-resolution-${outcome}.pdf`;
      const res = await doUpload("board-resolution", `/api/cases/${caseId}/documents/upload`, {
        name: "Board resolution — account mandate",
        fileCat: "Corporate",
        fileName,
        file: blob,
      });
      if (res) setResolutionState(res);
    },
    [caseId, doUpload],
  );

  // ---- phase 7: auto-close --------------------------------------------------
  const finishAndClose = useCallback(async () => {
    if (caseId == null) return;
    setError(null);
    setBusy("close");
    log(`PATCH /v2/Companies/${caseId}/status { status:"Close" } (auto-close, simulating bank review)`);
    try {
      const r = await bff<any>(`/api/cases/${caseId}/close`, { method: "POST" });
      const c = r.caseDetail.details.common;
      setCommon(c);
      // FOLLOW the sandbox: the customer-facing outcome reflects the decision the
      // sandbox derived from the document/check outcomes. No forcing.
      setDecision(c.caseDecision ?? null);
      log(`case ${caseId} closed · decision=${c.caseDecision ?? "(none)"} (from sandbox)`);
      setPhase(6);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [caseId, log]);

  const allDocsDone =
    people.length > 0 &&
    people.every((p) => docState[p.name]?.ok) &&
    resolutionState?.ok === true;

  const companyName = picked?.rawname || "your company";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <Stepper phase={phase} />
        <div className="row" style={{ gap: 8 }}>
          <TenantBadge session={session} onConnect={() => setShowConnect(true)} onDisconnect={disconnectSandbox} />
          <InternalToggle on={internalView} onChange={setInternalView} />
        </div>
      </div>

      {showConnect && (
        <ConnectSandbox
          onSubmit={connectSandbox}
          onCancel={() => setShowConnect(false)}
          baseUrl={session?.baseUrl}
        />
      )}

      {error && <div className="error-box">We hit a problem: {error}</div>}

      {/* PHASE 1 — IDENTIFY */}
      <div className="card">
        <h2>Open a business account</h2>
        <p className="subtle">
          Let&apos;s start by finding your company. Search by registered name or company / registration
          number, and choose the country it&apos;s registered in.
        </p>
        <div className="row">
          <input
            type="text"
            placeholder="Company name or registration number"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 320 }}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <select value={iso} onChange={(e) => setIso(e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={doSearch} disabled={busy === "search" || !query.trim()}>
            {busy === "search" ? "Searching…" : "Find my company"}
          </button>
        </div>

        <div className="callout">
          <strong>Sample companies for this demo</strong> — use any of these (name or ID):
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {SAMPLE_COMPANIES.map((s) => (
              <li key={s.name}>
                {s.name} — {s.country}, ID {s.id}
              </li>
            ))}
          </ul>
        </div>

        {results && results.length === 0 && (
          <div className="callout warn">
            We couldn&apos;t find a company matching <strong>{query}</strong> in{" "}
            {COUNTRIES.find((c) => c.iso === iso)?.name}. Check the spelling or the country, or try a
            registration number. (Tip: use one of the sample companies above.)
          </div>
        )}

        {results && results.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Reg. number</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.rawname}</td>
                  <td>{r.externalCode || "—"}</td>
                  <td>{r.companyStatus || "—"}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => confirmEntity(r)}
                      disabled={busy === "create"}
                    >
                      {busy === "create" ? "Setting up…" : "This is my company"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* PHASE 3 — YOUR DETAILS (collected while the case builds) */}
      {phase >= 2 && (
        <div className="card">
          <h2>Tell us about your account</h2>
          <p className="subtle">
            We&apos;re setting up <strong>{companyName}</strong> in the background. While that runs,
            please answer a few questions we can&apos;t get from the public register.
          </p>

          {phase === 2 ? (
            <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
              <Field label="Authorising person — full name">
                <input
                  type="text"
                  value={q.authorisingName}
                  onChange={(e) => setQ({ ...q, authorisingName: e.target.value })}
                  placeholder="Person mandated to open and operate the account"
                />
              </Field>
              <Field label="Authorising person — email">
                <input
                  type="text"
                  value={q.authorisingEmail}
                  onChange={(e) => setQ({ ...q, authorisingEmail: e.target.value })}
                  placeholder="Account details will be sent here"
                />
              </Field>
              <Field label="Source of funds">
                <select value={q.sourceOfFunds} onChange={(e) => setQ({ ...q, sourceOfFunds: e.target.value })}>
                  {SOURCE_OF_FUNDS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estimated transactions per month">
                <select value={q.txCount} onChange={(e) => setQ({ ...q, txCount: e.target.value })}>
                  {TX_COUNT_BANDS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estimated monthly transaction amount">
                <select value={q.txAmount} onChange={(e) => setQ({ ...q, txAmount: e.target.value })}>
                  {TX_AMOUNT_BANDS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Countries of operation">
                <input
                  type="text"
                  value={q.countriesOfOperation}
                  onChange={(e) => setQ({ ...q, countriesOfOperation: e.target.value })}
                  placeholder="Comma-separated, e.g. United Kingdom, Ireland"
                />
              </Field>
              <div>
                <button
                  className="btn"
                  onClick={submitDetails}
                  disabled={
                    busy === "note" || !q.authorisingName.trim() || !q.authorisingEmail.trim()
                  }
                >
                  {busy === "note" ? "Saving…" : "Save and continue"}
                </button>
              </div>
            </div>
          ) : (
            <div className="callout">{noteSaved ? "Your details are saved to the application." : ""}</div>
          )}
        </div>
      )}

      {/* PHASE 4 — VERIFYING */}
      {phase >= 3 && (
        <div className="card">
          <h2>Verifying your company</h2>
          <p className="subtle">
            We&apos;re checking <strong>{companyName}</strong> against the company register and building
            its ownership structure. This can take a little while.
          </p>
          <div className="row">
            <StatusBadge common={common} />
            {common?.statusId !== STATUS_READY && <span className="muted">Please keep this page open…</span>}
          </div>
        </div>
      )}

      {/* Developer view: API debug stream */}
      {internalView && phase >= 2 && (
        <div className="card" style={{ borderColor: "var(--color-primary)" }}>
          <h2>Developer view · API debug stream</h2>
          <p className="subtle">
            Raw sandbox calls and status transitions. A demo affordance, hidden when the
            developer view is off.
          </p>
          <div className="poll-log">
            {debug.map((l, i) => (
              <div className="line" key={i}>
                {l.t}  {l.text}
              </div>
            ))}
          </div>
          {orgChart && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Ownership structure (org chart)</summary>
              <div style={{ marginTop: 8 }}>
                <OrgChart root={orgChart} />
              </div>
            </details>
          )}
        </div>
      )}

      {/* PHASE 5 — DOCUMENTS */}
      {phase >= 4 && phase < 6 && (
        <div className="card">
          <h2>Upload identity documents</h2>
          <p className="subtle">
            We need a photo ID for each person who controls the company, plus a board resolution
            authorising the account. Choose a file (it&apos;s uploaded as multipart/form-data with the
            real bytes), or use the demo buttons. Demo: the filename carries the prevalidation outcome
            (accepted / forged / expired). Each ID goes to that person&apos;s own individual case.
          </p>

          {people.length === 0 ? (
            <span className="muted">Working out who needs to verify…</span>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Why</th>
                  <th>Upload (file or demo outcome)</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name}>
                    <td>
                      {p.name}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {p.memberCaseCommonId ? `individual case ${p.memberCaseCommonId}` : "company-case fallback"}
                      </div>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {p.reason}
                    </td>
                    <td>
                      <div className="row">
                        <input
                          type="file"
                          disabled={!!busy}
                          style={{ fontSize: 12, maxWidth: 150 }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadPersonId(p, "good", f);
                          }}
                        />
                        <button className="btn secondary" disabled={!!busy} onClick={() => uploadPersonId(p, "good")}>
                          demo: accepted
                        </button>
                        <button className="btn secondary" disabled={!!busy} onClick={() => uploadPersonId(p, "forged")}>
                          demo: forged
                        </button>
                        <button className="btn secondary" disabled={!!busy} onClick={() => uploadPersonId(p, "expired")}>
                          demo: expired
                        </button>
                      </div>
                    </td>
                    <td>
                      {docState[p.name] && (
                        <span className={`badge ${docState[p.name].ok ? "ready" : "danger"}`}>
                          {docState[p.name].ok ? "Verified" : docState[p.name].msg}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 18, fontSize: 15 }}>Board resolution</h3>
          <p className="subtle">
            Please upload a certified board resolution authorising the account and the authorising
            person. Suggested wording:
          </p>
          <blockquote
            style={{
              background: "var(--color-bg)",
              borderLeft: "3px solid var(--color-border)",
              padding: "10px 14px",
              fontSize: 13,
              margin: "0 0 12px",
            }}
          >
            Certified Extract of Resolution of the Board of Directors of <strong>{companyName}</strong>{" "}
            — At a meeting held on {today} it was resolved that: (1) a corporate account be opened with{" "}
            {brand.name} in the name of the Company; (2){" "}
            <strong>{q.authorisingName || "[Full Name]"}</strong>, [title], be authorised to open and
            operate the account, execute all account-opening documentation, and receive the account
            credentials and access details on the Company&apos;s behalf; (3) {brand.name} be authorised
            to rely on that person&apos;s instructions until written notice of revocation. Certified a
            true extract — signed [Director / Company Secretary], {today}.
          </blockquote>
          <div className="row">
            <input
              type="file"
              disabled={!!busy}
              style={{ fontSize: 12, maxWidth: 180 }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadResolution("good", f);
              }}
            />
            <button className="btn secondary" disabled={!!busy} onClick={() => uploadResolution("good")}>
              demo: accepted
            </button>
            <button className="btn secondary" disabled={!!busy} onClick={() => uploadResolution("forged")}>
              demo: forged
            </button>
            {resolutionState && (
              <span className={`badge ${resolutionState.ok ? "ready" : "danger"}`}>
                {resolutionState.ok ? "Resolution accepted" : resolutionState.msg}
              </span>
            )}
          </div>

          {/* SCREENING (automatic, World-Check only) */}
          <h3 style={{ marginTop: 18, fontSize: 15 }}>Screening</h3>
          <AmlPanel aml={aml} />

          <div style={{ marginTop: 18 }}>
            <button className="btn" onClick={finishAndClose} disabled={!allDocsDone || busy === "close"}>
              {busy === "close" ? "Submitting…" : "Submit application"}
            </button>
            {!allDocsDone && (
              <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                Upload an accepted ID for everyone listed, plus an accepted board resolution, to submit.
              </span>
            )}
          </div>
        </div>
      )}

      {/* PHASE 7 — DONE (customer message FOLLOWS the sandbox decision) */}
      {phase >= 6 && (
        <div className="card">
          {isApprovedDecision(decision) ? (
            <>
              <h2>Application submitted</h2>
              <p>
                Thank you. Your application to open a business account for{" "}
                <strong>{companyName}</strong> has been approved. We&apos;ll email your new account
                details to <strong>{q.authorisingEmail}</strong> within 24 hours.
              </p>
            </>
          ) : (
            <>
              <h2>Application received</h2>
              <p>
                Thank you for your application to open a business account for{" "}
                <strong>{companyName}</strong>. Following our checks, the outcome is{" "}
                <strong>{decision || "pending further review"}</strong>. Our team will be in touch at{" "}
                <strong>{q.authorisingEmail}</strong> regarding next steps.
              </p>
            </>
          )}
          {internalView && (
            <div className="callout">
              <strong>Developer view</strong> · case auto-closed. Sandbox decision:{" "}
              <strong>{common?.caseDecision ?? decision ?? "n/a"}</strong>.{" "}
              <a href={`/api/cases/${caseId}/report`} target="_blank" rel="noreferrer">
                Download close report (PDF)
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The sandbox reports an approved outcome as "Accepted"/"Approved". */
function isApprovedDecision(decision: string | null): boolean {
  return /^(accepted|approv)/i.test(decision || "");
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/**
 * Ensure the filename carries the demo outcome token (good/forged/expired) that
 * drives the sandbox's deterministic prevalidation, while keeping the original
 * extension. (Against the live API the real document content is validated; this
 * token only affects the sandbox.)
 */
function withOutcome(fileName: string, outcome: "good" | "forged" | "expired"): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : ".pdf";
  return `${base}-${outcome}${ext}`;
}

/** A tiny valid PDF so the demo can send REAL bytes when no file is picked. */
function makePlaceholderPdf(): Blob {
  const pdf =
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF";
  return new Blob([pdf], { type: "application/pdf" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Stepper({ phase }: { phase: number }) {
  return (
    <div className="stepper">
      {PHASES.map((label, i) => (
        <span key={label} className={`step ${i < phase ? "done" : i === phase ? "active" : ""}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

function InternalToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`btn ${on ? "" : "secondary"}`}
      onClick={() => onChange(!on)}
      title="Demo affordance, not real authentication"
    >
      Developer view: {on ? "ON" : "OFF"}
    </button>
  );
}

function StatusBadge({ common }: { common: any | null }) {
  if (!common) return <span className="badge building">Starting…</span>;
  const ready = common.statusId === STATUS_READY;
  return (
    <span className={`badge ${ready ? "ready" : "building"}`}>
      {ready ? "Company verified" : "Verifying…"}
    </span>
  );
}

/**
 * TenantBadge — shows WHICH sandbox this session is pointed at, and lets the
 * developer connect their own credentials (BYO) or disconnect back to the
 * public demo tenant.
 */
function TenantBadge({
  session,
  onConnect,
  onDisconnect,
}: {
  session: (SessionInfo & { version?: string }) | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (!session) return null;
  if (session.mode === "byo") {
    return (
      <span className="row" style={{ gap: 6, alignItems: "center" }}>
        <span className="badge ready" title={`Connected to your sandbox: ${session.tenantId}`}>
          Your sandbox · {session.tenantId}
        </span>
        <button className="btn secondary" onClick={onDisconnect} title="Disconnect and use the public demo sandbox">
          Disconnect
        </button>
      </span>
    );
  }
  const label = session.mode === "static" ? "Static sandbox" : "Public demo sandbox";
  return (
    <span className="row" style={{ gap: 6, alignItems: "center" }}>
      <span className="badge building" title="This journey runs against a shared/throwaway tenant">
        {label}
      </span>
      <button className="btn secondary" onClick={onConnect} title="Run this journey against your own sandbox tenant">
        Connect your sandbox
      </button>
    </span>
  );
}

/**
 * ConnectSandbox — paste the clientId + clientSecret issued by the dev portal.
 * The values are POSTed once to our BFF, which verifies and seals them into an
 * HttpOnly cookie; they are not retained in browser state after submit.
 */
function ConnectSandbox({
  onSubmit,
  onCancel,
  baseUrl,
}: {
  onSubmit: (clientId: string, clientSecret: string) => Promise<void>;
  onCancel: () => void;
  baseUrl?: string;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await onSubmit(clientId.trim(), clientSecret.trim());
      // Clear local copies of the secret immediately after a successful connect.
      setClientId("");
      setClientSecret("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h2>Connect your sandbox</h2>
      <p className="subtle">
        Paste the <strong>client ID</strong> and <strong>client secret</strong> you were emailed when
        you requested sandbox access. This runs the whole journey against{" "}
        <strong>your own sandbox tenant</strong>
        {baseUrl ? ` (${baseUrl})` : ""} — the same cases you see via the API and the Workspace console.
        Your secret is sent once to this server and kept server-side; it is never stored in your browser.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <Field label="Client ID">
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="sbx_…"
            autoComplete="off"
          />
        </Field>
        <Field label="Client secret">
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="••••••••"
            autoComplete="off"
          />
        </Field>
        {err && <div className="callout warn">{err}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={submit}
            disabled={busy || !clientId.trim() || !clientSecret.trim()}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
