import { badRequest, handleError, numericParam, ok, readJson } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { setJobIgnored } from "@/lib/jobs/repository";

export const runtime = "nodejs";

interface Body {
  ignored?: boolean;
  reason?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const jobId = numericParam(id);
    if (jobId === null) return badRequest("Invalid job id");

    const body = await readJson<Body>(request);
    const ignored = body.ignored ?? true;

    await setJobIgnored(jobId, ignored, body.reason ?? null);
    await logActivity({
      kind: ignored ? "job_ignored" : "job_unignored",
      message: ignored ? "Job ignored" : "Job restored to Discover",
      jobId,
      meta: body.reason ? { reason: body.reason } : {},
    });

    return ok({ ok: true, ignored });
  } catch (error) {
    return handleError(error, "jobs.ignore");
  }
}
