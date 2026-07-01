// BFF: GET /api/cases/{id}/report -> stream the report to the browser.
// The bytes pass through the BFF; the bearer token stays server-side.
//
// Robust to a genuine binary PDF from the sandbox: we trust the upstream
// content-type (defaulting to application/pdf), echo Content-Length, and set an
// inline Content-Disposition with a sane filename so the browser opens it in a
// new tab (or downloads it) rather than trying to render bytes as a document.
// Returns the upstream status (e.g. 409 while still building) as JSON so the
// client can show a clear message.
import { kyc, KycApiError } from "@/server/kyc-client";
import { handleExpiredSandbox } from "@/server/auth";
import { reportHeaders } from "@/lib/report-download";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { bytes, contentType, contentLength } = await kyc.getReportRaw(Number(id));
    return new Response(bytes, { status: 200, headers: reportHeaders(id, contentType, contentLength) });
  } catch (err) {
    if (err instanceof KycApiError) {
      if (err.status === 410) handleExpiredSandbox();
      const message =
        err.status === 409
          ? "The report is not ready yet — the case is still building."
          : err.body;
      return Response.json(
        { error: "KYC API error", status: err.status, detail: message },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "BFF error", detail: message }, { status: 500 });
  }
}
