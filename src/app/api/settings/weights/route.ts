import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { getScoringWeights, setScoringWeights } from "@/lib/settings";
import {
  ScoringWeightsSchema,
  componentTotal,
  type ScoringWeights,
} from "@/lib/scoring/weights";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return ok(await getScoringWeights());
  } catch (error) {
    return handleError(error, "settings.weights.get");
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJson<ScoringWeights>(request);
    const parsed = ScoringWeightsSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    }

    // The six components are a percentage breakdown; if they don't sum to 100
    // a "score" stops meaning what the UI says it means.
    const total = componentTotal(parsed.data);
    if (total !== 100) {
      return badRequest(
        `Component weights must add up to 100 (currently ${total}).`,
      );
    }

    await setScoringWeights(parsed.data);

    // Changing weights changes the score cache key, so existing scores stay
    // put and new ones are computed on the next discovery run.
    return ok({ ok: true, weights: parsed.data });
  } catch (error) {
    return handleError(error, "settings.weights.put");
  }
}
