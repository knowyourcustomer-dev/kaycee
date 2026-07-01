/**
 * kyc-client.ts — THE CANONICAL MAP OF THE KYC API.
 * =================================================
 * Read this one file and you understand the whole onboarding surface. Every
 * sandbox call the app makes goes through here. The shapes mirror the live KYC
 * Public API v2, so code written here works against production by changing only
 * SANDBOX_BASE_URL (see config.ts).
 *
 * Server-only: it attaches the bearer token from auth.ts. The browser never
 * imports this.
 *
 * The journey, in order, is the method list below:
 *   version() -> searchCompanies() -> createCompany() -> getCompany() (poll)
 *   -> getMembers() / getOrgChart() / getCaseSteps()
 *   -> getDocuments() / uploadDocument()
 *   -> getAmlChecks() -> closeCase() -> getReport()
 */

import "server-only";
import { config } from "./config";
import { getBearerToken, handleExpiredSandbox } from "./auth";

/* ------------------------------------------------------------------ *
 * Types — the slice of the v2 contract this reference app touches.
 * Captured from live sandbox responses. Non-exhaustive by design:
 * fields the journey does not render are left loose ([key: string]).
 * ------------------------------------------------------------------ */

export interface CompanySearchResult {
  rawname: string;
  externalCode?: string;
  companyStatus?: string;
  dataSource?: string;
  rawAddress?: string;
  city?: string;
  zip?: string;
  street?: string;
}

export interface CaseCommon {
  caseCommonId: number;
  statusId: number; // 3 == Ready; 50/51/52/54/56/57 == Building sub-states
  statusName: string; // "Building" | "Ready" | ...
  status: string; // "Open" | "Closed" | ...
  caseDecision: string | null;
  caseDescription: string;
  countryName: string;
  riskRating: string;
  complete: number;
  caseReadyDatetime: string | null;
  [key: string]: unknown;
}

export interface CaseDetail {
  caseDetail: {
    details: {
      common: CaseCommon;
      company?: Record<string, unknown>;
      caseAddress?: Record<string, unknown>;
      caseAmlSummary?: Record<string, unknown>;
      risks?: Record<string, unknown>;
      allUbosIdentified?: string;
      [key: string]: unknown;
    };
  };
}

/** Recursive org-chart node. The nesting (officers/shareholders) is the UBO tree. */
export interface OrgChartNode {
  name: string;
  role: string | null;
  shares: number | null;
  effectivePercentage: number | null;
  officers: OrgChartNode[];
  shareholders: OrgChartNode[];
  others: OrgChartNode[];
  caseStepId: number;
  caseLinkId: number;
  validation: boolean;
  isUnresolvedAML: boolean;
  [key: string]: unknown;
}

export interface CaseStepGroup {
  group: string;
  total: number;
  steps: Array<{
    name: string;
    type: string;
    status: string;
    caseStepId: number;
    [key: string]: unknown;
  }>;
}

export interface UploadResult {
  caseDocumentId: number;
  caseStepId: number;
  name: string;
  category: string;
  link: string;
  prevalidationMessages: Array<{ key: string; value: string }>;
}

export const STATUS_READY = 3;

/* ------------------------------------------------------------------ *
 * Low-level request helper. Maps non-2xx into a structured error.
 * ------------------------------------------------------------------ */

export class KycApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public method: string,
    public path: string,
  ) {
    super(`${method} ${path} -> HTTP ${status}: ${body}`);
    this.name = "KycApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: {
    json?: unknown;
    form?: Record<string, string>;
    multipart?: FormData;
    binary?: boolean;
  } = {},
): Promise<T> {
  // One transparent retry: if a mid-session call reports the sandbox tenant is
  // gone/expired (401/410), let the auth layer re-provision (sandbox mode) and
  // try again with a fresh token. Static mode does not re-provision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getBearerToken();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.multipart) {
      // Do NOT set Content-Type — fetch sets multipart/form-data + boundary.
      body = opts.multipart;
    } else if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    }

    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      const expiredTenant =
        res.status === 410 || (res.status === 401 && /sandbox/i.test(text));
      // Only the DEMO path re-provisions; BYO/static return false and surface
      // the error instead of silently switching the tester to a fresh tenant.
      if (expiredTenant && attempt === 0 && (await handleExpiredSandbox())) {
        continue; // re-provisioned; retry once with a fresh tenant
      }
      throw new KycApiError(res.status, text, method, path);
    }
    if (opts.binary) {
      const buf = await res.arrayBuffer();
      return buf as unknown as T;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw new KycApiError(0, "request retry exhausted", method, path);
}

/* ------------------------------------------------------------------ *
 * Document upload (multipart/form-data) — the REAL upload contract.
 * The API expects multipart with the actual file binary as the `file` part,
 * NOT a JSON/urlencoded body (a JSON body returns HTTP 415). buildUploadForm
 * assembles the multipart body; it is exported so it can be unit-tested.
 * ------------------------------------------------------------------ */

export interface UploadArgs {
  /** Human label for the document/step (Form field `name`). */
  name: string;
  /** Category, e.g. "photoid" for an individual ID, "Corporate" for a resolution. */
  fileCat: string;
  /** The actual file bytes the user selected. */
  file: Blob;
  /** Original filename (also drives the sandbox's deterministic prevalidation). */
  fileName: string;
  createNewStep?: boolean;
  jurisdictionSource?: string;
  clientAddress?: string;
}

export function buildUploadForm(
  args: UploadArgs & { caseCommonId: number; isCompany: boolean },
): FormData {
  const fd = new FormData();
  fd.set("name", args.name);
  fd.set("fileCat", args.fileCat);
  fd.set("caseCommonId", String(args.caseCommonId));
  fd.set("isCompany", String(args.isCompany));
  fd.set("createNewStep", String(args.createNewStep ?? true));
  if (args.fileName) fd.set("fileName", args.fileName);
  if (args.jurisdictionSource) fd.set("jurisdictionSource", args.jurisdictionSource);
  if (args.clientAddress) fd.set("clientAddress", args.clientAddress);
  // The real file binary as the `file` part — this is what was missing (415).
  fd.set("file", args.file, args.fileName || "upload.bin");
  return fd;
}

/* ------------------------------------------------------------------ *
 * The typed client — one method per journey step.
 * ------------------------------------------------------------------ */

export const kyc = {
  /** GET /v2/Version — confirm the contract version. */
  version: () => request<string>("GET", "/v2/Version"),

  /** POST /v2/Companies/search — exact-match company search. */
  searchCompanies: (query: string, codeiso31662: string) =>
    request<{ companySearch: { results: CompanySearchResult[] } }>(
      "POST",
      "/v2/Companies/search",
      { json: { query, codeiso31662 } },
    ),

  /**
   * POST /v2/Companies — create the entity case from a search match.
   *
   * Per the KYC API User Guide (§3.2), `rawname` must be exactly the name the
   * search returned, and — where available — passing the registration number
   * (`externalCode`) sharpens registry matching. The contract only requires
   * `rawname`; `externalCode` is optional, so we include it only when the chosen
   * search result actually carried one and omit it otherwise.
   */
  createCompany: (rawname: string, codeiso31662: string, externalCode?: string | null) =>
    request<CaseDetail>("POST", "/v2/Companies", {
      json: {
        rawname,
        codeiso31662,
        ...(externalCode ? { externalCode } : {}),
      },
    }),

  /** GET /v2/Companies/{id} — view case with LIVE statusId (poll this). */
  getCompany: (caseCommonId: number) =>
    request<CaseDetail>("GET", `/v2/Companies/${caseCommonId}`),

  /** GET /v2/Companies/{id}/members — controlling parties, shareholders, UBOs. */
  getMembers: (caseCommonId: number) =>
    request<Record<string, unknown>>("GET", `/v2/Companies/${caseCommonId}/members`),

  /** GET /v2/Companies/{id}/org-chart — the recursive ownership tree. */
  getOrgChart: (caseCommonId: number) =>
    request<OrgChartNode>("GET", `/v2/Companies/${caseCommonId}/org-chart`),

  /** GET /v2/CaseSteps/{id} — verification steps, grouped. */
  getCaseSteps: (caseCommonId: number) =>
    request<CaseStepGroup[]>("GET", `/v2/CaseSteps/${caseCommonId}`),

  /** GET /v2/Companies/{id}/documents — the document tree. */
  getDocuments: (caseCommonId: number) =>
    request<Record<string, unknown>>("GET", `/v2/Companies/${caseCommonId}/documents`),

  /**
   * POST /v2/Companies/{id}/documents/upload — upload a COMPANY document
   * (e.g. the board resolution) as multipart/form-data with the real file
   * binary. No fee. prevalidationMessages drive the deterministic verdict
   * (empty == accepted; a "...-forged"/"...-expired" filename is rejected).
   */
  uploadCompanyDocument: (caseCommonId: number, args: UploadArgs) =>
    request<UploadResult>("POST", `/v2/Companies/${caseCommonId}/documents/upload`, {
      multipart: buildUploadForm({ ...args, caseCommonId, isCompany: true }),
    }),

  /**
   * POST /v2/Individuals/{id}/documents/upload — upload an INDIVIDUAL document
   * (e.g. a UBO's photo ID) as multipart/form-data with the real file binary.
   * UBO identity docs belong on the individual member's own case, not the
   * company case (see resolveMemberCase in the BFF).
   */
  uploadIndividualDocument: (caseCommonId: number, args: UploadArgs) =>
    request<UploadResult>("POST", `/v2/Individuals/${caseCommonId}/documents/upload`, {
      multipart: buildUploadForm({ ...args, caseCommonId, isCompany: false }),
    }),

  /** GET /v2/Individuals/{id}/documents/mandatory — e.g. ["photoid","selfie","poa"]. */
  getIndividualMandatoryDocs: (caseCommonId: number) =>
    request<string[]>("GET", `/v2/Individuals/${caseCommonId}/documents/mandatory`),

  /**
   * POST /v2/CaseStepNotes/{caseCommonId}/{stepId} — attach a free-text note to
   * a case step. Used to record the customer's account-opening questionnaire on
   * the case record so it appears in the audit trail / close report.
   */
  addCaseNote: (caseCommonId: number, stepId: number, note: string) =>
    request<Record<string, unknown>>(
      "POST",
      `/v2/CaseStepNotes/${caseCommonId}/${stepId}`,
      { json: { note } },
    ),

  /** GET /v2/Companies/{id}/amlchecks — World-Check / LexisNexis arrays (read-only). */
  getAmlChecks: (caseCommonId: number) =>
    request<Record<string, unknown>>("GET", `/v2/Companies/${caseCommonId}/amlchecks`),

  /** PATCH /v2/Companies/{id}/status — close (or reopen) the case. */
  closeCase: (caseCommonId: number) =>
    request<CaseDetail>("PATCH", `/v2/Companies/${caseCommonId}/status`, {
      json: { status: "Close" },
    }),

  /** GET /v2/Companies/{id}/report — the cached PDF (ArrayBuffer). 409 while building. */
  getReport: (caseCommonId: number) =>
    request<ArrayBuffer>("GET", `/v2/Companies/${caseCommonId}/report`, { binary: true }),

  /**
   * GET /v2/Companies/{id}/report — report bytes WITH the upstream content-type
   * and length, so the BFF can pass a genuine binary PDF straight through to the
   * browser. Robust to the sandbox serving a real-format report (we trust the
   * upstream content-type, defaulting to application/pdf). 409 while building.
   */
  getReportRaw: (caseCommonId: number) =>
    requestRaw("GET", `/v2/Companies/${caseCommonId}/report`),
};

/**
 * Like request(), but returns the raw bytes plus the upstream content-type and
 * length, with the same transparent expired-sandbox retry. Used for binary
 * downloads (the report) so we don't lose the content-type.
 */
export async function requestRaw(
  method: string,
  path: string,
): Promise<{ bytes: ArrayBuffer; contentType: string; contentLength: string | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getBearerToken();
    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: { Accept: "*/*", Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      const expiredTenant = res.status === 410 || (res.status === 401 && /sandbox/i.test(text));
      if (expiredTenant && attempt === 0 && (await handleExpiredSandbox())) continue;
      throw new KycApiError(res.status, text, method, path);
    }
    const bytes = await res.arrayBuffer();
    return {
      bytes,
      // Trust the upstream content-type; default to PDF for the cached placeholder.
      contentType: res.headers.get("content-type") || "application/pdf",
      contentLength: res.headers.get("content-length"),
    };
  }
  throw new KycApiError(0, "request retry exhausted", method, path);
}
