import { NextResponse } from "next/server";
import { discoverBoards } from "@/lib/sources/board-discovery";
import { fetchYcCandidates } from "@/lib/sources/ycombinator";
import { logActivity } from "@/lib/activity";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly board discovery.
 *
 * Pulls YC's public company directory, keeps the US software companies that are
 * hiring, and probes each for a Greenhouse/Lever/Ashby board. Hits are
 * registered as `job_sources` and picked up by the normal discovery run.
 *
 * Incremental by design: every probe is recorded, so each week's run works
 * through companies it has not seen rather than repeating itself.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 260_000);

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 120);

    const candidates = await fetchYcCandidates(controller.signal);
    const result = await discoverBoards(candidates, {
      limit: Number.isFinite(limit) ? limit : 120,
      signal: controller.signal,
    });

    const seconds = Math.round((Date.now() - startedAt) / 1000);

    await logActivity({
      kind: "board_discovery_run",
      message:
        `Board discovery: probed ${result.probed} companies, found ${result.found} boards ` +
        `(${result.skipped} already known, ${seconds}s)`,
      meta: { ...result, candidates: candidates.length, seconds },
    });

    return NextResponse.json({
      ok: true,
      seconds,
      candidates: candidates.length,
      ...result,
    });
  } catch (error) {
    return handleError(error, "cron.discoverBoards");
  } finally {
    clearTimeout(deadline);
  }
}
