import { badRequest, handleError, notFound, numericParam, ok } from "@/lib/api";
import { approveResumeVersion, getResumeVersion } from "@/lib/resume/repository";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const versionId = numericParam(id);
    if (versionId === null) return badRequest("Invalid resume id");

    const version = await getResumeVersion(versionId);
    if (!version) return notFound("Resume version not found");

    // Approving a draft that failed the integrity check would defeat the whole
    // guard rail, so the server refuses rather than trusting the disabled button.
    if (!version.integrityOk) {
      return badRequest(
        "This resume failed the integrity check and cannot be approved. Regenerate or edit it first.",
      );
    }

    await approveResumeVersion(versionId);
    await logActivity({
      kind: "resume_approved",
      message: "Tailored resume approved",
      jobId: version.jobId,
      meta: { resumeVersionId: versionId },
    });

    return ok({ ok: true });
  } catch (error) {
    return handleError(error, "resume.approve");
  }
}
