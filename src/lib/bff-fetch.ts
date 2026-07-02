/**
 * bff-fetch.ts — tiny client-side helper that talks to OUR BFF (not the
 * sandbox). The browser never holds a credential or talks to the KYC API
 * directly; every call here hits /api/* on this same Next.js server.
 */

/**
 * Error thrown for non-2xx BFF responses; carries the HTTP status so the UI
 * can distinguish "not connected" (401 -> show the connect gate) from other
 * failures.
 */
export class BffError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "BffError";
  }
}

export async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = data?.detail || data?.error || `HTTP ${res.status}`;
    throw new BffError(
      typeof detail === "string" ? detail : JSON.stringify(detail),
      res.status,
    );
  }
  return data as T;
}
