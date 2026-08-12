import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Gate every page and API route behind the session cookie.
 *
 * Two exceptions, both of which authenticate themselves:
 *   /login and /api/auth/*  — where the session is established
 *   /api/cron/*             — authenticated by CRON_SECRET bearer token
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/");

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Failing open would publish the whole app; fail closed with a clear cause.
    return new NextResponse(
      "AUTH_SECRET is not configured. See .env.example.",
      { status: 500 },
    );
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await verifySessionToken(token, secret);

  if (isPublic) {
    // Already signed in and staring at the login form: send them home.
    if (pathname === "/login" && authenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (authenticated) return NextResponse.next();

  // API callers get a status code they can act on, not an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
