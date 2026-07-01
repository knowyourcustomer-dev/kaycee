// BFF: POST /api/cases/{id}/documents/upload  (multipart/form-data)
// Uploads a COMPANY document (e.g. the board resolution) to the company case.
// The browser sends the REAL file as a multipart part; the BFF forwards the
// bytes upstream as multipart (the real API rejects JSON with HTTP 415).
//
// Surfaces prevalidationMessages from the upload response (empty == accepted).
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") || "Document");
  const fileCat = String(form.get("fileCat") || "Corporate");
  const fileName = String(
    form.get("fileName") || (file instanceof File ? file.name : "upload.bin"),
  );

  return handle(() => {
    if (!(file instanceof Blob)) {
      throw new Error("No file was provided in the upload.");
    }
    return kyc.uploadCompanyDocument(Number(id), { name, fileCat, file, fileName });
  });
}
