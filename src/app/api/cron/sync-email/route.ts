import { NextResponse } from "next/server";
import { syncGmail } from "@/lib/gmail/sync";
import { logActivity } from "@/lib/activity";
import { gmailStatus } from "@/lib/gmail/client";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Scheduled Gmail sync. Authenticated with CRON_SECRET. */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await gmailStatus();
    if (!status.connected) {
      return NextResponse.json({ ok: true, skipped: "gmail_not_connected" });
    }

    const result = await syncGmail();

    if (result.stored > 0) {
      await logActivity({
        kind: "email_sync",
        message:
          `Email sync: ${result.stored} recruiting messages, ` +
          `${result.statusUpdates} status updates, ${result.needsReview} need review`,
        meta: result,
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleError(error, "cron.syncEmail");
  }
}
