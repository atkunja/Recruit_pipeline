import { NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/** Clear the session cookie. */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...sessionCookieOptions(env.isProduction),
    value: "",
    maxAge: 0,
  });
  return response;
}
