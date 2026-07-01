// BFF: POST /api/individuals/{id}/documents/upload  (multipart/form-data)
// Uploads an INDIVIDUAL document (e.g. a UBO's photo ID) to that individual's
// OWN case. {id} is the member's caseCommonId resolved via the members linkage
// (see src/lib/member-resolve.ts), NOT the org-chart display name.
//
// Surfaces prevalidationMessages from the upload response (empty == accepted).
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") || "Identity document");
  const fileCat = String(form.get("fileCat") || "photoid");
  const fileName = String(
    form.get("fileName") || (file instanceof File ? file.name : "upload.bin"),
  );

  return handle(() => {
    if (!(file instanceof Blob)) {
      throw new Error("No file was provided in the upload.");
    }
    return kyc.uploadIndividualDocument(Number(id), { name, fileCat, file, fileName });
  });
}
