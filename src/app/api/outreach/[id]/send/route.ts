import { NextResponse } from "next/server";
import { badRequest, handleError, numericParam, ok } from "@/lib/api";
import { NotApprovedError, sendOutreach } from "@/lib/outreach/send";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Send an approved message. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const messageId = numericParam(id);
    if (messageId === null) return badRequest("Invalid message id");

    return ok(await sendOutreach(messageId));
  } catch (error) {
    if (error instanceof NotApprovedError) {
      return NextResponse.json(
        { error: error.message, code: "not_approved" },
        { status: 409 },
      );
    }
    return handleError(error, "outreach.send");
  }
}
