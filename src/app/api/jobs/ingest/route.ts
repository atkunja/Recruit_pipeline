import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { fetchPosting } from "@/lib/jobs/fetch-posting";
import { ingestJob } from "@/lib/jobs/ingest";
import { loadProfileContext } from "@/lib/profile/context";
import { scoreJob } from "@/lib/scoring/score";
import { getJobDetail } from "@/lib/jobs/repository";
import { getScoringWeights } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  url?: string;
  company?: string;
  title?: string;
  location?: string;
  description?: string;
  /** Score immediately rather than waiting for the next discovery run. */
  score?: boolean;
}

/**
 * Manual job ingestion.
 *
 * Give it a URL and it will pull the posting from the ATS API when it
 * recognises one; anything you supply by hand wins over what was fetched.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<Body>(request);

    const url = body.url?.trim();
    if (!url) return badRequest("A job URL is required");

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return badRequest("That doesn't look like a valid URL");
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return badRequest("Only http(s) URLs are supported");
    }

    // Fetching is best-effort: a hand-filled form should still work when the
    // site blocks us.
    let fetched = null;
    let fetchError: string | null = null;
    try {
      fetched = await fetchPosting(url);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : "Could not fetch the page";
    }

    const company = body.company?.trim() || fetched?.companyName;
    const title = body.title?.trim() || fetched?.title;

    if (!company) {
      return badRequest(
        fetchError
          ? `Could not read the posting (${fetchError}). Enter the company name.`
          : "Could not determine the company. Enter it manually.",
      );
    }
    if (!title) {
      return badRequest("Could not determine the job title. Enter it manually.");
    }

    const { profile } = await loadProfileContext();

    const result = await ingestJob(
      {
        companyName: company,
        title,
        url,
        sourceKind: fetched?.sourceKind ?? "manual",
        sourceJobId: fetched?.sourceJobId ?? null,
        locationRaw: body.location?.trim() || fetched?.locationRaw || null,
        description: body.description?.trim() || fetched?.description || null,
        postedAt: fetched?.postedAt ?? null,
      },
      profile,
    );

    let score: number | null = null;
    if (body.score !== false) {
      const [detail, weights, context] = await Promise.all([
        getJobDetail(result.job.id),
        getScoringWeights(),
        loadProfileContext(),
      ]);
      if (detail) {
        const scored = await scoreJob({
          job: detail,
          companyName: detail.companyName,
          companyPreference: detail.companyPreference,
          context,
          weights,
        });
        score = scored.total;
      }
    }

    return ok({
      jobId: result.job.id,
      isNew: result.isNew,
      isDuplicate: result.isDuplicate,
      prefilter: result.job.prefilter,
      prefilterReasons: result.job.prefilterReasons,
      score,
      fetchError,
    });
  } catch (error) {
    return handleError(error, "jobs.ingest");
  }
}
