import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/pipeline/discover";
import { logActivity } from "@/lib/activity";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";
// Vercel's ceiling on the Pro plan; Hobby caps lower and the run is bounded
// internally so it finishes either way.
export const maxDuration = 300;

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

    // Leave headroom under maxDuration so results are always written.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 260_000);

    let result;
    try {
      result = await runDiscovery({
        maxSources: number("maxSources", 60),
        maxEnrichments: number("maxEnrichments", 60),
        maxScored: number("maxScored", 40),
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
