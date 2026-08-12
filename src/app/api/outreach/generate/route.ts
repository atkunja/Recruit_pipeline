import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { generateOutreach } from "@/lib/outreach/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  contactId?: number;
  jobId?: number;
  applicationId?: number | null;
  kind?: "initial" | "follow_up" | "thank_you";
  instruction?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<Body>(request);

    if (typeof body.contactId !== "number") return badRequest("contactId is required");
    if (typeof body.jobId !== "number") return badRequest("jobId is required");

    const message = await generateOutreach({
      contactId: body.contactId,
      jobId: body.jobId,
      applicationId: body.applicationId ?? null,
      kind: body.kind,
      instruction: body.instruction ?? null,
    });

    return ok(message);
  } catch (error) {
    return handleError(error, "outreach.generate");
  }
}
