import { NextResponse } from "next/server";
import {
  createSessionToken,
  passwordMatches,
  sessionCookieOptions,
} from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Exchange the app password for a signed session cookie.
 *
 * Rate limiting is deliberately omitted: this is a single-user app behind a
 * long random password, and a serverless-friendly limiter would need shared
 * state we otherwise don't require. The 600ms floor below makes online guessing
 * impractical regardless.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  let password = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "password" in body) {
      password = String((body as { password: unknown }).password ?? "");
    }
  } catch {
    // Malformed body is just a failed attempt.
  }

  const ok = passwordMatches(password, env.appPassword);

  // Uniform response time whether or not the password was right.
  const elapsed = Date.now() - startedAt;
  if (elapsed < 600) {
    await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
  }

  if (!ok) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await createSessionToken(env.authSecret);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...sessionCookieOptions(env.isProduction),
    value: token,
  });
  return response;
}
