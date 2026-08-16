import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { getScoringMode, setScoringMode, type ScoringMode } from "@/lib/settings";

export const runtime = "nodejs";

const MODES: ScoringMode[] = ["auto", "on_demand", "off"];

export async function GET(): Promise<Response> {
  try {
    return ok({ mode: await getScoringMode() });
  } catch (error) {
    return handleError(error, "settings.scoringMode.get");
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJson<{ mode?: string }>(request);
    const mode = body.mode as ScoringMode | undefined;
    if (mode === undefined || !MODES.includes(mode)) {
      return badRequest(`mode must be one of: ${MODES.join(", ")}`);
    }
    await setScoringMode(mode);
    return ok({ ok: true, mode });
  } catch (error) {
    return handleError(error, "settings.scoringMode.put");
  }
}
