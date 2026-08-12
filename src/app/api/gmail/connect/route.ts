import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthUrl } from "@/lib/gmail/client";
import { handleError } from "@/lib/api";
import { env, isGmailConfigured } from "@/lib/env";

export const runtime = "nodejs";

/** Start the Gmail OAuth flow. */
export async function GET(): Promise<Response> {
  try {
    if (!isGmailConfigured()) {
      return NextResponse.json(
        {
          error:
            "Gmail is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        },
        { status: 400 },
      );
    }

    // CSRF protection: the callback only proceeds if the returned state
    // matches this cookie.
    const state = randomBytes(16).toString("hex");

    const response = NextResponse.redirect(buildAuthUrl(state));
    response.cookies.set({
      name: "gmail_oauth_state",
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProduction,
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return handleError(error, "gmail.connect");
  }
}
