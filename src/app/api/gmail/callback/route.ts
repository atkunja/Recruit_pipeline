import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/gmail/client";
import { logActivity } from "@/lib/activity";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * OAuth callback.
 *
 * Public (the middleware exempts /api/gmail/callback is not exempt — Google
 * redirects the *browser* here, so the session cookie is present and the
 * middleware check passes normally).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const settings = new URL("/settings", env.appUrl);

  const error = url.searchParams.get("error");
  if (error !== null) {
    settings.searchParams.set("gmail", `error:${error}`);
    return NextResponse.redirect(settings);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const expected = (await cookies()).get("gmail_oauth_state")?.value;
  if (state === null || expected === undefined || state !== expected) {
    settings.searchParams.set("gmail", "error:state_mismatch");
    return NextResponse.redirect(settings);
  }

  if (code === null) {
    settings.searchParams.set("gmail", "error:missing_code");
    return NextResponse.redirect(settings);
  }

  try {
    const tokens = await exchangeCode(code);

    await logActivity({
      kind: "gmail_connected",
      message: `Gmail connected as ${tokens.email ?? "unknown account"}`,
    });

    settings.searchParams.set("gmail", "connected");
    const response = NextResponse.redirect(settings);
    response.cookies.delete("gmail_oauth_state");
    return response;
  } catch (caught) {
    console.error("[gmail.callback]", caught);
    settings.searchParams.set(
      "gmail",
      `error:${caught instanceof Error ? caught.message.slice(0, 120) : "exchange_failed"}`,
    );
    return NextResponse.redirect(settings);
  }
}
