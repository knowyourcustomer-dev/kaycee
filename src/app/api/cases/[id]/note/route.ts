// BFF: POST /api/cases/{id}/note { note } -> attach the customer questionnaire
// to the case record as a step note. The note is attached to the case's first
// available step (the client doesn't need to know step ids); it then shows in
// the audit trail and the close report.
import { handle } from "@/server/bff";
import { kyc } from "@/server/kyc-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caseId = Number(id);
  const { note } = await req.json();
  return handle(async () => {
    // Resolve a step to hang the note on: first step of the first group.
    const groups = await kyc.getCaseSteps(caseId);
    const stepId = groups.flatMap((g) => g.steps)[0]?.caseStepId;
    if (!stepId) {
      throw new Error("No case step available to attach the questionnaire note to yet.");
    }
    return kyc.addCaseNote(caseId, stepId, note);
  });
}
