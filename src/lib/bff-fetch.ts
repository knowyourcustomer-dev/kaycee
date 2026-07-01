/**
 * bff-fetch.ts — tiny client-side helper that talks to OUR BFF (not the
 * sandbox). The browser never holds a credential or talks to the KYC API
 * directly; every call here hits /api/* on this same Next.js server.
 */

export async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = data?.detail || data?.error || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}
