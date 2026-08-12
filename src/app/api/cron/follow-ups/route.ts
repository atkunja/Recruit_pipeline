import { NextResponse } from "next/server";
import { runFollowUps } from "@/lib/outreach/follow-ups";
import { logActivity } from "@/lib/activity";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled follow-up drafting.
 *
 * Produces drafts and tasks only. Sending still requires an explicit approval,
 * so a misfiring schedule can waste a little money but can never email anyone.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFollowUps();

    if (result.drafted > 0) {
      await logActivity({
        kind: "follow_up_run",
        message: `Drafted ${result.drafted} follow-up(s) awaiting approval`,
        meta: result,
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleError(error, "cron.followUps");
  }
}
