import { badRequest, handleError, numericParam, ok } from "@/lib/api";
import { prepareJob } from "@/lib/pipeline/prepare";

export const runtime = "nodejs";
// Scoring plus tailoring is two model calls; give them room on Vercel.
export const maxDuration = 120;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const jobId = numericParam(id);
    if (jobId === null) return badRequest("Invalid job id");

    const result = await prepareJob(jobId);
    return ok(result);
  } catch (error) {
    return handleError(error, "jobs.prepare");
  }
}
