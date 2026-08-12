import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/pipeline/discover";
import { logActivity } from "@/lib/activity";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * Function timeout.
 *
 * Vercel's Hobby plan caps serverless functions at 60s; Pro allows up to 300s.
 * `maxDuration` is a request, not a guarantee — the platform enforces its own
 * ceiling — so the run is time-budgeted internally to finish well inside the
 * smaller limit. Polling all 419 boards takes about 47s, and the default
 * budget below leaves room for scoring on top of that across several runs
 * per day rather than trying to do everything in one.
 */
export const maxDuration = 300;

/** Fits inside the Hobby 60s ceiling. Raise with ?budgetMs= on Pro. */
const DEFAULT_BUDGET_MS = 50_000;

/**
 * Scheduled discovery.
 *
 * Called by Vercel Cron (see vercel.json) and authenticated with CRON_SECRET,
 * because this route sits outside the session middleware.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const url = new URL(request.url);
    const number = (key: string, fallback: number) => {
      const raw = url.searchParams.get(key);
      const parsed = raw === null ? NaN : Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const budgetMs = number("budgetMs", DEFAULT_BUDGET_MS);

    // Abort a little after the internal budget so partial results are still
    // written rather than the whole invocation being killed by the platform.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), budgetMs + 5_000);

    let result;
    try {
      result = await runDiscovery({
        maxSources: number("maxSources", 500),
        maxEnrichments: number("maxEnrichments", 60),
        maxScored: number("maxScored", 40),
        timeBudgetMs: budgetMs,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(deadline);
    }

    const seconds = Math.round((Date.now() - startedAt) / 1000);

    await logActivity({
      kind: "discovery_run",
      message:
        `Discovery: ${result.jobsNew} new, ${result.jobsDuplicate} duplicates, ` +
        `${result.scored} scored across ${result.sourcesRun} sources (${seconds}s)`,
      meta: { ...result, seconds },
    });

    return NextResponse.json({ ok: true, seconds, ...result });
  } catch (error) {
    return handleError(error, "cron.discover");
  }
}
