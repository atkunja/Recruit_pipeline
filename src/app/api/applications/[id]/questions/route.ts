import { badRequest, handleError, numericParam, ok, readJson } from "@/lib/api";
import { COMMON_QUESTIONS, generateAnswers, listQuestions } from "@/lib/apply/answers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const applicationId = numericParam(id);
    if (applicationId === null) return badRequest("Invalid application id");

    return ok(await listQuestions(applicationId));
  } catch (error) {
    return handleError(error, "applications.questions.get");
  }
}

interface Body {
  /** Questions to answer. Omit to use the common set. */
  questions?: { question: string; maxLength?: number }[];
}

/** Generate answers for this application's questions. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const applicationId = numericParam(id);
    if (applicationId === null) return badRequest("Invalid application id");

    const body = await readJson<Body>(request);
    const questions =
      body.questions && body.questions.length > 0
        ? body.questions
        : COMMON_QUESTIONS.map((question) => ({ question }));

    const answers = await generateAnswers({ applicationId, questions });
    return ok({ answers, needsReview: answers.filter((a) => a.needsReview).length });
  } catch (error) {
    return handleError(error, "applications.questions.post");
  }
}
