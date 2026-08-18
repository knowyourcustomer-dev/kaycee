// BFF: GET /api/cases/{id}/report -> stream the report to the browser.
// The bytes pass through the BFF; the bearer token stays server-side.
//
// Robust to a genuine binary PDF from the sandbox: we trust the upstream
// content-type (defaulting to application/pdf), echo Content-Length, and set an
// inline Content-Disposition with a sane filename so the browser opens it in a
// new tab (or downloads it) rather than trying to render bytes as a document.
//
// Failures come back as a small JSON envelope with the upstream status and a
// short human-readable `detail` (see src/lib/report-failure.mjs). The upstream
// body is NEVER echoed: a gateway timeout page or a proxy block page is HTML,
// and wrapping it in JSON is what a tester saw on 2026-08-18. A 200 whose body
// is not a PDF (a proxy answering in place of the API) is treated the same way
// rather than served as a "PDF" that no viewer can open.
import { kyc, KycApiError } from "@/server/kyc-client";
import { NotConnectedError } from "@/server/auth";
import { looksLikePdf, reportHeaders } from "@/lib/report-download";
import { RETRY_MESSAGE, describeReportFailure } from "@/lib/report-failure.mjs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { bytes, contentType, contentLength } = await kyc.getReportRaw(Number(id));
    if (!looksLikePdf(bytes)) {
      // Something answered 200 with a non-PDF body (typically an HTML page from
      // a proxy or gateway). Never hand that to the browser as a report.
      return Response.json(
        { error: "KYC API error", status: 502, upstreamStatus: 200, detail: RETRY_MESSAGE },
        { status: 502 },
      );
    }
    return new Response(bytes, { status: 200, headers: reportHeaders(id, contentType, contentLength) });
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return Response.json({ error: "not_connected", detail: err.message }, { status: 401 });
    }
    if (err instanceof KycApiError) {
      const { detail } = describeReportFailure(err.status, err.body);
      return Response.json(
        { error: "KYC API error", status: err.status, detail },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "BFF error", detail: message }, { status: 500 });
  }
}
