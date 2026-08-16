import { NextResponse } from "next/server";
import { badRequest, handleError, notFound, numericParam, ok } from "@/lib/api";
import { getJobDetail } from "@/lib/jobs/repository";
import { loadProfileContext } from "@/lib/profile/context";
import { scoreJob } from "@/lib/scoring/score";
import { getScoringMode, getScoringWeights } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Score one job, on request.
 *
 * This is the path that exists so discovery does not have to score everything
 * it finds. Scores are cached on (job, weights, description), so pressing the
 * button twice costs nothing the second time.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const jobId = numericParam(id);
    if (jobId === null) return badRequest("Invalid job id");

    if ((await getScoringMode()) === "off") {
      return NextResponse.json(
        {
          error: "Scoring is turned off. Enable it in Settings to score a job.",
          code: "scoring_off",
        },
        { status: 409 },
      );
    }

    const job = await getJobDetail(jobId);
    if (!job) return notFound("Job not found");

    const [context, weights] = await Promise.all([
      loadProfileContext(),
      getScoringWeights(),
    ]);

    const score = await scoreJob({
      job,
      companyName: job.companyName,
      companyPreference: job.companyPreference,
      context,
      weights,
    });

    return ok({
      total: score.total,
      summary: score.summary,
      components: score.components,
      missingRequirements: score.missingRequirements,
    });
  } catch (error) {
    return handleError(error, "jobs.score");
  }
}
