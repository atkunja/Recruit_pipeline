import { badRequest, handleError, numericParam, ok } from "@/lib/api";
import { ensureApplication, setStatus } from "@/lib/applications/repository";

export const runtime = "nodejs";

/**
 * "I already applied to this."
 *
 * Records the application so the job stops appearing as a fresh opportunity
 * and so the prefilter rejects the same posting when another board surfaces it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const jobId = numericParam(id);
    if (jobId === null) return badRequest("Invalid job id");

    const application = await ensureApplication(jobId, "applied");
    const updated = await setStatus(
      application.id,
      "applied",
      "Marked as already applied",
    );

    return ok({ ok: true, applicationId: updated.id, status: updated.status });
  } catch (error) {
    return handleError(error, "jobs.applied");
  }
}
