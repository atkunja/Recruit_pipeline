import { handleError, ok, readJson } from "@/lib/api";
import { runDiscovery } from "@/lib/pipeline/discover";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  sourceIds?: number[];
  maxSources?: number;
  maxScored?: number;
  maxEnrichments?: number;
}

/** Run discovery on demand from Settings → Sources. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<Body>(request);

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 260_000);

    let result;
    try {
      result = await runDiscovery({
        sourceIds: body.sourceIds,
        // A manual run over one board should be quick; a manual run over
        // everything should still respect the same ceilings as the cron.
        maxSources: body.maxSources ?? 60,
        maxScored: body.maxScored ?? 25,
        maxEnrichments: body.maxEnrichments ?? 40,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(deadline);
    }

    await logActivity({
      kind: "discovery_run",
      message: `Manual discovery: ${result.jobsNew} new, ${result.scored} scored`,
      meta: result,
    });

    return ok(result);
  } catch (error) {
    return handleError(error, "sources.run");
  }
}
