import { badRequest, handleError, numericParam, ok } from "@/lib/api";
import { setStatus } from "@/lib/applications/repository";

export const runtime = "nodejs";

/**
 * Mark an application as submitted.
 *
 * Called by the Playwright CLI after *you* confirm you pressed submit. The
 * automation never submits and never calls this on its own.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const applicationId = numericParam(id);
    if (applicationId === null) return badRequest("Invalid application id");

    const application = await setStatus(
      applicationId,
      "applied",
      "Submitted (confirmed by you in the application assistant)",
    );
    return ok({ ok: true, status: application.status });
  } catch (error) {
    return handleError(error, "applications.submitted");
  }
}
