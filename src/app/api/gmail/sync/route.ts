import { handleError, ok, readJson } from "@/lib/api";
import { syncGmail } from "@/lib/gmail/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  windowDays?: number;
  maxMessages?: number;
}

/** Sync recruiting mail on demand. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<Body>(request);
    const result = await syncGmail({
      windowDays: body.windowDays,
      maxMessages: body.maxMessages,
    });
    return ok(result);
  } catch (error) {
    return handleError(error, "gmail.sync");
  }
}
