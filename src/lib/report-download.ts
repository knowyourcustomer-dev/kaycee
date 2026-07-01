/**
 * report-download.ts — pure helpers for the report download path, kept separate
 * so they can be unit-tested without a server (see tests/report-download.test.mjs).
 *
 * The report route must be robust to a genuine binary PDF coming back from the
 * sandbox: trust the upstream content-type (default application/pdf), echo the
 * length, and serve an inline disposition with a sane filename so the browser
 * opens it in a new tab / downloads it cleanly.
 */

export function reportFilename(caseId: number | string): string {
  return `kaycee-case-${caseId}-report.pdf`;
}

/** Build the response headers for a successful report download. */
export function reportHeaders(
  caseId: number | string,
  upstreamContentType: string | null | undefined,
  upstreamContentLength: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": upstreamContentType && upstreamContentType.trim() ? upstreamContentType : "application/pdf",
    "Content-Disposition": `inline; filename="${reportFilename(caseId)}"`,
    "Cache-Control": "no-store",
  };
  if (upstreamContentLength) headers["Content-Length"] = upstreamContentLength;
  return headers;
}

/** A buffer is a plausible PDF if it begins with the %PDF- magic bytes. */
export function looksLikePdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // "%PDF-" == 0x25 0x50 0x44 0x46 0x2D
  return u.length >= 5 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46 && u[4] === 0x2d;
}
