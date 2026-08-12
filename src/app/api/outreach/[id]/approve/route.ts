import { badRequest, handleError, numericParam, ok, readJson } from "@/lib/api";
import { sql } from "@/lib/db";
import { approveOutreach } from "@/lib/outreach/send";

export const runtime = "nodejs";

interface Body {
  /** Optional edits applied before approving. */
  subject?: string;
  body?: string;
}

/**
 * Approve a draft, optionally with edits.
 *
 * Approval is the explicit human step this whole feature is built around, so
 * it is its own route rather than a flag on send.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const messageId = numericParam(id);
    if (messageId === null) return badRequest("Invalid message id");

    const edits = await readJson<Body>(request);

    if (edits.subject !== undefined || edits.body !== undefined) {
      const subject = edits.subject?.trim();
      const text = edits.body?.trim();
      if (subject !== undefined && subject.length === 0) {
        return badRequest("Subject cannot be empty");
      }
      if (text !== undefined && text.length === 0) {
        return badRequest("Body cannot be empty");
      }

      await sql`
        update outreach_messages set
          subject    = coalesce(${subject ?? null}, subject),
          body       = coalesce(${text ?? null}, body),
          updated_at = now()
        where id = ${messageId} and status = 'draft'
      `;
    }

    return ok(await approveOutreach(messageId));
  } catch (error) {
    return handleError(error, "outreach.approve");
  }
}
