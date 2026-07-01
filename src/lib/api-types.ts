/**
 * api-types.ts — types shared between the BFF and the browser.
 * Safe to import from client components (no secrets, no server-only deps).
 */

export interface SessionInfo {
  tenantId: string | null;
  ephemeral: boolean;
  expiresAt: string | null;
  baseUrl: string;
  /**
   * "byo"     — connected with the tester's own pasted sandbox credentials
   *             (their tenant; tenantId carries the clientId for confirmation).
   * "static"  — fixed env credentials (e.g. the live-env instance).
   * "sandbox" — the public demo path (auto-provisioned throwaway tenant).
   */
  mode?: "byo" | "static" | "sandbox";
}

export interface ApiError {
  error: string;
  status?: number;
  detail?: string;
}

/** Country dropdown for the "identify your company" step (ISO 3166-1 alpha-2). */
export const COUNTRIES: Array<{ iso: string; name: string }> = [
  { iso: "GB", name: "United Kingdom" },
  { iso: "SG", name: "Singapore" },
  { iso: "HK", name: "Hong Kong" },
  { iso: "CN", name: "China" },
];

/**
 * Sample companies the tester can use (shown in an on-page hint box). These are
 * the sandbox golden fixtures, so they always resolve by exact name even before
 * substring search is deployed.
 */
export const SAMPLE_COMPANIES: Array<{ name: string; iso: string; country: string; id: string }> = [
  { name: "Cropwell Bishop Creamery Limited", iso: "GB", country: "United Kingdom", id: "00364890" },
  { name: "SC Engineering Private Limited", iso: "SG", country: "Singapore", id: "200815219G (UEN)" },
  { name: "Ubizense Limited", iso: "HK", country: "Hong Kong", id: "69293323" },
];

// --- Account-opening questionnaire dropdown values --------------------------
// Bank-typical bands. Edit here to retune the questionnaire options.

export const SOURCE_OF_FUNDS = [
  "Business revenue",
  "Investment income",
  "Shareholder capital",
  "Financing or loans",
  "Other",
] as const;

export const TX_COUNT_BANDS = ["<10", "10-50", "50-200", "200-1000", "1000+"] as const;

export const TX_AMOUNT_BANDS = [
  "<$10k",
  "$10k-50k",
  "$50k-250k",
  "$250k-1m",
  ">$1m",
] as const;

export interface Questionnaire {
  authorisingName: string;
  authorisingEmail: string;
  sourceOfFunds: string;
  txCount: string;
  txAmount: string;
  countriesOfOperation: string;
}
