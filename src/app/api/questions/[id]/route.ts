import { badRequest, handleError, numericParam, ok, readJson } from "@/lib/api";
import { updateAnswer } from "@/lib/apply/answers";
import { sql } from "@/lib/db";
import { getSensitiveAnswers, setSetting } from "@/lib/settings";

export const runtime = "nodejs";

interface Body {
  answer?: string;
  approve?: boolean;
  /** For a sensitive question: remember this answer for next time. */
  savePreference?: boolean;
}

/** Edit and approve an answer. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const questionId = numericParam(id);
    if (questionId === null) return badRequest("Invalid question id");

    const body = await readJson<Body>(request);
    const answer = body.answer;
    if (typeof answer !== "string") return badRequest("answer is required");

    await updateAnswer(questionId, answer, body.approve === true);

    // Saving a self-identification answer is opt-in per question, so the
    // system only ever pre-fills something you explicitly chose to store.
    if (body.savePreference === true) {
      const rows = await sql<{ question: string; isSensitive: boolean }[]>`
        select question, is_sensitive from application_questions where id = ${questionId}
      `;
      const row = rows[0];
      if (row?.isSensitive === true) {
        const saved = await getSensitiveAnswers();
        saved[normalize(row.question)] = answer;
        await setSetting("sensitive_answers", saved);
      }
    }

    return ok({ ok: true });
  } catch (error) {
    return handleError(error, "questions.patch");
  }
}

function normalize(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[?:.]+$/, "").trim();
}
