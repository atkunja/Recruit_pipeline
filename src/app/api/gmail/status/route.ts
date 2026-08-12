import { handleError, ok } from "@/lib/api";
import { disconnectGmail, gmailStatus } from "@/lib/gmail/client";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return ok(await gmailStatus());
  } catch (error) {
    return handleError(error, "gmail.status");
  }
}

/** Disconnect: forgets the stored tokens. */
export async function DELETE(): Promise<Response> {
  try {
    await disconnectGmail();
    await logActivity({ kind: "gmail_disconnected", message: "Gmail disconnected" });
    return ok({ ok: true });
  } catch (error) {
    return handleError(error, "gmail.disconnect");
  }
}
